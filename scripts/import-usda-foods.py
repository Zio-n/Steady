#!/usr/bin/env python3
"""Import USDA generic FNDDS CSV and Foundation Foods JSON into local Supabase."""
import argparse, base64, csv, hashlib, hmac, io, json, os, re, sys, uuid, zipfile
from pathlib import Path
import requests

BASE = os.environ.get("SUPABASE_REST_URL", "http://127.0.0.1:54331/rest/v1")
SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
UNIT = {"G":"g","MG":"mg","UG":"µg","MCG":"µg","KCAL":"kcal","KJ":"kJ","IU":"IU","%":"%"}
COMMON = {
 "energy":("energy_kcal","Energy","kcal"), "protein":("protein_g","Protein","g"),
 "carbohydrate, by difference":("carbohydrate_g","Carbohydrate","g"),
 "carbohydrate":("carbohydrate_g","Carbohydrate","g"), "total lipid (fat)":("fat_g","Fat","g"),
 "total fat":("fat_g","Fat","g"), "fiber, total dietary":("fibre_g","Fibre","g"),
 "fibre":("fibre_g","Fibre","g"), "fiber":("fibre_g","Fibre","g"),
 "total sugars":("sugars_g","Sugars","g"), "sugars, total including nlea":("sugars_g","Sugars","g"),
 "fatty acids, total saturated":("saturated_fat_g","Saturated fat","g"),
 "saturated fatty acids":("saturated_fat_g","Saturated fat","g"),
 "sodium, na":("sodium_mg","Sodium","mg"), "sodium":("sodium_mg","Sodium","mg"),
 "calcium, ca":("calcium_mg","Calcium","mg"), "iron, fe":("iron_mg","Iron","mg"),
 "potassium, k":("potassium_mg","Potassium","mg"), "vitamin c, total ascorbic acid":("vitamin_c_mg","Vitamin C","mg"),
 "vitamin c":("vitamin_c_mg","Vitamin C","mg"), "cholesterol":("cholesterol_mg","Cholesterol","mg"),
}

def jwt():
    enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(",",":")).encode()).rstrip(b"=").decode()
    h=enc({"alg":"HS256","typ":"JWT"}); p=enc({"role":"service_role","iss":"supabase","iat":1793350000,"exp":1983812996})
    sig=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),f"{h}.{p}".encode(),hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{h}.{p}.{sig}"

def slug(s):
    v=re.sub(r"[^a-z0-9]+","_",s.lower()).strip("_") or "nutrient"
    return (v if v[0].isalpha() else "n_"+v)[:64]

def nutrient(name, unit, value):
    if value is None: return None
    try: value=float(value)
    except (TypeError,ValueError): return None
    if value<0: return None
    key=name.lower().strip()
    if key.startswith("energy") and unit.upper() in ("KCAL", "KJ"):
        code,label,std="energy_kcal","Energy","kcal"
        if unit.upper()=="KJ": value=value/4.184
        return code,{"nutrient_code":code,"name":label,"standard_unit":std},value,"kcal"
    code,label,std=COMMON.get(key,("usda_"+slug(key),name.strip(),UNIT.get(unit.upper(),unit.lower())))
    return code,{"nutrient_code":code,"name":label,"standard_unit":std},value,UNIT.get(unit.upper(),unit.lower())

def batches(items,n=100):
    for i in range(0,len(items),n): yield items[i:i+n]

def fndds(path):
    z=zipfile.ZipFile(path); names=z.namelist(); root=next(n.split("/")[0] for n in names if n.endswith("/food.csv"))
    def rows(file): return list(csv.DictReader(io.TextIOWrapper(z.open(root+"/"+file),encoding="utf-8-sig")))
    # FNDDS food_nutrient.nutrient_id contains the published nutrient number,
    # which matches nutrient.csv.nutrient_nbr (not its internal FDC nutrient ID).
    nutrient_rows={r['nutrient_nbr']:r for r in rows('nutrient.csv')}
    categories={r['wweia_food_category']:r['wweia_food_category_description'] for r in rows('wweia_food_category.csv')}
    portions={}
    for p in rows('food_portion.csv'):
        try: grams=float(p.get('gram_weight') or 0)
        except ValueError: continue
        if grams>0: portions.setdefault(p['fdc_id'],[]).append({"label":(p.get('portion_description') or p.get('modifier') or "portion")[:100],"amount":float(p.get('amount') or 1),"unit":"portion","grams":grams,"is_default":False})
    vals={}
    for n in rows('food_nutrient.csv'):
        d=nutrient_rows.get(n.get('nutrient_id'))
        if not d: continue
        item=nutrient(d['name'],d['unit_name'],n.get('amount'))
        if item: vals.setdefault(n['fdc_id'],{})[item[0]]=(item[1],item[2],item[3],d['name'])
    out=[]
    for f in rows('food.csv'):
        name=(f.get('description') or '').strip(); key=f.get('fdc_id')
        if not key or not name: continue
        ns=vals.get(key,{})
        out.append({"id":str(uuid.uuid5(uuid.NAMESPACE_URL,"usda_fndds:"+key)),"source_id":"usda_fndds","source_record_id":key,
          "data_kind":"generic","name":name[:240],"category":categories.get(f.get('food_category_id')),
          "country_code":"US","locale":"en-US","basis_amount":100,"basis_unit":"g",
          "source_updated_at":f.get('publication_date'),"quality_status":"usable" if "energy_kcal" in ns else "incomplete",
          "source_metadata":{"data_type":"FNDDS","publication_date":f.get('publication_date')},"nutrients":ns,"portions":portions.get(key,[])})
    return out

