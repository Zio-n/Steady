-- Optional catalogue seeds: a fresh install may not have imported these foods.
-- Reviewed links from generic catalogue foods to separate Steady-owned cost
-- estimates. These links add no cost or nutrient values to imported records.
create table public.ingredient_cost_catalog_matches (
  source_id text not null,
  source_record_id text not null,
  ingredient_key text not null references public.steady_ingredient_cost_items(ingredient_key) on delete restrict,
  match_quality text not null check (match_quality in ('direct', 'approximate')),
  match_rationale text not null check (length(trim(match_rationale)) between 1 and 500),
  reviewed_at timestamptz not null default now(),
  primary key (source_id, source_record_id),
  foreign key (source_id, source_record_id)
    references public.catalog_foods(source_id, source_record_id) on delete cascade
);

create index ingredient_cost_catalog_matches_by_key_idx
  on public.ingredient_cost_catalog_matches(ingredient_key);

alter table public.ingredient_cost_catalog_matches enable row level security;
create policy "ingredient cost catalogue matches readable" on public.ingredient_cost_catalog_matches
  for select to anon, authenticated using (true);
grant select on public.ingredient_cost_catalog_matches to anon, authenticated;
grant all on public.ingredient_cost_catalog_matches to service_role;

comment on table public.ingredient_cost_catalog_matches is
  'Reviewed associations between generic source food records and Steady-owned ingredient cost keys. Costs remain in ingredient_cost_estimates and are selected by the recipe market.';
comment on column public.ingredient_cost_catalog_matches.match_quality is
  'direct means the generic food form closely matches the priced item; approximate means the ONS item is a reasonable broad-category estimate, not an exact variant price.';

insert into public.ingredient_cost_catalog_matches
  (source_id, source_record_id, ingredient_key, match_quality, match_rationale)
select candidate.* from (values
  ('usda_foundation','2646170','chicken_fillet','direct','Raw boneless, skinless chicken breast matches the ONS chicken fillet/steak price category.'),
  ('cofid_2021','12-313','milk_semi_skimmed','direct','CoFID average semi-skimmed pasteurised milk matches the priced fresh semi-skimmed milk category.'),
  ('usda_fndds','2705385','milk_whole','direct','Generic whole cow milk matches the priced fresh whole milk category.'),
  ('usda_fndds','2705412','oat_milk','approximate','Generic oat milk matches the priced oat milk category; sweetening and brand may differ.'),
  ('cofid_2021','12-526','parmesan','approximate','Fresh Parmesan matches the broad ONS Parmesan and similar cheese category.'),
  ('cofid_2021','16-416','tuna_canned','approximate','Canned tuna in brine, drained, is a reasonable generic form for the ONS canned tuna category.'),
  ('usda_fndds','2709643','broccoli','direct','Raw broccoli matches the priced fresh broccoli category.'),
  ('usda_fndds','2709660','carrots','direct','Raw carrots match the priced fresh carrots category.'),
  ('cofid_2021','13-627','courgette','direct','Raw courgette matches the priced courgette category.'),
  ('usda_fndds','2709793','mushrooms','direct','Raw mushrooms match the priced fresh mushrooms category.'),
  ('cofid_2021','13-499','onions','direct','Raw onions match the priced fresh onions category.'),
  ('usda_fndds','2709799','peppers','approximate','Generic raw peppers match the priced pepper category; colour and size may differ.'),
  ('usda_fndds','2709719','tomatoes','direct','Raw tomatoes match the priced fresh tomatoes category.'),
  ('usda_fndds','2710186','olive_oil','direct','Generic olive oil matches the priced olive oil category.'),
  ('cofid_2021','13-530','canned_tomatoes','direct','Canned whole tomatoes match the priced canned or jarred tomatoes category.'),
  ('usda_fndds','2707598','bread_white','approximate','Generic white bread matches the broad sliced white bread category; loaf format may differ.'),
  ('cofid_2021','14-319','apples','approximate','Raw eating apples match the ONS non-cooking apple category; variety and edible-weight basis may differ.')
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
