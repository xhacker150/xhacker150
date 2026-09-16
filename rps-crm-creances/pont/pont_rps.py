#!/usr/bin/env python3
"""
API DU PONT RPS — service installé sur RPS-SERVER (LAN), lecture seule sur Sage 100.

Deux usages :
  1. Service HTTP (FastAPI) sur le LAN : GET /health, GET /crm/extract (contrat de la maquette, api/openapi.yaml).
       uvicorn pont_rps:app --host 0.0.0.0 --port 8080
  2. Pousser l'extraction du matin vers le CRM (Vercel) — le serveur pousse, jamais l'inverse :
       python pont_rps.py pousser            (à planifier chaque matin, Planificateur de tâches Windows)
       python pont_rps.py fichiers DOSSIER   (écrit aussi qr0..qr4 en TSV dans DOSSIER\sql_out : mode fichiers de secours)

Règles d'or : compte SQL SELECT-only, READ UNCOMMITTED, aucune écriture vers Sage, aucun chiffre inventé
(chaque réponse porte date_extraction), aucune donnée réelle dans le dépôt (secrets en variables d'environnement).

Variables d'environnement (fichier .env à côté du script ou variables système) :
  SAGE_SERVEUR=RPS-SERVER\\SAGE100      SAGE_BD_COMPTA="RPS BD 26"     SAGE_BD_GESCOM="RPS NOUV BD"
  SAGE_AUTH=windows | sql               SAGE_UTILISATEUR / SAGE_MOT_DE_PASSE (si SAGE_AUTH=sql)
  CRM_URL=https://crm-creances.vercel.app   CRM_CLE_API=<PONT_API_KEY du CRM>
  PONT_CLE_API=<clé attendue en X-API-Key sur ce service LAN>   PONT_TAILLE_LOT=2000
"""
from __future__ import annotations

import json
import logging
import os
import sys
import urllib.request
import urllib.error
from datetime import date, datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pont")

ICI = Path(__file__).resolve().parent
SQL = ICI.parent / "sql"

# ---------------------------------------------------------------- configuration
def charger_env() -> None:
    f = ICI / ".env"
    if f.exists():
        for ligne in f.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if not ligne or ligne.startswith("#") or "=" not in ligne:
                continue
            k, v = ligne.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))

charger_env()
CONF = {
    "serveur": os.environ.get("SAGE_SERVEUR", r"RPS-SERVER\SAGE100"),
    "compta": os.environ.get("SAGE_BD_COMPTA", "RPS BD 26"),
    "gescom": os.environ.get("SAGE_BD_GESCOM", "RPS NOUV BD"),
    "auth": os.environ.get("SAGE_AUTH", "windows"),
    "utilisateur": os.environ.get("SAGE_UTILISATEUR", ""),
    "mot_de_passe": os.environ.get("SAGE_MOT_DE_PASSE", ""),
    "crm_url": os.environ.get("CRM_URL", "").rstrip("/"),
    "crm_cle": os.environ.get("CRM_CLE_API", ""),
    "pont_cle": os.environ.get("PONT_CLE_API", ""),
    "taille_lot": int(os.environ.get("PONT_TAILLE_LOT", "2000")),
}

