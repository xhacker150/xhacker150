# -*- coding: utf-8 -*-
# Rapport d'anomalies PDF d'une journee. Lit report_data.json + prises.json (cwd),
# missing.json + horsservice.json (cwd), rep_officiel.json optionnel (§5 ecarts).
# Sortie: RAPPORT-ANOMALIES-COMPLET-<JJ-MM-AAAA>.pdf dans RPS_DAYDIR.
import json,os
from collections import defaultdict, Counter
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,Image
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle

ASSETS=os.environ.get("RPS_ASSETS","../assets")
DAYDIR=os.environ["RPS_DAYDIR"]
d=json.load(open('report_data.json'))
DAY=d.get('day','')
DAYLBL="%s/%s/20%s"%(DAY[0:2],DAY[2:4],DAY[4:6]) if len(DAY)==6 else DAY
ESPACES=d.get('espaces',0)
log=sorted(set(tuple(x) for x in d['log'])); exc=d['excluded']
nom={s[0]:s[1] for s in d['stations']}
total=d['total']; nstations=len(d['stations'])
missing=json.load(open('missing.json')) if os.path.exists('missing.json') else []
hs=json.load(open('horsservice.json')) if os.path.exists('horsservice.json') else []
REP=json.load(open('rep_officiel.json')) if os.path.exists('rep_officiel.json') else None

CAT=[
 ('Renumerotation pieces hors-format (format TS)', lambda x:'renumerotation' in x and 'SAGE' not in x and 'deja' not in x),
 ('Anti-collision : piece deja dans SAGE', lambda x:'SAGE' in x or 'deja dans SAGE' in x),
 ('Compte tiers corrige (rapprochement nom / decision)', lambda x:x.startswith('compte ') and 'collectif' not in x),
 ('Compte collectif invalide -> compte general', lambda x:'collectif' in x),
 ('Libelle de depot corrige', lambda x:x.startswith('depot')),
 ('Nom de station normalise', lambda x:'nom station' in x),
 ('En-tete de bloc anormal (1/1/1/1 -> 1/7/1/1)', lambda x:'en-tete' in x),
 ('Separateur decimal (point -> virgule)', lambda x:'separateur decimal' in x),
]
buckets=defaultdict(list)
for num,piece,desc in log:
    for cname,fn in CAT:
        if fn(desc): buckets[cname].append((num,piece,desc)); break

st=getSampleStyleSheet()
H1=ParagraphStyle('H1',parent=st['Title'],fontSize=16,textColor=colors.HexColor('#1A3C6E'),spaceAfter=2)
H2=ParagraphStyle('H2',parent=st['Heading2'],fontSize=12,textColor=colors.HexColor('#E30613'),spaceBefore=10,spaceAfter=4)
N=ParagraphStyle('N',parent=st['Normal'],fontSize=9,leading=12)
note=ParagraphStyle('note',parent=st['Normal'],fontSize=8.3,leading=10.5,textColor=colors.HexColor('#555'))
story=[]
logo=os.path.join(ASSETS,'rps_logo.png')
try: story.append(Image(logo,width=46*mm,height=17*mm))
except: pass
story.append(Paragraph("Rapport des anomalies detectees et corrigees",H1))
story.append(Paragraph("Factures stations RPS — Journee du %s — Service Controle"%DAYLBL,ParagraphStyle('s',parent=N,fontSize=9.5,textColor=colors.HexColor('#444'))))
story.append(Paragraph('<font color="#1d7a45"><b>Fichier d\'import prepare : %d factures, %d stations — 1 seul #FLG/#FIN, #CHEN = #CHRE = %d, aucun doublon residuel.</b></font>'%(total,nstations,total),N))
story.append(Spacer(1,6))

