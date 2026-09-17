# MISE EN SERVICE — RPS CRM CRÉANCES

Procès-verbal daté de la mise en service du projet Supabase dédié. Complète `README.md` (procédure) et
`docs/REVUE-ARCHITECTURE.md` (décisions). Aucune clé ni secret ici : ils vont dans les variables
d'environnement (Vercel) et le coffre du pont.

## 1. Fait le 17/09/2026

| Étape | Résultat |
| --- | --- |
| Projet Supabase « RPS CRM CREANCES » | créé dans l'organisation RPS, région **eu-west-3 (Paris)**, PostgreSQL 17, plan Pro (10 $/mois) ; ref `fwyfgfhusnwztjwjnhyi`, URL `https://fwyfgfhusnwztjwjnhyi.supabase.co` |
| Migrations | `20260916000000_rps_crm_creances.sql` (appliquée en 3 blocs : schéma, calcul/vues, actions/RLS), `20260917000000_bases_workflow.sql`, `20260917120000_durcissement_avis_securite.sql` — 31 tables, 46 fonctions, 34 politiques RLS |
| pg_cron | `crm-recalcul-nocturne` 04:00 UTC et `crm-sauvegarde-quotidienne` 02:00 UTC planifiés (doublon du cron Vercel) |
| Storage | bucket privé `crm-documents` (10 Mo, PDF/PNG/JPEG), politiques lecture (utilisateur actif) / écriture (pointage) |
| Paramétrage | `societe`, `seuils`, `sequences`, `exploitation` ; 5 modèles de messages non validés (le DG valide avant tout envoi) |
| Avis de sécurité Supabase | 25 fonctions sans `search_path` figé, 6 fonctions SECURITY DEFINER ouvertes à `anon`, `rafraichir_stations()` sans garde → corrigés par la migration de durcissement ; **plus aucun avis `anon`**. Les 14 avis restants concernent des fonctions SECURITY DEFINER volontairement ouvertes aux utilisateurs connectés (chacune vérifie le rôle en interne, recette § 5a/5d) et la table `sauvegardes_quotidiennes` sans politique (service seul, voulu) |
| Preuve des chiffres sur la base réelle | jeu synthétique (10 clients, 71 lignes de facturation, 129 écritures, 338 livraisons) chargé par `pont_debut_extraction` / `pont_ajouter_lignes` (5 lots, dont les livraisons en 2 lots) / `pont_activer_extraction` avec totaux annoncés : 0 rejet, **10 soldes au franc** égaux aux attendus Python, stations 07/12/15/21/31 extraites des dépôts, historique alimenté, contrôle de santé fonctionnel |
| Empreinte fichiers = API | empreinte MD5 de `clients_calc` (solde, RAN, réglé, débits, facturé, nb, cadence, seuil, typologie, score) identique entre PostgreSQL 16 local et Supabase 17 : `1e09c471967ae22208a323fdc700ea42` ; top 10 = 541 143 528,50 F, DSO 136 j, > 90 j 338 444 100 F, 4 à relancer |
| Purge | le jeu synthétique a été supprimé après vérification (extractions, calculs, historique, stations, audit) : le projet est vierge, paramètres et modèles conservés |

Correction de dépôt faite à cette occasion : `vers_numeric()` utilise désormais les échappements `  `
(espace insécable et fine) au lieu des caractères invisibles dans la source, comportement identique (recette OK).

## 2. Reste à faire par le DG (accès au tableau de bord Supabase et à Vercel requis)

1. **Authentication → Providers → Email** : « Allow new users to sign up » **désactivé** ; **Auth → Settings** :
   protection « mots de passe compromis » activée.
2. **Authentication → Users → Invite user** : inviter le DG avec son **e-mail réel**, puis chaque personne
   (recouvrement, compta, exploitation, contrôle). Chaque compte naît **inactif** sans rôle élevé.
3. **SQL Editor** : `SELECT installer_dg('adresse-du-dg');` — le DG active ensuite les autres comptes dans
   Paramètres → Utilisateurs de l'application. Le contrôle de santé signale « Aucun DG actif » tant que ce
   n'est pas fait.
4. **Project Settings → API** : relever la clé `anon` (ou `sb_publishable_…`) et la clé `service_role`.
5. **Vercel** : importer le dépôt, Root Directory `rps-crm-creances`, variables de `.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL` = URL ci-dessus, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `PONT_API_KEYS` et `CRON_SECRET` générés aléatoirement, `NEXT_PUBLIC_APP_URL`, facultatif `RESEND_API_KEY` /
   `EMAIL_EXPEDITEUR`). Les crons de `vercel.json` sont créés au déploiement.
6. **Vérification applicative** après déploiement : connexion DG, écran SOURCE (mode fichiers) avec le jeu
   synthétique `python3 pont/donnees_synthetiques.py --tsv`, fiche client, pipeline, situation 4 volets, export,
   `GET /api/pont/health` avec la clé du pont ; puis `pont_rps.py pousser-json` depuis RPS-SERVER et comparaison
   de l'empreinte (`SELECT md5(...) FROM clients_calc`, requête en § 1) entre les deux modes.
7. **Recette témoins CDC-05 §3.5** sur les fichiers réels du jour (annexe confidentielle hors dépôt,
   `recette/temoins.json`), procès-verbal daté à ajouter ici.

## 3. Requête d'empreinte (à rejouer après chaque chargement)

```sql
SELECT md5(string_agg(compte || '|' || solde || '|' || ran || '|' || regle || '|' || debits_hors_ran || '|' || facture
       || '|' || nb_reglements || '|' || COALESCE(cadence_jours::text, '') || '|' || seuil_alerte_jours || '|' || typologie_auto
       || '|' || score, ',' ORDER BY compte)) AS empreinte,
       tableau_de_bord()->>'total_top_10' AS top_10, tableau_de_bord()->>'dso_jours' AS dso
  FROM clients_calc;
```
