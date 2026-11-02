-- The ONS banana price is per purchased weight, while the CoFID food record
-- measures edible flesh. Without an edible-yield adjustment, this is an
-- approximate price association rather than a directly usable unit match.
update public.ingredient_cost_catalog_matches
set match_quality = 'approximate',
    match_rationale = 'Raw banana flesh matches the food category, but the ONS price is per purchased banana weight including peel. Edible grams require a verified yield adjustment before this can be used as an exact unit cost.',
    reviewed_at = now()
where source_id = 'cofid_2021'
  and source_record_id = '14-318'
  and ingredient_key = 'bananas';
