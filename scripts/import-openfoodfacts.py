#!/usr/bin/env python3
"""Stream Open Food Facts JSONL gzip and import nutrition-labelled products globally."""
import argparse, base64, gzip, hashlib, hmac, json, os, re, sys, time, uuid
import requests

BASE=os.environ.get('SUPABASE_REST_URL','http://127.0.0.1:54331/rest/v1')
SECRET=os.environ.get('SUPABASE_JWT_SECRET','')
SOURCE={"id":"openfoodfacts","name":"Open Food Facts global product database",
 "licence":"Open Database License (ODbL) 1.0","source_url":"https://world.openfoodfacts.org/data",
 "attribution":"Contains information from Open Food Facts, available under the Open Database License (ODbL)."}
COMMON={"energy-kcal":"energy_kcal","proteins":"protein_g","carbohydrates":"carbohydrate_g","sugars":"sugars_g",
 "fiber":"fibre_g","fibre":"fibre_g","fat":"fat_g","saturated-fat":"saturated_fat_g","trans-fat":"trans_fat_g",
 "salt":"salt_g","sodium":"sodium_mg","cholesterol":"cholesterol_mg","calcium":"calcium_mg",
 "iron":"iron_mg","potassium":"potassium_mg","magnesium":"magnesium_mg","phosphorus":"phosphorus_mg",
 "copper":"copper_mg","zinc":"zinc_mg","vitamin-c":"vitamin_c_mg"}
STANDARD_UNITS={"energy_kcal":"kcal","protein_g":"g","carbohydrate_g":"g","sugars_g":"g","fibre_g":"g",
 "fat_g":"g","saturated_fat_g":"g","trans_fat_g":"g","salt_g":"g","sodium_mg":"mg",
 "cholesterol_mg":"mg","calcium_mg":"mg","iron_mg":"mg","potassium_mg":"mg","magnesium_mg":"mg",
 "phosphorus_mg":"mg","copper_mg":"mg","zinc_mg":"mg","vitamin_c_mg":"mg"}
MAX_PER_BASIS={"energy_kcal":1000,"protein_g":100,"carbohydrate_g":100,"sugars_g":100,"fibre_g":100,
 "fat_g":100,"saturated_fat_g":100,"trans_fat_g":100,"salt_g":100,"sodium_mg":100000,
 "cholesterol_mg":10000,"calcium_mg":100000,"iron_mg":100000,"potassium_mg":100000,
 "magnesium_mg":100000,"phosphorus_mg":100000,"copper_mg":100000,"zinc_mg":100000,"vitamin_c_mg":100000}
UNITS={"energy-kcal":"kcal","energy-kj":"kJ","proteins":"g","carbohydrates":"g","sugars":"g","fiber":"g","fibre":"g",
 "fat":"g","saturated-fat":"g","trans-fat":"g","salt":"g","sodium":"mg","cholesterol":"mg",
 "calcium":"mg","iron":"mg","potassium":"mg"}

def enc(v): return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
def token():
 h=enc({"alg":"HS256","typ":"JWT"});p=enc({"role":"service_role","iss":"supabase","iat":int(time.time()),"exp":int(time.time())+3600})
 sig=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),f'{h}.{p}'.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
 return f'{h}.{p}.{sig}'
def slug(s):
 v=re.sub(r'[^a-z0-9]+','_',s.lower()).strip('_') or 'nutrient'
 return (v if v[0].isalpha() else 'n_'+v)[:64]
def batches(a,n=100):
 for i in range(0,len(a),n):yield a[i:i+n]
def num(v):
 try:
  x=float(v);return x if x>=0 and x<1e8 else None
 except (TypeError,ValueError):return None

def canonical_value(code,value,unit):
 target=STANDARD_UNITS.get(code)
 if not target:return value,unit
 u=(unit or '').strip().lower().replace('μ','µ')
 if u in ('gram','grams'):u='g'
 if u in ('milligram','milligrams'):u='mg'
 if u in ('ug','mcg','µg','&#181;g','&#x3bc;g'):u='ug'
 if u in ('cal','kilocalories','the kcal','กิโลแคลอรี'):u='kcal'
 if u in ('kilojoule','kilojoules'):u='kj'
 if target=='kcal':
  if u=='kj':return value/4.184,'kcal'
  if u=='kcal':return value,'kcal'
  return None,None
 if target=='g':
  if u=='g':return value,'g'
  if u=='mg':return value/1000,'g'
  if u=='ug':return value/1000000,'g'
  return None,None
 if target=='mg':
  if u=='mg':return value,'mg'
  if u=='g':return value*1000,'mg'
  if u=='ug':return value/1000,'mg'
  return None,None
 return value,unit

