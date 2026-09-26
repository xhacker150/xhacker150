# RÉVERSIBILITÉ ET SAUVEGARDES — RPS CRM CRÉANCES

Critère de recette de l'OM-2026-01 : RPS est propriétaire de tout et peut réinstaller le CRM ailleurs.

## Ce qui constitue le système
| Élément | Où | Comment le récupérer |
| --- | --- | --- |
| Code source (application, pont, migrations, tests, documentation) | dépôt git | `git clone` ; archive `.zip` de la branche livrée |
| Schéma et logique métier | `supabase/migrations/*.sql` | rejouables sur tout PostgreSQL ≥ 15 avec le stub `supabase/local-auth-stub.sql` si Supabase Auth est absent |
| Données CRM (actions, promesses, fiches, messages, audit, paramètres, modèles, stations, habilitations) | base Supabase | `pg_dump` (voir ci-dessous) ; instantané quotidien en base (`sauvegardes_quotidiennes`, 14 j) |
| Copies des extractions Sage | base Supabase (`sage_*`) | inutile à sauvegarder longtemps : rejouables depuis Sage ou depuis les `sql_out` archivés sur RPS-SERVER |
| Comptes utilisateurs | Supabase Auth | `supabase db dump --data-only --schema auth` (CLI), ou recréation par e-mail (`installer_dg`, activation DG) |
| Documents officiels | bucket `crm-documents` (+ GED `30_CLIENTS/<client>/`) | `supabase storage` (CLI) ; les métadonnées sont dans `documents` |
| Secrets | coffre RPS / variables Vercel et `.env` du pont | jamais dans le dépôt |

## Sauvegardes (CDC-05 §8 : quotidiennes, rétention 90 jours, restauration testée < 1 h)
1. **En base, chaque nuit (02:00)** : `sauvegarde_quotidienne()` (instantané JSON des tables d'écriture, 14 jours) — pg_cron ou cron Vercel.
2. **Supabase** : sauvegardes quotidiennes du plan Pro (7 jours) ; PITR en option (≤ 28 jours).
3. **Depuis RPS-SERVER, chaque nuit** (rétention 90 jours, copie au Niger et hors site) :
   ```
   pg_dump "postgresql://postgres.<ref>:<mot de passe>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres" \
     --format=custom --no-owner --schema=public --file="D:\Sauvegardes\crm\crm_%DATE%.dump"
   forfiles /p D:\Sauvegardes\crm /m *.dump /d -90 /c "cmd /c del @path"
   ```
   (tâche planifiée Windows sous le compte de sauvegarde ; le mot de passe vient du coffre.)
4. **Projet de secours** Supabase pré-créé (migrations appliquées, variables Vercel de bascule prêtes).

## Restauration (procédure à chronométrer en recette, objectif < 1 heure)
1. Créer ou vider la base cible ; appliquer `supabase/migrations/*.sql`.
2. `pg_restore --no-owner --data-only --schema=public crm_<date>.dump` (ou restauration Supabase / PITR).
3. Recréer les comptes manquants dans Auth (e-mails réels), `SELECT installer_dg('dg@…')`, réactiver les profils.
4. Pointer Vercel sur le projet restauré (`NEXT_PUBLIC_SUPABASE_URL`, clés) ; redéployer.
5. Relancer le pont (`python pont_rps.py pousser …`) pour recharger l'extraction du jour ; vérifier le tableau de bord et un témoin au franc.

## Réinstallation hors Supabase (réversibilité totale)
Le schéma dépend de `auth.uid()`, `auth.role()` et des rôles PostgREST (`anon`, `authenticated`, `service_role`) :
`supabase/local-auth-stub.sql` les fournit sur un PostgreSQL standard. L'application Next.js utilise `@supabase/ssr`
pour l'authentification ; hors Supabase, remplacer l'authentification par un autre fournisseur JWT compatible
PostgREST ou par une couche d'accès directe, le reste (pages, fonctions SQL, pont) étant inchangé.
