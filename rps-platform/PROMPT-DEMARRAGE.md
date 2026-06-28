# Prompt de démarrage — à coller dans Claude Code

> Copie le bloc ci-dessous comme **premier message** à Claude Code, une fois ce
> dossier ouvert (tous les fichiers du kit présents à la racine).

---

```
Tu vas m'aider à construire la plateforme RPS (phase SOCLE). Avant tout :

1. Lis README-CLAUDE-CODE.md, puis CLAUDE.md (contexte permanent), puis
   REGLES-TRAITEMENT-GESCOM-RPS.md (règles métier d'import). Confirme que tu as
   bien intégré la RÈGLE D'OR : ne jamais modifier les montants, quantités, dates
   ou références issus de GESCOM.

2. Examine le schéma supabase/migrations/0001_init.sql et le seed 0002_seed.sql,
   ainsi que les jeux de test prises_history.json et missing_history.json, la
   maquette TABLEAU-BORD-PRISES-RPS.html (référence visuelle et fonctionnelle), et
   le dossier skill-gescom/ (la logique d'import existante, à porter sur Supabase à
   l'étape 3 — voir IMPORT-GESCOM-POUR-CLAUDE-CODE.md).

Ensuite, commençons par l'ÉTAPE 1 du socle uniquement :
- initialise un projet Next.js (App Router) + TypeScript + Tailwind + shadcn/ui ;
- configure le client Supabase typé (lis .env.example pour les variables) ;
- applique la charte RPS (rouge #E30613, bleu #0150DA, Montserrat/Inter) ;
- prépare le déploiement Vercel (mais ne déploie pas encore).

Procède par petites étapes vérifiables. À la fin de l'étape 1, lance l'app en
local, montre-moi le résultat, et attends ma validation avant l'étape 2
(migration + seed). Ne saute aucune étape. Pose-moi une question si une règle
métier est ambiguë plutôt que de supposer.
```

---

## Étapes suivantes (à demander une par une, après validation)

- **Étape 2** : « Applique 0001_init.sql puis 0002_seed.sql sur Supabase et génère
  les types TypeScript. Vérifie que les 55 stations et les 9 hors-service sont
  correctes. »
- **Étape 3** : « Lis d'abord IMPORT-GESCOM-POUR-CLAUDE-CODE.md et le dossier
  skill-gescom/ (scripts Python et référentiels existants). Porte cette logique
  d'import vers Supabase : écris le module qui charge prises_history.json (et les
  exports du dossier skill-gescom/examples/) dans `ventes` + `import_anomalies`, en
  respectant les 18 contrôles. Réutilise le parsing et les règles des scripts
  existants, ne les réinvente pas. Rends-le idempotent. Totaux de contrôle attendus :
  730 lignes, 631 375 L, 348 334 450 FCFA. Écris les tests. »
- **Étape 4** : « Reproduis le dashboard (KPI, graphiques Recharts, filtres,
  détail TanStack Table) sur les données Supabase, fidèle à la maquette HTML. »
- **Étape 5** : « Ajoute la saisie des règlements, le lettrage via
  reglement_affectations, et la vue des créances v_encours_clients avec l'aging.
  Écris les tests sur les calculs. »
- **Étape 6** : « Mets en place les tests unitaires manquants, vérifie le
  déploiement Vercel (preview + prod), et confirme que la règle d'or est respectée
  partout (aucune écriture sur `ventes`). »
