# -*- coding: utf-8 -*-
import csv,json
HS=set(json.load(open('hors_service.json')))
ref=[s for s in csv.DictReader(open('gescom_ref/REF_stations.csv',encoding='utf-8'),delimiter=';') if s['numero_station']!='GR']
refnum={s['numero_station']:s for s in ref}
present_merged=set(s[0] for s in json.load(open('report_data.json'))['stations'])
present_prises=set(r['snum'] for r in json.load(open('prises.json')))
en_service=set(refnum)-HS
# manquante = en service mais AUCUNE prise (soit pas de fichier, soit fichier a 0 L)
manq=sorted(en_service-present_prises, key=lambda x:int(x))
missing=[]
for n in manq:
    note="facture reçue mais 0 prise (0 L)" if n in present_merged else "aucun fichier transmis"
    missing.append({"num":n,"code":refnum[n]['code_site'],"nom":refnum[n]['nom_officiel'],"note":note})
hs=[{"num":n,"code":refnum[n]['code_site'],"nom":refnum[n]['nom_officiel']} for n in sorted(HS,key=lambda x:int(x))]
json.dump(missing,open('missing.json','w'),ensure_ascii=False)
json.dump(hs,open('horsservice.json','w'),ensure_ascii=False)
print('MANQUANTES (en service, 0 prise):',[(m['num'],m['nom'],m['note']) for m in missing])
print('HORS SERVICE:',len(hs))
