"""Tests sur données synthétiques (aucune donnée réelle) : cohérence du générateur et du découpage en lots."""
import json
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))
import donnees_synthetiques as ds  # noqa: E402


def test_formule_solde_economique():
    j = ds.construire()
    att = ds.attendus(j)
    # compte muet : RAN + facturation + dépenses payées, zéro règlement
    muet = att["41110030"]
    assert muet["nb"] == 0 and muet["deb"] == 2_044_100 and muet["solde"] == muet["ran"] + muet["fact"] + muet["deb"]
    # créditeur : RAN créditeur + gros règlement > facturation
    assert att["41110040"]["solde"] < 0
    # compte soldé au franc
    assert att["41110060"]["solde"] == 0
    # régularisation : débit et crédit hors RAN se neutralisent dans le solde
    c2 = att["41110002"]
    assert c2["solde"] == c2["ran"] + c2["fact"] + c2["deb"] - c2["regl"]


def test_formats_des_lignes():
    j = ds.construire()
    assert all(len(l) == 2 for l in j.clients)
    assert all(len(l) == 3 for l in j.facturation())
    assert all(len(l) == 8 for l in j.ecr)
    assert all(len(l) == 8 for l in j.livr)
    assert all(l[6] in (0, 1) for l in j.ecr)
    assert all(len(l[1]) == 10 for l in j.ecr)  # dates AAAA-MM-JJ


def test_generation_json_et_tsv(tmp_path):
    out = subprocess.run([sys.executable, str(ICI / "donnees_synthetiques.py"), "--json", str(tmp_path / "x.json"), "--tsv", str(tmp_path / "sql_out")], capture_output=True, text=True, check=True)
    assert "JSON écrit" in out.stdout
    p = json.loads((tmp_path / "x.json").read_text(encoding="utf-8"))
    assert set(p) >= {"date", "saisi_jusquau", "clients", "facturation", "ecritures", "livraisons"}
    lignes = (tmp_path / "sql_out" / "qr3_ecr_clients.txt").read_text(encoding="utf-8").splitlines()
    assert lignes[0].split("\t") == ["CT_Num", "d", "JO_Num", "EC_Piece", "EC_RefPiece", "EC_Intitule", "EC_Sens", "EC_Montant"]
    assert len(lignes) == len(p["ecritures"]) + 1
