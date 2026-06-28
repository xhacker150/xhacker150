# Règles de traitement automatique — Factures GESCOM → SAGE 100 i7 (RPS)

Ce document enregistre les règles appliquées **automatiquement** à chaque traitement
du lot de factures stations (export GESCOM) pour l'import dans SAGE. Elles s'appliquent
à **tous** les fichiers déposés, sans intervention, pour les journées futures.

## 1. Regroupement par station
La station est identifiée par le **contenu** (pas seulement le nom de fichier) :
compte de regroupement `41180XX`, sinon préfixe de pièce `Fxx`, sinon code site (`TA-06`, `DI-20`…).

## 2. Une seule journée retenue (fichiers multi-dates)
Quand un fichier contient **plusieurs dates** (cas Diffa, Bonkaney, fichiers mensuels…),
**seules les factures de la journée concernée** (ex. `230626`) sont conservées.
Toutes les autres dates sont écartées et listées dans le rapport (hors période).

## 3. Dédoublonnage automatique
- **Doublon de pièce + date** présent dans plusieurs fichiers (ex. fichier journalier
  identique au mensuel) → une seule occurrence conservée.
- **Doublon exact par CONTENU** : deux factures avec **mêmes date, compte, client et
  lignes produit/quantité** mais numéros de pièce différents (cas Diffa F22000000-002 =
  F22000003-005, cas Baléyara) → une seule conservée. L'autre est écartée et signalée.

## 4. Numérotation des pièces
- Les pièces déjà au bon format (`format_piece` station + séquence) sont **conservées**.
- Les pièces hors-format (numéro court, mauvais préfixe, date en guise de numéro) sont
  **renumérotées** au format **`F + n° station + TS + 4 chiffres`** (ex. `F14TS0001`), afin de
  les distinguer clairement des vrais numéros et éviter toute confusion. C'est volontaire.

## 5. Comptes tiers
- Compte absent/tronqué/erroné → **corrigé par rapprochement du nom** du tiers dans
  REF_comptes_tiers.csv (ex. `4111000`→`41110024`, `411299005`→`41129005`, `4118`→`41120050`).
- Compte « Tiers à créer » (INTERDIT) → corrigé par le nom si identifiable, sinon signalé.

## 6. Produits
Codes/libellés rapprochés de REF_produits.csv (`GAS`→GASOIL, `SUP`→SUPER).

## 7. Encodage (important)
- Le fichier d'import conserve **latin-1 + fins de ligne CRLF** à l'identique (exigence SAGE).
- Le caractère « ° » est stocké en encodage DOS (octet `0xF8`). Il est **réaffiché « ° »**
  dans les rapports et le tableau de bord (et non « ø »).

## 8. EX-DEPOT-RIMBO (dépôt garage)
Traité **à part** (période 01→22/06) : client unique **Rimbo Transport** (`41120026`),
nom station **EX-DEPOT-RIMBO**, format de pièce **FGRTS** + séquence. Non mélangé au lot du 23.

## 9. Fichiers de sortie ignorés au re-balayage
Les fichiers générés (`FACT-RPS-TOUTES-STATIONS…`, `FACT-EX-DEPOT-RIMBO…`) sont
automatiquement ignorés lors d'un nouveau traitement, pour ne pas se relire eux-mêmes.

## Livrables produits à chaque traitement
1. Fichier d'import fusionné `FACT-RPS-TOUTES-STATIONS-<jj>-au-<jj>-mm-aa.txt` (un seul `#FLG`/`#FIN`).
2. Rapport d'anomalies PDF (corrections, exclusions, dates hors période, stations manquantes).
3. Tableau de bord interactif des prises (par client / produit / station, filtres + impression).

---
*Référentiels : REF_stations.csv, REF_produits.csv, REF_comptes_tiers.csv.
Vérifications systématiques : `#CHEN` = `#CHRE`, un seul `#FLG`/`#FIN`, aucun doublon de pièce,
aucun numéro hors-format résiduel, montants/quantités/dates jamais modifiés.*

## 10. EX-DEPOT-RIMBO — intégration conditionnelle
EX-DEPOT-RIMBO n'est **intégré au lot du jour que s'il a au moins une facture datée du jour
traité** (ex. 23/06). Tant qu'il n'a pas de facture du jour, il est **traité à part**
(fichier dédié `FACT-EX-DEPOT-RIMBO…`, format FGRTS, client Rimbo Transport).

## 11. Stations hors service
Certaines stations sont **fermées (hors service)** et **ne doivent pas être comptées comme
manquantes**. Liste actuelle (9) : 07 Mossi Paga, 09 Zr-Rte Maradi, 10 Bangaré, 18 Agadez,
19 Bouppo, 23 Saga Gorou, 40 Maradi-Tibiri, 49 Tchinta RT Tahoua, 50 Abalak RT Agadez.

Une station est **« manquante »** si elle est **en service mais n'a transmis aucune prise**
le jour traité — que ce soit faute de fichier (ex. 30 Chateau8, 54 Ayorou) **ou** parce que
sa facture est vide / à 0 L (ex. 16 Cité Caisse, qui travaille). Les stations hors service
(fermées) ne sont jamais comptées comme manquantes.

