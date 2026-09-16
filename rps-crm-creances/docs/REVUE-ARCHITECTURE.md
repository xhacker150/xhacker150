# REVUE D'ARCHITECTURE — RPS CRM CRÉANCES

Version 1.0 — 17/09/2026. Revue conduite par une équipe de quatre agents (données/SQL, application, intégration
& sécurité, recette) sur la version livrée le 16/09, complétée par la qualification du projet « RPS WORKFLOW »
(workflow v1). Ce document consigne les constats, les décisions du DG et l'état de correction. Il complète
`ARCHITECTURE.md` (cible) et ne se substitue ni au CDC-05 ni à `CLAUDE.md`.

## 1. Décisions du DG (16/09/2026)

| Sujet | Décision |
| --- | --- |
| Projet de référence pour les bases communes | « RPS WORKFLOW » (workflow v1) ; « WORKFLOW 2.0 » consulté en complément |
| Hébergement de la base CRM | **Projet Supabase dédié** « RPS CRM CREANCES » (à créer dès régularisation des factures Supabase) ; référentiels répliqués, pas partagés |
| Données réelles dans le dépôt | **Anonymisation** des copies (`docs/`, README, maquette) : témoins T1…T14 ; chiffres opposables §3.5 dans `recette/temoins.json` hors dépôt |

Conséquence de l'hébergement dédié (avertissement) : tant qu'un fournisseur d'identité commun (CDC-04) n'est pas
en place, chaque personne a **un compte par application**. Parade : le DG crée les comptes CRM avec les e-mails
réels des mêmes personnes (invitation Supabase, jamais de mot de passe en clair par e-mail) ; le modèle
`habilitations` est prêt pour un futur SSO.

## 2. Points bloquants (tous corrigés)

| # | Constat (agents) | Correction | Preuve |
| --- | --- | --- | --- |
| 1 | N'importe quel compte connecté pouvait se passer DG (`profils_soi` sans restriction de colonne) | trigger `proteger_profil()` : rôle, état, identité modifiables par le DG seul ; auto-désactivation interdite | `recette.sql` § 5a |
| 2 | Inscription libre + « premier inscrit = DG » = lecture de tout le portefeuille | plus d'inscription ; profils créés **inactifs** ; DG désigné par `installer_dg(email)` (installation) | § 0, 5a |
| 3 | Fonctions du pont et `recalculer_clients` exécutables par tout compte connecté | garde `exiger_pont()` (service ou DG/recouvrement) ; fonctions d'aide de rôle jamais NULL (trou détecté par la recette et corrigé) | § 5a |
| 4 | Lots non idempotents, extraction partielle acceptée → soldes faux, actions fermées à tort | `extraction_lots`, totaux annoncés, rejets comptés, refus d'extraction partielle (< 80 %) ou antérieure, forçage DG journalisé | § 6, 7 |
| 5 | Troncature silencieuse à 1 000 lignes (PostgREST) sur écritures, situation, export | lecture paginée `tout()`, agrégats mensuels en base (`facturation_mensuelle`) | code |
| 6 | Le recouvrement effaçait la limite de crédit fixée par le DG (champ désactivé non soumis) | trigger `proteger_limite_credit()` + action serveur n'envoyant la limite que pour le DG | § 5b |
| 7 | `journaliser()` appelable par `anon` (pollution du journal) | REVOKE + contrôle d'identité ; grants explicites, `ALTER DEFAULT PRIVILEGES` | § 5d |

## 3. Points importants : corrigés / reportés

**Corrigés** : régularisations neutres sur le solde mais hors cadence, hors « dernier règlement » et hors
fermeture automatique ; médiane « haute » comme la maquette ; promesse tenue en plusieurs règlements (cumul) ;
relance fermée seulement par un règlement « couvrant » (25 % paramétrable) ; plan de paiement affecté en FIFO
(échéances tenues, prochaine échéance, clôture) ; promesse échue → `non_tenue` + tâche J+1 au DG ; mise en demeure
obligatoire avant contentieux ; une seule action ouverte par type ; aucune suppression (trigger) ; écriture des
actions uniquement par fonctions ; `vue_ecritures` sans doublon, clés de pièce avec journal ; `clients_pipeline`
maintenue par trigger ; tableau de bord sur agrégats, top 10 et bouclage ; `jours_sans_reglement` sur l'horloge du
jour ; périmètre 411 hors 41180, bornes de dates, montants tolérants, journal en majuscules ; numéro de station
extrait (`station_numero`) ; ratio BV + blocage ; soldes par payeur, étiquette sur les bons, pièces multi-clients
détectées ; historique par client ; contrôle de rôle TypeScript en plus de la base ; erreurs jamais brutes ni
« écran vide rassurant » ; document officiel généré par action et numéroté ; redirection ouverte fermée ;
API du pont : clés multiples comparées en temps constant, débit, 413 explicite, journal de chaque appel (401
compris), battement, abandon ; chargement fichiers par lots depuis le navigateur ; pipeline complet (plan, mise en
demeure, soldés) ; mobile (colonnes défilantes, colonnes secondaires masquées) ; hors ligne palier 1 ; cache des
lectures de session ; compte SQL lecture seule prouvable ; pont avec reprise et lots idempotents ; recette SQL et CI.

