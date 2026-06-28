# Kit de démarrage — Plateforme RPS (phase SOCLE)

Ce dossier contient **tout** ce qu'il faut pour démarrer le développement de la
plateforme RPS avec Claude Code. Lis ce fichier en premier, puis `CLAUDE.md`.

---

## Contexte en 30 secondes

RPS (Rissa Petroleum Service) exploite un réseau de stations-service au Niger.
On construit une application web qui : consolide les ventes (prises) issues de
**GESCOM**, facture les clients, suit les **règlements et créances**, et prépare
relances/commandes. Stack : **Next.js + Vercel + Supabase**. Esprit : opérationnel
réseau (major pétrolier) + rigueur comptable (Sage/Oracle).

**Règle d'or absolue** : les montants, quantités, dates et références client issus
de GESCOM ne sont **JAMAIS** modifiés. Voir `CLAUDE.md` §3.

---

## Contenu du kit

| Fichier | Rôle | Quoi en faire |
|---|---|---|
| `README-CLAUDE-CODE.md` | Ce fichier — point d'entrée | Lire en premier |
| `CLAUDE.md` | Contexte projet permanent | **Copier à la racine** du projet |
| `supabase/migrations/0001_init.sql` | Schéma BD (14 tables, 4 vues, RLS) | Migration Supabase |
| `supabase/migrations/0002_seed.sql` | Données de référence (55 stations, produits) | Seed après migration |
| `REGLES-TRAITEMENT-GESCOM-RPS.md` | Les 18 règles métier d'import (référence) | Lire avant de coder l'import |
| `IMPORT-GESCOM-POUR-CLAUDE-CODE.md` | Guide : comment porter l'import sur Supabase | Lire avant l'étape 3 |
| `skill-gescom/` | **Skill existant** : scripts Python + référentiels + exemples réels | Spécification exécutable de l'import (étape 3) |
| `REF_stations.csv` | Référentiel stations source | Source du seed / vérif |
| `prises_history.json` | 730 ventes réelles (3 jours) | Jeu de test pour l'import |
| `missing_history.json` | 5 cas de stations manquantes | Jeu de test |
| `TABLEAU-BORD-PRISES-RPS.html` | Dashboard actuel (autonome) | **Maquette de référence** visuelle/fonctionnelle |
| `.env.example` | Variables d'environnement attendues | Modèle pour `.env.local` + Vercel |
| `PROMPT-DEMARRAGE.md` | Le premier message à donner à Claude Code | Copier-coller pour lancer |

---

## Données de référence (formats réels)

**Une vente** (`prises_history.json`) :
```json
{
  "station": "43 - RPS Agadez Misrata", "snum": "43",
  "produit": "GASOIL", "code": "GAS",
  "client": "Clts CASH-RPS-Agadez Misrata", "compte": "41180043",
  "description": "GASOIL", "tvente": "Espèces",
  "piece": "F43TS0001", "date": "23/06/2026",
  "qte": 25.0, "prix": 618.0, "montant": 15450
}
```
Mapping vers la table `ventes` : `snum`→station, `tvente`→type_vente
(`Espèces`→`especes`, `Crédit`→`credit`), `date` JJ/MM/AAAA → `date_vente` ISO,
`compte`→compte_tiers, `code`→produit (`GAS`→GASOIL, `SUP`→SUPER).

**Une station manquante** (`missing_history.json`) :
```json
{ "num":"54","code":"TY-54","nom":"RPS Ayorou",
  "note":"aucun fichier transmis","date":"23/06/2026" }
```
À recouper avec la vue `v_stations_manquantes` (station active sans prise ce jour).

---

## Étapes de la phase socle (ordre conseillé)

1. **Init projet** : Next.js (App Router) + TypeScript + Tailwind + shadcn/ui,
   client Supabase typé, déploiement Vercel branché sur Git.
2. **Migration** : appliquer `0001_init.sql` puis `0002_seed.sql` sur Supabase.
   Générer les types TypeScript depuis le schéma.
3. **Import GESCOM** : module qui lit un export (ou `prises_history.json` en test)
   et écrit dans `ventes` + `import_anomalies`, en respectant les règles 1→18.
   **Ne pas réinventer la logique** : le dossier `skill-gescom/` contient les scripts
   Python éprouvés (`extract_prises.py`, `engine.py`…) et les référentiels. Lire
   `IMPORT-GESCOM-POUR-CLAUDE-CODE.md` qui explique quoi réutiliser tel quel et quoi
   transposer vers Supabase. Idempotent (dédoublonnage via l'index unique).
4. **Dashboard** : reproduire `TABLEAU-BORD-PRISES-RPS.html` sur les données
   Supabase (KPI, graphiques Recharts, filtres, détail TanStack Table).
5. **Règlements & créances** : saisie règlements, lettrage (table
   `reglement_affectations`), vue `v_encours_clients` (aging), échéancier.
6. **Tests + déploiement** : tests unitaires sur les calculs (encours, statut,
   ancienneté), vérifier preview + prod Vercel, secrets en variables d'env.

Avancer **étape par étape**, avec tests et validation avant de passer à la suite.
Tout est versionné dans Git (branche par fonctionnalité).

---

## Critères de « terminé » (socle)

Voir la checklist détaillée en fin de `CLAUDE.md` (§10). En résumé : schéma + seed
appliqués, import conforme aux règles avec journal d'anomalies, dashboard sur
Supabase, règlements/créances avec lettrage et aging, tests verts, déploiement OK,
règle d'or respectée partout (zéro écriture sur les ventes source).
