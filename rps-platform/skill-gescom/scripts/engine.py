import json
# -*- coding: utf-8 -*-
import os, glob, csv, re
from collections import Counter, defaultdict
import os as _osE
REFDIR=_osE.environ.get("RPS_REFDIR","gescom_ref")
import os as _os0
SRCDIR=_os0.environ["RPS_DAYDIR"]
DAY=_os0.environ["RPS_DAY"]
def load(p):
    try:
        with open(p,encoding="utf-8") as f: return list(csv.DictReader(f,delimiter=";"))
    except UnicodeDecodeError:
        with open(p,encoding="latin-1") as f: return list(csv.DictReader(f,delimiter=";"))
stations=load(REFDIR+"/REF_stations.csv")
comptes=load(REFDIR+"/REF_comptes_tiers.csv")
by_regr={s["compte_regroupement"]:s for s in stations}
by_fmt={s["format_piece"].upper():s for s in stations}
by_cs={s["code_site"].upper():s for s in stations if s.get("code_site")}
by_name={}
for _s in stations:
    by_name[_s["nom_officiel"].upper().strip()]=_s
    for _v in (_s.get("variantes_nom") or "").split("|"):
        if _v.strip(): by_name[_v.strip().upper()]=_s
order={s["numero_station"]:i for i,s in enumerate(stations)}
ref_nom={s["numero_station"]:s["nom_officiel"] for s in stations}
compte_ok=set(c["code_compte"] for c in comptes)
intit={c["code_compte"]:c["intitule"] for c in comptes}
# name->official account (OK only)
name2acc={}
for c in comptes:
    if c["statut"]=="OK":
        name2acc.setdefault(c["intitule"].upper().strip(), c["code_compte"])

# manual compte name-fixes confirmed in Etape0
COMPTE_FIX={}  # corrections de comptes tronques desormais CIBLEES par piece (corrections_tiers.json) pour ne pas ecraser les comptes collectifs

_EXCLUDE_23={
 "23-06-26-Cais RPS 16.txt":"fichier Cais vide (Fact existe)",
 "230626 Cais RPS Tchinta Rte Algerie.txt":"fichier Cais vide (Fact existe)",
 "23-06-25-Fact-RPSMARADI12.txt":"date interne 23/06/2025 (hors periode)",
 "01-06-26au-23-06-2026-Fact-GROUMDJI46.txt":"fichier mensuel remplace par fichier du jour (decision)",
 "DU 010626-AU 230626 FACTURE GARAGE.txt":"non rattachable a une station (a verifier)",
 "230626-Fact RPS DIFFA.txt":"remplace par le fichier Diffa complet du 23/06 (230626-Fact  RPS DIFFA.txt)",
}
# EXCLUDE_FILES propre au jour : configs 23/06 uniquement pour le 23/06 ; sinon liste vide
import json as _json0
try:
    EXCLUDE_FILES=_json0.load(open(os.path.join(SRCDIR,"exclude_files.json"),encoding="utf-8"))
except Exception:
    EXCLUDE_FILES=_EXCLUDE_23 if DAY=="230626" else {}

def split_blocks(path):
    raw=open(path,"rb").read(); text=raw.decode("latin-1"); L=text.split("\r\n")
    chen=[i for i,l in enumerate(L) if l.strip()=="#CHEN"]
    fin=[i for i,l in enumerate(L) if l.strip()=="#FIN"]
    fin_i=fin[0] if fin else len(L)
    preamble=L[:chen[0]] if chen else L[:]
    blocks=[]
    for k,ci in enumerate(chen):
        end=chen[k+1] if k+1<len(chen) else fin_i
        blocks.append(L[ci:end])
    return preamble, blocks

def detect(blocks, fname):
    regr=[]
    for b in blocks:
        for ln in b:
            if re.match(r"^41180\d{2,3}$",ln.strip()): regr.append(ln.strip())
    c=Counter(regr)
    for code,_ in c.most_common():
        if code in by_regr: return by_regr[code]
    for b in blocks:
        m=re.match(r"^(F\d{2})", b[5].strip() if len(b)>5 else "")
        if m and m.group(1).upper() in by_fmt: return by_fmt[m.group(1).upper()]
    for b in blocks:
        for ln in b:
            mm=re.match(r"^([A-Za-z]{2}-\d{2})-", ln.strip())
            if mm and mm.group(1).upper() in by_cs: return by_cs[mm.group(1).upper()]
    for b in blocks:
        for _o in (7,12):
            k=(b[_o].strip().upper() if len(b)>_o else "")
            if k and k in by_name: return by_name[k]
    return None

