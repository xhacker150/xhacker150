# CDC-05 — CRM CRÉANCES RPS & API DU PONT
## Cahier des charges complet — inspiré des meilleures pratiques CRM mondiales

**Maître d'ouvrage :** RISSA PETROLEUM SERVICE (RPS) — Direction Générale, Niamey, Niger
**Version :** 2.1 — 16/09/2026 (v2.0 + chapitre « sur-mesure RPS » tiré des dossiers réels)
**Rattachement :** dossier CDC-00 (cadrage et règles métier), CDC-02 (GED), CDC-03 (messagerie), CDC-04 (hébergement), ordre de mission OM-2026-01.
**Maquette de référence :** `30_CLIENTS/RPS CRM CREANCES.html` (livrée, fonctionnelle) — elle fait foi pour l'ergonomie de base et les règles de calcul.

---

## 1. Vision et objectifs

RPS facture plus de 19 milliards F CFA par an à un réseau de plus de 45
stations et à quelque 180 clients à terme. Le suivi des créances repose
aujourd'hui sur Sage (lecture seule via le pont), des documents PDF et la
mémoire des hommes. Le CRM Créances doit devenir **le poste de travail unique
du recouvrement** : qui doit quoi, depuis quand, qui relance, quand, avec
quelle promesse — et la preuve de tout.

**Objectifs chiffrés à 6 mois de mise en service :**