def product_row(p,definitions):
 code=str(p.get('code') or p.get('_id') or '').strip()
 name=(p.get('product_name_en') or p.get('product_name') or p.get('generic_name_en') or p.get('generic_name') or '').strip()
 countries=p.get('countries_tags') or []
 if not code or not name:return None
 raw=p.get('nutriments') or {};basis='g' if any(k.endswith('_100g') for k in raw) else 'ml'
 suf='_100g' if basis=='g' else '_100ml'
 vals={}
 for key,value in raw.items():
  if not key.endswith(suf):continue
  base=key[:-len(suf)];value=num(value)
  if value is None:continue
  unit=str(raw.get(base+'_unit') or UNITS.get(base) or 'g')
  ncode=COMMON.get(base,'off_'+slug(base)[:59])
  dname={"energy_kcal":"Energy","protein_g":"Protein","carbohydrate_g":"Carbohydrate","sugars_g":"Sugars","fibre_g":"Fibre","fat_g":"Fat","saturated_fat_g":"Saturated fat","trans_fat_g":"Trans fat","salt_g":"Salt","sodium_mg":"Sodium","cholesterol_mg":"Cholesterol","calcium_mg":"Calcium","iron_mg":"Iron","potassium_mg":"Potassium"}.get(ncode,base.replace('-',' ').title())
  if base=='energy-kj':ncode='energy_kcal';dname='Energy'
  value,unit=canonical_value(ncode,value,unit)
  if value is None or value>MAX_PER_BASIS.get(ncode,float('inf')):continue
  vals[ncode]=(value,unit,dname)
  definitions[ncode]={"nutrient_code":ncode,"name":dname,"standard_unit":STANDARD_UNITS.get(ncode,unit),"sort_order":500}
 if 'energy_kcal' not in vals:return None
 cat=next((x.split(':',1)[-1].replace('-',' ').title() for x in (p.get('categories_tags') or []) if x.startswith('en:')),None)
 updated=p.get('last_modified_t') or p.get('last_modified')
 try: updated=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(int(updated))) if updated else None
 except (ValueError,TypeError,OverflowError):updated=None
 nutrients={k:(v[0],v[1],v[2]) for k,v in vals.items()}
 row={"id":str(uuid.uuid5(uuid.NAMESPACE_URL,'off:'+code)),"source_id":"openfoodfacts","source_record_id":code,
  "data_kind":"branded","name":name[:240],"brand":(p.get('brands') or '').split(',')[0].strip()[:160] or None,
  "category":cat,"country_code":"GB" if any(x in ('en:united-kingdom','en:uk','en:great-britain') for x in countries) else None,
  "locale":"en-GB" if any(x in ('en:united-kingdom','en:uk','en:great-britain') for x in countries) else "en","barcode":code,
  "ingredients":(p.get('ingredients_text_en') or p.get('ingredients_text') or '')[:20000] or None,
  "allergens":','.join(p.get('allergens_tags') or [])[:2000] or None,"basis_amount":100,"basis_unit":basis,
  "source_updated_at":updated,"quality_status":"usable" if 'protein_g' in vals else "incomplete","source_metadata":{"completeness":p.get('completeness'),"quantity":p.get('quantity'),"serving_size":p.get('serving_size'),"source_country_tags":countries},
  "nutrients":nutrients,"portion":None}
 serving=num(p.get('serving_quantity'))
 if serving:
  label=(p.get('serving_size') or 'serving')[:100]
  row['portion']={"label":label,"amount":1,"unit":"serving","grams":serving if basis=='g' else None,"millilitres":serving if basis=='ml' else None,"is_default":False,"source_record_id":code}
 return row

