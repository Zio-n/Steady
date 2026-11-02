create or replace function public.search_catalog_foods(
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
  match_score integer
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
  if length(query_text) < 2 or length(query_text) > 100 then
    return;
  end if;

  like_pattern := '%' || replace(replace(replace(query_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  return query
  with candidates as (
    select
      food.id as food_id, food.name, food.brand, food.data_kind, food.quality_status,
      null::text as matched_alias, food.locale as match_locale,
      case
        when food.name ilike like_pattern escape E'\\' then 'name'
        else 'brand'
      end as matched_by,
      case
        when food.brand is not null and lower(concat_ws(' ', food.name, food.brand)) = query_text then 110
        when lower(food.name) = query_text and food.data_kind = 'generic' then 100
        when lower(food.name) = query_text then 90
        when lower(food.name) like query_text || '%' and food.data_kind = 'generic' then 85
        when lower(food.name) like query_text || '%' then 80
        when food.name ilike like_pattern escape E'\\' and food.data_kind = 'generic' then 70
        when food.name ilike like_pattern escape E'\\' then 65
        when lower(coalesce(food.brand, '')) = query_text then 60
        else 55
      end as match_score,
      case
        when p_locale is null or p_locale = '' then 0
        when lower(food.locale) = lower(p_locale) then 10
        when split_part(lower(food.locale), '-', 1) = split_part(lower(p_locale), '-', 1) then 5
        else 0
      end as locale_score
    from public.catalog_foods as food
    join public.catalog_sources as source on source.id = food.source_id and source.enabled
    where food.is_active
      and (food.name ilike like_pattern escape E'\\'
       or coalesce(food.brand, '') ilike like_pattern escape E'\\')

    union all

    select
      food.id as food_id, food.name, food.brand, food.data_kind, food.quality_status,
      alias.alias as matched_alias,
      alias.locale as match_locale,
      'alias'::text as matched_by,
      case
        when lower(alias.alias) = query_text and food.data_kind = 'generic' then 95
        when lower(alias.alias) = query_text then 88
        when lower(alias.alias) like query_text || '%' and food.data_kind = 'generic' then 78
        when lower(alias.alias) like query_text || '%' then 73
        when food.data_kind = 'generic' then 68
        else 63
      end as match_score,
      case
        when p_locale is null or p_locale = '' then 0
        when lower(alias.locale) = lower(p_locale) then 10
        when split_part(lower(alias.locale), '-', 1) = split_part(lower(p_locale), '-', 1) then 5
        else 0
      end as locale_score
    from public.catalog_foods as food
    join public.catalog_sources as source on source.id = food.source_id and source.enabled
    join public.catalog_food_aliases as alias on alias.food_id = food.id
    where food.is_active
      and alias.alias ilike like_pattern escape E'\\'
  ),
  best_match as (
    select distinct on (candidate.food_id) candidate.*
    from candidates as candidate
    order by candidate.food_id, candidate.match_score desc, candidate.locale_score desc,
      case candidate.matched_by when 'name' then 0 when 'alias' then 1 else 2 end
  ),
  top_matches as (
    select best.*
    from best_match as best
    order by best.match_score desc, best.locale_score desc,
      case best.quality_status when 'usable' then 0 when 'incomplete' then 1 else 2 end,
      best.name
    limit result_limit
  )
  select
    food.id, food.name, food.brand, food.data_kind, food.source_id,
    source.name, source.licence, food.locale, food.basis_amount,
    food.basis_unit, food.quality_status, energy.value, protein.value,
    result.matched_alias, result.match_locale, result.matched_by, result.match_score
  from top_matches as result
  join public.catalog_foods as food on food.id = result.food_id
  join public.catalog_sources as source on source.id = food.source_id
  left join lateral (
    select nutrient.value
    from public.catalog_food_nutrients as nutrient
    join public.catalog_nutrient_definitions as definition using (nutrient_code)
    where nutrient.food_id = food.id
      and nutrient.normalization_status = 'normalized'
      and nutrient.value_unit = 'kcal'
      and definition.standard_unit = 'kcal'
      and (nutrient.nutrient_code = 'energy_kcal' or nutrient.nutrient_code like 'off_energy%')
    order by case when nutrient.nutrient_code = 'energy_kcal' then 0 else 1 end
    limit 1
  ) as energy on true
  left join lateral (
    select nutrient.value
    from public.catalog_food_nutrients as nutrient
    where nutrient.food_id = food.id
      and nutrient.nutrient_code = 'protein_g'
      and nutrient.normalization_status = 'normalized'
      and nutrient.value_unit = 'g'
    limit 1
  ) as protein on true
  order by result.match_score desc, result.locale_score desc,
    case food.quality_status when 'usable' then 0 when 'incomplete' then 1 else 2 end,
    food.name;
end;
$$;

revoke all on function public.search_catalog_foods(text, text, integer) from public;
grant execute on function public.search_catalog_foods(text, text, integer) to anon, authenticated;
comment on function public.search_catalog_foods(text, text, integer) is
  'Bounded, locale-aware catalogue search across canonical names, brands, and attributed aliases. Returns only normalized kcal/protein values.';
