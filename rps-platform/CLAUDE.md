# CLAUDE.md — Plateforme RPS (Rissa Petroleum Service)

> Fichier de contexte lu automatiquement par Claude Code à chaque session.
> Il décrit le projet, les règles métier **intangibles**, la charte, le schéma
> de données et les conventions de développement. **À tenir à jour.**
>
> ⚠️ **Next.js 16** : lire aussi `AGENTS.md` (ce dépôt) — cette version comporte
> des changements de rupture (ex. `middleware` → `proxy`, voir `src/proxy.ts`).
> Consulter `node_modules/next/dist/docs/` avant de coder des conventions Next.

---

## 1. Le projet en une phrase

Plateforme web de pilotage du réseau de stations-service RPS : consolidation des
ventes (prises) issues de GESCOM, facturation clients, suivi des règlements et
créances, relances, commandes — déployée sur **Vercel + Supabase**, dans l'esprit
opérationnel d'un major pétrolier (Total / Shell / Vivo) avec la rigueur comptable
d'un ERP (Sage / Oracle).

**Phase en cours : SOCLE.** Objectif : base de données + import GESCOM + dashboard +
règlements/créances. Tout le reste (relances SMS, USSD, commandes avancées) vient après.

---

## 2. Stack technique (ne pas dévier sans raison)

| Couche | Choix | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | front + back dans un seul projet |
| Hébergement | **Vercel** | déploiement continu depuis Git, Vercel Cron |
| Base de données | **Supabase (PostgreSQL)** | migrations versionnées dans `/supabase/migrations` |
| Auth & rôles | **Supabase Auth + Row Level Security** | profils : `direction`, `controle`, `station` |
| Stockage | **Supabase Storage** | PDF émis, dépôts d'exports GESCOM |
| UI | **Tailwind CSS + shadcn/ui** | charte RPS ci-dessous |
| Graphiques | **Recharts** | reprend les graphiques du dashboard actuel |
| Tables | **TanStack Table** | tri / filtre / pagination |
| PDF | **@react-pdf/renderer** (ou Puppeteer) | factures, relevés, mini-relevés |
| Excel | **SheetJS (xlsx)** | export multi-onglets |
| Validation | **Zod** | toute saisie (règlements, commandes) |

**Conventions de code**
- TypeScript strict. Pas de `any` non justifié.
- Composants serveur par défaut ; client (`"use client"`) seulement si interaction.
- Logique métier (calculs encours, statuts, lettrage) dans `/lib`, testée unitairement.
- Accès base via le client Supabase typé (générer les types depuis le schéma).
- **Jamais** de secret en dur : variables d'environnement Vercel uniquement.
- Messages, libellés et commentaires **en français** (utilisateurs francophones).

---

## 3. RÈGLE D'OR INTANGIBLE

> **Les montants, quantités, dates et références client issus de GESCOM ne sont
> JAMAIS modifiés.** L'import est en lecture seule sur la source. Les règlements,
> commandes et corrections sont des données ajoutées *à côté*, traçées et horodatées,
> jamais des écrasements de la source.

Toute opération qui « corrige » une donnée source doit : (1) conserver la valeur
d'origine, (2) écrire la correction dans une table dédiée, (3) être journalisée.

---

## 4. Charte graphique RPS

- Rouge RPS : `#E30613` — Bleu RPS : `#0150DA`
- Encre : `#1b2330` — Texte secondaire : `#697586` — Fond clair : `#eef1f6`
- Vert (positif) : `#1d8a4e` — Ambre (alerte) : `#e08a00`
- Bandeau signature : dégradé rouge 0→62 %, bleu 62→100 %.
- Police titres : Montserrat ; texte : Inter.
- Logo : `/public/logo-rps.png` (header + documents PDF).

---

## 5. Formats et conventions métier (Niger / FCFA / SAGE)

