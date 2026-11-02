-- Reviewed staple-food matches for breakfast, pasta, rice, fish, and vegetable recipes.
insert into public.ingredient_cost_catalog_matches
  (source_id, source_record_id, ingredient_key, match_quality, match_rationale)
values
  ('usda_fndds','2707152','eggs_free_range','approximate','Raw whole eggs are the generic nutrition form for the ONS free-range egg price; production method is not represented in the generic food record.'),
  ('usda_fndds','2708489','oats','direct','Raw oats match the ONS oats or porridge ingredient category.'),
  ('cofid_2021','11-857','basmati_rice','direct','Raw white basmati rice matches the ONS basmati or jasmine rice item.'),
  ('cofid_2021','12-346','cheddar','direct','English Cheddar matches the ONS Cheddar item.'),
  ('cofid_2021','16-372','cod_fresh','direct','Raw cod flesh matches the ONS fresh cod item.'),
  ('cofid_2021','18-043','beef_steak','direct','Raw lean rump steak matches the ONS beef steak or chops category.'),
  ('usda_fndds','2707418','canned_beans','approximate','Canned chickpeas are a close pulse analogue for the ONS canned or jarred beans category; the price is not chickpea-specific.'),
  ('cofid_2021','13-543','mixed_vegetables_frozen','approximate','Boiled frozen mixed vegetables match the ONS frozen mixed vegetables category; cooking can change water weight.'),
  ('cofid_2021','13-884','dried_herbs','direct','Dried mixed herbs match the ONS dried herbs category.'),
  ('usda_fndds','2709285','frozen_fruit','approximate','Frozen strawberries are one fruit covered by the ONS frozen fruit category.'),
  ('usda_foundation','2257046','oat_milk','approximate','Unsweetened refrigerated oat milk is a close form for the ONS oat milk item; sweetened and shelf-stable products may differ.'),
  ('cofid_2021','13-489','potatoes_white','approximate','Raw old white potatoes are a close form for the ONS white potato item; variety and purchase preparation differ.')
on conflict (source_id, source_record_id) do update set
  ingredient_key = excluded.ingredient_key,
  match_quality = excluded.match_quality,
  match_rationale = excluded.match_rationale,
  reviewed_at = now();
