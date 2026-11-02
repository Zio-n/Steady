-- Read-only starter coverage sample. This is a deliberately diverse synthetic
-- query set, not a substitute for representative real-user searches.
-- Run with: npx supabase db query --local --file scripts/benchmark-catalogue-search.sql
with queries(query, query_group) as (values
  ('banana','generic produce'),('broccoli','generic produce'),('sweet potato','generic produce'),
  ('chicken breast','generic protein'),('salmon','generic protein'),('eggs','generic protein'),
  ('chickpeas','generic pantry'),('red lentils','generic pantry'),('basmati rice','generic pantry'),
  ('porridge oats','generic pantry'),('wholemeal bread','generic bakery'),('greek yoghurt','generic dairy'),
  ('plain yogurt','generic dairy'),('soya milk','generic alternatives'),('tofu','global foods'),
  ('tempeh','global foods'),('plantain','global foods'),('cassava','global foods'),('kimchi','global foods'),
  ('miso','global foods'),('tahini','global foods'),('paneer','global foods'),('tamarind','global foods'),
  ('Heinz baked beans','UK branded'),('Tesco Greek yoghurt','UK branded'),
  ('Warburtons bread','UK branded'),('Alpro soya milk','UK branded'),('Quaker oats','branded'),
  ('Hovis seeded bread','UK branded'),('chicken tikka ready meal','UK branded')
)
select queries.query, queries.query_group, found.name, found.brand, found.source_name,
  found.data_kind, found.quality_status, found.match_score,
  found.calories_kcal is not null as has_calories,
  found.protein_g is not null as has_protein
from queries
left join lateral public.search_catalog_foods(queries.query,'en-GB',1) as found on true
order by queries.query_group, queries.query;
