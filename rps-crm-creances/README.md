# RPS CRM CRÉANCES

CRM de suivi de la facturation, du recouvrement et des créances de **RISSA PETROLEUM SERVICE**, construit selon
`docs/CDC-05 - CRM CREANCES ET API DU PONT.md` (le contrat) et `maquette/RPS CRM CREANCES.html` (qui fait foi pour
l'ergonomie et les calculs). `CLAUDE.md` contient les règles métier non négociables.

- **Base CRM + authentification** : Supabase (PostgreSQL 17, Auth, RLS). Les extractions Sage y sont copiées en
  lecture ; la seule zone en écriture est la base CRM (actions, promesses, messages, audit). Tout calcul de solde est
  en SQL (`supabase/migrations/`), testé au franc sur données synthétiques.
- **Application** : Next.js 15 (App Router, Server Actions, TypeScript), hébergée sur Vercel. Français intégral,
  charte RPS, pages < 110 ko, utilisable au téléphone.
- **API du pont** : `pont/pont_rps.py` sur RPS-SERVER — SELECT-only sur Sage 100 (`READ UNCOMMITTED`), exécute les
  4 requêtes de référence de `sql/` et **pousse** l'extraction chaque matin vers le CRM. Sage n'est jamais exposé à
  Internet. Le mode « fichiers du pont » (chargement des 4 TSV de `sql_out`) reste le secours.

## Règles métier implémentées

| Règle (CDC-05) | Où |
| --- | --- |
| Solde économique = RAN + facturation gescom + débits hors RAN − règlements ; jamais la balance comptable | `recalculer_clients()` (migration), tuiles de la fiche |
| Règlements un à un (date, journal, pièce, référence) ; jamais de somme mensuelle en détail | onglet Règlements, volet 3 de la situation, chronologie |
| Périmètre 411 hors 41180 ; le numéro de station fait foi | requêtes `sql/`, colonne `station` déduite de l'intitulé de dépôt |
| Aucun chiffre inventé : « données du JJ/MM », bandeau si l'extraction n'est pas arrivée | en-tête, bandeau de péremption, `date_extraction` dans chaque réponse d'API |
| Lecture seule absolue sur Sage | `pont_rps.py` (`readonly`, `ApplicationIntent=ReadOnly`, aucune requête d'écriture) |
| Document officiel : facture du dernier mois clos (réserve « saisi jusqu'au »), relevé au-delà de 300 lignes | `/clients/[compte]/situation` (4 volets, charte 66/34, pied NIF 7272/R) |
| Alerte par cadence individuelle : 1,5 × médiane des intervalles, bornée 10-45 j ; filet 500 000 F / 30 j | `recalculer_clients()`, `vue_clients.decroche`, paramétrable |
| Typologies (grand compte à remises, fil de l'eau, au camion, BV/Bénin, compte muet, créditeur, collectif) | `typologie_auto()` + surcharge manuelle dans la fiche |
| Remise multi-clients, réglé via, régularisation, payeurs multiples | onglet Règlements → « qualifier » (`reglements_liens`, `etiquettes_payeur`) |
| Créditeur : relance interdite ; promesse ≥ 50 % du solde sinon plan ; contentieux = décision DG | `creer_action()` (refus SQL) |
| Une carte sort du pipeline dès que le règlement couvrant arrive | fermeture automatique à l'activation de chaque extraction |
| Scoring 0-100, limites de crédit (DG), prévision d'encaissements 30/60 j, promesses tenues | `clients_calc.score`, tableau de bord |
| Séquences N1-N4, modèles validés par le DG, WhatsApp (`wa.me`) / SMS / e-mail tracés | Paramètres → Modèles, fiche → Messages, `messages_sortants` |
| Comptes nominatifs, rôles (DG, recouvrement, compta, exploitation, contrôle), audit complet | `profils`, RLS, table `audit` (consultations, actions, exports, envois) |
| Aucune donnée réelle dans le dépôt | `pont/donnees_synthetiques.py` uniquement |

## Structure

```
rps-crm-creances/
├── CLAUDE.md, docs/, sql/, maquette/, api/openapi.yaml   # dossier de démarrage RPS (contrat, règles, requêtes éprouvées)
├── supabase/migrations/20260916000000_rps_crm_creances.sql  # schéma, vues, fonctions métier, RLS, paramètres, modèles
├── supabase/local-auth-stub.sql                          # émulation du schéma auth pour tester en local (jamais sur Supabase)
├── pont/pont_rps.py                                      # service du pont (FastAPI /health, /crm/extract) + commande « pousser »
├── pont/donnees_synthetiques.py, pont/test_pont.py       # jeu de test synthétique (10 clients, tous les pièges du §3)
├── src/app/(app)/dashboard | clients | recouvrement | facturation | source | parametres
├── src/app/api/pont/*                                    # réception des extractions (X-API-Key)
├── src/app/api/cron/recalcul                             # recalcul nocturne (Vercel Cron, 04:00 UTC)
└── src/app/api/export/clients                            # export CSV journalisé
```

## Mise en service

### 1. Supabase
1. Créer un projet (région eu-west-3) et exécuter `supabase/migrations/20260916000000_rps_crm_creances.sql` dans
   **SQL Editor** (ou `supabase db push`).
2. **Authentication → Providers → Email** activé ; pour un usage interne désactiver « Confirm email » ou créer les
   comptes depuis **Authentication → Users**. Le premier compte créé est le DG ; les suivants sont en lecture
   (« Direction exploitation ») jusqu'à attribution d'un rôle dans Paramètres → Utilisateurs.
3. Noter l'URL du projet, la clé `anon` et la clé `service_role`.

### 2. Vercel
Importer le dépôt, **Root Directory = `rps-crm-creances`**, variables d'environnement de `.env.example` :
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PONT_API_KEY`,
`CRON_SECRET`, `NEXT_PUBLIC_APP_URL`. Le cron de `vercel.json` recalcule scores et promesses chaque nuit.

### 3. Pont sur RPS-SERVER
```
pip install -r pont/requirements.txt          # pyodbc + pilote « ODBC Driver 17 for SQL Server »
copy pont\.env.example pont\.env               # renseigner CRM_URL et CRM_CLE_API (= PONT_API_KEY)
python pont\pont_rps.py pousser "D:\REPORTING CLAUDE RPS"   # extrait, écrit sql_out\qr*.txt (secours) et pousse vers le CRM
```
À planifier chaque matin (Planificateur de tâches Windows). Le compte SQL utilisé doit être **SELECT-only** : la
lecture seule est garantie par les droits de base, pas seulement par le code. Service LAN facultatif (contrat
`api/openapi.yaml`) : `uvicorn pont_rps:app --host 0.0.0.0 --port 8080`.

### 4. Premier chargement sans pont
Onglet **SOURCE** → charger `qr0_clients.txt`, `qr1_fact_clients.txt`, `qr3_ecr_clients.txt`, `qr4_livr_clients.txt`.

## Développement et tests

```bash
npm install && npm run dev        # http://localhost:3000 (avec .env.local)
npm test                          # tests unitaires (formats, TSV)
npm run build                     # compilation + types
python3 pont/donnees_synthetiques.py --tsv sql_out --json extraction.json --attendus
python3 -m pytest pont/           # tests du pont
```

Test de la logique métier SQL sur PostgreSQL local (sans Supabase) :
```bash
psql -d test -f supabase/local-auth-stub.sql -f supabase/migrations/20260916000000_rps_crm_creances.sql
python3 pont/donnees_synthetiques.py --sql charge.sql && psql -d test -f charge.sql
psql -d test -c "SELECT a.compte, a.solde, c.solde FROM attendus a JOIN clients_calc c USING (compte)"   # égalité au franc
```

## Recette (CDC-05 §3.5 et §9)
Les chiffres témoins réels (DIDI, SINOMA, SOTCO, Oudou Younoussa…) se vérifient en chargeant l'extraction du jour
d'arrêté correspondant : la fiche client doit afficher exactement le solde attendu, et la somme des 10 premiers
clients de la liste doit boucler avec le classement. Un règlement saisi en compta ferme la carte du pipeline à
l'extraction suivante (moins d'une heure si le pont tourne toutes les heures). Une coupure du pont laisse les
dernières données datées avec un bandeau, sans estimation.

## Lots
- **Lot A** (API du pont) : `pont/` + `src/app/api/pont/` — recette sur les témoins §3.5.
- **Lot B** (CRM v1) : auth et rôles, base CRM, tableau de bord, clients / fiche 360°, pipeline, promesses, situation 4 volets.
- **Lot C** (CRM v2) : séquences et modèles, WhatsApp / SMS / e-mail tracés, scoring et limites, prévision, audit, mobile.
  Reste à brancher en phase 2 : API WhatsApp Business et passerelle SMS locale (les envois sont aujourd'hui tracés,
  l'envoi lui-même passe par `wa.me`), classement GED (les métadonnées sont dans `documents`).
- **Lot D** : déploiement VPS / Vercel, formation, documentation.
