#!/usr/bin/env python3
"""
API DU PONT RPS — service installé sur RPS-SERVER (LAN), lecture seule sur Sage 100.

Usages :
  python pont_rps.py pousser [DOSSIER]     extrait Sage, écrit les TSV de secours (DOSSIER\\sql_out) et POUSSE vers le CRM par lots
  python pont_rps.py fichiers DOSSIER      écrit seulement qr0..qr4 en TSV (mode fichiers)
  python pont_rps.py pousser-json F.json   rejoue un payload JSON déjà extrait (tests, secours)
  python pont_rps.py verifier-lecture-seule   prouve que le compte SQL ne peut pas écrire (erreur 229 attendue)
  uvicorn pont_rps:app --host 192.168.x.x --port 8080   service LAN facultatif (contrat api/openapi.yaml : /health, /crm/extract)

Règles d'or : la lecture seule est garantie par les DROITS du compte SQL (sql/00_compte_pont_lecture.sql) ; le code n'émet
aucune écriture ; READ UNCOMMITTED ; le serveur POUSSE vers le CRM, jamais l'inverse ; chaque réponse porte date_extraction ;
aucun chiffre inventé ; aucune donnée réelle dans le dépôt ; secrets en variables d'environnement.

Variables (pont/.env ou variables système) :
  SAGE_SERVEUR=RPS-SERVER\\SAGE100  SAGE_BD_COMPTA="RPS BD 26"  SAGE_BD_GESCOM="RPS NOUV BD"  SAGE_AUTH=windows|sql
  SAGE_UTILISATEUR / SAGE_MOT_DE_PASSE (si SAGE_AUTH=sql)   SAGE_PILOTE="ODBC Driver 17 for SQL Server"
  CRM_URL=https://crm-creances.vercel.app   CRM_CLE_API=<PONT_API_KEYS du CRM>
  PONT_CLE_API=<clé exigée en X-API-Key sur le service LAN, OBLIGATOIRE pour démarrer le service>   PONT_TAILLE_LOT=2000
  PONT_JOURNAL=C:\\RPS\\pont\\pont.log   PONT_TENTATIVES=3
"""
from __future__ import annotations

import hmac
import json
import logging
import logging.handlers
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

ICI = Path(__file__).resolve().parent
SQL = ICI.parent / "sql"


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
    "pilote": os.environ.get("SAGE_PILOTE", "ODBC Driver 17 for SQL Server"),
    "crm_url": os.environ.get("CRM_URL", "").rstrip("/"),
    "crm_cle": os.environ.get("CRM_CLE_API", ""),
    "pont_cle": os.environ.get("PONT_CLE_API", ""),
    "taille_lot": int(os.environ.get("PONT_TAILLE_LOT", "2000")),
    "tentatives": int(os.environ.get("PONT_TENTATIVES", "3")),
    "journal": os.environ.get("PONT_JOURNAL", str(ICI / "pont.log")),
}

# Journal fichier tournant (le Planificateur de tâches perd stdout) + console
log = logging.getLogger("pont")
log.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
_h = logging.handlers.RotatingFileHandler(CONF["journal"], maxBytes=2_000_000, backupCount=10, encoding="utf-8")
_h.setFormatter(_fmt)
log.addHandler(_h)
_c = logging.StreamHandler()
_c.setFormatter(_fmt)
log.addHandler(_c)

