#!/usr/bin/env python3
"""
Génère un jeu de données SYNTHÉTIQUE au format des extractions du pont (qr0/qr1/qr3/qr4).
Aucune donnée réelle RPS : clients fictifs, montants inventés, mais typologies et pièges
du CDC-05 §3 reproduits (RAN débiteur et créditeur, remise multi-clients, régularisation,
débits hors RAN, compte muet, créditeur, fil de l'eau mobile money, transporteur au camion, BV Bénin).

Usage :
  python3 donnees_synthetiques.py --tsv sql_out/           # écrit qr0_clients.txt … qr4_livr_clients.txt
  python3 donnees_synthetiques.py --json extraction.json   # écrit le payload {date, clients, facturation, ecritures, livraisons}
  python3 donnees_synthetiques.py --attendus               # affiche les soldes attendus (pour les tests)
"""
import argparse, json, os, random, sys
from datetime import date, timedelta

DATE_EXTRACTION = date(2026, 9, 16)
DEBUT_EXERCICE = date(2026, 1, 1)
random.seed(42)

def dstr(d): return d.isoformat()

class Jeu:
    def __init__(self):
        self.clients, self.fact, self.ecr, self.livr = [], [], [], []
        self.no = 0
    def client(self, compte, nom):
        self.clients.append([compte, nom])
    def ecriture(self, compte, d, jo, piece, ref, intit, sens, montant):
        self.no += 1
        self.ecr.append([compte, dstr(d), jo, piece, ref, intit, sens, f"{montant:.2f}"])
    def livraison(self, compte, d, piece, ar, design, qte, pu, depot):
        self.livr.append([compte, dstr(d), piece, ar, design, f"{qte:.2f}", f"{qte * pu:.2f}", depot])
        mois = d.strftime("%Y-%m")
        self.fact.append((compte, mois, qte * pu))
    def facturation(self):
        agg = {}
        for c, m, ht in self.fact:
            agg[(c, m)] = agg.get((c, m), 0) + ht
        return [[c, m, f"{ht:.2f}"] for (c, m), ht in sorted(agg.items())]