| Indicateur | Aujourd'hui (référence 08/09/2026) | Cible |
|---|---|---|
| DSO (délai moyen d'encaissement, clients à terme) | à établir en recette | − 20 % |
| Créances > 90 jours sans règlement | SOTCO 282,5 M à lui seul | < 5 % de l'encours |
| Clients « décrochés » (> 30 j sans règlement, solde > 500 k) non relancés | non mesuré | 0 (relance sous 48 h) |
| Promesses de paiement tenues | non mesuré | > 70 % |
| Temps de production d'une situation client officielle | minutes (via Claude) | < 10 s (bouton dans la fiche) |

## 2. Benchmark — ce que l'on retient des meilleurs, adapté au Niger

| Référence mondiale | Pratique retenue pour RPS |
|---|---|
| **Salesforce** | Le modèle « fiche 360° » : tout ce qui concerne un client sur un seul écran (soldes, factures, règlements, actions, documents, notes) ; la piste d'audit de chaque modification. |
| **HubSpot** | La chronologie unifiée (timeline) : chaque événement — facture, règlement, relance, promesse, appel — daté et signé sur un fil unique ; les tableaux de bord simples lisibles par un non-financier. |
| **Pipedrive** | Le pipeline visuel en colonnes glisser-déposer, transposé au recouvrement : À relancer → Relancé → Promesse → Contentieux → Soldé ; « rotting » : une carte qui stagne change de couleur. |
| **Zoho / Dynamics 365** | Les rôles et permissions fins par profil ; les vues sauvegardées par utilisateur ; le mode hors-ligne dégradé. |
| **HighRadius / Sidetrade** (leaders mondiaux du poste client) | Le **scoring de risque client** calculé sur le comportement réel de paiement (régularité, ancienneté, tendance d'encours) ; la priorisation automatique du portefeuille de relance par enjeu × risque. |
| **Upflow / Chaser / Esker** (relance automatisée) | Les **séquences de relance** par paliers avec modèles de messages, déclenchées par des règles, tracées, et interrompues automatiquement dès qu'un règlement arrive. |
| **Agicap** | Le lien créances → trésorerie prévisionnelle : les promesses de paiement datées alimentent une prévision d'encaissements. |

Ce qui est volontairement écarté : la gestion d'opportunités commerciales
(pas le sujet), l'e-mail marketing, l'IA générative embarquée (Claude joue déjà
ce rôle en amont), toute dépendance à une connexion Internet permanente.

## 3. LE SUR-MESURE RPS — construit sur les dossiers réels déjà instruits

Ce chapitre est la différence entre un CRM du commerce et le CRM de RPS. Chaque
règle ci-dessous vient d'un dossier réel traité entre août et septembre 2026
sur les données Sage. **Ces comportements sont le paramétrage de départ de
l'application — pas des exemples.**

### 3.1 La typologie clients RPS (affectée automatiquement, corrigeable à la main)

| Typologie | Dossiers réels qui la définissent | Traitement dans le CRM |
|---|---|---|
| **Grand compte à remises** | Rimbo Transport (2,24 Mds facturés, 36 règlements par remises de chèques 18-138 M, ECOBANK/BOA) ; SINOMA CARGO (536,8 M, remises 25-73 M, ~2/mois) ; ETS Oudou Younoussa (règlements NITA jusqu'à 272 M d'un coup) | Suivi de **cadence individuelle** (§3.2), relance par relevé et rendez-vous, jamais de petites relances ; interlocuteur attitré |
| **Payeur au fil de l'eau (mobile money)** | Moussa Seydalamine : 22 règlements de 1 à 10 M, majoritairement CAINIT/NITA, solde quasi nul en permanence | Aucune relance tant que la dérive d'encours reste sous 2 semaines de consommation ; suivi de dérive, pas de harcèlement |
| **Transporteur au camion** | Yahaya Ould Ahmed : 39 règlements en 2026, un par consommation, camion par camion (AB-4909, AG-4905…), compte créditeur ; Ibrahim Ahmed-Maradi : règle « au franc près » sur relevé | Rapprochement bon ↔ règlement ; relevé hebdomadaire automatique ; tout écart > 1 semaine de bons se signale |
| **Compte BV / Bénin** | Série 41150001-18 ; BV-RPS BENIN : 50,6 M facturés, UN règlement en 9 mois (bons « SOS LOGISTIQUE » servis à Gaya) ; JMD et SINOMA règlent parfois par « décharge » Bénin (OD) | Règle dure : **pas de nouveau lot de bons sans règlement du précédent** ; le CRM bloque la typologie en rouge tant que le ratio bons servis / réglés dépasse le seuil DG |
| **Compte muet** | SOTCO : 282,5 M dus, ZÉRO règlement en 2026, et 2,0 M de dépenses payées pour son compte par les caisses stations | Passage automatique en pré-contentieux ; le solde intègre les **débits hors RAN** (dépenses payées pour le client) — spécificité RPS qu'aucun CRM du commerce ne connaît |
| **Créditeur (avance)** | Oudou Younoussa (jusqu'à 357,6 M d'avance), Yahaya (47 950 F), Moussa (ponctuellement) | Interdiction de relance ; priorité de service ; alerte si l'avance fond plus vite que la consommation ne le justifie |
| **Compte collectif à payeurs multiples** | SSN (41120050) : sur un même compte, SSN, bons NIGELEC Doutchi, World Vision, ONG — des payeurs différents | Étiquette **payeur** sur chaque règlement et chaque bon ; soldes par payeur à l'intérieur du compte |

### 3.2 L'alerte par cadence individuelle (la leçon SINOMA)

SINOMA a décroché le 28/07 ; avec un seuil générique « 30 jours sans
règlement », l'alerte serait tombée fin août — 24 M de consommation plus tard.
Sa cadence réelle était de ~2 règlements/mois : la rupture était donc visible
dès le 12-15 août. **Règle produit :** pour chaque client, le CRM calcule la
médiane des intervalles entre ses règlements ; l'alerte « décrochage » part à
**1,5 × sa médiane** (bornée entre 10 et 45 jours), pas à un seuil unique.
Le seuil générique (solde > 500 000 F et > 30 j) reste le filet de sécurité.

### 3.3 Les particularités comptables RPS que le CRM doit savoir lire

- **Une remise de chèques peut couvrir plusieurs clients** (pièce BQECOB 2984
  du 02/02 : Rimbo 63 M + SINOMA 37,2 M) → une pièce de règlement est
  affectable à plusieurs comptes.
- **Un client peut régler pour un autre** (« règlement SINOMA remis à DIDI en
  espèce », OD 13) → champ « réglé via » tracé.
- **Des écritures de RÉGULARISATION** corrigent des règlements antérieurs
  (SINOMA OD 17283) → jamais compter deux fois ; rattachement à la pièce
  d'origine.
- **Le RAN peut être créditeur** (Yahaya +31 300) comme débiteur (Rimbo
  972,6 M) et il est parfois saisi en cours d'année (RAN SINOMA passé le
  26/03) → le solde d'ouverture vient du journal RAN, jamais d'une hypothèse.
- **La facturation du mois en cours est toujours en retard de saisie**
  (constaté : août saisi jusqu'au 15/08 au 08/09) → tout écran affiche « saisi
  jusqu'au JJ/MM », et aucun indicateur mensuel n'est comparé sur un mois non
  clos.
- **La classe 7 n'existe pas en compta** (constat de la radiographie RPS BD
  26) → le CRM ne lit JAMAIS les créances dans la balance comptable : solde
  économique obligatoire (règle n°1).
- **NITA pèse plus que toutes les banques réunies** (141,0 M contre 88,0 M au
  19/08) → le mobile money est un canal d'encaissement de premier rang :
  champs de référence NITA/Airtel sur les règlements, rapprochement dédié.

### 3.4 Les seuils de départ, calibrés sur le portefeuille réel

- Segments d'encours (constatés au 08/09) : **> 100 M** (Rimbo 993,7 M à
  l'arrêté, SINOMA 101,5 M — revue hebdomadaire DG) · **25-100 M** (SOTCO
  282,5 M déjà en anomalie, BV-Bénin 37,9 M, LABAN 34,1 M, Jainata 30,9 M —
  revue bimensuelle) · **5-25 M** (revue mensuelle) · **< 5 M** (séquence
  automatique seule).
