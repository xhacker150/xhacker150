# -*- coding: utf-8 -*-
import re,csv,json
import os as _o
SRC=_o.environ["RPS_MERGED"]
stations=list(csv.DictReader(open('gescom_ref/REF_stations.csv',encoding='utf-8'),delimiter=';'))
by_regr={s['compte_regroupement']:s for s in stations}
by_fmt={s['format_piece'].upper():s for s in stations}
comptes=list(csv.DictReader(open('gescom_ref/REF_comptes_tiers.csv',encoding='utf-8'),delimiter=';'))
intit={c['code_compte']:c['intitule'] for c in comptes}

def num(s):
    # accepte la decimale en VIRGULE ou en POINT, espaces de milliers tolérés
    s=s.strip().replace(' ','').replace('\xa0','')
    if not s: return None
    neg=s.startswith('-'); s=s.lstrip('+-')
    if ',' in s and '.' in s:
        if s.rfind(',')>s.rfind('.'): s=s.replace('.','').replace(',','.')   # 1.234,56 -> 1234.56
        else: s=s.replace(',','')                                            # 1,234.56 -> 1234.56
    elif ',' in s:
        p=s.split(','); s=(''.join(p[:-1])+'.'+p[-1]) if len(p)>2 else s.replace(',','.')
    try: v=float(s)
    except Exception: return None
    return -v if neg else v

raw=open(SRC,'rb').read().decode('latin-1'); L=[x for x in raw.split('\r\n')]
Ls=[x.strip() for x in L]
chen=[i for i,l in enumerate(Ls) if l=='#CHEN']
fin=[i for i,l in enumerate(Ls) if l=='#FIN'][0]
recs=[]
for k,ci in enumerate(chen):
    end=chen[k+1] if k+1<len(chen) else fin
    block=Ls[ci:end]
    piece=block[5]; date=block[6]
    compte=block[11]; cname=block[13]
    st=None
    for ln in block:
        if re.match(r'^41180\d{2,3}$',ln) and ln in by_regr: st=by_regr[ln];break
    if st is None:
        m=re.match(r'^(F\d{2})',piece)
        if m and m.group(1).upper() in by_fmt: st=by_fmt[m.group(1).upper()]
    if st is None:
        for s2 in stations:
            fp=s2['format_piece'].upper()
            if fp and piece.upper().startswith(fp): st=s2; break
    snum=st['numero_station'] if st else '?'
    snom=st['nom_officiel'] if st else '?'
    client=intit.get(compte, cname).strip()
    chli=[j for j,l in enumerate(block) if l=='#CHLI']
    for li in chli:
        code=block[li+2].strip()
        qte=num(block[li+14]) or 0.0
        prix=num(block[li+12]) or 0.0
        lib={'GAS':'GASOIL','SUP':'SUPER'}.get(code,'')
        desc=block[li+3].strip().replace('ø','°')   # ° encode DOS lu 'ø' -> affichage correct
        description=desc   # especes: generalement GASOIL/SUPER ; credit: plaque/n° bon
        if qte<=0 and prix<=0: continue
        dd=date; datef=("%s/%s/20%s"%(dd[0:2],dd[2:4],dd[4:6])) if len(dd)==6 else dd
        tvente="Espèces" if compte.startswith("41180") else "Crédit"
        recs.append(dict(station=snum+" - "+snom,snum=snum,produit=(lib or 'GASOIL'),code=code,
                         client=(client or compte),compte=compte,
                         description=description,tvente=tvente,piece=piece,date=datef,
                         qte=round(qte,2),prix=prix,montant=round(qte*prix)))
json.dump(recs,open('prises.json','w'),ensure_ascii=False)
tot_q=sum(r['qte'] for r in recs); tot_m=sum(r['montant'] for r in recs)
print('Lignes de prise:',len(recs))
print('Quantite (L):',round(tot_q),'| Montant (FCFA):',tot_m)
print('Especes:',sum(1 for r in recs if r['tvente']=='Espèces'),'| Credit:',sum(1 for r in recs if r['tvente']=='Crédit'))
print('Avec description:',sum(1 for r in recs if r['description']))