REQUETES = {  # nom du jeu -> (base, fichier SQL de référence — sémantique ÉPROUVÉE, ne pas modifier)
    "clients": ("compta", "qr0_clients.sql"),
    "facturation": ("gescom", "qr1_fact_clients.sql"),
    "ecritures": ("compta", "qr3_ecr_clients.sql"),
    "livraisons": ("gescom", "qr4_livr_clients.sql"),
}
FICHIERS_TSV = {"clients": "qr0_clients.txt", "facturation": "qr1_fact_clients.txt", "ecritures": "qr3_ecr_clients.txt", "livraisons": "qr4_livr_clients.txt"}
ENTETES = {
    "clients": ["CT_Num", "CT_Intitule"],
    "facturation": ["CT_Num", "mois", "ht"],
    "ecritures": ["CT_Num", "d", "JO_Num", "EC_Piece", "EC_RefPiece", "EC_Intitule", "EC_Sens", "EC_Montant"],
    "livraisons": ["CT_Num", "d", "DO_Piece", "AR_Ref", "DL_Design", "DL_Qte", "DL_MontantHT", "DE_Intitule"],
}
SQL_SAISI_JUSQUAU = "SELECT MAX(DO_Date) FROM F_DOCLIGNE WHERE DO_Domaine=0 AND DO_Type IN (6,7) AND CT_Num LIKE '411%' AND CT_Num NOT LIKE '41180%' AND DO_Date >= '20241201'"

# ---------------------------------------------------------------- Sage (SELECT-only)
def lire_sql(nom: str) -> str:
    texte = (SQL / nom).read_text(encoding="utf-8")
    return "\n".join(l for l in texte.splitlines() if not l.strip().startswith("--")).strip()

def connexion(base: str):
    import pyodbc  # pip install pyodbc (pilote « ODBC Driver 17/18 for SQL Server »)
    if CONF["auth"] == "sql":
        chaine = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={CONF['serveur']};DATABASE={CONF[base]};UID={CONF['utilisateur']};PWD={CONF['mot_de_passe']};ApplicationIntent=ReadOnly"
    else:
        chaine = f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={CONF['serveur']};DATABASE={CONF[base]};Trusted_Connection=yes;ApplicationIntent=ReadOnly"
    cnx = pyodbc.connect(chaine, readonly=True, autocommit=True)
    cur = cnx.cursor()
    cur.execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
    return cnx

def normaliser(valeur):
    if valeur is None:
        return ""
    if isinstance(valeur, datetime):
        return valeur.strftime("%Y-%m-%d")
    if isinstance(valeur, date):
        return valeur.isoformat()
    if isinstance(valeur, float):
        return f"{valeur:.2f}"
    return str(valeur).strip()

def extraire() -> dict:
    """Exécute les 4 requêtes de référence et retourne le payload {date, saisi_jusquau, clients, facturation, ecritures, livraisons}."""
    resultat = {"date": date.today().isoformat(), "date_extraction": date.today().isoformat()}
    for jeu, (base, fichier) in REQUETES.items():
        cnx = connexion(base)
        try:
            cur = cnx.cursor()
            cur.execute(lire_sql(fichier))
            resultat[jeu] = [[normaliser(v) for v in ligne] for ligne in cur.fetchall()]
            log.info("%s : %d lignes", jeu, len(resultat[jeu]))
        finally:
            cnx.close()
    cnx = connexion("gescom")
    try:
        cur = cnx.cursor()
        cur.execute(SQL_SAISI_JUSQUAU)
        v = cur.fetchone()[0]
        resultat["saisi_jusquau"] = normaliser(v) or None
    finally:
        cnx.close()
    return resultat

def ecrire_tsv(payload: dict, dossier: Path) -> None:
    out = dossier / "sql_out"
    out.mkdir(parents=True, exist_ok=True)
    for jeu, nom in FICHIERS_TSV.items():
        with open(out / nom, "w", encoding="utf-8", newline="") as f:
            f.write("\t".join(ENTETES[jeu]) + "\n")
            for ligne in payload[jeu]:
                f.write("\t".join(str(v).replace("\t", " ") for v in ligne) + "\n")
    (out / "date_extraction.txt").write_text(f"{payload['date']}\nsaisi_jusquau={payload.get('saisi_jusquau') or ''}\n", encoding="utf-8")
    log.info("TSV écrits dans %s", out)