- Alerte grosse remise attendue : un grand compte à remises sans règlement
  depuis 1,5 × sa cadence (§3.2).
- Promesse : montant minimal = 50 % du solde exigible, sinon plan de paiement.
- Le 11e client (Jainata au 31/07) était à 70 000 F du 10e : les classements
  du CRM s'arrêtent toujours au **dernier mois entièrement facturé**.

### 3.5 Jeu de recette sur dossiers réels (chiffres opposables)

La recette du lot A se fait sur ces témoins, valeurs à retrouver **au franc**
aux mêmes dates d'arrêté : DIDI 51 322 716 (20/08) · Boubacar Ahmadou
9 003 496 (20/08) · Yahaya Ould Ahmed **créditeur** 47 950 (20/08) · SINOMA
101 476 896 (08/09) · BV-RPS BENIN 37 862 185 (08/09) · Jainata 30 921 901
(arrêté 31/07 + règlement du 17/08) · SOTCO 282 509 928 dont 2 044 100 de
dépenses payées (20/08) · Oudou Younoussa créditeur 333 719 370 (20/08) ·
somme des 10 premiers clients = solde cumulé du classement (bouclage prouvé
le 20/08 : 1 364 033 696).


## 4. Utilisateurs et rôles

| Profil | Droits |
|---|---|
| **DG** | tout voir, tout paramétrer, arbitrages (passage en contentieux, plans de paiement, limites de crédit) |
| **Chargé de recouvrement** | portefeuille complet : relances, promesses, notes, tâches ; demande de situation officielle ; pas de paramétrage |
| **Comptabilité (versements/caisses)** | lecture + pointage des encaissements ; signalement d'un règlement non identifié |
| **Directeur exploitation / adjoint** | lecture, exports |
| **Contrôle de gestion** | lecture, exports, indicateurs |

Comptes **nominatifs, jamais partagés** (règle DG). SSO commun aux applications
métier (CDC-04). Toute action est signée et horodatée.

## 5. Modules fonctionnels

### 5.1 Tableau de bord (page d'accueil)
Créances totales, avances, clients débiteurs, à relancer, facturé/encaissé du
mois, **DSO**, top débiteurs, **balance âgée** (0-30/31-60/61-90/+90 par
ancienneté du dernier règlement ET par ancienneté de facturation), promesses de
la semaine, promesses échues non tenues, courbe 12 mois facturé vs encaissé.
Chaque chiffre est cliquable et mène à la liste qui le compose.

### 5.2 Référentiel clients et fiche 360°
Liste triable/filtrable/segmentable (zone, catégorie BV/transporteur/société,
statut, score). Fiche : identité et contacts (téléphones, WhatsApp), tuiles
RAN / facturé / réglé / solde économique, facturation par mois, **règlements un
à un**, livraisons, **timeline unifiée** de tous les événements, documents liés
(situations PDF, courriers — classés aussi dans la GED, CDC-02), score de
risque, limite de crédit et consommation de la limite, notes d'équipe.

### 5.3 Facturation et encaissements
Vue mensuelle facturé/encaissé/taux de couverture (réseau et par client) ;
détection des clients actifs sans facture du mois (signal gescom) ; règlements
non affectés à identifier ; rapprochement avec la compta au franc.

