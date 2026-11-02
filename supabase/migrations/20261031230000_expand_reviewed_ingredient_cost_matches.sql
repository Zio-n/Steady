-- Expand the reviewed crosswalk with specific, source-backed generic food forms.
insert into public.ingredient_cost_catalog_matches
  (source_id, source_record_id, ingredient_key, match_quality, match_rationale)
values
  ('cofid_2021','13-532','baked_beans','direct','Canned baked beans in tomato sauce match the ONS baked beans item.'),
  ('cofid_2021','11-981','bread_wholemeal','direct','CoFID wholemeal bread matches the ONS sliced wholemeal or brown bread item.'),
  ('cofid_2021','19-497','bacon','direct','Raw back bacon rashers match the ONS bacon item; the broad item also includes other bacon forms.'),
  ('usda_fndds','2705853','beef_mince','approximate','Generic raw ground beef is a close analogue for the ONS minced or diced beef item; fat level and UK cut mix may differ.'),
  ('cofid_2021','18-298','whole_chicken','approximate','Raw whole chicken weighed with bone matches the ONS whole chicken purchase weight; edible yield varies.'),
  ('cofid_2021','13-527','peas_frozen','direct','Raw frozen peas match the ONS frozen peas item.'),
  ('cofid_2021','17-050','honey','direct','Generic honey matches the ONS honey item.'),
  ('usda_fndds','2707537','peanut_butter','direct','Generic peanut butter matches the ONS peanut butter item.'),
  ('cofid_2021','19-510','pork_sausages','direct','Raw pork sausages match the ONS pork sausages item.'),
  ('usda_fndds','2706284','salmon_fresh','direct','Raw salmon matches the ONS fresh salmon item.'),
  ('cofid_2021','11-888','self_raising_flour','direct','White self-raising wheat flour matches the ONS self-raising flour item.'),
  ('cofid_2021','17-709','tomato_ketchup','direct','Tomato ketchup matches the ONS ketchup item.'),
  ('cofid_2021','17-063','white_sugar','direct','White sugar matches the ONS white sugar item.'),
  ('usda_fndds','2707824','wraps_tortillas','approximate','Flour tortilla is a close analogue for the ONS wraps and tortillas category; size and recipe vary.'),
  ('cofid_2021','13-512','cauliflower','direct','Raw cauliflower matches the ONS fresh cauliflower item.'),
  ('usda_fndds','2709784','cucumber','direct','Raw cucumber matches the ONS fresh cucumber item.'),
  ('cofid_2021','11-716','dried_pasta','direct','White dried pasta matches the ONS dry pasta item.'),
  ('cofid_2021','12-380','flavoured_yoghurt','approximate','Low-fat fruit yoghurt matches the ONS flavoured yoghurt category; fat and flavour variants differ.'),
  ('usda_fndds','2707626','garlic_bread','approximate','Generic garlic bread matches the ONS garlic bread category; pack and recipe differ.'),
  ('cofid_2021','17-688','jam','approximate','Stone-fruit jam is a close analogue for the ONS jam or conserve category.'),
  ('usda_fndds','2710220','mayonnaise','approximate','Light mayonnaise matches the ONS broad mayonnaise category; regular mayonnaise may cost differently.'),
  ('cofid_2021','19-128','canned_meat','approximate','Canned corned beef is a common canned meat form represented by the ONS canned meat item.'),
  ('cofid_2021','11-989','crumpets','approximate','Toasted crumpets match the ONS per-crumpet item; toasting changes weight but not purchase count.'),
  ('usda_fndds','2705730','parmesan','direct','Hard Parmesan matches the ONS Parmesan and similar cheese category.')
on conflict (source_id, source_record_id) do update set
  ingredient_key = excluded.ingredient_key,
  match_quality = excluded.match_quality,
  match_rationale = excluded.match_rationale,
  reviewed_at = now();