files=[f for f in sorted(glob.glob(SRCDIR+"/*.txt")) if not os.path.basename(f).startswith(("FACT-RPS-TOUTES","FACT-EX-DEPOT"))]
log=[]            # correction log
excluded=[]       # (file, piece, reason)
station_invoices=defaultdict(list)  # num -> list of (block, meta)
preamble_global=None

for f in files:
    bn=os.path.basename(f)
    pre,blocks=split_blocks(f)
    if preamble_global is None and blocks: preamble_global=pre
    if bn in EXCLUDE_FILES:
        for b in blocks:
            excluded.append((bn, b[5].strip() if len(b)>5 else "?", EXCLUDE_FILES[bn]))
        if not blocks: excluded.append((bn,"-",EXCLUDE_FILES[bn]))
        continue
    st=detect(blocks,bn)
    if st is None:
        for b in blocks: excluded.append((bn,b[5].strip(),"station non identifiee (a verifier)"))
        continue
    num=st["numero_station"]
    for b in blocks:
        date=b[6].strip()
        piece=b[5].strip()
        if date!=DAY:
            excluded.append((bn,piece,f"date interne {date} (hors journee 23/06)"))
            continue
        station_invoices[num].append({"block":list(b),"file":bn,"orig_piece":piece,"st":st})

# ---- dedoublonnage (meme piece + date, fichiers multiples ex: Maradi mensuel vs journalier) ----
for num in list(station_invoices):
    seen=set(); kept=[]
    for it in station_invoices[num]:
        key=(it["orig_piece"], it["block"][6].strip())
        if key in seen:
            excluded.append((it["file"], it["orig_piece"], "doublon (meme piece + date, deja present dans un autre fichier)"))
            continue
        seen.add(key); kept.append(it)
    station_invoices[num]=kept

# ---- dedoublonnage par CONTENU (meme date + compte + lignes produit/quantite, n de piece different) ----
for num in list(station_invoices):
    seen=set(); kept=[]
    for it in station_invoices[num]:
        b=it["block"]
        chli=[j for j,l in enumerate(b) if l.strip()=="#CHLI"]
        lines=tuple((b[j+2].strip(),b[j+12].strip(),b[j+14].strip()) for j in chli)
        sig=(b[6].strip(), b[11].strip(), b[13].strip(), lines)
        if sig in seen:
            excluded.append((it["file"], it["orig_piece"], "doublon exact (contenu identique a une autre facture)"))
            continue
        seen.add(sig); kept.append(it)
    station_invoices[num]=kept

# ---- suppression de doublons manuels (decision utilisateur, audites) ----
try:
    _md=json.load(open("doublons_a_supprimer.json",encoding="utf-8")) if DAY=="230626" else []
except Exception:
    _md=[]
_mset={(m["station"],m["piece"]):m.get("motif","doublon manuel") for m in _md}
try:
    _ctiers=json.load(open("corrections_tiers.json",encoding="utf-8"))  # ciblees par piece -> appliquees a toute journee
except Exception:
    _ctiers=[]
_ctmap={(c["station"],c["piece"]):c for c in _ctiers}
for num in list(station_invoices):
    kept=[]
    for it in station_invoices[num]:
        key=(num,it["orig_piece"])
        if key in _mset:
            excluded.append((it["file"],it["orig_piece"],_mset[key])); continue
        kept.append(it)
    station_invoices[num]=kept