### 5.4 Pipeline de recouvrement (cœur de l'application)
Colonnes : **À relancer** (entrée automatique par règles) → **Relancé** →
**Promesse de paiement** (échéance + montant obligatoires) → **Plan de
paiement** (multi-échéances) → **Contentieux** (avec étape pré-contentieuse :
mise en demeure générée, réf. dossier juridique OHADA) → **Soldé**.
Glisser-déposer, carte qui « pourrit » visuellement si elle stagne, montants
totalisés par colonne. **Une carte sort automatiquement du pipeline dès que le
règlement couvrant arrive en compta** — la donnée Sage commande, pas l'humain.

### 5.5 Séquences de relance automatisées (à la Upflow/Chaser)
Paramétrables par le DG, par segment de client :
- **N1 (préventif)** : J+3 après facturation du mois — envoi du relevé.
- **N2 (amiable)** : décrochage de cadence individuelle (§3.2) ou solde > seuil et > 30 j — message + tâche d'appel, adaptés à la typologie (§3.1).
- **N3 (ferme)** : > 60 j — courrier de relance à la charte + copie DG.
- **N4 (pré-contentieux)** : > 90 j ou promesse non tenue 2 fois — mise en demeure générée (modèle juridique OHADA), décision DG requise.
Chaque envoi est tracé ; toute séquence s'arrête seule si un règlement arrive ;
aucun envoi automatique sans validation initiale du modèle par le DG.

### 5.6 Communications intégrées
Modèles de messages à la charte (relevé, relance, remerciement de règlement)
en français, envoyables par **WhatsApp** (lien wa.me pré-rempli en phase 1,
API WhatsApp Business en phase 2), **SMS** (passerelle locale) et e-mail.
L'envoi loggue l'événement dans la timeline. Aucun chiffre interne d'un autre
client ne peut apparaître dans un message.

