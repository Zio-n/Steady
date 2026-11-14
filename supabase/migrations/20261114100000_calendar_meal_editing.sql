-- Use the composer to replace any dated meal under the existing group identity.
create or replace function public.save_calendar_composer(
  p_request_id uuid, p_local_date date, p_state text, p_items jsonb,
  p_replace_item_id uuid default null, p_expected_revision integer default null,
  p_recurrence jsonb default null, p_series_edit jsonb default null, p_replace_group jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := encode(extensions.digest(convert_to(
    jsonb_build_array(p_local_date,p_state,p_items,p_replace_item_id,p_expected_revision,p_recurrence,p_series_edit,p_replace_group)::text,
    'UTF8'),'sha256'),'hex');
  prior public.mutation_receipts%rowtype;
  replaced public.day_items%rowtype;
  replacement jsonb;
  replacement_group uuid;
  series public.calendar_meal_series%rowtype;
  series_scope text := p_series_edit->>'scope';
  series_entries jsonb := '[]'::jsonb;
  repeat_until date := nullif(p_recurrence->>'endsOn','')::date;
  repeat_interval integer := (p_recurrence->>'interval')::integer;
  repeat_days integer[];
  stores_series boolean := p_recurrence is not null or coalesce(series_scope in ('all','following'),false);
  group_id uuid := p_request_id;
  entry jsonb;
  payload jsonb;
  logging jsonb;
  variant_id uuid;
  entry_id uuid;
  item_request uuid;
  item_index integer := 0;
  result jsonb;
  saved_ids jsonb := '[]'::jsonb;
  section public.meal_section := coalesce(p_items->0->>'section','unlabelled')::public.meal_section;
begin
  if actor is null then raise exception using errcode='28000', message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_state is null or p_state not in ('planned','eaten','removed')
    or jsonb_typeof(p_items) is distinct from 'array'
    or (p_state<>'removed' and jsonb_array_length(p_items) not between 1 and 50)
    or (p_state='removed' and (p_series_edit is null or jsonb_array_length(p_items)<>0))
    or (p_series_edit is not null and (p_replace_item_id is not null or p_recurrence is not null or p_replace_group is not null))
    or (p_replace_group is not null and (p_replace_item_id is not null or p_recurrence is not null
      or jsonb_typeof(p_replace_group) is distinct from 'array' or jsonb_array_length(p_replace_group) not between 1 and 50)) then
    raise exception using errcode='22023', message='A meal needs a date, state and 1 to 50 items';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_request_id::text, 0));
  select * into prior from public.mutation_receipts where user_id=actor and request_id=p_request_id;
  if found then
    if prior.operation <> 'save_calendar_composer' or prior.input_fingerprint <> fingerprint then
      raise exception using errcode='22023', message='Request ID was already used with different input';
    end if;
    return prior.result;
  end if;

  if p_recurrence is not null then
    select array(select distinct value::integer from jsonb_array_elements_text(p_recurrence->'weekdays')) into repeat_days;
    if p_state<>'planned' or p_replace_item_id is not null or coalesce(p_recurrence->>'frequency','') not in ('daily','weekly')
      or repeat_interval is null or repeat_interval not between 1 and 365
      or (repeat_until is not null and repeat_until < p_local_date)
      or (p_recurrence->>'frequency'='weekly' and cardinality(repeat_days)=0)
      or exists (select 1 from unnest(repeat_days) as day where day not between 1 and 7) then
      raise exception using errcode='22023', message='Repeat schedule is invalid';
    end if;
  end if;

  if p_series_edit is not null then
    select * into series from public.calendar_meal_series
      where user_id=actor and id=(p_series_edit->>'id')::uuid for update;
    if not found or series.revision is distinct from (p_series_edit->>'revision')::integer
      or not private.series_matches_date(series,p_local_date)
      or exists (select 1 from public.calendar_meal_series_exceptions
        where user_id=actor and series_id=series.id and local_date=p_local_date) then
      raise exception using errcode='40001', message='Recurring plan changed or is unavailable';
    end if;
    if coalesce(series_scope,'') not in ('one','following','all') or (p_state='eaten' and series_scope<>'one') then
      raise exception using errcode='22023', message='Choose a valid recurrence edit scope';
    end if;
    group_id := pg_catalog.md5(series.id::text || ':' || p_local_date::text)::uuid;
  end if;

  if p_replace_item_id is not null or p_replace_group is not null then
    perform 1 from public.days as day
      where day.user_id=actor and day.local_date=p_local_date and day.status='open' for update;
    if not found then raise exception using errcode='40001', message='The calendar date is unavailable or complete'; end if;
  end if;

  if p_replace_group is not null then
    select coalesce(item.meal_group_id,item.id) into replacement_group from public.day_items as item
      where item.user_id=actor and item.local_date=p_local_date
        and item.id=(p_replace_group->0->>'id')::uuid and item.state<>'removed';
    if replacement_group is null or
      (select count(*) from public.day_items as item where item.user_id=actor and item.local_date=p_local_date
        and coalesce(item.meal_group_id,item.id)=replacement_group and item.state<>'removed') <> jsonb_array_length(p_replace_group) then
      raise exception using errcode='40001', message='The meal has changed';
    end if;
    group_id := replacement_group;
    for replacement in select value from jsonb_array_elements(p_replace_group)
    loop
      select * into replaced from public.day_items as item
        where item.user_id=actor and item.local_date=p_local_date and coalesce(item.meal_group_id,item.id)=replacement_group
          and item.id=(replacement->>'id')::uuid and item.state<>'removed' for update;
      if not found or replaced.revision is distinct from (replacement->>'revision')::integer then
        raise exception using errcode='40001', message='The meal has changed';
      end if;
      if replaced.state='eaten' then
        perform public.revise_day_item(pg_catalog.md5(p_request_id::text || ':remove:' || replaced.id)::uuid,
          p_local_date,replaced.id,replaced.revision,'remove');
      else
        perform public.remove_planned_day_item(pg_catalog.md5(p_request_id::text || ':remove:' || replaced.id)::uuid,
          p_local_date,replaced.id,replaced.revision);
      end if;
    end loop;
  end if;

  if p_replace_item_id is not null then
    select * into replaced from public.day_items as item
      where item.user_id=actor and item.id=p_replace_item_id and item.local_date=p_local_date for update;
    if not found or replaced.revision is distinct from p_expected_revision or replaced.state not in ('planned','eaten')
      or coalesce(replaced.eaten_snapshot->'logging'->>'kind',replaced.planned_payload->'logging'->>'kind','') <> 'calorie_block'
      or (replaced.state='eaten' and p_state<>'eaten') then
      raise exception using errcode='40001', message='Calorie block has changed or is unavailable';
    end if;
    group_id := coalesce(replaced.meal_group_id,replaced.id);
    section := replaced.section;
    if replaced.state='eaten' then
      perform public.revise_day_item(pg_catalog.md5(p_request_id::text || ':remove')::uuid,
        p_local_date,replaced.id,replaced.revision,'remove');
    else
      perform public.remove_planned_day_item(pg_catalog.md5(p_request_id::text || ':remove')::uuid,
        p_local_date,replaced.id,replaced.revision);
    end if;
  end if;

  for entry in select value from jsonb_array_elements(p_items)
  loop
    item_index := item_index + 1;
    payload := entry->'payload';
    logging := coalesce(entry->'logging','{}'::jsonb);
    if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(logging) is distinct from 'object'
      or (logging->>'kind'='calorie_block' and (jsonb_array_length(p_items)<>1 or payload->>'caloriesKcal' is null)) then
      raise exception using errcode='22023', message='Food or calorie block is invalid';
    end if;

    if stores_series and (
      coalesce(entry->>'unit','') <> coalesce(payload->>'basisUnit','')
      or length(trim(coalesce(entry->>'unit',''))) not between 1 and 24
      or (payload->>'basisAmount')::numeric is distinct from 1
      or length(trim(coalesce(payload->>'name',''))) not between 1 and 160
      or (entry->>'amount')::numeric is null or (entry->>'amount')::numeric not between 0.0001 and 99999999.9999
      or jsonb_typeof(payload->'nutrients') is distinct from 'object'
      or (payload->>'caloriesKcal')::numeric < 0 or (payload->>'caloriesKcal')::numeric >= 100000000
      or exists (select 1 from jsonb_each(payload->'nutrients') as nutrient(key,value)
        where jsonb_typeof(nutrient.value) not in ('number','null')
          or case when jsonb_typeof(nutrient.value)='number'
            then (nutrient.value::text)::numeric not between 0 and 99999999.999999 else false end
          or not exists (select 1 from public.nutrient_fields as field where field.user_id=actor and field.field_id=nutrient.key and field.archived_at is null))
    ) then
      raise exception using errcode='22023', message='Recurring food values are invalid';
    end if;

    logging := logging || jsonb_build_object('position',item_index);
    if entry ? 'variant' then
      variant_id := private.save_logging_variant(actor,entry->'variant',pg_catalog.md5(p_request_id::text || ':food:' || item_index)::uuid);
      logging := logging || jsonb_build_object('foodId',variant_id);
    end if;

    if stores_series then
      series_entries := series_entries || jsonb_build_array((entry - 'variant') || jsonb_build_object('logging',logging,'section',section));
    else
      item_request := pg_catalog.md5(p_request_id::text || ':item:' || item_index)::uuid;
      if p_state='planned' then
        result := public.calendar_plan_day_item(item_request,p_local_date,section,'one_off_food',null,
          (entry->>'amount')::numeric,entry->>'unit',payload);
      else
        result := public.calendar_log_day_item(item_request,p_local_date,section,'one_off_food',null,
          (entry->>'amount')::numeric,entry->>'unit',payload);
      end if;
      entry_id := (result->>'item_id')::uuid;
      perform public.assign_calendar_meal_group(entry_id,group_id,p_local_date,section,payload->>'brand',null);
      update public.day_items as item set
        planned_payload=case when item.state='planned' then item.planned_payload || jsonb_build_object('logging',logging) else item.planned_payload end,
        eaten_snapshot=case when item.state='eaten' then item.eaten_snapshot || jsonb_build_object('logging',logging) else item.eaten_snapshot end
        where item.user_id=actor and item.id=entry_id;
      saved_ids := saved_ids || jsonb_build_array(entry_id);
    end if;
    insert into public.user_food_portion_preferences(user_id,food_kind,food_id,amount,unit)
    select actor,'library',food.id,(entry->>'amount')::numeric,entry->>'unit'
      from public.foods as food where food.user_id=actor and food.id=nullif(logging->>'foodId','')::uuid
    union all
    select actor,'catalogue',food.id,(entry->>'amount')::numeric,entry->>'unit'
      from public.catalog_foods as food
      where logging->>'foodId' is null and food.id=nullif(logging->>'catalogueFoodId','')::uuid
    on conflict (user_id,food_kind,food_id) do update
      set amount=excluded.amount, unit=excluded.unit, updated_at=now();
  end loop;

  if p_series_edit is not null then
    perform private.change_calendar_series(series,p_request_id,p_local_date,series_scope,p_state='removed',series_entries);
  elsif p_recurrence is not null then
    insert into public.calendar_meal_series(id,user_id,starts_on,ends_on,frequency,repeat_interval,weekdays,entries)
      values(p_request_id,actor,p_local_date,repeat_until,p_recurrence->>'frequency',repeat_interval,repeat_days,series_entries);
  end if;

  result := jsonb_build_object('item_ids',saved_ids,'meal_group_id',group_id);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor,p_request_id,'save_calendar_composer',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_calendar_composer(uuid,date,text,jsonb,uuid,integer,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_calendar_composer(uuid,date,text,jsonb,uuid,integer,jsonb,jsonb,jsonb) to authenticated;

alter table public.day_item_history drop constraint day_item_history_action_check;
alter table public.day_item_history add constraint day_item_history_action_check
  check (action in ('edited','removed','restored','replaced','replanned'));

-- A reverted log keeps its captured nutrition and can be logged again directly.
create function public.set_calendar_meal_state(
  p_request_id uuid, p_local_date date, p_state text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := encode(extensions.digest(convert_to(
    jsonb_build_array(p_local_date,p_state,p_items)::text,'UTF8'),'sha256'),'hex');
  prior public.mutation_receipts%rowtype;
  entry public.day_items%rowtype;
  group_id uuid;
  expected_state public.day_item_state;
  destination public.day_item_state;
  reference jsonb;
  snapshot jsonb;
  result jsonb;
begin
  if actor is null then raise exception using errcode='28000', message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or coalesce(p_state,'') not in ('planned','eaten')
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode='22023', message='A date, state, and meal are required';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode='22023', message='Choose one meal to update';
  end if;
  expected_state := case when p_state='planned' then 'eaten' else 'planned' end;
  destination := p_state::public.day_item_state;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_request_id::text,0));
  select * into prior from public.mutation_receipts where user_id=actor and request_id=p_request_id;
  if found then
    if prior.operation<>'set_calendar_meal_state' or prior.input_fingerprint<>fingerprint then
      raise exception using errcode='22023', message='Request ID was already used with different input';
    end if;
    return prior.result;
  end if;

  if destination='eaten' and not exists (
    select 1 from public.profiles where user_id=actor and p_local_date<=(now() at time zone timezone)::date
  ) then raise exception using errcode='22023', message='Future dates are planning-only'; end if;

  perform 1 from public.days where user_id=actor and local_date=p_local_date and status='open' for update;
  if not found then raise exception using errcode='40001', message='The calendar date is unavailable or complete'; end if;

  select coalesce(item.meal_group_id,item.id) into group_id from public.day_items as item
    where item.user_id=actor and item.local_date=p_local_date and item.id=(p_items->0->>'id')::uuid
      and item.state=expected_state;
  if group_id is null or (select count(*) from public.day_items as item
    where item.user_id=actor and item.local_date=p_local_date
      and coalesce(item.meal_group_id,item.id)=group_id and item.state<>'removed') <> jsonb_array_length(p_items) then
    raise exception using errcode='40001', message='The meal has changed';
  end if;

  for reference in select value from jsonb_array_elements(p_items)
  loop
    select * into entry from public.day_items as item
      where item.user_id=actor and item.local_date=p_local_date and coalesce(item.meal_group_id,item.id)=group_id
        and item.id=(reference->>'id')::uuid and item.state=expected_state for update;
    if not found or entry.revision is distinct from (reference->>'revision')::integer then
      raise exception using errcode='40001', message='The meal has changed';
    end if;
    snapshot := case when destination='planned' then entry.eaten_snapshot else entry.planned_payload->'frozen_snapshot' end;
    if jsonb_typeof(snapshot) is distinct from 'object' then
      raise exception using errcode='40001', message='The saved meal details are unavailable';
    end if;
    -- Some planned snapshots are copied to another date. Their history starts when logged.
    if destination='planned' then
      insert into public.day_item_history(user_id,item_id,item_revision,action,state,selected_amount,selected_unit,eaten_snapshot)
        values(actor,entry.id,entry.revision,'replanned',entry.state,entry.selected_amount,entry.selected_unit,snapshot);
    end if;
    update public.day_items as item set
      state=destination,
      planned_payload=case when destination='planned' then entry.planned_payload || jsonb_build_object(
        'name',snapshot->>'name','frozen_snapshot',snapshot)
        else entry.planned_payload - 'frozen_snapshot' end,
      eaten_snapshot=case when destination='eaten' then snapshot else null end,
      eaten_at=case when destination='eaten' then now() else null end,
      revision=entry.revision+1,updated_at=now()
      where item.user_id=actor and item.id=entry.id;
  end loop;

  update public.days set log_revision=log_revision+1,revision=revision+1,updated_at=now()
    where user_id=actor and local_date=p_local_date;
  result := jsonb_build_object('meal_group_id',group_id,'state',destination);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor,p_request_id,'set_calendar_meal_state',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.set_calendar_meal_state(uuid,date,text,jsonb) from public,anon;
grant execute on function public.set_calendar_meal_state(uuid,date,text,jsonb) to authenticated;
