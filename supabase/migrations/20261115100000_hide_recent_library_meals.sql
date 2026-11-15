create table public.hidden_recent_meals (
  user_id uuid not null references auth.users(id) on delete cascade,
  history_key text not null check (history_key ~ '^[0-9a-f]{32}$'),
  primary key (user_id, history_key)
);

alter table public.hidden_recent_meals enable row level security;
create policy owner_access on public.hidden_recent_meals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, delete on public.hidden_recent_meals to authenticated;

create or replace function public.list_recent_calendar_meals(
  p_search text default '', p_limit integer default 20, p_offset integer default 0, p_history_key text default null
)
returns table(history_key text, local_date date, last_logged_at timestamptz, items jsonb, saved_meal_id uuid)
language sql stable security invoker set search_path = '' as $$
  with occurrences as (
    select
      item.local_date,
      coalesce(item.meal_group_id, item.id) as occurrence_id,
      max(item.eaten_at) as last_logged_at,
      jsonb_agg(jsonb_build_object(
        'id', item.id, 'state', item.state, 'section', item.section, 'source', item.source,
        'selected_amount', item.selected_amount, 'selected_unit', item.selected_unit,
        'planned_payload', item.planned_payload, 'eaten_snapshot', item.eaten_snapshot, 'revision', item.revision
      ) order by coalesce(
        item.eaten_snapshot->'logging'->'position', item.planned_payload->'logging'->'position', '0'::jsonb
      ), item.created_at, item.id) as items,
      jsonb_agg(component.identities) as identity_lists,
      string_agg(component.search_text, ' ') as search_text
    from public.day_items as item
    cross join lateral (
      select case when item.eaten_snapshot->>'source' in ('meal','one_off_meal') then (
        select jsonb_agg(jsonb_build_array(
          value->>'food_id', lower(trim(value->>'food_name')), null,
          round((value->>'amount')::numeric * item.selected_amount,4), lower(trim(value->>'unit'))
        )) from jsonb_array_elements(coalesce(item.eaten_snapshot->'components','[]'))
      ) else jsonb_build_array(jsonb_build_array(
        coalesce(item.eaten_snapshot->'logging'->>'foodId', item.planned_payload->'logging'->>'foodId',
                 item.eaten_snapshot->'logging'->>'catalogueFoodId', item.planned_payload->'logging'->>'catalogueFoodId',
                 item.eaten_snapshot->>'source_id'),
        lower(trim(item.eaten_snapshot->>'name')), lower(trim(item.eaten_snapshot->>'brand')),
        item.selected_amount, lower(trim(item.selected_unit))
      )) end as identities,
      concat_ws(' ', item.eaten_snapshot->>'name', item.eaten_snapshot->>'brand',
        (select string_agg(value->>'food_name',' ') from jsonb_array_elements(coalesce(item.eaten_snapshot->'components','[]')))) as search_text
    ) as component
    where item.user_id = (select auth.uid()) and item.state <> 'removed'
    group by item.local_date, coalesce(item.meal_group_id,item.id)
    having bool_and(item.state = 'eaten')
      and bool_and(coalesce(item.eaten_snapshot->'logging'->>'kind', item.planned_payload->'logging'->>'kind', '') <> 'calorie_block')
      and (count(*) between 2 and 50 or (count(*) = 1 and bool_or(
        item.eaten_snapshot->>'source' in ('meal','one_off_meal')
        and jsonb_array_length(coalesce(item.eaten_snapshot->'components','[]')) between 2 and 50
      )))
  ), keyed as (
    select occurrence.*, signature.history_key
    from occurrences as occurrence
    cross join lateral (
      select md5(jsonb_agg(food.identity order by food.identity)::text) as history_key
      from jsonb_array_elements(occurrence.identity_lists) as entry(identities)
      cross join lateral jsonb_array_elements(nullif(entry.identities, 'null'::jsonb)) as food(identity)
      having count(*) between 2 and 50
    ) as signature
  ), latest as (
    select distinct on (occurrence.history_key) occurrence.*
    from keyed as occurrence
    where p_history_key is null or occurrence.history_key = p_history_key
    order by occurrence.history_key, occurrence.last_logged_at desc, occurrence.local_date desc, occurrence.occurrence_id
  )
  select latest.history_key, latest.local_date, latest.last_logged_at, latest.items, saved.id
  from latest
  left join public.meals as saved on saved.user_id = (select auth.uid())
    and saved.history_key = latest.history_key and saved.archived_at is null
  where not exists (
    select 1 from public.hidden_recent_meals as hidden
    where hidden.user_id = (select auth.uid()) and hidden.history_key = latest.history_key
  )
  and (saved.id is not null or not exists (
    select 1 from public.meals as archived
    where archived.user_id = (select auth.uid()) and archived.history_key = latest.history_key
      and archived.archived_at is not null
  ))
  and not exists (
    select 1 from regexp_split_to_table(left(lower(coalesce(p_search,'')),160), '[^[:alnum:]]+') as word(value)
    where word.value <> '' and strpos(lower(latest.search_text), word.value) = 0
  )
  order by latest.last_logged_at desc, latest.local_date desc, latest.history_key
  limit least(100, greatest(1, coalesce(p_limit,20))) offset greatest(0, coalesce(p_offset,0));
$$;