- **Devise** : franc CFA (FCFA), **sans décimale** à l'affichage des montants.
- **Quantités (litres)** : 2 décimales.
- **Séparateur décimal source** : la VIRGULE (norme SAGE). Le parseur lit
  indifféremment `479,77` ou `479.77` mais l'import SAGE écrit toujours la virgule.
- **Dates** : affichage `JJ/MM/AAAA` ; stockage ISO (`date` PostgreSQL).
- **Produits** : `GASOIL`, `SUPER` (rapprochés : `GAS`→GASOIL, `SUP`→SUPER).
- **Type de vente** : `Espèces` ou `Crédit`.
- **Encodage SAGE** (pour les exports GESCOM uniquement) : latin-1/CP850, CRLF.
  Ne concerne QUE le fichier d'import SAGE, pas la base ni l'app (UTF-8 partout ailleurs).

---

## 6. Règles de traitement GESCOM (résumé — voir REGLES-TRAITEMENT-GESCOM-RPS.md)

Ces règles s'appliquent à l'**import** des prises. Le détail complet fait foi ;
voici l'essentiel à respecter dans le code d'ingestion :

1. **Identification station** par contenu : compte regroupement `41180XX`, sinon
   préfixe pièce `Fxx`, sinon code site (`TA-06`…). Pas seulement le nom de fichier.
2. **Une seule journée** retenue dans les fichiers multi-dates ; les autres dates
   sont écartées et listées (hors période).
3. **Dédoublonnage** : par pièce+date, et par CONTENU (même date/compte/client/lignes,
   pièces différentes → une seule conservée).
4. **Renumérotation** des pièces hors-format vers `F + n°station + TS + 4 chiffres`
   (ex. `F14TS0001`). Les pièces déjà conformes sont conservées.
5. **Comptes tiers** corrigés par rapprochement du nom (référentiel) — correction
   **ciblée par pièce**, jamais globale (ne jamais écraser un compte collectif).
6. **Compte collectif** (offset +40) = toujours un compte général (`tiers[0:4]+000`),
   jamais un n° de tiers ; jamais modifié par les corrections de tiers.
7. **Normalisation point→virgule** journalisée (sinon une vente en point est lue 0).
8. **Nettoyage espaces** début/fin de tous les champs (SAGE rejette « valeur␠ »).
9. **Dépôt** forcé à `code_site + nom_officiel` du référentiel ; **lieu de livraison**
   conservé tel quel depuis la source (ne pas forcer).
10. **EX-DEPOT-RIMBO** : traité à part sauf s'il a une facture du jour traité.
11. **Stations hors service** (fermées) : jamais comptées « manquantes ».
    Liste (9) : 07, 09, 10, 18, 19, 23, 40, 49, 50.
12. **Station manquante** = en service mais aucune prise transmise le jour (fichier
    absent OU facture vide/0 L).
13. **Anti-collision** : renuméroter toute pièce déjà présente dans SAGE.

Chaque correction/exclusion est **journalisée** dans la table `imports` / `import_anomalies`.

---

## 7. Modèle de données (voir schema.sql)

Tables socle : `stations`, `clients`, `produits`, `ventes` (prises GESCOM, lecture seule),
`prix` (barème par produit/date), `factures`, `facture_lignes`, `reglements`,
`reglement_affectations` (lettrage), `commandes`, `relances`, `imports`,
`import_anomalies`, `profils` (rôles). Vues : `v_encours_clients`, `v_factures_statut`,
`v_stations_manquantes`, `v_kpi_journalier`.

**Inspirations** :
- *Major pétrolier* : suivi par site (station), par produit, volumes en litres,
  barème de prix daté, notion de réseau (actif/hors service), wetstock à terme.
- *Sage / Oracle* : lettrage règlement↔facture (table d'affectations, pas de
  surécriture), compte tiers + compte collectif, échéancier, piste d'audit
  (horodatage + utilisateur sur chaque écriture), ancienneté de créance (aging).

---

## 8. Rôles et sécurité (RLS)

- `direction` : accès total (toutes stations, finances, paramètres).
- `controle` : lecture/écriture sur ventes, factures, règlements, créances ; pas
  de gestion des comptes utilisateurs.
