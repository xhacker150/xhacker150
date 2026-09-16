"""Tests du pont sur données SYNTHÉTIQUES (aucune donnée réelle) : chaque cas du CDC-05 §3.3 est asserté individuellement."""
import json
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))
import donnees_synthetiques as ds  # noqa: E402

J = ds.construire()
ATT = ds.attendus(J)


def test_ran_debiteur():
    assert ATT["41110001"]["ran"] == 250_000_000
    assert ATT["41110001"]["solde"] == 155_280_000


def test_ran_crediteur_et_avance():
    assert ATT["41120020"]["ran"] == -31_300
    assert ATT["41120020"]["solde"] == -47_950          # clone du témoin « créditeur 47 950 »
    assert ATT["41110040"]["ran"] == -120_000_000 and ATT["41110040"]["solde"] < 0


def test_ran_saisi_en_cours_d_annee():
    ran = [e for e in J.ecr if e[0] == "41110002" and e[2] == "RAN"]
    assert len(ran) == 1 and ran[0][1] == "2026-03-26"
    assert ATT["41110002"]["ran"] == 40_000_000


def test_debits_hors_ran_compte_muet():
    m = ATT["41110030"]
    assert m["nb"] == 0 and m["deb"] == 2_044_100
    assert m["solde"] == m["ran"] + m["fact"] + m["deb"] == 270_700_100


def test_regularisation_neutre_et_hors_cadence():
    c2 = ATT["41110002"]
    od = [e for e in J.ecr if e[3] == "17283"]
    assert len(od) == 2 and {e[6] for e in od} == {0, 1}
    assert c2["deb"] == 30_000_000 and c2["regl"] == 487_200_000
    assert c2["nb"] == 15, "la régularisation ne compte pas comme un règlement"


def test_remise_multi_clients_et_regle_via():
    r = [e for e in J.ecr if e[3] == "2984" and e[6] == 1]
    assert {e[0] for e in r} == {"41110001", "41110002"} and sum(float(e[7]) for e in r) == 100_200_000
    via = [e for e in J.ecr if e[3] == "OD13"]
    assert {e[0] for e in via} == {"41120050", "41110060"}


def test_compte_solde_et_inactif():
    assert ATT["41110060"]["solde"] == 0
    assert ATT["41110070"]["fact"] == 0 and ATT["41110070"]["solde"] == 0


def test_fil_de_l_eau_quasi_nul():
    f = ATT["41120010"]
    assert f["nb"] >= 15 and 0 < f["solde"] < f["fact"] / 4


def test_formats_des_lignes():
    assert all(len(l) == 2 for l in J.clients)
    assert all(len(l) == 3 for l in J.facturation())
    assert all(len(l) == 8 and l[6] in (0, 1) and len(l[1]) == 10 for l in J.ecr)
    assert all(len(l) == 8 for l in J.livr)
    assert all(l[0].startswith("411") and not l[0].startswith("41180") for l in J.clients)


def test_generation_json_tsv_sql(tmp_path):
    out = subprocess.run([sys.executable, str(ICI / "donnees_synthetiques.py"), "--json", str(tmp_path / "x.json"), "--tsv", str(tmp_path / "sql_out"), "--sql", str(tmp_path / "charge.sql")], capture_output=True, text=True, check=True)
    assert "JSON écrit" in out.stdout
    p = json.loads((tmp_path / "x.json").read_text(encoding="utf-8"))
    assert set(p) >= {"date", "saisi_jusquau", "clients", "facturation", "ecritures", "livraisons"}
    lignes = (tmp_path / "sql_out" / "qr3_ecr_clients.txt").read_text(encoding="utf-8").splitlines()
    assert lignes[0].split("\t") == ["CT_Num", "d", "JO_Num", "EC_Piece", "EC_RefPiece", "EC_Intitule", "EC_Sens", "EC_Montant"]
    assert len(lignes) == len(p["ecritures"]) + 1
    sql = (tmp_path / "charge.sql").read_text(encoding="utf-8")
    assert "pont_debut_extraction" in sql and "'ecritures'" in sql and "pont_activer_extraction" in sql
