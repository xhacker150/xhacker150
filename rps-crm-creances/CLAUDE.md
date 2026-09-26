# CLAUDE.md — Projet RPS CRM CRÉANCES

Instructions permanentes pour Claude Code sur ce projet. Lues à chaque session.

## Le projet en une phrase

Construire le CRM Créances de RISSA PETROLEUM SERVICE (RPS, 45+ stations-service
au Niger) — suivi de la facturation, du recouvrement et des créances — et l'API
en lecture seule qui l'alimente depuis Sage 100, selon `docs/CDC-05 - CRM
CREANCES ET API DU PONT.md` (le contrat) et `maquette/RPS CRM CREANCES.html`
(qui fait foi pour l'ergonomie et les calculs).

## Règles métier NON NÉGOCIABLES (toute violation = bug bloquant)

1. **Solde économique** = RAN (journal `RAN`, débit − crédit) + facturation
   gescom + débits hors RAN (dépenses payées pour le client) − règlements
   encaissés. **Jamais** la balance comptable : la classe 7 n'existe pas dans
   `RPS BD 26`, les factures ne sont pas déversées en compta.
2. **Règlements toujours présentés UN À UN** (date, journal, pièce, référence).
   Jamais de somme mensuelle dans une vue de détail ou un document.
3. Périmètre clients : comptes `411%` **hors** `41180%` (clients cash des
   stations — hors sujet). Le **numéro de station fait foi** partout
   (suffixe des comptes = numéro dans les intitulés de dépôts `XX-nn-RPS …`).
4. **Aucun chiffre inventé** : source indisponible → afficher « données du
   JJ/MM » + bandeau, jamais estimer. Chaque réponse d'API porte
   `date_extraction`.
5. **Lecture seule absolue sur Sage** : compte SQL SELECT-only,
   `READ UNCOMMITTED`. La seule base en écriture est la base CRM (actions,
   promesses, messages, audit). Toute écriture vers Sage = faute grave.
6. Documents officiels : facture du **dernier mois clos** (réserve « saisi
   jusqu'au JJ/MM » si la saisie est incomplète) ; situation au jour, mois
   courant compris ; relevé mensuel au-delà de ~300 lignes de livraisons.
7. **Alerte par cadence individuelle** : médiane des intervalles de règlement
   du client, alerte à 1,5× (bornée 10-45 j) ; filet générique 500 000 F / 30 j.
   Typologies et cas particuliers : CDC-05 §3 (remise multi-clients, « réglé
   via », régularisations, RAN créditeur, payeurs multiples type SSN).
8. Confidentialité : **aucune donnée réelle RPS dans ce dépôt** (ni dump, ni
   fixture copiée de Sage) ; jeux de test synthétiques uniquement. Secrets en
   variables d'environnement, jamais commités. Comptes utilisateurs
   nominatifs, jamais partagés.

## Architecture cible (CDC-04 + CDC-05 §7)

- **API du pont** sur RPS-SERVER (LAN) : FastAPI (Python 3.11+) recommandé,
  sinon .NET/Node — SELECT-only vers SQL Server (`RPS NOUV BD` gescom,
  `RPS BD 26` compta, serveur `RPS-SERVER\SAGE100`, auth Windows).
  Contrat : `api/openapi.yaml`. Sage **jamais** exposé à Internet ; le serveur
  pousse vers le VPS `apps.rps.ne`, pas l'inverse.
- **Base CRM** : PostgreSQL, schéma de départ `db/schema.sql`.
- **Front** : la maquette est du HTML/JS vanilla volontairement sans
  dépendance ; l'industrialisation peut passer à un framework léger, mais :
  français intégral, charte RPS (rouge #EA0000, bleu #0051DD, encre #1B1F2E,
  Arial), utilisable sur téléphone 6" en 3G (< 500 Ko par page), mode dégradé
  lecture si le réseau tombe.
- Les requêtes SQL de référence sont dans `sql/` — elles sont ÉPROUVÉES en
  production via le pont par fichiers : ne pas en changer la sémantique.

## Définition de « fini »

Une fonctionnalité est finie quand : elle passe le **jeu de recette du CDC-05
§3.5** (soldes réels à retrouver au franc) ; le mode fichiers et le mode API de
la maquette donnent le même chiffre ; l'action est journalisée ; l'écran est
lisible sur téléphone ; le texte est en français sans faute.

## Conventions

- Commits en français, impératif court (« Ajoute l'alerte cadence »).
- Tests : pytest côté API ; tout calcul de solde a un test avec RAN créditeur,
  RAN débiteur, débits hors RAN, et régularisation.
- Ne jamais reformater massivement un fichier existant dans le même commit
  qu'un changement fonctionnel.
- En cas de doute sur une règle métier : c'est le CDC-05 puis
  `docs/REGLES-METIER-RPS.md` qui tranchent, pas une supposition.
