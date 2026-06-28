# -*- coding: utf-8 -*-
# Dashboard consolide multi-dates. Lit prises_all.json (cumul) + horsservice.json (cwd),
# template + logo (ASSETS). Sortie RAPPORT-PRISES-CONSOLIDE.html dans RPS_ROOT.
import json,base64,os
ASSETS=os.environ.get("RPS_ASSETS","../assets")
ROOT=os.environ.get("RPS_ROOT",".")
recs=json.load(open('prises_all.json'))
hs=json.load(open('horsservice.json')) if os.path.exists('horsservice.json') else []
logo=base64.b64encode(open(os.path.join(ASSETS,'rps_logo.png'),'rb').read()).decode()
DATA=json.dumps(recs,ensure_ascii=False)
def chip(it): return ''.join('<span style="display:inline-block;background:#eef1f5;border:1px solid #d4dae2;color:#444;border-radius:6px;padding:5px 9px;margin:3px;font-size:12.5px"><b>%s</b> %s — %s</span>'%(m["num"],m["code"],m["nom"]) for m in it)
card='<div class="card" id="missingCard" style="border-left:4px solid #888"><div class="muted">Consolide multi-dates : choisissez la periode avec <b>Du</b> et <b>Au</b> (meme date = un seul jour). Stations hors service non comptees comme manquantes.</div><h3 style="color:#555;margin-top:8px">Stations hors service</h3><div>'+chip(hs)+'</div></div>'
t=open(os.path.join(ASSETS,'template_consolide.html'),encoding='utf-8').read()
t=t.replace('<title>Rapport des prises — RPS — 23/06/2026','<title>Rapport des prises consolide — RPS')
html=t.replace('__LOGO__',logo).replace('__DATA__',DATA).replace('__MISSING_CARD__',card)
OUT=os.path.join(ROOT,"RAPPORT-PRISES-CONSOLIDE.html")
open(OUT,'w',encoding='utf-8').write(html)
from collections import Counter
print("DASHBOARD OK ->",OUT,"| lignes:",len(recs),"| par date:",dict(Counter(x['date'] for x in recs)))