# ---- corrections per station ----
final_order=sorted(station_invoices, key=lambda n: order.get(n,999))
fmt_re=lambda nn: re.compile(r"^F"+nn+r"\d{6}$")
for num in final_order:
    st=station_invoices[num][0]["st"]
    fmt=st["format_piece"]          # e.g. F39 ; GR -> FGRTS
    _renpfx=fmt if fmt.upper().endswith("TS") else fmt+"TS"
    invs=station_invoices[num]
    # Pieces correctes = F+NN+sequence (conservees). Hors-format = renumerotees F+NN+TS+4chiffres.
    ts_seq=1
    for it in invs:
        b=it["block"]; p=it["orig_piece"]
        # 1) header fix 1/1/1/1 -> 1/7/1/1
        if [b[1].strip(),b[2].strip(),b[3].strip(),b[4].strip()]==["1","1","1","1"]:
            b[2]="7"
            log.append((num,p,"en-tete 1/1/1/1 -> 1/7/1/1"))
        # 2) renumerotation des pieces hors-format -> F{NN}TS{0000}
        if not re.match(r"^"+fmt+r"\d+$",p):
            newp=f"{_renpfx}{ts_seq:04d}"; ts_seq+=1
            b[5]=newp
            it["new_piece"]=newp
            log.append((num,p,f"renumerotation -> {newp}"))
        else:
            it["new_piece"]=p
        # 2b) nom de station: variante -> nom_officiel
        _sn=b[7].strip()
        if _sn and _sn.upper()!=st["nom_officiel"].upper() and _sn.upper() in by_name and by_name[_sn.upper()]["numero_station"]==num:
            b[7]=st["nom_officiel"]
            log.append((num,it.get("new_piece",p),f"nom station '{_sn}' -> {st['nom_officiel']}"))
        # 3) compte tiers name-fix (whole-line within block)
        for i,ln in enumerate(b):
            t=ln.strip()
            if t in COMPTE_FIX:
                b[i]=COMPTE_FIX[t]
        # 3b) correction tiers manuelle ciblee (decision utilisateur)
        _ct=_ctmap.get((num, it["orig_piece"]))
        if _ct:
            for i,ln in enumerate(b):
                t=ln.strip()
                if t==_ct["from_compte"]: b[i]=ln.replace(_ct["from_compte"],_ct["to_compte"])
                elif _ct.get("from_nom") and t==_ct["from_nom"]: b[i]=ln.replace(_ct["from_nom"],_ct.get("to_nom",t))
            log.append((num, it.get("new_piece",it["orig_piece"]), f"compte {_ct['from_compte']} -> {_ct['to_compte']} {('('+_ct['to_nom']+') ') if _ct.get('to_nom') else ''}[{_ct.get('motif','decision')}]"))
        if b[11].strip() in COMPTE_FIX or any(False for _ in []):
            pass
        # log compte fix once (based on header compte original)
    # log compte fixes by scanning original
# re-scan compte fixes for log (header compte)
for num in final_order:
    for it in station_invoices[num]:
        # find if any fix applied: compare nothing; detect by presence of fixed value mapping
        pass

# Build compte-fix log properly: re-parse originals
for f in files:
    bn=os.path.basename(f)
    if bn in EXCLUDE_FILES: continue
    pre,blocks=split_blocks(f)
    for b in blocks:
        if b[6].strip()!=DAY: continue
        c=b[11].strip()
        if c in COMPTE_FIX:
            log.append(("?",b[5].strip(),f"compte {c} -> {COMPTE_FIX[c]} ({intit[COMPTE_FIX[c]]}) [rapproch. par nom]"))

# ---- CONTROLE & NORMALISATION separateur decimal (SAGE attend la virgule) ----
import re as _re2
decimal_warnings=[]
_decpat=_re2.compile(r"^-?\d+\.\d+$")   # nombre decimal avec POINT
for num in final_order:
    for it in station_invoices[num]:
        b=it["block"]; touched=0
        for j,l in enumerate(b):
            t=l.strip()
            if _decpat.match(t):
                b[j]=l.replace('.',',')   # 479.77 -> 479,77 (valeur identique, format SAGE)
                touched+=1
                decimal_warnings.append((num, it.get("new_piece",it["orig_piece"]), t, t.replace('.',',')))
        if touched:
            log.append((num, it.get("new_piece",it["orig_piece"]), f"separateur decimal point->virgule ({touched} champ(s))"))
print("CONTROLE DECIMALE: champs point->virgule normalises:",len(decimal_warnings))


# ---- CONTROLE espaces parasites en debut/fin de champ (SAGE y est sensible) ----
space_clean=0
for num in final_order:
    for it in station_invoices[num]:
        b=it["block"]
        for i,l in enumerate(b):
            st_=l.strip()
            if st_!="" and l!=st_:
                b[i]=st_; space_clean+=1
print("CONTROLE ESPACES: champs nettoyes (debut/fin):",space_clean)

