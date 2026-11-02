-- Preserve normalized nutrient values in catalogue search results.
drop function if exists public.search_catalog_foods(text, text, integer);

create function public.search_catalog_foods(
  p_query text,
  p_locale text default null,
  p_limit integer default 30
)
returns table (
  food_id uuid,
  name text,
  brand text,
  data_kind text,
  source_id text,
  source_name text,
  source_licence text,
  locale text,
  basis_amount numeric,
  basis_unit text,
  quality_status text,
  calories_kcal numeric,
  protein_g numeric,
  matched_alias text,
  match_locale text,
  matched_by text,
  match_score integer,
  nutrients jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  query_text text := lower(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'));
  like_pattern text;
  result_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  if length(query_text) < 2 or length(query_text) > 100 then return; end if;
  like_pattern := '%' || replace(replace(replace(query_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  return query
  with candidates as (
    select food.id as food_id, food.name, food.brand, food.data_kind, food.quality_status,
      null::text as matched_alias, food.locale as match_locale,
      case when food.name ilike like_pattern escape E'\\' then 'name' else 'brand' end as matched_by,
      case
        when food.brand is not null and lower(concat_ws(' ', food.name, food.brand)) = query_text then 110
        when lower(food.name) = query_text and food.data_kind = 'generic' then 100
        when lower(food.name) = query_text then 90
        when lower(food.name) like query_text || '%' and food.data_kind = 'generic' then 85
        when lower(food.name) like query_text || '%' then 80
        when food.name ilike like_pattern escape E'\\' and food.data_kind = 'generic' then 70
        when food.name ilike like_pattern escape E'\\' then 65
        when lower(coalesce(food.brand, '')) = query_text then 60 else 55
      end as match_score,
      case when p_locale is null or p_locale = '' then 0
        when lower(food.locale) = lower(p_locale) then 10
        when split_part(lower(food.locale), '-', 1) = split_part(lower(p_locale), '-', 1) then 5 else 0 end as locale_score
    from public.catalog_foods as food
    join public.catalog_sources as source on source.id = food.source_id and source.enabled
    where food.is_active and (food.name ilike like_pattern escape E'\\' or coalesce(food.brand, '') ilike like_pattern escape E'\\')
    union all
    select food.id, food.name, food.brand, food.data_kind, food.quality_status,
      alias.alias, alias.locale, 'alias'::text,
      case
        when lower(alias.alias) = query_text and food.data_kind = 'generic' then 95
        when lower(alias.alias) = query_text then 88
        when lower(alias.alias) like query_text || '%' and food.data_kind = 'generic' then 78
        when lower(alias.alias) like query_text || '%' then 73
        when food.data_kind = 'generic' then 68 else 63
      end,
      case when p_locale is null or p_locale = '' then 0
        when lower(alias.locale) = lower(p_locale) then 10
        when split_part(lower(alias.locale), '-', 1) = split_part(lower(p_locale), '-', 1) then 5 else 0 end
    from public.catalog_foods as food
    join public.catalog_sources as source on source.id = food.source_id and source.enabled
    join public.catalog_food_aliases as alias on alias.food_id = food.id
    where food.is_active and alias.alias ilike like_pattern escape E'\\'
  ), best_match as (
    select distinct on (candidate.food_id) candidate.* from candidates as candidate
    order by candidate.food_id, candidate.match_score desc, candidate.locale_score desc,
      case candidate.matched_by when 'name' then 0 when 'alias' then 1 else 2 end
  ), top_matches as (
    select best.* from best_match as best
    order by best.match_score desc, best.locale_score desc,
      case best.quality_status when 'usable' then 0 when 'incomplete' then 1 else 2 end, best.name
    limit result_limit
  )
  select food.id, food.name, food.brand, food.data_kind, food.source_id, source.name, source.licence,
    food.locale, food.basis_amount, food.basis_unit, food.quality_status, energy.value, protein.value,
    result.matched_alias, result.match_locale, result.matched_by, result.match_score,
    coalesce(all_nutrients.values, '{}'::jsonb)
  from top_matches as result
  join public.catalog_foods as food on food.id = result.food_id
  join public.catalog_sources as source on source.id = food.source_id
  left join lateral (
    select nutrient.value from public.catalog_food_nutrients as nutrient
    join public.catalog_nutrient_definitions as definition using (nutrient_code)
    where nutrient.food_id = food.id and nutrient.normalization_status = 'normalized'
      and nutrient.value_unit = 'kcal' and definition.standard_unit = 'kcal'
      and (nutrient.nutrient_code = 'energy_kcal' or nutrient.nutrient_code like 'off_energy%')
    order by case when nutrient.nutrient_code = 'energy_kcal' then 0 else 1 end limit 1
  ) as energy on true
  left join lateral (
    select nutrient.value from public.catalog_food_nutrients as nutrient
    where nutrient.food_id = food.id and nutrient.nutrient_code = 'protein_g'
      and nutrient.normalization_status = 'normalized' and nutrient.value_unit = 'g' limit 1
  ) as protein on true
  left join lateral (
    select jsonb_object_agg(nutrient.nutrient_code,
      jsonb_build_object('value', nutrient.value, 'unit', nutrient.value_unit)) as values
    from public.catalog_food_nutrients as nutrient
    where nutrient.food_id = food.id and nutrient.value is not null
      and nutrient.normalization_status = 'normalized'
  ) as all_nutrients on true
  order by result.match_score desc, result.locale_score desc,
    case food.quality_status when 'usable' then 0 when 'incomplete' then 1 else 2 end, food.name;
end;
$$;

revoke all on function public.search_catalog_foods(text, text, integer) from public;
grant execute on function public.search_catalog_foods(text, text, integer) to anon, authenticated;
comment on function public.search_catalog_foods(text, text, integer) is
  'Bounded, locale-aware catalogue search with attributed matches and normalized nutrient values only.';

-- User copies retain source lineage while private edits never change shared data.
create table public.food_catalogue_origins (
  user_id uuid not null,
  food_id uuid not null,
  catalog_food_id uuid not null references public.catalog_foods(id) on delete restrict,
  is_personally_adjusted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id),
  foreign key (user_id, food_id) references public.foods(user_id, id) on delete cascade
);
alter table public.food_catalogue_origins enable row level security;
create policy "users can read own food catalogue origins"
  on public.food_catalogue_origins for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.food_catalogue_origins to authenticated;
revoke insert, update, delete on public.food_catalogue_origins from anon, authenticated;

create or replace function public.mark_catalogue_copy_adjusted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_food_id uuid;
begin
  if tg_table_name = 'foods' then
    if new.name is not distinct from old.name and new.brand is not distinct from old.brand
      and new.basis_amount is not distinct from old.basis_amount and new.basis_unit is not distinct from old.basis_unit
      and new.grams_per_serving is not distinct from old.grams_per_serving
      and new.default_portion_amount is not distinct from old.default_portion_amount
      and new.default_portion_unit is not distinct from old.default_portion_unit
      and new.calories_kcal is not distinct from old.calories_kcal then return new; end if;
    actor_id := new.user_id;
    target_food_id := new.id;
  elsif tg_op = 'DELETE' then
    actor_id := old.user_id;
    target_food_id := old.food_id;
  else
    if tg_op = 'UPDATE' and old.value is not distinct from new.value then return new; end if;
    actor_id := new.user_id;
    target_food_id := new.food_id;
  end if;
  update public.food_catalogue_origins set is_personally_adjusted = true
    where user_id = actor_id and food_id = target_food_id and not is_personally_adjusted;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger mark_catalogue_copy_adjusted_food
  after update of name, brand, basis_amount, basis_unit, grams_per_serving,
    default_portion_amount, default_portion_unit, calories_kcal on public.foods
  for each row execute function public.mark_catalogue_copy_adjusted();
create trigger mark_catalogue_copy_adjusted_nutrient
  after insert or update or delete on public.food_nutrients
  for each row execute function public.mark_catalogue_copy_adjusted();

create or replace function public.save_catalog_food_copy(
  p_request_id uuid,
  p_catalog_food_id uuid,
  p_name text,
  p_brand text,
  p_basis_amount numeric,
  p_basis_unit text,
  p_default_portion_amount numeric,
  p_default_portion_unit text,
  p_calories_kcal numeric,
  p_nutrients jsonb,
  p_is_personally_adjusted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
  saved_food_id uuid;
begin
  if actor_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  if not exists (
    select 1 from public.catalog_foods as food
    join public.catalog_sources as source on source.id = food.source_id and source.enabled
    where food.id = p_catalog_food_id and food.is_active
  ) then raise exception using errcode = '22023', message = 'Catalogue food is unavailable'; end if;

  result := public.save_food(p_request_id, null, null, p_name, p_brand, p_basis_amount, p_basis_unit,
    null, p_default_portion_amount, p_default_portion_unit, p_calories_kcal, p_nutrients);
  saved_food_id := (result ->> 'id')::uuid;
  insert into public.food_catalogue_origins as existing_origin(user_id, food_id, catalog_food_id, is_personally_adjusted)
    values (actor_id, saved_food_id, p_catalog_food_id, coalesce(p_is_personally_adjusted, false))
    on conflict (user_id, food_id) do update set catalog_food_id = excluded.catalog_food_id
    where existing_origin.catalog_food_id = excluded.catalog_food_id;
  if not found then raise exception using errcode = '22023', message = 'Request is already linked to another catalogue food'; end if;
  return result;
end;
$$;

revoke all on function public.save_catalog_food_copy(uuid, uuid, text, text, numeric, text, numeric, text, numeric, jsonb, boolean) from public, anon;
grant execute on function public.save_catalog_food_copy(uuid, uuid, text, text, numeric, text, numeric, text, numeric, jsonb, boolean) to authenticated;