def livraisons_mensuelles(j, compte, nb_par_mois, litres, pu, depot, ar="GAS", jusqua=None, mois_debut=1):
    jusqua = jusqua or DATE_EXTRACTION
    m = DEBUT_EXERCICE.replace(month=mois_debut)
    piece = 1000
    while m <= jusqua:
        for k in range(nb_par_mois):
            d = m + timedelta(days=min(27, 2 + k * (26 // max(1, nb_par_mois))))
            if d > jusqua: break
            piece += 1
            j.livraison(compte, d, f"BL{compte[-4:]}{piece}", ar, f"BON {piece} / {random.choice(['AB-4909','AG-4905','BR-1010','CC-2020'])}", litres, pu, depot)
        m = (m.replace(day=1) + timedelta(days=32)).replace(day=1)

def construire():
    j = Jeu()
    PU_GAS, PU_SUP = 618, 499
    # 1. Grand compte à remises (RAN débiteur, remise multi-clients avec le client 2)
    j.client("41110001", "TRANSPORT DU SAHEL SA")
    j.ecriture("41110001", date(2026, 1, 1), "RAN", "RAN1", "", "REPORT A NOUVEAU", 0, 250_000_000)
    livraisons_mensuelles(j, "41110001", 6, 20000, PU_GAS, "01-12-RPS NIAMEY ROUTE FILINGUE", jusqua=date(2026, 8, 31))
    for i, (d, m) in enumerate([(date(2026, 1, 20), 60_000_000), (date(2026, 2, 2), 63_000_000), (date(2026, 2, 25), 80_000_000), (date(2026, 3, 18), 70_000_000),
                                 (date(2026, 4, 9), 90_000_000), (date(2026, 5, 6), 75_000_000), (date(2026, 6, 2), 88_000_000), (date(2026, 7, 1), 92_000_000), (date(2026, 7, 28), 70_000_000)]):
        j.ecriture("41110001", d, "BQECOB", "2984" if d == date(2026, 2, 2) else f"BQ{4000+i}", f"REMISE CHQ {i+1}", f"REMISE CHEQUES TRANSPORT DU SAHEL {m//1_000_000}M", 1, m)
    # 2. Grand compte qui décroche (dernier règlement 28/07 ; cadence ~15 j) — même remise 2984 (multi-clients)
    j.client("41110002", "CARGO NIGER EXPRESS")
    j.ecriture("41110002", date(2026, 3, 26), "RAN", "RAN2", "", "REPORT A NOUVEAU (saisi en cours d'annee)", 0, 40_000_000)
    livraisons_mensuelles(j, "41110002", 8, 10000, PU_GAS, "01-12-RPS NIAMEY ROUTE FILINGUE")
    d = date(2026, 1, 12); k = 0
    while d <= date(2026, 7, 28):
        k += 1
        j.ecriture("41110002", d, "BQECOB", "2984" if d == date(2026, 2, 2) else f"BC{k}", f"VERS {k}", "REMISE CHEQUES CARGO NIGER", 1, 37_200_000 if d == date(2026, 2, 2) else 30_000_000)
        d += timedelta(days=15 if k % 2 else 16)
        if k == 3: d = date(2026, 2, 2)  # aligne sur la remise multi-clients
    j.ecriture("41110002", date(2026, 5, 4), "OD", "17283", "", "REGULARISATION VERS 6 DOUBLE SAISIE", 0, 30_000_000)  # débit hors RAN qui annule un règlement compté deux fois
    j.ecriture("41110002", date(2026, 5, 4), "OD", "17283", "", "REGULARISATION VERS 6 (annulation)", 1, 30_000_000)
    # 3. Fil de l'eau mobile money (solde quasi nul)
    j.client("41120010", "SEYDOU MOUSSA (fil de l'eau)")
    livraisons_mensuelles(j, "41120010", 6, 1500, PU_SUP, "02-07-RPS MARADI CENTRE", ar="SUP")
    d = date(2026, 1, 6); k = 0
    while d <= date(2026, 9, 12):
        k += 1
        j.ecriture("41120010", d, random.choice(["NITA", "CAINIT", "NITA"]), f"NT{k}", f"N°{100000+k}", "VERS NITA SEYDOU", 1, 1_500 * PU_SUP * 6 / 7)
        d += timedelta(days=5)
    # 4. Transporteur au camion (RAN créditeur, compte légèrement créditeur à la fin)
    j.client("41120020", "OULD TRANSPORT (au camion)")
    j.ecriture("41120020", date(2026, 1, 1), "RAN", "RAN4", "", "REPORT A NOUVEAU", 1, 31_300)
    livraisons_mensuelles(j, "41120020", 5, 3000, PU_GAS, "03-21-RPS ZINDER GARE")
    d = date(2026, 1, 3); k = 0
    while d <= date(2026, 9, 10):
        k += 1
        j.ecriture("41120020", d, "CAISSE", f"CS{k}", f"AB-{4900+k}", f"REGLT CAMION AB-{4900+k}", 1, 3000 * PU_GAS)
        d += timedelta(days=7)
    # avance finale calibrée pour finir créditeur de 47 950 (clone du témoin « créditeur 47 950 »)
    consomme = sum(float(l[6]) for l in j.livr if l[0] == "41120020")
    regle = sum(float(e[7]) for e in j.ecr if e[0] == "41120020" and e[2] != "RAN" and e[6] == 1)
    j.ecriture("41120020", date(2026, 9, 10), "CAISSE", "CS999", "", "AVANCE SUR PROCHAIN CAMION", 1, consomme - 31_300 - regle + 47_950)
    # 5. BV / Bénin : un seul règlement
    j.client("41150003", "BV-TRANSIT BENIN")
    livraisons_mensuelles(j, "41150003", 3, 5000, PU_GAS, "05-31-RPS GAYA FRONTIERE")
    j.ecriture("41150003", date(2026, 4, 15), "BQBOA", "BV1", "", "VIREMENT BV TRANSIT", 1, 12_000_000)
    # 6. Compte muet : aucun règlement, dépenses payées pour son compte (débits hors RAN)
    j.client("41110030", "SOCIETE MUETTE SARL")
    j.ecriture("41110030", date(2026, 1, 1), "RAN", "RAN6", "", "REPORT A NOUVEAU", 0, 150_000_000)
    livraisons_mensuelles(j, "41110030", 4, 8000, PU_GAS, "01-12-RPS NIAMEY ROUTE FILINGUE", jusqua=date(2026, 6, 30))
    j.ecriture("41110030", date(2026, 3, 3), "CAISSE", "DEP1", "", "FRAIS DOUANE PAYES POUR LE CLIENT", 0, 1_244_100)
    j.ecriture("41110030", date(2026, 6, 3), "CAISSE", "DEP2", "", "REPARATION CAMION PAYEE PAR STATION", 0, 800_000)
    # 7. Créditeur (grosse avance)
    j.client("41110040", "ETS AVANCE & FILS")
    j.ecriture("41110040", date(2026, 1, 1), "RAN", "RAN7", "", "REPORT A NOUVEAU", 1, 120_000_000)
    livraisons_mensuelles(j, "41110040", 4, 6000, PU_GAS, "02-07-RPS MARADI CENTRE")
    j.ecriture("41110040", date(2026, 5, 20), "NITA", "NT9001", "", "VERS NITA ETS AVANCE", 1, 90_000_000)
    # 8. Compte collectif à payeurs multiples
    j.client("41120050", "COLLECTIF ONG & BONS (payeurs multiples)")
    livraisons_mensuelles(j, "41120050", 4, 2000, PU_GAS, "04-15-RPS DOSSO")
    for k, (d, payeur, m) in enumerate([(date(2026, 2, 10), "ONG A", 3_000_000), (date(2026, 4, 12), "MAIRIE B", 2_500_000), (date(2026, 6, 15), "ONG A", 3_500_000), (date(2026, 8, 20), "PROJET C", 4_000_000)]):
        j.ecriture("41120050", d, "BQBOA", f"COL{k}", payeur, f"VIREMENT {payeur}", 1, m)
    # 8bis. « Réglé via » (témoin T2) : le collectif règle 500 000 pour le compte de GARAGE SOLDE (OD tracée sur les deux comptes)
    j.ecriture("41120050", date(2026, 7, 3), "OD", "OD13", "", "REGLEMENT GARAGE SOLDE REMIS PAR COLLECTIF EN ESPECE", 0, 500_000)
    j.ecriture("41110060", date(2026, 7, 3), "OD", "OD13", "", "REGLEMENT VIA COLLECTIF ONG (OD 13)", 1, 500_000)
    # 9. Client soldé (tout réglé)
    j.client("41110060", "GARAGE SOLDE")
    livraisons_mensuelles(j, "41110060", 2, 1000, PU_SUP, "01-12-RPS NIAMEY ROUTE FILINGUE", ar="SUP", jusqua=date(2026, 3, 31))
    j.ecriture("41110060", date(2026, 4, 5), "BQBOA", "GS1", "", "SOLDE COMPTE", 1, 6 * 1000 * PU_SUP - 500_000)
    # 10. Petit compte inactif sans facturation
    j.client("41110070", "CLIENT INACTIF")
    # Pièce mal datée (piège n°7) : ignorée par le pont (DO_Date >= 20241201) — on ne la génère pas.
    return j

def attendus(j):
    C = {}
    for c, n in j.clients: C[c] = {"nom": n, "ran": 0, "fact": 0, "regl": 0, "deb": 0, "nb": 0, "der": ""}
    for c, m, ht in j.facturation(): C[c]["fact"] += float(ht)
    for e in j.ecr:
        c, d, jo, sens, m = e[0], e[1], e[2], e[6], float(e[7])
        if jo == "RAN": C[c]["ran"] += m if sens == 0 else -m
        elif sens == 1:
            C[c]["regl"] += m
            # règle CRM (revue d'architecture) : une régularisation (OD « REGUL… ») est neutre sur le solde mais
            # n'est ni un règlement pour la cadence, ni un « dernier règlement »
            if not (jo == "OD" and "REGUL" in e[5].upper()):
                C[c]["nb"] += 1; C[c]["der"] = max(C[c]["der"], d)
        else: C[c]["deb"] += m
    for c in C: C[c]["solde"] = C[c]["ran"] + C[c]["fact"] + C[c]["deb"] - C[c]["regl"]
    return C

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv"); ap.add_argument("--json"); ap.add_argument("--attendus", action="store_true"); ap.add_argument("--sql")
    a = ap.parse_args()
    j = construire()
    if a.tsv:
        os.makedirs(a.tsv, exist_ok=True)
        def w(nom, entete, lignes):
            with open(os.path.join(a.tsv, nom), "w", encoding="utf-8") as f:
                f.write("\t".join(entete) + "\n")
                for l in lignes: f.write("\t".join(str(x) for x in l) + "\n")
        w("qr0_clients.txt", ["CT_Num", "CT_Intitule"], j.clients)
        w("qr1_fact_clients.txt", ["CT_Num", "mois", "ht"], j.facturation())
        w("qr3_ecr_clients.txt", ["CT_Num", "d", "JO_Num", "EC_Piece", "EC_RefPiece", "EC_Intitule", "EC_Sens", "EC_Montant"], j.ecr)
        w("qr4_livr_clients.txt", ["CT_Num", "d", "DO_Piece", "AR_Ref", "DL_Design", "DL_Qte", "DL_MontantHT", "DE_Intitule"], j.livr)
        print(f"TSV écrits dans {a.tsv} : {len(j.clients)} clients, {len(j.ecr)} écritures, {len(j.livr)} livraisons")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"date": dstr(DATE_EXTRACTION), "saisi_jusquau": dstr(max(date.fromisoformat(l[1]) for l in j.livr)),
                       "clients": j.clients, "facturation": j.facturation(), "ecritures": j.ecr, "livraisons": j.livr}, f, ensure_ascii=False)
        print(f"JSON écrit : {a.json}")
    if a.sql:
        def jl(x): return "$j$" + json.dumps(x, ensure_ascii=False) + "$j$::jsonb"
        with open(a.sql, "w", encoding="utf-8") as f:
            att = {"clients": len(j.clients), "facturation": len(j.facturation()), "ecritures": len(j.ecr), "livraisons": len(j.livr)}
            f.write(f"SELECT pont_debut_extraction('{dstr(DATE_EXTRACTION)}', 'fichiers', NULL, 'jeu synthétique', {jl(att)}) AS ext \\gset\n")
            f.write(f"SELECT pont_ajouter_lignes(:'ext', 'clients', {jl(j.clients)}, 1);\n")
            f.write(f"SELECT pont_ajouter_lignes(:'ext', 'facturation', {jl(j.facturation())}, 1);\n")
            f.write(f"SELECT pont_ajouter_lignes(:'ext', 'ecritures', {jl(j.ecr)}, 1);\n")
            f.write(f"SELECT pont_ajouter_lignes(:'ext', 'livraisons', {jl(j.livr)}, 1);\n")
            f.write("SELECT pont_activer_extraction(:'ext');\n")
            f.write("CREATE TEMP TABLE attendus (compte text, solde numeric, ran numeric, regle numeric, nb int);\n")
            for c, v in attendus(j).items():
                f.write(f"INSERT INTO attendus VALUES ('{c}', {v['solde']:.2f}, {v['ran']:.2f}, {v['regl']:.2f}, {v['nb']});\n")
        print(f"SQL écrit : {a.sql}")
    if a.attendus:
        for c, v in attendus(j).items():
            print(f"{c} {v['nom'][:32]:32} RAN {v['ran']:>15,.0f} FACT {v['fact']:>15,.0f} REGL {v['regl']:>15,.0f} DEB {v['deb']:>12,.0f} SOLDE {v['solde']:>15,.0f} nb={v['nb']} der={v['der']}")