### 5.7 Promesses et plans de paiement
Montant, échéance, preuve (note, enregistrement de l'engagement) ; alerte à
J-1 et à échéance ; taux de tenue par client (alimente le score) ; les
promesses datées alimentent une **prévision d'encaissements à 30/60 jours**
(vue trésorerie, à la Agicap).

### 5.8 Scoring risque et limites de crédit (à la HighRadius)
Score 0-100 par client, recalculé chaque nuit à partir de la typologie (§3.1) et de la cadence (§3.2) : régularité de règlement,
ancienneté moyenne, tendance de l'encours, promesses tenues, incidents.
Affiché en pastille (vert/orange/rouge) partout. Limite de crédit par client
(fixée par le DG) ; dépassement = alerte au DG et blocage recommandé — la
décision de bloquer reste humaine.

### 5.9 Documents
Génération en un clic depuis la fiche : **situation officielle 4 volets**
(gabarit charte RPS du plugin — mêmes règles : facture du dernier mois clos,
règlements un à un, solde économique), relevé simple, courrier de relance,
mise en demeure. Classement automatique GED (`30_CLIENTS/<client>/`).

### 5.10 Tâches et journal
Tâches datées assignables (« appeler X avant jeudi ») avec rappels ; **journal
d'audit** complet : qui a vu quoi, modifié quoi, envoyé quoi, quand.

## 6. Règles métier opposables (non négociables — référentiel plugin rps-gestion)

1. **Solde économique** = RAN + facturation gescom (+ débits hors RAN) −
   règlements encaissés. Les factures ne sont pas déversées en compta : la
   balance comptable ne fait pas foi pour les créances.
2. **Règlements toujours présentés un à un** (date, journal, pièce, référence).
3. Périmètre : comptes `411` hors `41180` (clients cash des stations, traités
   par le contrôle des caisses). **Le numéro de station fait foi** partout.
4. Document officiel : facture du **dernier mois clos** (réserve écrite si la
   saisie est incomplète) ; situation à la date du jour, mois courant compris.
5. **Aucun chiffre inventé** : source indisponible = affichage « données du
   JJ/MM » et bandeau d'avertissement, jamais d'estimation.
6. Lecture seule absolue sur Sage. La seule écriture du CRM est sa propre base
   (actions, tâches, scores, messages).
7. Confidentialité : données servies uniquement aux comptes autorisés ;
   aucun chiffre interne dans une communication sortante sans validation.

## 7. Données et intégrations

### 7.1 API du pont sur le serveur (remplace le pont par fichiers)
Service installé sur RPS-SERVER (.NET / Node / FastAPI au choix du titulaire),
démarré automatiquement, supervisé (`/health`), **compte SQL SELECT-only**.
Sage jamais exposé à Internet : API sur le LAN ; pour l'extérieur, le serveur
**pousse** vers le VPS `apps.rps.ne` (CDC-04). Transition : double
fonctionnement fichiers + API un mois minimum, fichiers conservés en secours.

**Contrat v1 :** `GET /health` · `GET /crm/extract` (équivalent exact de
`qr0/qr1/qr3/qr4` — contrat déjà câblé dans la maquette, bouton ⚙ « API
serveur ») · `GET /clients` · `GET /clients/{compte}` ·
`GET /clients/{compte}/situation.pdf` · `GET /stations/{num}/ventes` ·
`GET /alertes` · `GET /tresorerie` · `POST /crm/actions`,
`PATCH /crm/actions/{id}` (seule écriture, dans la base CRM). Pagination,
filtres de dates, `date_extraction` dans chaque réponse, clé d'API par
application + jeton utilisateur SSO. Journalisation de chaque appel.

### 7.2 Base CRM
PostgreSQL (recommandé). Tables : clients (extension du référentiel Sage —
contacts, segments, limites, scores), actions, séquences, messages, tâches,
promesses/échéanciers, documents (métadonnées, fichiers en GED), audit.
Reprise de l'existant : import des fichiers `30_CLIENTS/data/crm_*.json`.

### 7.3 Intégrations
GED (CDC-02) pour les documents ; messagerie interne / assistant de données
(CDC-03 §4.8) : `/client <nom>` interroge l'API ; alertes du matin
(claude_alertes) affichées dans le tableau de bord ; export CSV/Excel partout.

## 8. Exigences non fonctionnelles

- **Langue** : français intégral. Montants en F CFA, format `1 234 567`.
- **Charte RPS** : rouge #EA0000, bleu #0051DD, encre #1B1F2E, logo — la
  maquette fait foi.
- **Mobile d'abord pour le terrain** : le chargé de recouvrement travaille au
  téléphone ; les écrans pipeline et fiche doivent être pleinement utilisables
  sur un écran de 6 pouces et sur une connexion 3G (pages < 500 Ko, mode
  dégradé lecture si le réseau tombe).
- **Performances** : liste de 200 clients < 1 s ; fiche < 1 s ; 20
  utilisateurs simultanés.
- **Disponibilité et secours** : coupure Sage → le CRM sert les dernières
  données datées ; coupure serveur → retour possible au mode fichiers.
- **Sauvegardes** : base CRM sauvegardée chaque nuit, restauration testée en
  recette ; rétention 90 jours.
- **Réversibilité** (critère de recette, OM-2026-01) : export complet de la
  base + code source + documentation ; RPS propriétaire de tout.

## 9. Lots, livrables et recette

| Lot | Contenu | Délai indicatif |
|---|---|---|
| **A** | API du pont (contrat §7.1) + bascule de la maquette CRM en mode API, chiffres identiques au franc sur le jeu de recette §3.5 | 4 semaines |
| **B** | CRM v1 : auth SSO + rôles, base CRM, tableau de bord, clients/fiche 360°, pipeline, promesses, documents (situation 4 volets) | 6 semaines |
| **C** | CRM v2 : séquences de relance, communications WhatsApp/SMS, scoring et limites, prévision d'encaissements, audit complet, mobile | 4 semaines |
| **D** | Déploiement VPS (CDC-04), formation (DG, recouvrement, compta), documentation, transfert | 2 semaines |

**Recette (extraits des cas de test) :** (1) chiffres API = fichiers au franc
sur 10 clients témoins dont SINOMA CARGO et un compte soldé ; (2) un règlement
saisi en compta sort la carte du pipeline en moins d'une heure ; (3) promesse
échue non tenue = alerte J+1 au DG ; (4) tentative d'écriture SQL depuis
l'API = échec par droits de base, tracé ; (5) coupure Sage simulée = bandeau
« données du JJ/MM », zéro chiffre inventé ; (6) situation 4 volets générée
identique au gabarit du plugin, au franc ; (7) un utilisateur sans droit ne
voit ni n'exporte rien ; (8) restauration de la sauvegarde de la veille en
moins d'une heure.

Conditions contractuelles (paiement 30/50/20, recette provisoire/définitive,
garantie 3 mois, réversibilité, résiliation) : celles de l'OM-2026-01, ce
marché s'y rattachant comme extension.

---
*Annexes disponibles dans le dossier : maquette `RPS CRM CREANCES.html` (fait
foi), requêtes SQL de référence (`sql_auto/`), charte graphique
(`references/formats-documents.md` du plugin), dictionnaire des données.*