**Reportés (lot C / décisions)** :
- Glisser-déposer du pipeline (les boutons couvrent les transitions ; à faire quand l'API WhatsApp sera branchée).
- Séquences N1–N4 **exécutées** automatiquement (aujourd'hui : palier suggéré, modèles, entrée automatique dans
  « À relancer », alertes) — nécessite la validation DG des modèles et la passerelle SMS/WhatsApp.
- Hors ligne palier 2 (pack terrain + boîte d'envoi).
- PDF côté serveur et classement GED automatique (bucket `crm-documents` créé, métadonnées en place).
- Fonction « solde à une date d'arrêté rétroactive » pour rejouer un témoin sans recharger les fichiers du jour.
- Push Web (rappels de promesses) : tables et patron du workflow réutilisables.

## 4. Bases héritées de « RPS WORKFLOW » (workflow v1)

Qualification en lecture seule (projet `afrarsanwpcviydkzako`, eu-west-1) : application « Circuit des dépenses »
sur un magasin clé-valeur `rps_kv` (RLS ouverte à tout utilisateur), 11 comptes Auth à e-mails synthétiques,
aucun référentiel stations, aucun tiers 411, aucun pont Sage, aucun SSO, pièces jointes en base64 (1,4 Go),
pg_cron + Vault, Resend, Web Push, sauvegarde et contrôle de santé quotidiens.

| Élément du workflow v1 | Décision pour le CRM | Réalisé |
| --- | --- | --- |
| `auth.users` partagé (SSO de fait) | Ignoré (projet dédié) ; mêmes e-mails réels, `habilitations` prête pour un SSO futur | migration 2 |
| Fiche utilisateur JSON, rôles admin/dex/dg/compta/caissier/tresorier | Ignoré ; `profils` + `role_enum` du CRM restent la référence | — |
| `app_metadata.role` (source forte) | Adapté : table `habilitations(user_id, application, role)` synchronisée depuis `profils` | migration 2 |
| « premier inscrit = admin », mots de passe en clair par e-mail | Ignoré ; `installer_dg()`, invitations Supabase, profils inactifs, `email_contact` | migration 2 |
| `rps_kv` + RLS `using(true)` | Ignoré (dette) | — |
| `rps_reserver_numero()` (compteur atomique) | Adapté : `reserver_numero('MED'|'REL'|'SIT')`, garde de rôle, REVOKE anon | migration 2 |
| `rps_sauvegarde_quotidienne()` (instantané, 14 j) | Adapté : `sauvegarde_quotidienne()` sur les tables d'écriture, + `pg_dump` 90 j | migration 2, cron |
| `controle-sante` (anomalies → e-mail admins) | Adapté : `controle_sante()` (extraction périmée, pont muet, promesses, habilitations, DG) | migration 2, cron |
| `recap-quotidien` | Adapté : `recapitulatif_quotidien()` + `/api/cron/recap` aux profils abonnés | migration 2, cron |
| Resend + gabarit e-mail charte | Repris aux couleurs CLAUDE.md (`src/lib/email.ts`), filtre de domaines | code |
| `_shared` : secrets en temps constant, débit, lecture paginée, filtre destinataires | Repris dans `src/lib/pont.ts`, `pagine.ts`, `email.ts` | code |
| pg_cron + Vault | Repris : jobs `crm-recalcul-nocturne`, `crm-sauvegarde-quotidienne` si pg_cron disponible, en doublon du cron Vercel | migration 2 |
| Pièces jointes en base64 en table | Ignoré ; bucket Storage privé `crm-documents` (politiques par rôle) | migration 2 |
| Référentiel stations / tiers 411 | Créés par le CRM (`stations` depuis les dépôts qr4, `vue_tiers_411`) : le CRM devient la source | migration 2 |
| Machine à états AD/BR, tranches BR, Web Push | Ignoré / phase ultérieure | — |
| Conventions (français snake_case, `timestamptz`, `cree_le`) | Reprises ; fuseau `Africa/Niamey` en paramètre | — |

Qualification de « WORKFLOW 2.0 » : en cours au moment de cette version ; ses apports éventuels seront ajoutés ici.

## 5. Recette (CDC-05 §9) — couverture après corrections

| Cas | Couverture |
| --- | --- |
| (1) chiffres API = fichiers au franc | `recette.sql` § 1 (synthétique) + `recette_temoins.sql` (réels, hors dépôt) + empreintes fichiers/API (README) |
| (2) règlement saisi → carte hors pipeline < 1 h | § 6 ; pont planifié toutes les heures (`pont/planification.md`) |
| (3) promesse non tenue → alerte J+1 au DG | tâche automatique au DG (`recalculer_clients`), contrôle de santé |
| (4) écriture SQL depuis l'API = échec par droits, tracé | `sql/00_compte_pont_lecture.sql` + `pont_rps.py verifier-lecture-seule` + SQL Server Audit |
| (5) coupure Sage simulée = bandeau, zéro chiffre inventé | bandeau de péremption, battement `sage_erreur`, contrôle de santé |
| (6) situation 4 volets au franc | page imprimable numérotée, volet 3 = chaque règlement |
| (7) utilisateur sans droit ne voit ni n'exporte rien | § 5a/5d, export réservé aux rôles autorisés et journalisé |
| (8) restauration de la veille < 1 h | sauvegarde quotidienne en base + `pg_dump` 90 j + projet de secours (README « Sauvegardes ») — à chronométrer en recette |
