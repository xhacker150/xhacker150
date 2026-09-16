# ARCHITECTURE — RPS CRM CRÉANCES

Version 1.1 — 17/09/2026 (après revue d'architecture, voir `REVUE-ARCHITECTURE.md`). Dossier d'architecture de l'application livrée, rattaché au CDC-05 (contrat) et au
CDC-04 (hébergement). Les règles métier de `CLAUDE.md` et `REGLES-METIER-RPS.md` priment sur ce document.

## 1. Vue d'ensemble

```
   RPS-SERVER (LAN, Niamey)                         Internet                    Utilisateurs
 ┌───────────────────────────┐                                            ┌───────────────────┐
 │ Sage 100                  │                                            │ DG · recouvrement │
 │  SQL Server               │  SELECT-only                               │ compta · exploit. │
 │  RPS BD 26 (compta)       │◄──────────┐                                │ contrôle          │
 │  RPS NOUV BD (gescom)     │           │                                └────────┬──────────┘
 └───────────────────────────┘           │                                         │ HTTPS
                                 ┌───────┴────────┐   HTTPS POST (X-API-Key)  ┌────▼─────────────────────┐
                                 │ pont_rps.py    │──────────────────────────►│ Vercel : Next.js 15      │
                                 │ (tâche 07:00)  │   /api/pont/extractions   │  pages, server actions,  │
                                 │ + sql_out\*.txt│   … /lignes … /activer    │  /api/pont, /api/cron    │
                                 └────────────────┘                           └────┬─────────────────────┘
                                    (secours : fichiers                            │ supabase-js (RLS)
                                     chargés à la main)                       ┌────▼─────────────────────┐
                                                                              │ Supabase (eu-west-3)     │
                                                                              │  PostgreSQL 17 + Auth    │
                                                                              │  sage_* (copies lecture) │
                                                                              │  clients_calc, actions…  │
                                                                              └──────────────────────────┘
```

Principes structurants :
1. **Sage est la vérité des chiffres, jamais modifié.** Le CRM ne détient que des *copies datées* des 4 extractions
   de référence (qr0 clients, qr1 facturation mensuelle, qr3 écritures, qr4 livraisons) et sa propre couche métier.
2. **Le serveur pousse.** Sage n'est jamais exposé ; aucun flux entrant vers le LAN. Deux transports pour la même
   donnée : API (push par lots) et fichiers (`sql_out`, chargés depuis l'écran SOURCE) — secours et transition.
3. **Tout calcul opposable est en SQL**, dans une seule fonction (`recalculer_clients()`), testée au franc.
4. **Aucun chiffre sans sa date** : chaque écran et chaque réponse d'API porte `date_extraction` et `saisi_jusquau`.

## 2. Composants

| Composant | Technologie | Rôle | Fichiers |
| --- | --- | --- | --- |
| Pont | Python 3.11, pyodbc, FastAPI (facultatif) | Exécute `sql/qr*.sql` en lecture seule, écrit les TSV de secours, pousse vers le CRM | `pont/pont_rps.py` |
| Réception | Next.js Route Handlers | Ouvre une extraction, reçoit les lots, active | `src/app/api/pont/*` |
| Base | Supabase PostgreSQL 17 | Copies Sage, calculs, base CRM, RLS, audit | `supabase/migrations/*.sql` |
| Auth | Supabase Auth (e-mail / mot de passe, SSO CDC-04 à brancher) | Comptes nominatifs, profils et rôles | `profils`, `src/lib/supabase/*`, `src/middleware.ts` |
| Application | Next.js 15 App Router, server components + server actions, CSS vanille à la charte | Écrans métier | `src/app/(app)/*` |
| Traitements planifiés | Vercel Cron | Recalcul nocturne (scores, promesses échues) | `vercel.json`, `src/app/api/cron/recalcul` |
| Documents | Pages imprimables (PDF via le navigateur) | Situation 4 volets, courriers | `src/app/(app)/clients/[compte]/situation` |

## 3. Flux de données

### 3.1 Extraction quotidienne (mode API)
1. 07:00 — `pont_rps.py pousser` : 4 requêtes SELECT (`READ UNCOMMITTED`, `ApplicationIntent=ReadOnly`), calcul de
   `saisi_jusquau` (max `DO_Date` gescom), écriture des TSV de secours.
2. `GET /api/pont/health` (le CRM est joignable, date de l'extraction en place).
3. `POST /api/pont/extractions` → id (statut `en_cours`).
4. `POST /api/pont/extractions/{id}/lignes` par lots **numérotés** de 2 000 lignes (`extraction_lots` : un lot
   rejoué après un timeout est ignoré, jamais compté deux fois) ; lignes hors périmètre (≠ 411, 41180), aux dates
   ou montants invalides rejetées et comptées.
5. `POST /api/pont/extractions/{id}/activer` → transaction SQL `pont_activer_extraction()` : contrôles de
   complétude (totaux annoncés, rejets = 0, pas d'extraction antérieure ni partielle < 80 % — forçage DG journalisé),
   bascule `active` (index unique partiel), purge au-delà de 2 archivées, `recalculer_clients()`, fermeture
   automatique des actions couvertes, historique par client, référentiel stations, journal d'audit.
   Une extraction `en_cours` est marquée `abandonnee` après 6 h (ou par `DELETE`), purgée après 1 jour.
6. Chaque appel du pont (y compris un refus 401) est journalisé : chemin, statut, durée, IP, empreinte de clé.
   Le pont envoie un battement `ok` / `sage_erreur` / `crm_erreur` à chaque exécution.

### 3.2 Extraction manuelle (mode fichiers)
Écran SOURCE → 4 fichiers TSV lus dans le navigateur et envoyés par lots à `/api/source` (session utilisateur,
rôle DG / recouvrement vérifié par la base) → même chaîne `pont_debut_extraction / pont_ajouter_lignes /
pont_activer_extraction`. Dépasse la limite de 4,5 Mo par appel des fonctions Vercel.

### 3.3 Lecture
Toutes les pages lisent `vue_clients` (calc + extension CRM + statut pipeline), `vue_ecritures`, `vue_livraisons`,
`vue_facturation` (filtrées sur l'extraction active) et les fonctions `tableau_de_bord()`, `alertes_du_jour()`.

### 3.4 Écriture CRM
Les actions ne s'écrivent **que** par `creer_action()` / `fermer_action()` (SECURITY DEFINER : règles métier +
journal) ; un trigger rejoue les règles et interdit toute suppression. Tables directes sous RLS : `clients_ext`
(limite de crédit réservée au DG par trigger), `messages_sortants` (jamais de relance vers un créditeur),
`etiquettes_payeur`, `reglements_liens`, `documents`. Chaque écriture est journalisée dans `audit`.

## 4. Modèle de données

```
extractions ──1:n── extraction_lots ; sage_clients / sage_facturation / sage_ecritures / sage_livraisons (copies)
clients_calc (1 ligne / compte, recalculée) ──1:1── clients_ext ──1:1── clients_pipeline (agrégats d'actions, par trigger)
clients_historique (solde, score par extraction) · stations (depuis les dépôts qr4) · vue_tiers_411
actions (relance, promesse, plan, mise_en_demeure, contentieux, note, tâche, appel) ──1:n── plans_echeances
messages_sortants, etiquettes_payeur (règlements ET bons), reglements_liens, documents (numérotés), audit
profils (= auth.users, e-mail de contact) ──1:1── habilitations · parametres (societe, seuils, exploitation) · modeles_messages
compteurs (MED/REL/SIT) · sauvegardes_quotidiennes
```

Formule (fonction `recalculer_clients`, par compte de l'extraction active) :
```
ran   = Σ RAN (débit − crédit)
fact  = Σ qr1.ht                     regle = Σ crédits hors RAN     debits_hors_ran = Σ débits hors RAN
solde = ran + fact + debits_hors_ran − regle          (< 0 : créditeur)   — les régularisations (OD « REGUL… » ou
        lien « régularisation ») comptent dans le solde (neutres) mais ni dans la cadence, ni dans le dernier règlement
cadence = médiane « haute » des intervalles entre règlements effectifs (comme la maquette) ;
          seuil = min(45, max(10, 1,5 × cadence)) sinon 30 (filet) ; jours sans règlement sur l'horloge du jour
typologie_auto : créditeur | compte muet | BV / Bénin | grand compte à remises | fil de l'eau | au camion | standard
ratio_bv = bons servis de l'exercice / réglés ; bv_bloque si > bv_ratio_max (1,5)
score 0-100 = 100 − retard/cadence (≤40) − muet (20) − limite dépassée (15) − promesses non tenues (≤20) − contentieux (25) − BV bloqué (15)
statut (vue_clients) : créditeur | soldé | contentieux | mise en demeure | plan | promesse | relancé | à relancer | en cours
fermetures automatiques : solde ≤ 1 000 ; promesse : cumul des crédits ≥ 98 % ; plan : FIFO sur les échéances ;
relance : crédits ≥ 25 % du solde à la relance ; promesse échue + 7 j → « non tenue » + tâche au DG
```

## 5. Sécurité

- **Lecture seule Sage** : garantie d'abord par les droits du compte SQL (`db_datareader` seul, `DENY INSERT, UPDATE,
  DELETE`), ensuite par le code (`readonly=True`, `ApplicationIntent=ReadOnly`). Aucune requête d'écriture n'existe
  dans le pont.
- **Réseau** : le pont sort en HTTPS vers Vercel ; rien n'entre. Le service FastAPI LAN est facultatif et ne sert que
  le contrat `/health`, `/crm/extract` de la maquette.
- **API du pont** : en-tête `X-API-Key` (liste `PONT_API_KEYS`, rotation à chaud, comparaison en temps constant),
  limitation de débit, corps > 4,4 Mo refusés, journalisation de chaque appel ; clé service_role utilisée
  uniquement côté serveur (`src/lib/supabase/admin.ts`), jamais exposée au navigateur.
- **Utilisateurs** : Supabase Auth, comptes nominatifs créés par le DG (pas d'inscription libre), profils créés
  **inactifs**, DG désigné à l'installation (`installer_dg`), `profils.role` ∈ {dg, recouvrement, compta,
  exploitation, contrôle}, rôle et état modifiables par le DG seul (trigger). RLS sur toutes les tables : lecture
  pour tout utilisateur actif ; actions par fonctions pour DG et recouvrement ; pointage (payeur, liens) pour la
  compta ; paramètres, modèles, rôles, audit pour le DG (audit aussi pour le contrôle de gestion). Les règles
  sensibles (promesse ≥ 50 %, mise en demeure puis contentieux = DG, créditeur jamais relancé, limite = DG) sont
  vérifiées **dans la base** (fonctions et triggers), et de nouveau côté serveur TypeScript.
- **Audit** : consultation d'une fiche, action, message, export, extraction, recalcul, changement de rôle.
- **Confidentialité** : aucune donnée réelle dans le dépôt (jeu synthétique), secrets en variables d'environnement.

## 6. Exploitation

| Sujet | Disposition |
| --- | --- |
| Péremption | Bandeau si l'extraction active a plus de `peremption_donnees_jours` (1) ; les chiffres restent ceux de la date affichée, jamais estimés |
| Coupure Sage / pont | Le CRM sert la dernière extraction datée ; le pont peut être relancé à la main ; secours = chargement des TSV |
| Coupure Vercel / Supabase | Retour à la maquette HTML locale sur les fichiers `sql_out` (mode fichiers), le pipeline CRM étant alors en lecture |
| Sauvegardes | Instantané quotidien des tables d'écriture en base (14 j, `sauvegarde_quotidienne`) + sauvegardes Supabase (plan Pro : 7 j, PITR en option) + `pg_dump` nocturne depuis RPS-SERVER, rotation 90 j (README) ; projet de secours pré-provisionné, restauration chronométrée en recette |
| Contrôle de santé | Chaque nuit : extraction périmée, pont muet, promesses sans décision, habilitations incohérentes, DG actif, sauvegarde absente → e-mail aux administrateurs seulement en anomalie |
| Hors ligne | Palier 1 : service worker (pages déjà vues consultables, datées), bandeau « hors ligne », actions désactivées |
| Réversibilité | Code source (dépôt), schéma et données (`pg_dump`), documentation ; RPS propriétaire |
| Performances | 180 clients : `clients_calc` précalculée, vues filtrées sur l'extraction active, pages < 110 ko, pipeline et fiche < 1 s |
| Planification | Pont 07:00 (Windows), recalcul CRM 04:00 UTC (Vercel Cron) ; un push horaire est possible pour la recette « < 1 h » |

## 7. Décisions d'architecture (ADR)

| # | Décision | Alternatives écartées | Motif |
| --- | --- | --- | --- |
| 1 | Copier les extractions dans Supabase plutôt que d'interroger le LAN en direct | API LAN appelée par le CRM, VPN | Sage jamais exposé ; le CRM reste utilisable hors LAN et hors panne du pont ; données datées |
| 2 | Calculs en fonctions SQL | Calcul TypeScript | Une seule implémentation opposable, testable au franc, identique pour l'écran, l'export et le document |
| 3 | Statut pipeline dérivé (vue) et non stocké | Colonne statut éditable | La donnée Sage commande : un règlement sort la carte sans intervention humaine |
| 4 | Next.js server components + server actions, CSS vanille | SPA React + API REST, Tailwind | Pages légères pour la 3G, pas de client lourd, moins de surface d'attaque |
| 5 | Push par lots avec activation transactionnelle | Un seul POST | Limite 4,5 Mo des fonctions Vercel, reprise possible, bascule atomique |
| 6 | Modèles de messages validés par le DG, envoi WhatsApp via `wa.me` en phase 1 | API WhatsApp Business dès la v1 | Coût et délai ; l'envoi reste tracé ; passage à l'API en phase 2 sans changer le modèle de données |
| 7 | Projet Supabase dédié, référentiels répliqués (décision DG) | Schéma `crm` dans le projet Workflow (SSO de fait) | Isolation dépenses / créances ; SSO commun à traiter par un IdP (CDC-04) ; `habilitations` prête |
| 8 | Chargement par lots numérotés idempotents, activation contrôlée | Un seul POST, activation immédiate | Limite Vercel 4,5 Mo, reprise sans doublon, jamais de fermeture d'action sur une extraction partielle |
| 9 | Écriture des actions uniquement par fonctions SQL | Politiques RLS d'écriture directe | Règles métier et journal inévitables, preuve intacte (pas de suppression) |

## 8. Points ouverts et suite
Voir `docs/REVUE-ARCHITECTURE.md` : constats de la revue, décisions du DG, corrections réalisées, points reportés
au lot C, et tableau des bases héritées du projet « RPS WORKFLOW ». Région du projet Workflow : eu-west-1 ; le
projet dédié du CRM sera créé en eu-west-3.