## 12. Contrôle du séparateur décimal (virgule ou point)
Les exports doivent utiliser la **virgule** comme séparateur décimal (norme SAGE). Certains
postes exportent en **point** (ex. `479.77` au lieu de `479,77`). Le pipeline :
- **lit indifféremment** virgule ou point (parseur robuste) pour les rapports/comparaisons ;
- **normalise automatiquement point → virgule** dans le fichier d'import (valeur identique,
  format SAGE), et **journalise** chaque conversion.
Sans ce contrôle, une facture en point décimal serait lue **0** et paraîtrait « vide » à tort
(cas réel : RPS Cité Caisse, dont les ventes 479,77 / 1 976,62 étaient masquées par le point).

## 13. Contrôle du libellé de dépôt (validé par SAGE à l'import)
SAGE rejette une facture si le **dépôt** indiqué n'existe pas (« Le dépôt … n'existe pas »).
Le pipeline vérifie que le libellé de dépôt de chaque facture correspond au référentiel
(`code_site` + `nom_officiel`) et **corrige** tout écart de **nom** (ex. station 43 :
« Agadez Tribune » → « Agadez Misrata » ; station 32 Madina : dépôt « NY-31-RPS Rimbo »
copié par erreur → « NY-32-RPS Madina »). La comparaison se fait **sans tenir compte des
accents/encodage** (les accents DOS ne sont pas de vrais écarts) ; seules les différences de
nom réelles sont corrigées, le reste est signalé.

## 14. Contrôle des espaces parasites (début/fin de champ)
Certaines stations laissent un **espace en début ou fin** d'un champ (ex. « RPS BCEAO », nom
de tiers, dépôt…). SAGE compare alors « valeur » à « valeur␠ » et peut **rejeter** l'entrée
(compte/dépôt/lieu « n'existe pas »). Le pipeline **supprime systématiquement** les espaces
de début/fin de tous les champs (valeur identique, simple nettoyage) et journalise le nombre
de champs nettoyés. Cas réel : 11 noms de station du 23/06 portaient un espace final.

## 15. Lieu de livraison & dépôt = intitulé/nom exact du référentiel (+ accents ANSI)
SAGE valide le **dépôt** et le **lieu de livraison** contre ses données : ils doivent
correspondre **exactement** (casse, orthographe, accents) au référentiel.
- **Lieu de livraison** (champ tiers de chaque facture) → **conservé tel quel depuis la SOURCE**
  (GESCOM exporte le nom exact que SAGE connaît). ⚠ NE PAS le forcer vers REF_comptes_tiers.csv :
  le référentiel diffère parfois des noms réels de SAGE (ex. SAGE = « Clts CASH-RPS-Tahoua02 »
  mais REF = « Clts CASH-RPS-Ta-RT-Agadez »). Forcer le lieu casserait l'import.
- **Dépôt** → forcé à `code_site` + `nom_officiel` (REF_stations.csv).
- **Accents** : SAGE attend l'encodage **CP850/DOS** (é=`0x82`, è=`0x8A`), qui s'affiche
  « Cit‚ Caisse » / « ProgrŠs » dans un éditeur ANSI. Le pipeline **préserve/écrit les accents
  en CP850** ; ne PAS convertir en ANSI (sinon SAGE ne reconnaît pas le dépôt/lieu). Seuls la
  casse et l'orthographe sont corrigées, l'octet d'accent reste en CP850.

## 16. Corrections de comptes CIBLÉES (ne jamais écraser un compte collectif)
Une correction de compte tronqué (ex. tiers `4111000` → `41110024`) doit être **ciblée sur la
facture concernée** (par n° de pièce), **jamais appliquée globalement** : la même valeur
`4111000` est aussi un **compte collectif/général** légitime (champ collectif de la facture).
Un remplacement global corromprait ce collectif (`4111000` → `41110024`), et SAGE rejetterait
alors « le compte 41110024 n'existe pas » (un n° de tiers n'est pas un compte général).
→ Les corrections de comptes tronqués sont listées dans `corrections_tiers.json` (par pièce) ;
le champ **compte collectif (offset +40) n'est jamais modifié**.


## 17. Compte collectif (compte général) — toujours valide
Le **compte collectif** (champ offset +40 de chaque facture) doit être un **compte général**
(ex. `4111000`, `4112000`, `4118000`, `4110000`), **jamais un n° de tiers ni un nombre à 8
chiffres**. Certaines stations y mettent par erreur un n° de tiers (`41110001`) ou un compte
malformé (`41100000`). Le pipeline détecte ces collectifs invalides et les remplace par le
compte général de la classe du tiers (`tiers[0:4]+000`). Sinon SAGE rejette « le compte … n'existe pas ».

## 18. Contrôle anti-collision avec les pièces déjà dans SAGE
Si la liste des pièces déjà présentes dans SAGE est fournie (`SAGE_pieces.txt`), le pipeline
**renumérote** toute pièce du lot qui existe déjà (erreur « le numéro de pièce … existe déjà »)
vers un numéro **libre** au format `F+n° station+TS+séquence` (ou `FGRTS…` pour EX-DEPOT),
en sautant tous les numéros déjà pris. Cas réel : F29000006 → F29TS0021, FGRTS0001 → FGRTS0023.