def send(session,path,rows,prefer='resolution=merge-duplicates,return=minimal'):
 for b in batches(rows):
  r=session.post(BASE+'/'+path,json=b,headers={"Prefer":prefer},timeout=90)
  if not r.ok:raise RuntimeError(f'{path}: HTTP {r.status_code}: {r.text[:600]}')

def main():
 ap=argparse.ArgumentParser();ap.add_argument('file');ap.add_argument('--skip-lines',type=int,default=0);a=ap.parse_args()
 if not SECRET:raise SystemExit('Set SUPABASE_JWT_SECRET for the local Supabase database.')
 s=requests.Session();t=token();s.headers.update({'apikey':t,'Authorization':'Bearer '+t,'Content-Type':'application/json'})
 send(s,'catalog_sources?on_conflict=id',[SOURCE])
 defs={};batch=[];seen=0;loaded=0;size=os.path.getsize(a.file)
 with gzip.open(a.file,'rb') as f:
  for line in f:
   seen+=1
   if seen%100000==0:print(f'Scanned {seen:,} rows; selected {loaded+len(batch):,} nutrition-labelled products so far',flush=True)
   if seen<=a.skip_lines:continue
   try: p=json.loads(line)
   except json.JSONDecodeError: continue
   row=product_row(p,defs)
   if row:batch.append(row)
   if len(batch)>=100:
    batch=list({x['source_record_id']:x for x in batch}.values())
    send(s,'catalog_nutrient_definitions?on_conflict=nutrient_code',list(defs.values()))
    payload=[{k:v for k,v in x.items() if k not in ('nutrients','portion')} for x in batch]
    r=s.post(BASE+'/catalog_foods?on_conflict=source_id,source_record_id',json=payload,headers={'Prefer':'resolution=merge-duplicates,return=representation'},timeout=90)
    if not r.ok:raise RuntimeError(f'catalog_foods: HTTP {r.status_code}: {r.text[:600]}')
    ids={x['source_record_id']:x['id'] for x in r.json()};ns=[];ps=[]
    for x in batch:
     fid=ids.get(x['source_record_id'],x['id'])
     for code,(value,unit,_) in x['nutrients'].items():ns.append({'food_id':fid,'nutrient_code':code,'value':value,'source_unit':unit,'basis_amount':100,'basis_unit':x['basis_unit'],'source_nutrient_name':code})
     if x['portion']:ps.append({**x['portion'],'food_id':fid})
    send(s,'catalog_food_nutrients?on_conflict=food_id,nutrient_code',ns)
    if ps:send(s,'catalog_food_portions?on_conflict=food_id,label,amount,unit',ps)
    loaded+=len(batch);batch.clear();defs.clear()
    if seen%50000==0:print(f'Read {seen:,} rows; imported {loaded:,} global products',flush=True)
  if batch:
   batch=list({x['source_record_id']:x for x in batch}.values())
   send(s,'catalog_nutrient_definitions?on_conflict=nutrient_code',list(defs.values()))
   payload=[{k:v for k,v in x.items() if k not in ('nutrients','portion')} for x in batch]
   r=s.post(BASE+'/catalog_foods?on_conflict=source_id,source_record_id',json=payload,headers={'Prefer':'resolution=merge-duplicates,return=representation'},timeout=90);r.raise_for_status()
   ids={x['source_record_id']:x['id'] for x in r.json()};ns=[];ps=[]
   for x in batch:
    fid=ids.get(x['source_record_id'],x['id'])
    for code,(value,unit,_) in x['nutrients'].items():ns.append({'food_id':fid,'nutrient_code':code,'value':value,'source_unit':unit,'basis_amount':100,'basis_unit':x['basis_unit'],'source_nutrient_name':code})
    if x['portion']:ps.append({**x['portion'],'food_id':fid})
   send(s,'catalog_food_nutrients?on_conflict=food_id,nutrient_code',ns)
   if ps:send(s,'catalog_food_portions?on_conflict=food_id,label,amount,unit',ps)
   loaded+=len(batch)
 print(f'Complete: scanned {seen:,} rows; imported or updated {loaded:,} global nutrition-labelled products from {size:,} compressed bytes.')

if __name__=='__main__':
 try:main()
 except Exception as e:print(f'Import failed: {e}',file=sys.stderr);sys.exit(1)
