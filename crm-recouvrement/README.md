# CRM Recouvrement

Application de **facturation, suivi de créances et recouvrement automatisé**, pensée comme un complément
« automation » de Sage : les tiers et les factures sont repris depuis les exports Sage, puis le CRM pilote les
relances, les encaissements, la balance âgée et le contentieux.

- **Front / API** : Next.js 15 (App Router, Server Actions, TypeScript), déployé sur **Vercel**.
- **Base de données & authentification** : **Supabase** (PostgreSQL 17, Auth, RLS). Toute la logique métier
  critique (numérotation, calcul des totaux, lettrage, moteur de relance) est en fonctions SQL transactionnelles.
- **Automatisation** : Vercel Cron appelle chaque matin `/api/cron/relances` qui fait avancer chaque facture échue
  dans son scénario de relance, détecte les promesses rompues et envoie les e-mails (Resend, optionnel).

## Fonctionnalités

| Module | Contenu |
| --- | --- |
| Tableau de bord | Encours, échu, DSO, taux de recouvrement, encaissements vs facturé sur 6 mois, balance âgée, top débiteurs, agenda du jour |
| Clients | Fiche tiers (NIF, RCCM, contact, délai de paiement, plafond de crédit, scénario de relance, agent), situation complète, historique |
| Factures | Saisie multi-lignes avec TVA, numérotation automatique `FAC-AAAA-NNNNNN`, brouillon/émission/annulation, vue imprimable (PDF via le navigateur), suspension des relances, litiges |
| Règlements | Encaissement (virement, chèque, espèces, mobile money…), **lettrage automatique FIFO** ou manuel, annulation avec recalcul des factures |
| Recouvrement | Agenda des actions (appel, e-mail, courrier, visite, mise en demeure, contentieux), traitement avec compte-rendu, promesses de paiement (tenues/rompues), litiges |
| Balance âgée | Par client : non échu, 1-30, 31-60, 61-90, 91-120, > 120 jours ; export CSV ; export détaillé des factures ouvertes |
| Scénarios de relance | Étapes paramétrables : délai après échéance (négatif = rappel avant échéance), canal, envoi automatique, modèle avec variables `{{client}} {{numero}} {{reste}} {{echeance}} {{jours_retard}}…`, blocage du client, passage en contentieux |
| Import / Export Sage | Import CSV des tiers et des factures/soldes (séparateur `;` ou `,`, dates `jj/mm/aaaa`, montants à la virgule, anti-doublon sur le n° de pièce), exports CSV |
| Paramètres | Société émettrice, devise, TVA, préfixes, mentions légales, réglages du moteur, gestion des utilisateurs et rôles (admin / gestionnaire / agent), journal d'audit |

### Moteur de relance

Chaque jour (ou à la demande via « Générer les relances du jour ») :

1. pour chaque facture `emise` ou `partiellement_payee`, non en litige, non suspendue, dont le client n'est ni en
   contentieux ni inactif, on cherche **l'étape suivante** du scénario du client (ou du scénario par défaut) ;
2. si le délai de l'étape est atteint (`date - échéance ≥ jours_apres_echeance`) et que le délai minimum entre deux
   relances est respecté, une **action de recouvrement** est créée avec le message rendu depuis le modèle ;
3. les rappels « avant échéance » sont ignorés si la facture est déjà en retard ;
4. selon l'étape, le client est **bloqué** ou passé en **contentieux** ; un client bloqué est réactivé
   automatiquement dès qu'il n'a plus d'échu ;
5. les actions e-mail automatiques sont envoyées si `RESEND_API_KEY` est configurée, sinon elles restent « à faire »
   dans l'agenda pour envoi manuel ;
6. les promesses de paiement dépassées passent en « rompue » et génèrent une action d'appel.

Le scénario standard livré : J-5 rappel → J+3 rappel courtois → J+15 relance 1 → J+30 appel → J+45 mise en demeure
(bloque le client) → J+60 contentieux (injonction de payer OHADA).

## Structure

