# ARCHITECTURE — RPS CRM CRÉANCES

Version 1.0 — 16/09/2026. Dossier d'architecture de l'application livrée, rattaché au CDC-05 (contrat) et au
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
4. `POST /api/pont/extractions/{id}/lignes` par lots de 2 000 lignes, par jeu.
5. `POST /api/pont/extractions/{id}/activer` → transaction SQL `pont_activer_extraction()` :
   comptage, bascule `active` (index unique partiel : une seule extraction active), purge au-delà de 2 archivées,
   `recalculer_clients()`, fermeture automatique des actions couvertes, journal d'audit.
   Une extraction `en_cours` abandonnée est purgée au push suivant (après 1 h).

### 3.2 Extraction manuelle (mode fichiers)
Écran SOURCE → 4 fichiers TSV → même chaîne `pont_debut_extraction / pont_ajouter_lignes / pont_activer_extraction`,
exécutée par une server action avec les droits de l'utilisateur (DG ou recouvrement).

### 3.3 Lecture
Toutes les pages lisent `vue_clients` (calc + extension CRM + statut pipeline), `vue_ecritures`, `vue_livraisons`,
`vue_facturation` (filtrées sur l'extraction active) et les fonctions `tableau_de_bord()`, `alertes_du_jour()`.

### 3.4 Écriture CRM
Uniquement via `creer_action()`, `fermer_action()`, tables `clients_ext`, `messages_sortants`, `etiquettes_payeur`,
`reglements_liens`, `documents`, sous RLS. Chaque écriture est journalisée dans `audit`.

## 4. Modèle de données

```
extractions ──1:n── sage_clients / sage_facturation / sage_ecritures / sage_livraisons   (copies, remplacées)
clients_calc (1 ligne / compte, recalculée)  ──1:1── clients_ext (contacts, typologie manuelle, limite, chargé de compte)
actions (relance, promesse, plan, contentieux, note, tâche, appel) ──1:n── plans_echeances
messages_sortants, etiquettes_payeur, reglements_liens, documents, audit
profils (= auth.users), parametres (societe, seuils, sequences), modeles_messages
```

Formule (fonction `recalculer_clients`, par compte de l'extraction active) :
```
ran   = Σ RAN (débit − crédit)
fact  = Σ qr1.ht                     regle = Σ crédits hors RAN     debits_hors_ran = Σ débits hors RAN
solde = ran + fact + debits_hors_ran − regle          (< 0 : créditeur)
cadence = médiane des intervalles entre règlements ; seuil = min(45, max(10, 1,5 × cadence)) sinon 30
typologie_auto : créditeur | compte muet | BV / Bénin | grand compte à remises | fil de l'eau | au camion | standard
score 0-100 = 100 − retard/cadence (≤40) − muet (20) − limite dépassée (15) − promesses non tenues (≤20) − contentieux (25)
statut (vue_clients) : soldé | créditeur | contentieux | plan | promesse | relancé | à relancer | en cours
```

## 5. Sécurité

- **Lecture seule Sage** : garantie d'abord par les droits du compte SQL (`db_datareader` seul, `DENY INSERT, UPDATE,
  DELETE`), ensuite par le code (`readonly=True`, `ApplicationIntent=ReadOnly`). Aucune requête d'écriture n'existe
  dans le pont.
- **Réseau** : le pont sort en HTTPS vers Vercel ; rien n'entre. Le service FastAPI LAN est facultatif et ne sert que
  le contrat `/health`, `/crm/extract` de la maquette.
- **API du pont** : en-tête `X-API-Key` (= `PONT_API_KEY`), routes hors session utilisateur, clé service_role
  utilisée uniquement côté serveur (`src/lib/supabase/admin.ts`), jamais exposée au navigateur.
- **Utilisateurs** : Supabase Auth, comptes nominatifs, `profils.role` ∈ {dg, recouvrement, compta, exploitation,
  contrôle}. RLS sur toutes les tables : lecture pour tout utilisateur actif ; écriture des actions/fiches pour DG et
  recouvrement ; pointage (payeur, liens) pour la compta ; paramètres, modèles, rôles, audit pour le DG (audit aussi
  pour le contrôle de gestion). Les règles sensibles (promesse ≥ 50 %, contentieux = DG, créditeur jamais relancé)
  sont vérifiées **dans la base**, pas seulement dans l'interface.
- **Audit** : consultation d'une fiche, action, message, export, extraction, recalcul, changement de rôle.
- **Confidentialité** : aucune donnée réelle dans le dépôt (jeu synthétique), secrets en variables d'environnement.

## 6. Exploitation

| Sujet | Disposition |
| --- | --- |
| Péremption | Bandeau si l'extraction active a plus de `peremption_donnees_jours` (1) ; les chiffres restent ceux de la date affichée, jamais estimés |
| Coupure Sage / pont | Le CRM sert la dernière extraction datée ; le pont peut être relancé à la main ; secours = chargement des TSV |
| Coupure Vercel / Supabase | Retour à la maquette HTML locale sur les fichiers `sql_out` (mode fichiers), le pipeline CRM étant alors en lecture |
| Sauvegardes | Sauvegardes quotidiennes Supabase (plan Pro : 7 j, PITR en option) + export nocturne complémentaire recommandé (`pg_dump` via le pont) pour la rétention 90 j |
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

## 8. Points ouverts et suite
Voir `docs/REVUE-ARCHITECTURE.md` (revue par l'équipe d'architecture : données, application, intégration/sécurité,
recette) pour les écarts constatés, leur gravité et le plan de correction.
