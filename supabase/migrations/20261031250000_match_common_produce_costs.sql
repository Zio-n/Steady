-- Optional catalogue seeds: a fresh install may not have imported these foods.
-- Link common generic produce records to matching ONS grocery estimates.
insert into public.ingredient_cost_catalog_matches
  (source_id, source_record_id, ingredient_key, match_quality, match_rationale)
select candidate.* from (values
  ('cofid_2021','14-318','bananas','direct','Raw banana flesh is a close generic match to the ONS bananas price; the cost is per edible fruit weight basis as specified by the ONS pack.'),
  ('cofid_2021','13-520','lettuce','direct','Average raw lettuce matches the ONS lettuce category; specific varieties may differ.')
) as candidate(source_id, source_record_id, ingredient_key, match_quality, match_rationale)
where exists (
  select 1 from public.catalog_foods f
  where f.source_id = candidate.source_id and f.source_record_id = candidate.source_record_id
)
on conflict (source_id, source_record_id) do update set
  ingredient_key = excluded.ingredient_key,
  match_quality = excluded.match_quality,
  match_rationale = excluded.match_rationale,
  reviewed_at = now();
