# Guide de déploiement — ERP Stations-service (Supabase + Claude)

ERP multi-postes pour réseau de stations-service : carburant Super/Gasoil, comptabilité SYSCOHADA (XOF), saisie hors-ligne, et une **analyse par Claude** qui détecte les fraudes, dégage les tendances et calcule les prévisions.

Principe de fiabilité : **la base de données calcule les chiffres exacts** (totaux, écarts caisse, volumes, cumuls clients) ; **Claude raisonne sur ces chiffres** pour juger ce qui est suspect, expliquer et prévoir. Claude ne recalcule pas les montants, ce qui évite les erreurs d'arithmétique d'un modèle de langage et garantit des chiffres justes.

Fichiers :

- `schema.sql` — base de données, partie double, piste d'audit, RLS, **fonction `dossier_analyse`** (chiffres exacts pour Claude) et table `alertes`.
- `functions/analyse-claude.ts` — Edge Function unique : appelle Claude (fraudes + tendances + prévisions) et enregistre les fraudes détectées.
- `app.html` — application web (onglet « IA & Alertes »).
- `supabase-config.js` — configuration (URL + clé anon).

---

## 1. Projet Supabase

1. https://supabase.com → **New project**. Nom, mot de passe BDD (à noter), région proche (ex. `eu-central`).
2. Attendre le provisionnement (~1 min).

## 2. Base de données

1. **SQL Editor → New query**, coller tout `schema.sql`, **Run**. Idempotent.
2. Il crée les tables, la comptabilité en partie double (contrôle d'équilibre débit=crédit), la piste d'audit immuable, le verrouillage des fiches clôturées, la RLS, la table `alertes`, et la fonction `dossier_analyse(station, année, mois)` qui produit le dossier chiffré exact analysé par Claude.

## 3. Configuration de l'application

1. **Project Settings → API** : copier **Project URL** et **anon public**.
2. Les coller dans `supabase-config.js`.

## 4. Authentification

- **Authentication → Providers → Email** activé.
- Pour les tests, désactiver « Confirm email » afin de vous connecter immédiatement (réactivable ensuite).
- Le **premier compte créé devient administrateur**.

## 5. Clé Claude + déploiement de la fonction d'analyse

L'analyse Claude est obligatoire (pas de repli). Il faut une clé API Anthropic, stockée comme **secret serveur** (jamais dans l'app).

1. Obtenir une clé sur https://console.anthropic.com.
2. Installer la CLI (une fois) : `npm install -g supabase`
3. Se connecter et lier le projet :
   ```
   supabase login
   supabase link --project-ref VOTRE_REF_PROJET
   ```
4. Enregistrer la clé comme secret :
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
5. Déployer la fonction (arborescence attendue par la CLI) :
   ```
   # supabase/functions/analyse-claude/index.ts = contenu de functions/analyse-claude.ts
   supabase functions deploy analyse-claude
   ```

La fonction transmet le jeton de l'utilisateur : **la RLS s'applique** (un gérant n'analyse que sa station). Modèle utilisé : `claude-opus-4-8`, modifiable en une ligne dans la fonction.

## 6. Tester l'application

Servir les fichiers par un serveur (pas en double-clic) :

```
python -m http.server 5173      # puis http://localhost:5173/app.html
```

ou déposer sur Netlify Drop / Vercel / Cloudflare Pages (renommer `app.html` en `index.html`).

---

## Comment fonctionne l'analyse Claude

Dans l'onglet **IA & Alertes**, le bouton « Analyser avec Claude » lance :

1. La base produit le **dossier exact** du mois : pour chaque jour, volumes, bons, recette cash théorique `(volume − bons) × prix du jour`, versement du pompiste et **écart** ; plus les repères historiques (moyenne et écart-type des écarts), les plus gros bons, le top clients et les tendances par produit.
2. Ce dossier est envoyé à **Claude**, qui détecte les fraudes (manquants anormaux au regard des repères, bons gonflés, incohérences) avec type, gravité, niveau de confiance et explication ; commente les tendances ; estime les besoins par produit sur l'horizon choisi.
3. Les fraudes détectées sont **enregistrées** dans la table `alertes` (suivies, résolvables par le comptable/admin).

Limites honnêtes : Claude juge des **chiffres exacts** fournis par la base, donc les montants sont fiables ; ses qualifications de fraude restent des **pistes à vérifier**, pas des preuves. La pertinence s'améliore avec l'historique disponible.

Coût : chaque analyse consomme quelques milliers de jetons Anthropic. À lancer à la demande.

## Sécurité (RLS)

- Gérant : lecture/écriture limitées à **sa** station, y compris via l'API et l'Edge Function.
- Comptable : lecture des opérations et alertes, export, résolution des alertes ; ne saisit pas.
- Admin : accès complet, gestion des rôles et stations.
- Piste d'audit **immuable** ; fiche clôturée **verrouillée** ; écriture comptable **équilibrée** obligatoire.

## Sauvegarde

Données dans PostgreSQL (sauvegardes Supabase ; PITR sur plan Pro). L'app propose aussi un export `.json` d'appoint.

## Dépannage

- **« IA indisponible »** : clé `ANTHROPIC_API_KEY` non posée, ou fonction `analyse-claude` non déployée (étape 5).
- **« Action réservée au comptable/admin »** : seuls ces rôles clôturent une alerte (RLS).
- **Peu ou pas de fraudes signalées** : historique court ou activité régulière — normal ; les repères s'affinent avec le temps.
- **Le 1er compte n'est pas admin** : `update public.profiles set role='admin' where email='vous@ex.com';` dans le SQL Editor.
