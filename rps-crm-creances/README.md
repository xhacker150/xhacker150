# RPS CRM CRÉANCES

CRM de suivi de la facturation, du recouvrement et des créances de **RISSA PETROLEUM SERVICE**, construit selon
`docs/CDC-05 - CRM CREANCES ET API DU PONT.md` (copie anonymisée du contrat) et `maquette/RPS CRM CREANCES.html`
(qui fait foi pour l'ergonomie et les calculs). `CLAUDE.md` porte les règles métier non négociables ;
`docs/ARCHITECTURE.md` la cible technique ; `docs/REVUE-ARCHITECTURE.md` les constats de la revue, les décisions
du DG et les bases héritées du projet « RPS WORKFLOW » ; `docs/REVERSIBILITE.md` les sauvegardes et la réversibilité.

- **Base CRM + authentification** : Supabase (PostgreSQL 17, Auth, RLS), **projet dédié** « RPS CRM CREANCES ».
  Les extractions Sage y sont copiées en lecture ; la seule zone en écriture est la base CRM. Tout calcul de solde est
  en SQL (`supabase/migrations/`), testé au franc sur données synthétiques à chaque commit (CI).
- **Application** : Next.js 15 (App Router, Server Actions, TypeScript), hébergée sur Vercel. Français intégral,
  charte RPS, pages ≈ 105 ko, utilisable au téléphone, mode dégradé lecture hors ligne.
- **Pont** : `pont/pont_rps.py` sur RPS-SERVER — SELECT-only sur Sage 100 (droits du compte SQL), exécute les
  4 requêtes de référence de `sql/` et **pousse** l'extraction vers le CRM par lots idempotents. Sage n'est jamais
  exposé à Internet. Le mode « fichiers du pont » (chargement des 4 TSV de `sql_out` depuis l'écran SOURCE) reste
  le secours.

## Règles métier implémentées

| Règle (CDC-05) | Où |
| --- | --- |
| Solde économique = RAN + facturation gescom + débits hors RAN − règlements ; jamais la balance comptable | `recalculer_clients()` ; régularisations neutres (hors cadence et fermetures) |
| Règlements un à un (date, journal, pièce, référence) | onglet Règlements, volet 3 de la situation, chronologie |
| Périmètre 411 hors 41180 ; le numéro de station fait foi | filtré en SQL au chargement ; `station_numero`, référentiel `stations` |
| Aucun chiffre inventé | « données du JJ/MM », bandeau de péremption, lecture paginée (jamais tronquée), agrégats en base, `date_extraction` dans chaque réponse d'API |
| Lecture seule absolue sur Sage | `sql/00_compte_pont_lecture.sql` (db_datareader + DENY + audit), `pont_rps.py verifier-lecture-seule` |
| Document officiel : dernier mois clos (réserve « saisi jusqu'au »), relevé au-delà de 300 lignes | `/clients/[compte]/situation`, numéroté (`SIT-AAAA-nnnn`), tracé |
| Alerte par cadence individuelle : 1,5 × médiane bornée 10-45 j ; filet 500 000 F / 30 j | `recalculer_clients()`, `vue_clients.decroche` ; paramétrable |
| Typologies, BV (ratio bons servis / réglés, blocage), payeurs multiples (soldes par payeur), pièces multi-clients, réglé via, régularisations | `typologie_auto()`, `bv_bloque`, `etiquettes_payeur`, `vue_soldes_payeur`, `vue_pieces_multi_clients`, `reglements_liens` |
| Créditeur jamais relancé ; promesse ≥ 50 % sinon plan ; mise en demeure puis contentieux = DG ; limite de crédit = DG | fonctions et triggers SQL + contrôle de rôle serveur |
| Une carte sort du pipeline dès que le règlement couvrant arrive | fermeture automatique à chaque activation (cumul des règlements, plan FIFO, règlement « couvrant ») |
| Scoring 0-100, prévision d'encaissements 30/60 j, promesses tenues, historique | `clients_calc`, `clients_historique`, tableau de bord |
| Séquences N1-N4, modèles validés par le DG, WhatsApp (`wa.me`) / SMS / e-mail / courrier tracés | Paramètres → Modèles, fiche → Messages |
| Comptes nominatifs créés par le DG (pas d'inscription), rôles, audit de chaque consultation, action, envoi, export, appel du pont | `profils`, `habilitations`, RLS, `audit` |
| Aucune donnée réelle dans le dépôt | copies anonymisées (témoins T1…T14), jeu synthétique, `recette/temoins.json` hors dépôt |

## Structure

```
rps-crm-creances/
├── CLAUDE.md, docs/, sql/, maquette/, api/openapi.yaml       # dossier de démarrage RPS (copies anonymisées)
├── supabase/migrations/20260916…_rps_crm_creances.sql        # schéma, vues, fonctions métier, RLS, paramètres, modèles
├── supabase/migrations/20260917…_bases_workflow.sql          # bases héritées du workflow : amorçage DG, stations, habilitations,
│                                                             #   numérotation, sauvegarde, contrôle de santé, récapitulatif, pg_cron, Storage
├── supabase/tests/recette.sql, lancer.sh, recette_temoins.sql # recette SQL (synthétique en CI ; témoins réels hors dépôt)
├── supabase/local-auth-stub.sql                              # émulation du schéma auth pour PostgreSQL local / CI
├── pont/pont_rps.py, planification.md, donnees_synthetiques.py, test_pont.py
├── sql/00_compte_pont_lecture.sql                            # compte SQL Server lecture seule + audit
├── src/app/(app)/dashboard | clients | recouvrement | facturation | source | parametres
├── src/app/api/pont/*, api/source, api/cron/{recalcul,recap}, api/export/clients
├── public/sw.js, manifest.webmanifest                        # mode dégradé lecture (palier 1)
└── ../.github/workflows/recette.yml                          # CI : tests, types, compilation, pytest, recette SQL
```

## Mise en service

### 1. Supabase (projet dédié)
1. Créer le projet « RPS CRM CREANCES » (eu-west-3) — nécessite une organisation Supabase sans facture impayée.
2. **SQL Editor** : exécuter `supabase/migrations/20260916000000_rps_crm_creances.sql` puis
   `supabase/migrations/20260917000000_bases_workflow.sql` (ou `supabase db push`). pg_cron et le bucket
   `crm-documents` sont créés s'ils sont disponibles.
3. **Authentication → Providers → Email** : activé, « Allow new users to sign up » **désactivé**, protection
   « mots de passe compromis » activée. **Authentication → Users** : créer le DG puis chaque personne avec son
   **e-mail réel** (invitation par lien, jamais de mot de passe en clair).
4. SQL Editor : `SELECT installer_dg('dg@rps.ne');` — le DG active ensuite les autres comptes dans Paramètres → Utilisateurs.
5. **Project Settings → API** : noter l'URL, la clé `anon` et la clé `service_role`.

### 2. Vercel
Importer le dépôt, **Root Directory = `rps-crm-creances`**, variables de `.env.example` : `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PONT_API_KEYS`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`,
et facultatif `RESEND_API_KEY` / `EMAIL_EXPEDITEUR` (alertes et récapitulatif). Crons de `vercel.json` : recalcul +
sauvegarde + contrôle de santé (04:00 UTC), récapitulatif (17:00 UTC).

### 3. Pont sur RPS-SERVER
Voir `pont/planification.md` : compte SQL lecture seule (`sql/00_compte_pont_lecture.sql`), preuve
`python pont_rps.py verifier-lecture-seule`, `.env` depuis le coffre, tâche planifiée **toutes les heures**
(07:00-19:00) sous le compte de service : `python pont_rps.py pousser "D:\REPORTING CLAUDE RPS"`.

### 4. Premier chargement sans pont
Onglet **SOURCE** → charger `qr0_clients.txt`, `qr1_fact_clients.txt`, `qr3_ecr_clients.txt`, `qr4_livr_clients.txt`
(envoi par lots depuis le navigateur ; les lignes rejetées sont listées ; une extraction partielle est refusée, le DG
peut forcer).

## Mode dégradé
- **Sage ou pont en panne** : le CRM sert la dernière extraction datée, bandeau « données du JJ/MM », battement
  `sage_erreur` visible dans Paramètres → Exploitation ; aucun chiffre n'est estimé.
- **CRM (Vercel/Supabase) en panne** : les pages déjà consultées restent lisibles hors ligne (service worker, datées) ;
  pour travailler, ouvrir la maquette `maquette/RPS CRM CREANCES.html` en mode « Fichiers du pont » sur le dossier
  `REPORTING CLAUDE RPS` (les TSV `sql_out` sont réécrits à chaque exécution du pont). Les actions saisies dans la
  maquette (`30_CLIENTS\data\crm_*.json`) se réimportent ensuite dans le CRM (écran SOURCE → reprise de la maquette).
- **Restauration** : `docs/REVERSIBILITE.md`.

## Développement et tests

```bash
npm install && npm run dev        # http://localhost:3000 (avec .env.local)
npm test                          # tests unitaires (formats, TSV)
npm run typecheck && npm run build
python3 -m pytest pont/           # tests du pont (données synthétiques)
npm run test:sql                  # recette SQL complète sur PostgreSQL local (PGHOST/PGUSER/PGPASSWORD)
```

La CI (`.github/workflows/recette.yml`) rejoue tout cela sur PostgreSQL 17 : 10 soldes au franc, RAN débiteur et
créditeur, débits hors RAN, régularisation neutre, remise multi-clients, réglé via, cadence (leçon du témoin T2),
bouclage top 10, refus métier, droits (compte inactif, lecture seule, anon, escalade de rôle), règlement → carte fermée,
lots idempotents, chargement tolérant, extraction partielle refusée, exploitation.

## Recette sur les témoins réels (CDC-05 §3.5)
Les chiffres opposables ne sont jamais dans le dépôt : copier `recette/temoins.json.example` en `recette/temoins.json`
(ignoré par git) et le renseigner depuis l'annexe confidentielle. Pour chaque date d'arrêté :
1. Charger l'extraction (`sql_out` archivé à cette date) par l'écran SOURCE (mode fichiers), noter l'`extraction.id`.
2. `psql -v temoins="$(cat recette/temoins.json)" -f supabase/tests/recette_temoins.sql` → chaque témoin au franc,
   bouclage top 10.
3. Pousser la même extraction par l'API (`python pont_rps.py pousser-json extraction_<date>.json`) et comparer les
   empreintes des données brutes des deux extractions :
   ```sql
   SELECT extraction_id, count(*), md5(string_agg(compte||'|'||date_ecriture||'|'||journal||'|'||coalesce(piece,'')||'|'||sens||'|'||montant, E'\n' ORDER BY compte, date_ecriture, ordre))
     FROM sage_ecritures WHERE extraction_id IN ('<id_fichiers>', '<id_api>') GROUP BY 1;
   ```
   puis rejouer l'étape 2 : mêmes chiffres. Archiver la sortie datée dans la GED (procès-verbal de recette).
4. Vérifier l'affichage (fiche, situation 4 volets, export CSV) et la maquette en mode fichiers sur les mêmes TSV.

## Lots
- **Lot A** (API du pont) : `pont/`, `sql/00_compte_pont_lecture.sql`, `src/app/api/pont/` — recette témoins §3.5.
- **Lot B** (CRM v1) : rôles, base CRM, tableau de bord, clients / fiche 360°, pipeline, promesses et plans, situation 4 volets.
- **Lot C** (CRM v2) : modèles et paliers N1-N4, messages tracés, scoring, limites, prévision, audit complet, mobile,
  hors ligne palier 1, contrôle de santé, récapitulatif. Reste : exécution automatique des séquences, API WhatsApp
  Business et passerelle SMS, PDF serveur et classement GED automatique, glisser-déposer, hors ligne palier 2.
- **Lot D** : déploiement, formation, documentation, transfert (`docs/REVERSIBILITE.md`).