# ---- CONTROLE dépôt + lieu de livraison = référentiel exact (accents CP850/DOS comme SAGE) ----
_cp=lambda x: x.encode('cp850','replace').decode('latin-1')   # accents en CP850 (é=0x82) attendus par SAGE
depot_fix=0; lieu_fix=0
for num in final_order:
    st=station_invoices[num][0]["st"]
    cs=(st.get("code_site") or "").strip()
    exp=_cp((cs+"-"+st["nom_officiel"]) if cs else st["nom_officiel"])
    for it in station_invoices[num]:
        b=it["block"]
        cur=b[12].strip() if len(b)>12 else ""
        if cur and cur!=exp:
            for i,l in enumerate(b):
                if l.strip()==cur: b[i]=exp
            log.append((num,it.get("new_piece",it["orig_piece"]),f"depot '{cur}' -> {exp}")); depot_fix+=1
        # NOTE: le lieu de livraison (offset+13) reste tel que la SOURCE l'a fourni
        # (GESCOM = SAGE) ; le référentiel ne correspond pas toujours aux noms SAGE.
        # compte collectif (offset+40) invalide = un n° de tiers OU 8 chiffres -> compte général (classe+000)
        if len(b)>40:
            coll=b[40].strip()
            if coll and (coll in compte_ok or (coll.isdigit() and len(coll)==8)):
                tc=b[11].strip()
                newcoll=(tc[:4]+"000") if (tc.isdigit() and len(tc)>=4) else coll
                if newcoll!=coll:
                    b[40]=newcoll
                    log.append((num,it.get("new_piece",it["orig_piece"]),f"compte collectif '{coll}' -> {newcoll} (collectif invalide)")); lieu_fix+=1
print("CONTROLE DEPOT:",depot_fix,"| LIEU DE LIVRAISON:",lieu_fix)

# ---- ANTI-COLLISION : pièces déjà présentes dans SAGE -> renumérotées (format TS, numéro libre) ----
try:
    sage_pieces=set(l.strip() for l in open("gescom_ref/SAGE_pieces.txt",encoding="latin-1") if l.strip())
except Exception:
    sage_pieces=set()
if sage_pieces:
    used=set(it["block"][5].strip() for num in final_order for it in station_invoices[num])
    coll=0
    for num in final_order:
        st=station_invoices[num][0]["st"]; fmt=st["format_piece"]
        base=fmt if fmt.upper().endswith("TS") else fmt+"TS"
        for it in station_invoices[num]:
            b=it["block"]; p=b[5].strip()
            if p in sage_pieces:
                seq=1
                while (f"{base}{seq:04d}" in sage_pieces) or (f"{base}{seq:04d}" in used): seq+=1
                newp=f"{base}{seq:04d}"
                used.discard(p); used.add(newp)
                b[5]=newp; it["new_piece"]=newp
                log.append((num,p,f"pièce déjà dans SAGE -> renumérotée {newp}")); coll+=1
    print("ANTI-COLLISION SAGE:",coll,"pièce(s) renumérotée(s)")

# ---- merge ----
out=[]
out.extend(preamble_global)   # #FLG 000 / #VER 19
total=0
for num in final_order:
    for it in station_invoices[num]:
        out.extend(it["block"])
        total+=1
out.append("#FIN")
out.append("")   # trailing
text="\r\n".join(out)
# ensure ends with CRLF like source
if not text.endswith("\r\n"): text+="\r\n"
raw=text.encode("latin-1")

import datetime
outname=f"FACT-RPS-TOUTES-STATIONS-{DAY[0:2]}-au-{DAY[0:2]}-{DAY[2:4]}-{DAY[4:6]}.txt"
outpath=os.path.join(SRCDIR, outname)
open(outpath,"wb").write(raw)

# ---- report data dump ----
print("TOTAL FACTURES FUSIONNEES:",total)
print("STATIONS:",len(final_order))
print("FICHIER:",outname,"taille",len(raw),"octets")
print("FLG count:",text.count("#FLG"),"FIN count:",text.count("#FIN"),"CHEN:",text.count("#CHEN"),"CHRE:",text.count("#CHRE"))
print("EXCLUSIONS:",len(excluded))
for e in excluded: print("  EXCL",e)
print("CORRECTIONS:")
for c in sorted(set(log)): print("  ",c)
# save log csv for report
import json as _js
_js.dump({
    "total": total,
    "stations": [[num, ref_nom[num], len(station_invoices[num]),
                  [(it["orig_piece"], it.get("new_piece")) for it in station_invoices[num]]] for num in final_order],
    "excluded": excluded,
    "log": sorted(set(log)),
    "decimal_warnings": decimal_warnings,
    "espaces": space_clean,
    "depot_fix": depot_fix,
    "day": DAY,
}, open("report_data.json", "w"), ensure_ascii=False, indent=1)
