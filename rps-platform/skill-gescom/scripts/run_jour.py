# -*- coding: utf-8 -*-
"""
Orchestrateur — traite une journee de factures stations GESCOM -> import SAGE.
Usage:
  python run_jour.py --daydir "/.../Exportation facture/25-06-2026" --day 250626 \
        [--root "/.../Exportation facture"] [--rapport-officiel rep.json]
Produit dans le dossier du jour : fichier d'import fusionne, RAPPORT-ANOMALIES, ECARTS (si rapport officiel),
et met a jour le dashboard consolide RAPPORT-PRISES-CONSOLIDE.html a la racine.
rep.json (optionnel) = {"NUM_STATION":[GASOIL_L, SUPER_L], ...} extrait du rapport officiel des ventes.
"""
import os,sys,json,shutil,tempfile,subprocess,argparse
HERE=os.path.dirname(os.path.abspath(__file__))
SKILL=os.path.dirname(HERE)
REF=os.path.join(SKILL,"references"); ASSETS=os.path.join(SKILL,"assets")

ap=argparse.ArgumentParser()
ap.add_argument("--daydir",required=True); ap.add_argument("--day",required=True)
ap.add_argument("--root",default=None); ap.add_argument("--rapport-officiel",default=None)
a=ap.parse_args()
DAYDIR=os.path.abspath(a.daydir); DAY=a.day
ROOT=os.path.abspath(a.root) if a.root else os.path.dirname(DAYDIR)
DAYLBL="%s/%s/20%s"%(DAY[0:2],DAY[2:4],DAY[4:6])

WORK=tempfile.mkdtemp(prefix="rps_")
os.makedirs(os.path.join(WORK,"gescom_ref"),exist_ok=True)
for f in ("REF_stations.csv","REF_produits.csv","REF_comptes_tiers.csv","SAGE_pieces.txt"):
    shutil.copy(os.path.join(REF,f), os.path.join(WORK,"gescom_ref",f))
for f in ("corrections_tiers.json","hors_service.json","doublons_a_supprimer.json"):
    shutil.copy(os.path.join(REF,f), os.path.join(WORK,f))
if a.rapport_officiel: shutil.copy(a.rapport_officiel, os.path.join(WORK,"rep_officiel.json"))

env=dict(os.environ, RPS_DAYDIR=DAYDIR, RPS_DAY=DAY, RPS_REFDIR="gescom_ref",
         RPS_ASSETS=ASSETS, RPS_ROOT=ROOT)
def run(script):
    print("\n=== %s ==="%script)
    r=subprocess.run([sys.executable, os.path.join(HERE,script)], cwd=WORK, env=env)
    if r.returncode!=0: print("ECHEC:",script); sys.exit(r.returncode)

run("engine.py")
merged=os.path.join(DAYDIR,"FACT-RPS-TOUTES-STATIONS-%s-au-%s-%s-%s.txt"%(DAY[0:2],DAY[0:2],DAY[2:4],DAY[4:6]))
env["RPS_MERGED"]=merged
run("extract_prises.py")
run("compute_missing.py")
run("anomalies.py")
if a.rapport_officiel: run("ecarts.py")

# historique cumulatif pour le dashboard consolide
hist=os.path.join(ROOT,"prises_history.json")
H=json.load(open(hist)) if os.path.exists(hist) else []
H=[x for x in H if x.get("date")!=DAYLBL]          # remplace la journee si re-traitee
H+=json.load(open(os.path.join(WORK,"prises.json")))
json.dump(H,open(hist,"w"),ensure_ascii=False)
shutil.copy(hist, os.path.join(WORK,"prises_all.json"))
run("dashboard.py")

print("\nTERMINE — journee %s : import, rapport d'anomalies%s et dashboard consolide a jour."%(DAYLBL," + ecarts" if a.rapport_officiel else ""))
print("Dossier du jour :",DAYDIR)
