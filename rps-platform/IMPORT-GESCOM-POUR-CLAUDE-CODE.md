# Import GESCOM — guide d'intégration pour Claude Code

Ce dossier `skill-gescom/` contient le **skill existant** de traitement des factures
GESCOM (`traitement-factures-gescom-sage`). Il encode, sous forme de scripts Python
éprouvés et de référentiels, **toute la logique d'import** que la plateforme RPS doit
reproduire. C'est la **spécification exécutable de l'étape 3** (import GESCOM).

> **Ne pas réinventer les 18 contrôles.** Ils existent, ils sont testés sur des
> données réelles (journées des 23, 24, 25 juin 2026). Le travail consiste à les
> **porter** vers Supabase, pas à les redécouvrir.

---

## Ce que fait le skill aujourd'hui

Entrée : un dossier de la journée avec les `.txt` exportés par les stations (format
GESCOM `#CHEN`/`#CHLI`, encodage latin-1/CP850, CRLF).

Pipeline (`scripts/run_jour.py` orchestre) :
1. `engine.py` — fusion des fichiers + application des **18 contrôles** de fiabilisation.
2. `extract_prises.py` — extraction des lignes de prise en JSON (`prises.json`).
3. `compute_missing.py` — calcul des stations manquantes.
4. `anomalies.py` — rapport d'anomalies PDF.
5. `ecarts.py` — écarts vs rapport officiel des ventes (Excel), si fourni.
6. `dashboard.py` — dashboard HTML consolidé (`prises_history.json`).

Sorties : fichier d'import SAGE `.txt`, rapport d'anomalies PDF, écarts Excel,
dashboard HTML.

---

## Ce que Claude Code doit en RÉUTILISER tel quel

- **La logique des 18 contrôles** (voir `references/REGLES-TRAITEMENT-GESCOM-RPS.md`
  et `SKILL.md`). Identique, intangible.
- **Le parsing du format GESCOM** (`extract_prises.py`) : blocs `#CHEN` (entête
  facture) contenant des `#CHLI` (lignes produit). Points clés à conserver :
  - identification station : compte regroupement `41180XX` → sinon préfixe pièce
    `Fxx` → sinon code site ;
  - **parseur décimal robuste** : accepte virgule **ou** point (fonction `num()`) ;
  - type de vente : `Espèces` si le compte commence par `41180`, sinon `Crédit` ;
  - produit : `GAS`→GASOIL, `SUP`→SUPER ;
  - date `JJMMAA` → `JJ/MM/20AA` ;
  - `montant = round(qte * prix)` (jamais recalculé autrement, jamais arrondi à la source).
- **Les référentiels** (`references/`) : `REF_stations.csv`, `REF_produits.csv`,
  `REF_comptes_tiers.csv`, `hors_service.json`, `corrections_tiers.json`,
  `SAGE_pieces.txt`. Ils alimentent le seed et les corrections ciblées.

---

## Ce que Claude Code doit TRANSPOSER (la seule vraie différence)

Le skill écrit un **fichier texte SAGE** ; la plateforme écrit dans **Supabase**.
La cible de l'import change, la logique non.

| Skill (aujourd'hui) | Plateforme (cible) |
|---|---|
| `prises.json` | lignes dans la table `ventes` |
| corrections/exclusions journalisées dans le rapport | lignes dans `import_anomalies` |
| stations manquantes calculées | vue `v_stations_manquantes` (recoupée) |
| fichier `FACT-…SAGE.txt` | **non concerné** par la plateforme (reste un usage SAGE séparé) |

**Mapping `prises.json` → `ventes`** (déjà détaillé dans README-CLAUDE-CODE.md) :
`snum`→station_id (via numéro), `tvente` `Espèces/Crédit`→`especes/credit`,
`date` JJ/MM/AAAA→`date_vente` ISO, `compte`→`compte_tiers`, `code`→`produit_id`,
`qte`→`quantite`, `prix`→`prix_unitaire`, `montant`→`montant`,
`piece`→`piece` (+ `piece_origine` si renumérotée), `description`→`description`,
`client`→`client_id` (rapprochement par `compte_tiers`).

**Idempotence** : l'index unique `uq_ventes_piece (station_id, date_vente, piece,
produit_id)` garantit qu'un ré-import ne duplique pas. Utiliser un `upsert` qui
ignore les conflits, et journaliser les doublons détectés en `import_anomalies`
(type `doublon_piece` / `doublon_contenu`).

**Règle d'or** : la table `ventes` est verrouillée (trigger anti-UPDATE/DELETE).
L'import ne fait qu'INSÉRER. Toute « correction » (compte tiers, dépôt, pièce
renumérotée) est tracée dans `import_anomalies` avec valeur d'origine + valeur
corrigée, jamais en écrasant la donnée source.

---

## Stratégie recommandée pour l'étape 3

1. **Réutiliser les scripts Python du skill** comme bibliothèque de parsing/contrôle
   (ils tournent déjà), exposés via une route serveur ou une fonction d'ingestion ;
   **ou** réécrire le parsing en TypeScript en suivant `extract_prises.py` à la lettre
   (parseur décimal, identification station, espèces/crédit) si on veut un import 100 % TS.
2. Charger d'abord les **référentiels** dans Supabase (seed clients depuis
   `REF_comptes_tiers.csv`, stations déjà dans `0002_seed.sql`).
3. Tester sur `examples/23-06-2026/…` puis sur `prises_history.json` (730 lignes
   attendues : 631 375 L, 348 334 450 FCFA — totaux de contrôle).
4. Écrire les tests : nombre de lignes, totaux, idempotence (ré-import sans doublon),
   stations manquantes conformes à `missing_history.json`.

> En cas de doute sur un contrôle, **lire le script correspondant dans `scripts/`**
> avant de coder : il fait foi sur le comportement attendu.