```
crm-recouvrement/
├── supabase/
│   ├── migrations/20260915000000_schema.sql   # schéma complet : tables, vues, fonctions, RLS, scénarios par défaut
│   ├── seed.sql                               # données de démonstration (optionnel)
│   ├── test-scenario.sql                      # scénario de test SQL (base locale)
│   └── local-auth-stub.sql                    # émulation du schéma auth pour tester en local (jamais sur Supabase)
├── src/
│   ├── middleware.ts                          # rafraîchit la session Supabase, protège les pages
│   ├── lib/                                   # clients Supabase, formatage, CSV, e-mail, session
│   ├── components/                            # Sidebar, badges, formulaires facture / règlement / client
│   └── app/
│       ├── login/                             # connexion / création de compte
│       ├── (app)/                             # dashboard, clients, factures, reglements, recouvrement, creances, scenarios, import, parametres
│       └── api/cron/relances                  # traitement quotidien (Vercel Cron)
│       └── api/export/balance-agee            # exports CSV
├── test/                                      # tests unitaires (node --test)
├── vercel.json                                # planification du cron
└── .env.example
```

## Déploiement

### 1. Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (ou réutilisez-en un).
2. Ouvrez **SQL Editor** et exécutez le contenu de `supabase/migrations/20260915000000_schema.sql`
   (ou `supabase db push` avec la CLI Supabase).
3. Optionnel : exécutez `supabase/seed.sql` pour des données de démonstration.
4. **Authentication → Providers → Email** : activé. Pour un usage interne, désactivez « Confirm email » afin que les
   comptes soient utilisables immédiatement, ou créez les utilisateurs depuis **Authentication → Users**.
5. **Project Settings → API** : notez l'URL du projet, la clé `anon` (ou publishable) et la clé `service_role`.

Le **premier compte créé devient administrateur** ; les suivants sont « agents » jusqu'à modification dans
Paramètres → Utilisateurs.

### 2. Vercel

1. Importez le dépôt dans Vercel et définissez **Root Directory = `crm-recouvrement`**.
2. Variables d'environnement (voir `.env.example`) :

   | Variable | Rôle |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon / publishable |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé service_role (utilisée uniquement par le cron, côté serveur) |
   | `CRON_SECRET` | chaîne aléatoire ; Vercel l'envoie automatiquement au cron |
   | `RESEND_API_KEY` | optionnel : envoi des relances e-mail via [Resend](https://resend.com) |
   | `EMAIL_EXPEDITEUR` | optionnel : expéditeur par défaut, domaine vérifié chez Resend |

3. Déployez. Le cron `0 7 * * *` (07:00 UTC) est déclaré dans `vercel.json` ; il apparaît dans
   **Settings → Cron Jobs** du projet Vercel. Le plan Hobby autorise une exécution quotidienne.

### 3. Développement local

```bash
cd crm-recouvrement
cp .env.example .env.local   # renseignez les clés Supabase
npm install
npm run dev                  # http://localhost:3000
npm test                     # tests unitaires (CSV, formats)
npm run build                # compilation + vérification des types
```

Pour tester la migration et la logique métier SQL sans Supabase (PostgreSQL local) :

```bash
psql -d ma_base -f supabase/local-auth-stub.sql -f supabase/migrations/20260915000000_schema.sql
psql -d ma_base -f supabase/test-scenario.sql   # scénario complet, se termine par ROLLBACK
```

## Import depuis Sage

Exportez depuis Sage 100 (Comptabilité : plan tiers, grand livre / échéancier clients ; Gestion commerciale :
liste des documents de vente) au format CSV. Les en-têtes sont reconnus sans tenir compte de la casse ni des accents.

**Clients** : `Compte` (ou `Code`), `Intitulé`, `NIF`, `RCCM`, `Adresse`, `Ville`, `Pays`, `Téléphone`, `Email`,
`Contact`, `Délai paiement`, `Plafond crédit`. Un client existant (même code) est mis à jour.

**Factures / soldes** : `Compte`, `N° pièce`, `Date`, `Montant TTC` (ou `Débit`), `Échéance`, `Montant HT`,
`Réglé` (ou `Crédit`), `Libellé`. Chaque pièce devient une facture émise (une ligne « Import Sage ») ; le montant
déjà réglé est repris comme règlement lettré ; le n° de pièce sert de clé anti-doublon, l'import peut donc être
relancé sans risque.

## Sécurité

- Row Level Security activé sur toutes les tables : seuls les utilisateurs authentifiés et actifs accèdent aux
  données ; paramètres et profils réservés aux administrateurs, scénarios aux gestionnaires.
- Les vues sont en `security_invoker`, les fonctions métier en `SECURITY INVOKER` ; seules `generer_relances` et
  `verifier_promesses` sont en `SECURITY DEFINER` (exécutées par le cron avec la clé service_role).
- La clé `service_role` n'est jamais exposée au navigateur ; le cron est protégé par `CRON_SECRET`.
- Journal d'audit des créations / émissions / annulations de factures et règlements.
