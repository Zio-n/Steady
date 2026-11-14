alter table public.meals
  add column snapshot_foods jsonb check (
    snapshot_foods is null or (jsonb_typeof(snapshot_foods) = 'array' and jsonb_array_length(snapshot_foods) between 1 and 50)
  ),
  add column history_key text check (history_key is null or history_key ~ '^[0-9a-f]{32}$');

create unique index active_saved_meal_history
  on public.meals(user_id, history_key) where history_key is not null and archived_at is null;
create index day_items_library_meals
  on public.day_items(user_id, local_date, (coalesce(meal_group_id,id))) where state <> 'removed';

create function public.list_recent_calendar_meals(
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
    select 1 from regexp_split_to_table(left(lower(coalesce(p_search,'')),160), '[^[:alnum:]]+') as word(value)
    where word.value <> '' and strpos(lower(latest.search_text), word.value) = 0
  )
  order by latest.last_logged_at desc, latest.local_date desc, latest.history_key
  limit least(100, greatest(1, coalesce(p_limit,20))) offset greatest(0, coalesce(p_offset,0));
$$;

create function public.save_snapshot_meal(
  p_request_id uuid, p_name text, p_foods jsonb, p_history_key text default null,
  p_meal_id uuid default null, p_expected_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := encode(extensions.digest(convert_to(
    jsonb_build_array(p_name,p_foods,p_history_key,p_meal_id,p_expected_revision)::text,'UTF8'),'sha256'),'hex');
  prior public.mutation_receipts%rowtype;
  saved public.meals%rowtype;
  food jsonb;
begin
  if actor is null then raise exception using errcode='28000', message='Authentication required'; end if;
  if p_request_id is null or length(trim(coalesce(p_name,''))) not between 1 and 160
    or jsonb_typeof(p_foods) is distinct from 'array'
    or (p_history_key is not null and (p_meal_id is not null or p_history_key !~ '^[0-9a-f]{32}$'))
    or (p_meal_id is null) <> (p_expected_revision is null) then
    raise exception using errcode='22023', message='A name and meal foods are required';
  end if;
  if jsonb_array_length(p_foods) not between 1 and 50 or octet_length(p_foods::text) > 500000 then
    raise exception using errcode='22023', message='A meal needs 1 to 50 foods';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text, 0));
  select * into prior from public.mutation_receipts where user_id=actor and request_id=p_request_id;
  if found then
    if prior.operation <> 'save_snapshot_meal' or prior.input_fingerprint <> fingerprint then
      raise exception using errcode='22023', message='Request ID was already used with different input';
    end if;
    return prior.result;
  end if;

  for food in select value from jsonb_array_elements(p_foods) loop
    if jsonb_typeof(food->'payload') is distinct from 'object'
      or jsonb_typeof(food->'logging') is distinct from 'object'
      or food ? 'variant' or food->'logging'->>'kind' is not null
      or length(trim(coalesce(food->'payload'->>'name',''))) not between 1 and 160
      or length(trim(coalesce(food->>'unit',''))) not between 1 and 24
      or (food->>'unit') is distinct from (food->'payload'->>'basisUnit')
      or (food->'payload'->>'basisAmount')::numeric is distinct from 1
      or (food->>'amount')::numeric is null or (food->>'amount')::numeric not between 0.0001 and 99999999.9999
      or not (food->'payload' ? 'caloriesKcal')
      or (food->'payload'->>'caloriesKcal')::numeric not between 0 and 99999999.999999
      or jsonb_typeof(food->'payload'->'nutrients') is distinct from 'object' then
      raise exception using errcode='22023', message='A meal food has an invalid portion or nutrition value';
    end if;
    if exists (
      select 1 from jsonb_each(food->'payload'->'nutrients') as nutrient(key,value)
      where jsonb_typeof(nutrient.value) not in ('number','null')
        or case when jsonb_typeof(nutrient.value)='number' then (nutrient.value::text)::numeric not between 0 and 99999999.999999 else false end
        or not exists (select 1 from public.nutrient_fields as field where field.user_id=actor and field.field_id=nutrient.key and field.archived_at is null)
    ) then raise exception using errcode='22023', message='A meal food contains invalid nutrients'; end if;
  end loop;

  if p_meal_id is null then
    insert into public.meals(user_id,name,sections,snapshot_foods,history_key)
      values(actor,trim(p_name),array['unlabelled'::public.meal_section],p_foods,p_history_key)
      returning * into saved;
  else
    update public.meals set name=trim(p_name),snapshot_foods=p_foods,revision=revision+1,updated_at=now()
      where user_id=actor and id=p_meal_id and archived_at is null and revision=p_expected_revision and snapshot_foods is not null
      returning * into saved;
    if not found then raise exception using errcode='40001', message='The saved meal has changed'; end if;
  end if;
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor,p_request_id,'save_snapshot_meal',fingerprint,jsonb_build_object('id',saved.id,'revision',saved.revision));
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end;
$$;

create function public.archive_saved_meal(p_request_id uuid, p_meal_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := encode(extensions.digest(convert_to(
    jsonb_build_array(p_meal_id,p_expected_revision)::text,'UTF8'),'sha256'),'hex');
  prior public.mutation_receipts%rowtype;
  result jsonb;
begin
  if actor is null then raise exception using errcode='28000', message='Authentication required'; end if;
  if p_request_id is null or p_meal_id is null or p_expected_revision is null then
    raise exception using errcode='22023', message='A saved meal is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text, 0));
  select * into prior from public.mutation_receipts where user_id=actor and request_id=p_request_id;
  if found then
    if prior.operation <> 'archive_saved_meal' or prior.input_fingerprint <> fingerprint then
      raise exception using errcode='22023', message='Request ID was already used with different input';
    end if;
    return prior.result;
  end if;
  update public.meals set archived_at=now(),updated_at=now(),revision=revision+1
    where user_id=actor and id=p_meal_id and revision=p_expected_revision and archived_at is null
    returning jsonb_build_object('id',id,'revision',revision) into result;
  if not found then raise exception using errcode='40001', message='The saved meal has changed'; end if;
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor,p_request_id,'archive_saved_meal',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.list_recent_calendar_meals(text,integer,integer,text) from public,anon;
revoke all on function public.save_snapshot_meal(uuid,text,jsonb,text,uuid,integer) from public,anon;
revoke all on function public.archive_saved_meal(uuid,uuid,integer) from public,anon;
grant execute on function public.list_recent_calendar_meals(text,integer,integer,text) to authenticated;
grant execute on function public.save_snapshot_meal(uuid,text,jsonb,text,uuid,integer) to authenticated;
grant execute on function public.archive_saved_meal(uuid,uuid,integer) to authenticated;