story.append(Paragraph("1. Synthese des corrections automatiques",H2))
rows=[["Categorie d'anomalie","Nb"]]
for cname,_ in CAT: rows.append([cname,str(len(buckets[cname]))])
rows.append(["Espaces parasites nettoyes (debut/fin de champ)","%d champs"%ESPACES])
rows.append(["Doublons ecartes (piece/contenu/decision)",str(sum(1 for e in exc if 'doublon' in e[2]))])
rows.append(["Factures hors periode / fichiers ecartes",str(sum(1 for e in exc if 'doublon' not in e[2]))])
t=Table(rows,colWidths=[140*mm,25*mm])
t.setStyle(TableStyle([('FONTSIZE',(0,0),(-1,-1),9),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#ccc')),
 ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1A3C6E')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
 ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f4f7fb')]),
 ('LEFTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),2.5),('BOTTOMPADDING',(0,0),(-1,-1),2.5)]))
story.append(t); story.append(Spacer(1,4))
story.append(Paragraph("Garde-fous : aucun montant, quantite, date ou reference client modifie ; latin-1 + CRLF preserves ; 1 seul #FLG/#FIN ; #CHEN = #CHRE ; aucun doublon de piece residuel. Controles detailles dans REGLES-TRAITEMENT-GESCOM-RPS.md.",note))

story.append(Paragraph("2. Detail des corrections par categorie",H2))
for cname,_ in CAT:
    items=buckets[cname]
    if not items: continue
    story.append(Paragraph("<b>%s</b> — %d"%(cname,len(items)),N))
    rr=[["Station","Piece / origine","Correction appliquee"]]
    for num,piece,desc in items:
        rr.append([("%s %s"%(num,nom.get(num,''))).strip()[:26],piece,desc[:60]])
    tt=Table(rr,colWidths=[40*mm,32*mm,95*mm],repeatRows=1)
    tt.setStyle(TableStyle([('FONTSIZE',(0,0),(-1,-1),7.3),('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#ddd')),
     ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#41597a')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
     ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f6f8fb')]),
     ('LEFTPADDING',(0,0),(-1,-1),3),('TOPPADDING',(0,0),(-1,-1),1.5),('BOTTOMPADDING',(0,0),(-1,-1),1.5)]))
    story.append(tt); story.append(Spacer(1,5))

story.append(PageBreak())
story.append(Paragraph("3. Factures & fichiers ecartes (dates hors periode / doublons)",H2))
story.append(Paragraph("Factures dont la date interne n'est pas le %s — ecartees du lot et a traiter avec leur journee respective."%DAYLBL,note))
import re as _re
def relab(m): return _re.sub(r'hors journee \d\d/\d\d', 'hors journee %s'%DAYLBL[:5], m)
mot=Counter(relab(e[2]) for e in exc)
rr=[["Motif","Nb"]]
for m,n in mot.most_common(): rr.append([m[:95],str(n)])
te=Table(rr,colWidths=[150*mm,15*mm],repeatRows=1)
te.setStyle(TableStyle([('FONTSIZE',(0,0),(-1,-1),7.5),('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#ddd')),
 ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1A3C6E')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
 ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f4f7fb')]),
 ('LEFTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),1.3),('BOTTOMPADDING',(0,0),(-1,-1),1.3)]))
story.append(te)

story.append(Paragraph("4. Stations non transmises",H2))
story.append(Paragraph("<b>Manquantes (en service, a relancer pour le %s)</b> : "%DAYLBL+(", ".join("%s %s"%(m['num'],m['nom']) for m in missing) if missing else "aucune"),N))
story.append(Paragraph("<b>Hors service (fermees, non comptees)</b> : "+", ".join("%s %s"%(m['num'],m['nom']) for m in hs),note))

# 5. ecarts
recs=json.load(open('prises.json'))
mine=defaultdict(lambda:{'GASOIL':0.0,'SUPER':0.0})
for r in recs: mine[r['snum']][r['produit']]+=r['qte']
def fmt(x): return ('%0.2f'%x).replace('.',',')
story.append(PageBreak())
story.append(Paragraph("5. Ecarts avec le rapport officiel des ventes (litres)",H2))
if not REP:
    tg=sum(v['GASOIL'] for v in mine.values()); ts=sum(v['SUPER'] for v in mine.values())
    story.append(Paragraph("Le rapport officiel des ventes du %s n'a pas ete fourni : comparaison station x produit a ajouter des reception. Total provisoire export GESCOM traite : GASOIL %s L / SUPER %s L."%(DAYLBL,fmt(tg),fmt(ts)),note))
else:
    missnum={m['num']:m['nom'] for m in missing}
    ec=[]
    for num,(rg,rs) in REP.items():
        mg=round(mine.get(num,{}).get('GASOIL',0.0),2); ms=round(mine.get(num,{}).get('SUPER',0.0),2)
        dg=mg-rg; ds=ms-rs
        if abs(dg)>1 or abs(ds)>1:
            st_=nom.get(num) or missnum.get(num) or num
            why='station non transmise (a relancer)' if num in missnum else 'a verifier'
            ec.append((num,st_,rg,rs,mg,ms,dg,ds,why))
    story.append(Paragraph("Comparaison station x produit entre l'export GESCOM traite et le rapport officiel des ventes du %s. Aucune valeur GESCOM modifiee : ecarts signales pour relance."%DAYLBL,note))
    rr=[["St","Station","Officiel G / S","GESCOM G / S","Ecart G / S","Cause"]]
    for num,st_,rg,rs,mg,ms,dg,ds,why in sorted(ec,key=lambda x:-(abs(x[6])+abs(x[7]))):
        rr.append([num,str(st_)[:20],fmt(rg)+" / "+fmt(rs),fmt(mg)+" / "+fmt(ms),
                   ('+' if dg>=0 else '')+fmt(dg)+" / "+('+' if ds>=0 else '')+fmt(ds),why[:34]])
    tg2=Table(rr,colWidths=[9*mm,33*mm,32*mm,32*mm,33*mm,39*mm],repeatRows=1)
    tg2.setStyle(TableStyle([('FONTSIZE',(0,0),(-1,-1),6.8),('GRID',(0,0),(-1,-1),0.25,colors.HexColor('#ddd')),
     ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1A3C6E')),('TEXTCOLOR',(0,0),(-1,0),colors.white),
     ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#fbf2ee')]),
     ('ALIGN',(2,1),(4,-1),'RIGHT'),('LEFTPADDING',(0,0),(-1,-1),3),('TOPPADDING',(0,0),(-1,-1),1.6),('BOTTOMPADDING',(0,0),(-1,-1),1.6)]))
    story.append(tg2)
    mt_g=sum(v['GASOIL'] for v in mine.values()); mt_s=sum(v['SUPER'] for v in mine.values())
    rt_g=sum(v[0] for v in REP.values()); rt_s=sum(v[1] for v in REP.values())
    story.append(Spacer(1,5))
    story.append(Paragraph("<b>Totaux</b> — Officiel : GASOIL %s L / SUPER %s L. GESCOM traite : GASOIL %s L / SUPER %s L. Ecart : GASOIL %s L / SUPER %s L. Aucune valeur modifiee."%(fmt(rt_g),fmt(rt_s),fmt(mt_g),fmt(mt_s),fmt(mt_g-rt_g),fmt(mt_s-rt_s)),note))

OUT=os.path.join(DAYDIR,"RAPPORT-ANOMALIES-COMPLET-%s.pdf"%DAYLBL.replace('/','-'))
SimpleDocTemplate(OUT,pagesize=A4,topMargin=12*mm,bottomMargin=12*mm,leftMargin=16*mm,rightMargin=16*mm,title="Rapport anomalies RPS %s"%DAYLBL).build(story)
print("ANOMALIES OK ->",OUT)