REQUETES = {  # jeu -> (base, fichier SQL de référence — sémantique ÉPROUVÉE en production, ne pas modifier)
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
    """Une connexion par base, isolation READ UNCOMMITTED (attribut de session). readonly/ApplicationIntent : ceinture, pas garantie."""
    import pyodbc  # pip install pyodbc

    if CONF["auth"] == "sql":
        chaine = f"DRIVER={{{CONF['pilote']}}};SERVER={CONF['serveur']};DATABASE={CONF[base]};UID={CONF['utilisateur']};PWD={CONF['mot_de_passe']};ApplicationIntent=ReadOnly"
    else:
        chaine = f"DRIVER={{{CONF['pilote']}}};SERVER={CONF['serveur']};DATABASE={CONF[base]};Trusted_Connection=yes;ApplicationIntent=ReadOnly"
    cnx = pyodbc.connect(chaine, readonly=True, autocommit=True)
    cnx.cursor().execute("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
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
    return str(valeur).replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()


def extraire() -> dict:
    """Exécute les 4 requêtes de référence (une connexion par base, même instant) : {date, heure, saisi_jusquau, clients, facturation, ecritures, livraisons}."""
    heure = datetime.now()
    resultat = {"date": heure.date().isoformat(), "date_extraction": heure.date().isoformat(), "heure": heure.isoformat(timespec="seconds")}
    connexions = {}
    try:
        for base in ("compta", "gescom"):
            connexions[base] = connexion(base)
        for jeu, (base, fichier) in REQUETES.items():
            cur = connexions[base].cursor()
            cur.execute(lire_sql(fichier))
            resultat[jeu] = [[normaliser(v) for v in ligne] for ligne in cur.fetchall()]
            log.info("%s : %d lignes", jeu, len(resultat[jeu]))
        cur = connexions["gescom"].cursor()
        cur.execute(SQL_SAISI_JUSQUAU)
        v = cur.fetchone()[0]
        resultat["saisi_jusquau"] = normaliser(v) or None
    finally:
        for c in connexions.values():
            c.close()
    return resultat


def verifier_lecture_seule() -> bool:
    """Prouve que le compte ne peut pas écrire (cas de recette n°4). Une écriture qui PASSE est une faute grave."""
    import pyodbc

    for base in ("compta", "gescom"):
        cnx = connexion(base)
        try:
            cnx.cursor().execute("BEGIN TRANSACTION; SELECT 1 INTO #t_pont_test; ROLLBACK")   # table temporaire : autorisée, sans effet
            try:
                cnx.cursor().execute("UPDATE dbo.F_COMPTET SET CT_Intitule = CT_Intitule WHERE 1 = 0")
                log.error("FAUTE GRAVE : le compte du pont peut écrire dans %s. Appliquez sql/00_compte_pont_lecture.sql", CONF[base])
                return False
            except pyodbc.Error as e:
                log.info("OK %s : écriture refusée par les droits (%s)", CONF[base], str(e)[:80])
        finally:
            cnx.close()
    return True


def ecrire_tsv(payload: dict, dossier: Path) -> None:
    out = dossier / "sql_out"
    out.mkdir(parents=True, exist_ok=True)
    for jeu, nom in FICHIERS_TSV.items():
        with open(out / nom, "w", encoding="utf-8", newline="") as f:
            f.write("\t".join(ENTETES[jeu]) + "\n")
            for ligne in payload[jeu]:
                f.write("\t".join(str(v) for v in ligne) + "\n")
    (out / "date_extraction.txt").write_text(f"{payload['date']}\nheure={payload.get('heure', '')}\nsaisi_jusquau={payload.get('saisi_jusquau') or ''}\n", encoding="utf-8")
    log.info("TSV écrits dans %s", out)


# ---------------------------------------------------------------- CRM (push par lots, idempotent, avec reprise)
class ErreurCrm(RuntimeError):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def appel_crm(chemin: str, corps: dict | None = None, methode: str = "POST") -> dict:
    """Appel HTTP avec reprise exponentielle sur erreur réseau ou 5xx (jamais sur 4xx : un refus est une décision du CRM)."""
    if not CONF["crm_url"] or not CONF["crm_cle"]:
        raise SystemExit("CRM_URL et CRM_CLE_API doivent être définis")
    donnees = json.dumps(corps, ensure_ascii=False).encode("utf-8") if corps is not None else None
    derniere = None
    for tentative in range(1, CONF["tentatives"] + 1):
        req = urllib.request.Request(CONF["crm_url"] + chemin, data=donnees, method=methode,
                                     headers={"X-API-Key": CONF["crm_cle"], "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as rep:
                return json.loads(rep.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            texte = e.read().decode("utf-8", "ignore")[:300]
            if 400 <= e.code < 500:
                raise ErreurCrm(e.code, f"CRM {chemin} -> HTTP {e.code} : {texte}")
            derniere = f"HTTP {e.code} : {texte}"
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            derniere = str(e)
        attente = 2 ** tentative
        log.warning("%s : échec (%s), nouvelle tentative dans %ss", chemin, derniere, attente)
        time.sleep(attente)
    raise ErreurCrm(0, f"CRM {chemin} injoignable après {CONF['tentatives']} tentatives : {derniere}")


def battement(etat: str, detail: str = "") -> None:
    try:
        appel_crm("/api/pont/health", {"etat": etat, "detail": detail[:400]})
    except Exception as e:  # noqa: BLE001 — la trace ne bloque jamais
        log.warning("battement non envoyé : %s", e)


def pousser(payload: dict) -> dict:
    """Ouvre une extraction avec les totaux annoncés, envoie chaque jeu par lots NUMÉROTÉS (idempotents), active ; abandonne en cas d'échec."""
    sante = appel_crm("/api/pont/health", methode="GET")
    log.info("CRM joignable — extraction active : %s", sante.get("date_extraction"))
    attendus = {jeu: len(payload[jeu]) for jeu in REQUETES}
    ouverture = appel_crm("/api/pont/extractions", {"date": payload["date"], "saisi_jusquau": payload.get("saisi_jusquau"), "heure": payload.get("heure"), "attendus": attendus, "commentaire": "pont_rps.py"})
    ident = ouverture["id"]
    taille = CONF["taille_lot"]
    try:
        for jeu in REQUETES:
            lignes = payload[jeu]
            for lot, i in enumerate(range(0, len(lignes), taille), start=1):
                r = appel_crm(f"/api/pont/extractions/{ident}/lignes", {"jeu": jeu, "lot": lot, "lignes": lignes[i:i + taille]})
                if r.get("deja_recu"):
                    log.info("%s lot %d déjà reçu (rejeu ignoré)", jeu, lot)
                elif r.get("rejetees"):
                    log.warning("%s lot %d : %s rejet(s), ex. %s", jeu, lot, r.get("rejetees"), r.get("exemples_rejets"))
        resultat = appel_crm(f"/api/pont/extractions/{ident}/activer", {})
        log.info("Extraction activée : %s", resultat)
        battement("ok", f"extraction {payload['date']} activée")
        return resultat
    except ErreurCrm as e:
        log.error("Échec du push : %s", e)
        if e.code == 409:
            log.error("Activation refusée par le CRM (extraction partielle, rejets ou date antérieure) : l'extraction reste en attente d'une décision du DG dans l'écran SOURCE")
        else:
            try:
                appel_crm(f"/api/pont/extractions/{ident}", methode="DELETE")
                log.info("Extraction %s abandonnée", ident)
            except Exception:  # noqa: BLE001
                pass
        battement("crm_erreur", str(e))
        raise


# ---------------------------------------------------------------- service HTTP LAN (contrat openapi.yaml), facultatif
try:
    from fastapi import FastAPI, Header, HTTPException  # pip install fastapi uvicorn

    if not CONF["pont_cle"]:
        raise ImportError("PONT_CLE_API vide : le service LAN refuse de démarrer sans clé (utilisez la commande « pousser »)")

    app = FastAPI(title="API du pont RPS (lecture seule Sage)", version="1.1")

    def verifier(x_api_key: str | None):
        if not x_api_key or not hmac.compare_digest(x_api_key, CONF["pont_cle"]):
            raise HTTPException(status_code=401, detail="Clé API invalide")

    @app.get("/health")
    @app.get("/api/health")
    def health(x_api_key: str | None = Header(default=None)):
        verifier(x_api_key)
        etat = {}
        for base in ("compta", "gescom"):
            try:
                cnx = connexion(base)
                cnx.cursor().execute("SELECT 1")
                cnx.close()
                etat[base] = "ok"
            except Exception as e:  # noqa: BLE001
                etat[base] = "erreur"
                log.error("health %s : %s", base, e)
        return {"ok": all(v == "ok" for v in etat.values()), "bases": etat, "date_extraction": date.today().isoformat(), "heure": datetime.now().isoformat()}

    @app.get("/crm/extract")
    @app.get("/api/crm/extract")
    def crm_extract(x_api_key: str | None = Header(default=None)):
        verifier(x_api_key)
        return extraire()
except ImportError as _e:  # FastAPI facultatif pour le mode « pousser »
    app = None
    if "PONT_CLE_API" in str(_e):
        log.warning(str(_e))


# ---------------------------------------------------------------- ligne de commande
if __name__ == "__main__":
    commande = sys.argv[1] if len(sys.argv) > 1 else "aide"
    try:
        if commande == "pousser":
            charge = extraire()
            if len(sys.argv) > 2:
                ecrire_tsv(charge, Path(sys.argv[2]))
            pousser(charge)
        elif commande == "fichiers":
            ecrire_tsv(extraire(), Path(sys.argv[2] if len(sys.argv) > 2 else "."))
        elif commande == "pousser-json":
            with open(sys.argv[2], encoding="utf-8") as f:
                pousser(json.load(f))
        elif commande == "verifier-lecture-seule":
            sys.exit(0 if verifier_lecture_seule() else 2)
        else:
            print(__doc__)
    except Exception as e:  # noqa: BLE001
        log.error("Sage / extraction : %s", e)
        if commande in ("pousser", "fichiers"):
            battement("sage_erreur", str(e))
        sys.exit(1)