# ---------------------------------------------------------------- CRM (push par lots)
def appel_crm(chemin: str, corps: dict | None = None, methode: str = "POST") -> dict:
    if not CONF["crm_url"] or not CONF["crm_cle"]:
        raise SystemExit("CRM_URL et CRM_CLE_API doivent être définis")
    donnees = json.dumps(corps, ensure_ascii=False).encode("utf-8") if corps is not None else None
    req = urllib.request.Request(CONF["crm_url"] + chemin, data=donnees, method=methode,
                                 headers={"X-API-Key": CONF["crm_cle"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as rep:
            return json.loads(rep.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"CRM {chemin} -> HTTP {e.code} : {e.read().decode('utf-8', 'ignore')[:300]}")

def pousser(payload: dict) -> dict:
    """Ouvre une extraction, envoie chaque jeu par lots, active. Idempotent : une extraction non activée est purgée après 1 h."""
    sante = appel_crm("/api/pont/health", methode="GET")
    log.info("CRM joignable — extraction active : %s", sante.get("date_extraction"))
    ouverture = appel_crm("/api/pont/extractions", {"date": payload["date"], "saisi_jusquau": payload.get("saisi_jusquau"), "commentaire": "pont_rps.py"})
    ident = ouverture["id"]
    taille = CONF["taille_lot"]
    for jeu in REQUETES:
        lignes = payload[jeu]
        for i in range(0, len(lignes), taille):
            r = appel_crm(f"/api/pont/extractions/{ident}/lignes", {"jeu": jeu, "lignes": lignes[i:i + taille]})
            log.info("%s : lot %d-%d -> %s lignes", jeu, i, i + taille, r.get("lignes_ajoutees"))
    resultat = appel_crm(f"/api/pont/extractions/{ident}/activer", {})
    log.info("Extraction activée : %s", resultat)
    return resultat

# ---------------------------------------------------------------- service HTTP LAN (contrat openapi.yaml)
try:
    from fastapi import FastAPI, Header, HTTPException  # pip install fastapi uvicorn

    app = FastAPI(title="API du pont RPS (lecture seule Sage)", version="1.0")

    def verifier(x_api_key: str | None):
        if CONF["pont_cle"] and x_api_key != CONF["pont_cle"]:
            raise HTTPException(status_code=401, detail="Clé API invalide")

    @app.get("/health")
    def health(x_api_key: str | None = Header(default=None)):
        verifier(x_api_key)
        etat = {}
        for base in ("compta", "gescom"):
            try:
                cnx = connexion(base); cnx.cursor().execute("SELECT 1"); cnx.close(); etat[base] = "ok"
            except Exception as e:  # noqa: BLE001
                etat[base] = f"erreur : {e}"
        return {"ok": all(v == "ok" for v in etat.values()), "bases": etat, "date_extraction": date.today().isoformat(), "heure": datetime.now().isoformat()}

    @app.get("/crm/extract")
    def crm_extract(x_api_key: str | None = Header(default=None)):
        verifier(x_api_key)
        return extraire()

    @app.get("/api/health")
    def health_api(x_api_key: str | None = Header(default=None)):
        return health(x_api_key)

    @app.get("/api/crm/extract")
    def crm_extract_api(x_api_key: str | None = Header(default=None)):
        return crm_extract(x_api_key)
except ImportError:  # FastAPI facultatif pour le mode « pousser »
    app = None

# ---------------------------------------------------------------- ligne de commande
if __name__ == "__main__":
    commande = sys.argv[1] if len(sys.argv) > 1 else "aide"
    if commande == "pousser":
        payload = extraire()
        if len(sys.argv) > 2:
            ecrire_tsv(payload, Path(sys.argv[2]))
        pousser(payload)
    elif commande == "fichiers":
        ecrire_tsv(extraire(), Path(sys.argv[2] if len(sys.argv) > 2 else "."))
    elif commande == "pousser-json":  # rejoue un payload JSON déjà extrait (tests, secours)
        with open(sys.argv[2], encoding="utf-8") as f:
            pousser(json.load(f))
    else:
        print(__doc__)