def foundation(path):
    with zipfile.ZipFile(path) as z:
        name=next(n for n in z.namelist() if n.endswith('.json'))
        data=json.load(z.open(name))
    out=[]
    for f in data.get('FoundationFoods',[]):
        key=str(f.get('fdcId') or ''); name=(f.get('description') or '').strip()
        if not key or not name: continue
        ns={}
        for n in f.get('foodNutrients',[]):
            d=n.get('nutrient') or {}; item=nutrient(d.get('name',''),d.get('unitName',''),n.get('amount'))
            if item: ns[item[0]]=(item[1],item[2],item[3],d.get('name',''))
        portions=[]
        for p in f.get('foodPortions',[]):
            try: grams=float(p.get('gramWeight') or 0)
            except (TypeError,ValueError): continue
            if grams>0: portions.append({"label":(p.get('portionDescription') or 'portion')[:100],"amount":float(p.get('amount') or 1),"unit":"portion","grams":grams,"is_default":False})
        out.append({"id":str(uuid.uuid5(uuid.NAMESPACE_URL,"usda_foundation:"+key)),"source_id":"usda_foundation","source_record_id":key,
          "data_kind":"generic","name":name[:240],"category":(f.get('foodCategory') or {}).get('description'),
          "country_code":"US","locale":"en-US","basis_amount":100,"basis_unit":"g",
          "source_updated_at":f.get('publicationDate'),"quality_status":"usable" if "energy_kcal" in ns else "incomplete",
          "source_metadata":{"data_type":"Foundation Foods","food_class":f.get('foodClass')},"nutrients":ns,"portions":portions})
    return out

def import_rows(rows,source,session):
    session.post(BASE+"/catalog_sources?on_conflict=id",json=source,headers={"Prefer":"resolution=merge-duplicates,return=minimal"},timeout=30).raise_for_status()
    defs={}
    for f in rows:
        for code,(d,_,_,_) in f['nutrients'].items(): defs[code]=d
    for b in batches(list(defs.values())):
        session.post(BASE+"/catalog_nutrient_definitions?on_conflict=nutrient_code",json=b,headers={"Prefer":"resolution=merge-duplicates,return=minimal"},timeout=30).raise_for_status()
    for b in batches(rows,100):
        payload=[{k:v for k,v in f.items() if k not in ('nutrients','portions')} for f in b]
        r=session.post(BASE+"/catalog_foods?on_conflict=source_id,source_record_id",json=payload,headers={"Prefer":"resolution=merge-duplicates,return=representation"},timeout=60);r.raise_for_status()
        ids={x['source_record_id']:x['id'] for x in r.json()}; ns=[]; ps=[]
        for f in b:
            fid=ids.get(f['source_record_id'],f['id'])
            for code,(d,val,unit,name) in f['nutrients'].items(): ns.append({"food_id":fid,"nutrient_code":code,"value":val,"source_unit":unit,"basis_amount":100,"basis_unit":"g","source_nutrient_name":name})
            for p in f['portions']: ps.append({**p,"food_id":fid,"source_record_id":f['source_record_id']})
        for part in batches(ns): session.post(BASE+"/catalog_food_nutrients?on_conflict=food_id,nutrient_code",json=part,headers={"Prefer":"resolution=merge-duplicates,return=minimal"},timeout=60).raise_for_status()
        ps=list({(p['food_id'],p['label'],p['amount'],p['unit']):p for p in ps}.values())
        for part in batches(ps):
            r=session.post(BASE+"/catalog_food_portions?on_conflict=food_id,label,amount,unit",json=part,headers={"Prefer":"resolution=merge-duplicates,return=minimal"},timeout=60)
            if not r.ok: raise RuntimeError(f"Portion import failed: {r.text}")
    print(f"Imported {len(rows)} {source['name']} foods",flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--fndds');p.add_argument('--foundation');a=p.parse_args()
    if not SECRET: raise SystemExit('Set SUPABASE_JWT_SECRET for local Supabase.')
    s=requests.Session();key=jwt();s.headers.update({'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    sources={'fndds':{"id":"usda_fndds","name":"USDA FNDDS 2021-2023","licence":"CC0 1.0","source_url":"https://fdc.nal.usda.gov/download-datasets/","attribution":"USDA FoodData Central"},
      'foundation':{"id":"usda_foundation","name":"USDA Foundation Foods October 2026","licence":"CC0 1.0","source_url":"https://fdc.nal.usda.gov/download-datasets/","attribution":"USDA FoodData Central"}}
    for option,func,keyname in [(a.fndds,fndds,'fndds'),(a.foundation,foundation,'foundation')]:
        if option: import_rows(func(option),sources[keyname],s)
if __name__=='__main__':
    try: main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f'Import failed: {e}',file=sys.stderr);sys.exit(1)
