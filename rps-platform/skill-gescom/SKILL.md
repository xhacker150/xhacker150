---
name: traitement-factures-gescom-sage
description: Traitement quotidien des factures stations (export GESCOM) vers un fichier d'import unique Sage 100 i7, avec rapport d'anomalies, écarts vs rapport officiel des ventes et tableau de bord consolidé des prises. Se déclenche quand l'utilisateur dit "traite les factures du jour", "traite le JJMMAA", "prépare l'import SAGE des factures stations", "fusionne les factures GESCOM", "rapport d'anomalies du jour", ou dépose un dossier de factures stations RPS. NE MODIFIE JAMAIS les montants, quantités, dates ou références client.
---

# Factures stations (export GESCOM) → Import unique Sage 100 i7 (RPS)

## But
Chaque jour, ~45 stations RPS déposent un fichier de factures (export GESCOM, format `#CHEN`).
Cette skill les regroupe par station, applique 18 contrôles de fiabilisation, et produit **un seul
fichier d'import** Sage 100 i7 (un seul `#FLG`/`#VER`/`#FIN`, blocs `#CHEN` groupés par station),
plus un **rapport d'anomalies**, les **écarts** vs le rapport officiel des ventes, et un **dashboard
consolidé** des prises.

## Principe de sécurité (NE JAMAIS contourner)
1. **Aucun montant, quantité, date ou référence client n'est modifié.** On corrige seulement les
   métadonnées techniques que Sage exige (n° de pièce, dépôt, compte collectif, encodage…).
2. **Encodage préservé** : latin-1 + fins de ligne CRLF ; accents écrits en **CP850/DOS** (é=`0x82`,
   è=`0x8A`) — JAMAIS convertis en ANSI, sinon Sage ne reconnaît pas dépôt/lieu.
3. **Anomalies signalées, pas inventées** : une station non transmise ou un écart sont reportés pour
   relance, jamais « comblés ».
4. C'est l'utilisateur qui importe dans Sage ; la skill ne touche jamais à Sage.

## Déclenchement et entrée
- L'utilisateur fournit un **dossier de la journée** (ex. `…/Exportation facture/25-06-2026/`) contenant
  les fichiers `.txt` exportés par les stations, et la **date** au format `JJMMAA` (ex. `250626`).
- Si la date n'est pas donnée, la déduire du nom du dossier.

## Comment exécuter (commande unique)
Lancer l'orchestrateur depuis `scripts/` :

```bash
python scripts/run_jour.py \
  --daydir "<dossier de la journée>" \
  --day <JJMMAA> \
  [--root "<dossier parent, défaut = parent du dossier du jour>"] \
  [--rapport-officiel rep.json]
```

Il enchaîne automatiquement : `engine.py` (fusion + 18 contrôles) → `extract_prises.py` →
`compute_missing.py` → `anomalies.py` → `ecarts.py` (si `--rapport-officiel`) → `dashboard.py`.

### Livrables produits
1. **`FACT-RPS-TOUTES-STATIONS-<jj>-au-<jj>-mm-aa.txt`** dans le dossier du jour — le fichier d'import Sage.
2. **`RAPPORT-ANOMALIES-COMPLET-<jj-mm-aaaa>.pdf`** — synthèse + détail des corrections, exclusions,
   stations manquantes, et §5 écarts (si rapport officiel fourni).
3. **`ECARTS-VENTES-<jj-mm-aaaa>.xlsx`** — seulement si `--rapport-officiel` fourni.
4. **`RAPPORT-PRISES-CONSOLIDE.html`** à la racine — dashboard multi-dates (filtre Du/Au), cumule
   toutes les journées traitées via `prises_history.json`.

### Rapport officiel des ventes (pour les écarts)
Optionnel mais recommandé. Lire le PDF/Excel officiel et le transcrire en JSON
`{"NUM_STATION": [GASOIL_litres, SUPER_litres], ...}` (n° = numéro de station RPS, ex. `"43":[13552.00,13697.67]`),
le sauver en `rep.json` et le passer via `--rapport-officiel rep.json`. Sans lui, le §5 reste « en attente ».

## Les 18 contrôles appliqués (détail dans `references/REGLES-TRAITEMENT-GESCOM-RPS.md`)
1. Regroupement par station via le **contenu** (compte regroupement `41180XX`, sinon préfixe pièce `Fxx`, sinon code site).
2. Une seule journée retenue (les autres dates des fichiers multi-dates sont écartées et listées).
3. Dédoublonnage (même pièce+date ; et doublon exact par contenu).
4. Renumérotation des pièces hors-format en `F + n° station + TS + 4 chiffres` ; les pièces déjà au bon
   format `F+n°+séquence` sont **conservées**.
5. Comptes tiers corrigés par rapprochement du nom (`references/corrections_tiers.json`, ciblés par pièce).
6. Produits rapprochés (`GAS`→GASOIL, `SUP`→SUPER).
7. Encodage latin-1 + CRLF préservé ; `°` réaffiché correctement.
8/10. EX-DEPOT-RIMBO (garage) : intégré seulement s'il a une facture du jour, sinon traité à part (format `FGRTS`).
11. Stations hors service (`references/hors_service.json`) jamais comptées comme manquantes.
12. Séparateur décimal : lit virgule **ou** point, normalise point→virgule dans l'import.
13. Libellé de dépôt forcé à `code_site + nom_officiel` (comparaison sans accents).
14. Espaces parasites (début/fin de champ) supprimés.
15. Lieu de livraison conservé depuis la source ; dépôt = référentiel ; accents en CP850.
16. Corrections de comptes ciblées par pièce — **jamais** le compte collectif (offset +40).
17. Compte collectif toujours un compte général (`tiers[0:4]+000` si invalide).
18. Anti-collision : pièces déjà dans Sage (`references/SAGE_pieces.txt`) renumérotées vers un n° libre.

## Mémoire / personnalisation
- `references/corrections_tiers.json` — corrections de comptes tiers par (station, pièce). Ajouter une
  entrée quand l'utilisateur signale un compte erroné identifiable par le nom.
- `references/hors_service.json` — numéros des stations fermées.
- `references/SAGE_pieces.txt` — pièces déjà comptabilisées dans Sage (anti-collision) ; à actualiser.
- `references/REF_*.csv` — référentiels stations / produits / comptes tiers.

## Vérifications systématiques (toujours rappeler à l'utilisateur)
`#CHEN = #CHRE`, un seul `#FLG`/`#FIN`, aucun doublon de pièce, aucun numéro hors-format résiduel,
montants/quantités/dates jamais modifiés. Présenter les anomalies AVANT que l'utilisateur n'importe dans Sage.

## Exemples
Le dossier `examples/` contient les livrables réels produits pour les journées des 23, 24 et 25 juin 2026
(fichier d'import, rapport d'anomalies, écarts Excel, dashboard) comme références de format.
