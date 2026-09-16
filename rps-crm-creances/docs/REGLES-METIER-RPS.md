# RÈGLES MÉTIER RPS — référentiel condensé pour le développeur

Extrait opposable du référentiel interne (plugin rps-gestion, validé par le DG
entre août et septembre 2026). En cas de conflit avec toute autre source, ce
document et le CDC-05 font foi.

## 1. Les trois systèmes

| Système | Base | Fait foi pour |
|---|---|---|
| GESCOM (Sage gestion commerciale) | SQL `RPS NOUV BD` | facturation, livraisons, dépôts, clients |
| COMPTA (Sage comptabilité) | SQL `RPS BD 26` | écritures, règlements, RAN, caisses, banques |
| GESTA (logiciel stations) | classeurs Excel réseau | ventes à la pompe, espèces (hors périmètre CRM) |

Serveur `RPS-SERVER\SAGE100`, authentification Windows, **lecture seule**.

## 2. Plan de comptes utile au CRM

- `411xxxxx` hors `41180xxx` : clients à terme (le périmètre du CRM).
  `41180xxx` = clients cash des stations (suffixe = n° de station) — exclus.
  `41150001-…` : série des comptes BV (bons de valeur), dont BV-RPS BENIN.
- Journal `RAN` : report à nouveau (peut être débiteur OU créditeur, parfois
  saisi en cours d'année). Tout autre journal, sens crédit = règlement ;
  sens débit hors RAN = dépense payée pour le client (s'ajoute à sa dette).
- Banques en `521xxxx` (5211001 BOA, 5212001 BIA, 5216001 ORABANK, 5217001
  ECOBANK, 5217002 BHN, 5217003 CORIS, 5218001 Banque Islamique — journal
  BBIN). Mobile money en `5381xxx` (NITA — journaux NITA et CAINIT — et
  Airtel Money) : canal d'encaissement majeur.
- Constat structurel : les factures de vente ne sont PAS déversées en compta
  (classe 7 absente, débits clients ≈ 0). D'où la règle du solde économique.

## 3. La formule du solde (LA règle n°1)

```
SOLDE = RAN(débits−crédits, journal RAN)
      + FACTURATION GESCOM (F_DOCLIGNE, DO_Domaine=0, DO_Type IN (6,7))
      + DÉBITS COMPTA HORS RAN (dépenses payées pour le client)
      − RÈGLEMENTS (crédits compta hors RAN)
```
Solde négatif = client créditeur (avance) : interdiction de relance.

## 4. Requêtes de référence (dossier `sql/`)

Éprouvées en production. Formats de sortie (TSV, 1 ligne d'en-tête) :

- `qr0_clients` : `CT_Num, CT_Intitule`
- `qr1_fact_clients` : `CT_Num, mois(AAAA-MM), ht`
- `qr3_ecr_clients` : `CT_Num, d(AAAA-MM-JJ), JO_Num, EC_Piece, EC_RefPiece,
  EC_Intitule, EC_Sens(0=débit,1=crédit), EC_Montant`
- `qr4_livr_clients` : `CT_Num, d, DO_Piece, AR_Ref(GAS/SUP), DL_Design(bon/
  camion), DL_Qte(litres), DL_MontantHT, DE_Intitule(dépôt=station)`

Prix constatés 2026 : gasoil 618 F/L HT, super 499 F/L HT — mais toujours
recalculer depuis les montants, jamais coder un prix en dur.

## 5. Pièges réels observés (chaque item vient d'un dossier vécu)

1. Une remise de chèques peut couvrir **plusieurs clients** (même pièce,
   plusieurs lignes sur des comptes différents).
2. Un client peut régler **pour un autre** (« SINOMA remis à DIDI en espèce »).
3. Des écritures « RÉGULARISATION » corrigent un règlement antérieur : ne pas
   compter deux fois.
4. La facturation du mois en cours est **toujours en retard de saisie** —
   afficher « saisi jusqu'au JJ/MM », ne jamais comparer un mois non clos.
5. Certains comptes sont **collectifs** (plusieurs payeurs sur un compte, ex.
   bons NIGELEC + ONG sur un même 41120xxx) : prévoir une étiquette payeur.
6. Les intitulés d'écritures contiennent les références utiles (« N°… »,
   « VERS … ») : les parser avec tolérance (fautes de frappe fréquentes).
7. 6 pièces gescom mal datées (2002/2012/2023, montant nul) traînent en base :
   filtrer sur les exercices utiles (`DO_Date >= '20241201'`).

## 6. Typologies clients et cadence (paramétrage de départ)

Voir CDC-05 §3.1-3.2. Résumé : grand compte à remises / fil de l'eau mobile
money / transporteur au camion / BV-Bénin (pas de nouveau lot de bons sans
règlement du précédent) / compte muet (pré-contentieux) / créditeur (aucune
relance) / collectif. Alerte décrochage = 1,5 × médiane des intervalles de
règlement du client, bornée 10-45 jours ; filet générique 500 k / 30 j.

## 7. Documents officiels

Situation client 4 volets (facture du dernier mois clos + relevé + situation
chronologique avec chaque règlement individuellement + note d'analyse), PDF à
la charte : rouge #EA0000, bleu #0051DD, encre #1B1F2E, Arial/Helvetica,
bandeaux bicolores 66/34, pied de page RPS (B.P. 2184 Niamey — NIF 7272/R).
La maquette et les PDF du dossier `30_CLIENTS/` chez RPS servent de gabarits.

## 8. Sécurité

Lecture seule Sage garantie par les droits du compte SQL (pas seulement par le
code). Sage jamais exposé à Internet. Comptes applicatifs nominatifs. Journal
d'audit sur toute action. Aucune donnée réelle dans le dépôt de code ni dans
les tickets.
