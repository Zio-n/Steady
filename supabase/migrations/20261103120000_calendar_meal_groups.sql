-- Preserve the meal assembled in the calendar as one visible occurrence.
-- Older single-item and batch callers continue to work with a null group ID.
alter table public.day_items add column if not exists meal_group_id uuid;
create index if not exists day_items_meal_group_idx
  on public.day_items(user_id,local_date,meal_group_id)
  where meal_group_id is not null;

-- Batch writers run as the signed-in role, which cannot directly update day_items.
-- Keep the privileged assignment narrow and scoped to the actor's own item.
drop function if exists public.assign_calendar_meal_group(uuid,uuid,date,public.meal_section);
drop function if exists public.assign_calendar_meal_group(uuid,uuid,date,public.meal_section,text);
create or replace function public.assign_calendar_meal_group(
  p_item_id uuid, p_group_id uuid, p_local_date date, p_section public.meal_section, p_brand text, p_measure jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_item_id is null or p_group_id is null then
    raise exception using errcode='28000',message='Authentication and meal IDs are required';
  end if;
  if p_brand is not null and length(p_brand)>120 then
    raise exception using errcode='22023',message='Food brand is too long';
  end if;
  if p_measure is not null and (jsonb_typeof(p_measure)<>'object'
    or coalesce(p_measure->>'kind','') not in ('weight','volume')
    or jsonb_typeof(p_measure->'value') is distinct from 'number'
    or (p_measure->>'value')::numeric<=0
    or (p_measure->>'value')::numeric>=1000000000) then
    raise exception using errcode='22023',message='Food measure is invalid';
  end if;
  update public.day_items as item set meal_group_id=p_group_id,
    eaten_snapshot=case when item.state='eaten' then
      item.eaten_snapshot || jsonb_build_object('brand',coalesce(
        nullif(trim(p_brand),''),
        (select food.brand from public.foods as food
          where food.user_id=auth.uid() and food.id=nullif(item.eaten_snapshot->>'source_id','')::uuid)
      ),'display_measure',p_measure) else item.eaten_snapshot end,
    planned_payload=case when item.state='planned' and p_measure is not null then
      item.planned_payload || jsonb_build_object('display_measure',p_measure) else item.planned_payload end
    where item.id=p_item_id and item.user_id=auth.uid()
      and item.local_date=p_local_date and item.section=p_section
      and (item.meal_group_id is null or item.meal_group_id=p_group_id);
  if not found then raise exception using errcode='40001',message='Meal group changed'; end if;
end;
$$;
revoke all on function public.assign_calendar_meal_group(uuid,uuid,date,public.meal_section,text,jsonb) from public, anon;
grant execute on function public.assign_calendar_meal_group(uuid,uuid,date,public.meal_section,text,jsonb) to authenticated;

create or replace function public.calendar_log_day_items(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
  group_id uuid;
  group_date date;
  group_section text;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 50 then raise exception using errcode='22023',message='Add between 1 and 50 entries'; end if;
  group_id := nullif(p_items->0->>'meal_group_id','')::uuid;
  group_date := (p_items->0->>'local_date')::date;
  group_section := p_items->0->>'section';
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    if group_id is not null and ((item->>'meal_group_id')::uuid is distinct from group_id
      or (item->>'local_date')::date is distinct from group_date
      or item->>'section' is distinct from group_section) then
      raise exception using errcode='22023',message='Meal items must share a date, label and group';
    end if;
    result := public.calendar_log_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end,
      nullif(item->>'planned_item_id','')::uuid,
      nullif(item->>'expected_item_revision','')::integer
    );
    if group_id is not null then
      perform public.assign_calendar_meal_group((result->>'item_id')::uuid,group_id,group_date,group_section::public.meal_section,item->'manual_payload'->>'brand',nullif(item->'display_measure','null'::jsonb));
    end if;
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;

create or replace function public.calendar_plan_day_items(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
  group_id uuid;
  group_date date;
  group_section text;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 50 then raise exception using errcode='22023',message='Add between 1 and 50 entries'; end if;
  group_id := nullif(p_items->0->>'meal_group_id','')::uuid;
  group_date := (p_items->0->>'local_date')::date;
  group_section := p_items->0->>'section';
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    if group_id is not null and ((item->>'meal_group_id')::uuid is distinct from group_id
      or (item->>'local_date')::date is distinct from group_date
      or item->>'section' is distinct from group_section) then
      raise exception using errcode='22023',message='Meal items must share a date, label and group';
    end if;
    result := public.calendar_plan_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end
    );
    if group_id is not null then
      perform public.assign_calendar_meal_group((result->>'item_id')::uuid,group_id,group_date,group_section::public.meal_section,item->'manual_payload'->>'brand',nullif(item->'display_measure','null'::jsonb));
    end if;
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;



-- Include the group in day and range reads; old fields remain unchanged.
-- Read a calendar date without creating a day, week, routine occurrence or carry record.
-- Existing completion snapshots remain authoritative for completed legacy days.
create or replace function public.read_calendar_day(p_local_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  day_row public.days%rowtype;
  target_row public.profile_target_versions%rowtype;
  day_value jsonb;
  item_values jsonb;
  target_value jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_local_date is null then
    raise exception using errcode = '22023', message = 'A local date is required';
  end if;

  select day.* into day_row
    from public.days as day
    where day.user_id = actor_id and day.local_date = p_local_date;

  select version.* into target_row
    from public.profile_target_versions as version
    where version.user_id = actor_id and version.effective_from <= p_local_date
    order by version.effective_from desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'section', item.section,
      'state', item.state,
      'source', item.source,
      'selected_amount', item.selected_amount,
      'selected_unit', item.selected_unit,
      'planned_payload', item.planned_payload,
      'eaten_snapshot', item.eaten_snapshot,
      'eaten_at', item.eaten_at,
      'revision', item.revision,
      'meal_group_id', item.meal_group_id
    ) order by item.created_at, item.id), '[]'::jsonb)
    into item_values
    from public.day_items as item
    where item.user_id = actor_id and item.local_date = p_local_date
      and item.state <> 'removed';

  if day_row.user_id is null then
    day_value := null;
  else
    day_value := to_jsonb(day_row);
  end if;

  if day_row.status = 'completed' then
    target_value := jsonb_build_object(
      'calories_kcal', day_row.completed_target_kcal,
      'nutrients', day_row.nutrient_target_snapshot,
      'source', 'completed_snapshot'
    );
  elsif target_row.user_id is not null then
    target_value := jsonb_build_object(
      'calories_kcal', target_row.base_daily_target_kcal,
      'nutrients', jsonb_build_object(
        'targets', target_row.nutrient_targets,
        'fields', target_row.nutrient_field_snapshot
      ),
      'source', 'profile_version'
    );
  else
    target_value := jsonb_build_object(
      'calories_kcal', null,
      'nutrients', '{}'::jsonb,
      'source', 'unset'
    );
  end if;

  return jsonb_build_object(
    'local_date', p_local_date,
    'day', day_value,
    'target', target_value,
    'items', item_values
  );
end;
$$;

revoke all on function public.read_calendar_day(date) from public, anon;
grant execute on function public.read_calendar_day(date) to authenticated;
comment on function public.read_calendar_day(date) is
  'Stable account-scoped calendar read. Empty dates and historical routine plans are never materialised by reading.';