- `station` : accès **restreint à sa propre station** (ses ventes, ses clients).

RLS active sur toutes les tables de données. Les vues respectent le périmètre du rôle.

---

## 9. Méthode de travail avec Claude Code

- Avancer par **petites étapes vérifiables** ; après chaque étape, écrire les tests
  et lancer l'app avant de continuer.
- Travailler dans **Git** (branche par fonctionnalité, commits clairs en français).
- Ne pas introduire de dépendance lourde sans la justifier ici.
- Avant d'écrire du code touchant l'import : relire la section 6 et le fichier
  de règles complet. En cas de doute sur une règle métier, **demander** plutôt que supposer.
- Quand une décision d'architecture est prise, **la consigner dans ce fichier**.

---

## 10. Définition de « terminé » pour la phase socle

- [ ] Migrations Supabase appliquées (toutes les tables + vues + RLS).
- [ ] Types TypeScript générés depuis le schéma.
- [ ] Import GESCOM fonctionnel respectant les règles 1→13, avec journal d'anomalies.
- [ ] Dashboard (KPI, graphiques, filtres, détail) sur données Supabase.
- [ ] Saisie des règlements + lettrage + vue des créances par ancienneté.
- [ ] Tests unitaires sur les calculs (encours, statut facture, ancienneté).
- [ ] Déploiement Vercel vérifié (preview + prod), secrets en variables d'env.
- [ ] Règle d'or respectée partout (aucune écriture sur les données source).

---

## 11. Décisions d'architecture (journal)

### Étape 1 — socle technique (faite)
- **Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui.** Tailwind v4
  est piloté par CSS (`@theme inline` dans `src/app/globals.css`), pas de
  `tailwind.config.ts`. La charte RPS est exposée en variables CSS + tokens
  (`--color-rps-rouge`, `--color-rps-bleu`…) et utilisable en classes
  (`bg-rps-rouge`, `text-rps-bleu`, `.rps-bandeau`).
- **Polices** via `next/font/google` : Inter (texte, `--font-inter`) et Montserrat
  (titres, `--font-montserrat`), chargées dans `src/app/layout.tsx`.
- **Client Supabase typé** (`src/lib/supabase/`) :
  - `client.ts` → composants client (clé anon, navigateur) ;
  - `server.ts` → composants serveur / Server Actions (cookies, `cookies()` async) ;
  - `service.ts` → clé `service_role`, **serveur uniquement** (import GESCOM, cron) ;
  - `types.ts` → type `Database` dérivé de `0001_init.sql`. **À régénérer** à
    l'étape 2 via `supabase gen types` une fois la migration appliquée.
- **Session** rafraîchie dans `src/proxy.ts` (le « middleware » de Next 16),
  défensif : si Supabase n'est pas configuré, la requête passe sans erreur.
- **Migrations** versionnées dans `supabase/migrations/` (0001_init, 0002_seed).
  SQL validé localement sur PostgreSQL 16 (toutes tables, vues, RLS, triggers).
- **Skill d'import** : le dossier `skill-gescom/` (scripts Python + référentiels +
  exemples réels) est la **spécification exécutable** de l'import (étape 3) — voir
  `IMPORT-GESCOM-POUR-CLAUDE-CODE.md`. Jeux de test : `prises_history.json`
  (730 lignes · 631 375 L · 348 334 450 FCFA), `missing_history.json`.
- **Non fait à l'étape 1** (volontaire, gates de validation du kit) : application de
  la migration sur le vrai projet Supabase + génération des types (étape 2),
  import (étape 3), dashboard (étape 4), règlements/créances (étape 5),
  déploiement Vercel (étape 6).

### Variables d'environnement
Voir `.env.example`. Projet Supabase cible : `yrzpjacgoqdopooalpsb`
(`https://yrzpjacgoqdopooalpsb.supabase.co`). Clés (anon, service_role) à placer
dans `.env.local` en dev et dans Vercel en production — **jamais** committées.
