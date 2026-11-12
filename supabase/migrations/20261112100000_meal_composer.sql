alter table public.foods
  add column logging_details jsonb,
  add column logging_variant_key text;

create unique index foods_logging_variant_key
  on public.foods(user_id, logging_variant_key)
  where archived_at is null and logging_variant_key is not null;

-- Library edits change the basis of a variant. Keep its historical snapshots,
-- but stop using its old identity and value details for future matching.
create function private.clear_edited_logging_details()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.revision is distinct from old.revision then
    new.logging_variant_key := null;
    new.logging_details := null;
  end if;
  return new;
end;
$$;

create trigger clear_edited_logging_details
  before update of revision on public.foods
  for each row execute function private.clear_edited_logging_details();

create function private.save_logging_variant(p_actor uuid, p_variant jsonb, p_request uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  variant_key text := pg_catalog.md5(p_variant::text);
  food_id uuid;
  catalogue_id uuid := nullif(p_variant->'logging'->>'catalogueFoodId', '')::uuid;
  parent_id uuid := nullif(p_variant->'logging'->>'foodId', '')::uuid;
  result jsonb;
begin
  if parent_id is not null and not exists (
    select 1 from public.foods as food where food.user_id=p_actor and food.id=parent_id
  ) then
    raise exception using errcode='23503', message='Original private food is unavailable';
  end if;

  if catalogue_id is not null and not exists (
    select 1 from public.catalog_foods as food where food.id=catalogue_id
  ) then
    raise exception using errcode='23503', message='Original catalogue food is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text || 'variant:' || variant_key, 0));
  select food.id into food_id from public.foods as food
    where food.user_id=p_actor and food.logging_variant_key=variant_key and food.archived_at is null;
  if found then return food_id; end if;

  result := public.save_food(
    p_request, null, null, p_variant->>'name', p_variant->>'brand',
    (p_variant->>'basisAmount')::numeric, p_variant->>'basisUnit',
    null, (p_variant->>'basisAmount')::numeric, p_variant->>'basisUnit',
    (p_variant->>'caloriesKcal')::numeric, p_variant->'nutrients'
  );
  food_id := (result->>'id')::uuid;

  update public.foods as food set logging_variant_key=variant_key, logging_details=p_variant->'logging'
    where food.user_id=p_actor and food.id=food_id;
  if catalogue_id is not null then
    insert into public.food_catalogue_origins(user_id, food_id, catalog_food_id, is_personally_adjusted)
      values (p_actor, food_id, catalogue_id, true);
  end if;
  return food_id;
end;
$$;
revoke all on function private.save_logging_variant(uuid,jsonb,uuid) from public,anon,authenticated;

create table public.calendar_meal_series (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_on date not null,
  ends_on date,
  frequency text not null check (frequency in ('daily','weekly')),
  repeat_interval integer not null check (repeat_interval between 1 and 365),
  weekdays integer[] not null,
  entries jsonb not null check (jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 1 and 50),
  revision integer not null default 1,
  archived_at timestamptz,
  unique (user_id,id),
  check (ends_on is null or ends_on >= starts_on)
);

create index calendar_meal_series_active
  on public.calendar_meal_series(user_id,starts_on) where archived_at is null;

create table public.calendar_meal_series_exceptions (
  user_id uuid not null,
  series_id uuid not null,
  local_date date not null,
  primary key (user_id,series_id,local_date),
  foreign key (user_id,series_id) references public.calendar_meal_series(user_id,id) on delete cascade
);

alter table public.calendar_meal_series enable row level security;
alter table public.calendar_meal_series_exceptions enable row level security;
create policy read_own_series on public.calendar_meal_series for select to authenticated using (user_id=(select auth.uid()));
create policy read_own_series_exceptions on public.calendar_meal_series_exceptions for select to authenticated using (user_id=(select auth.uid()));
grant select on public.calendar_meal_series, public.calendar_meal_series_exceptions to authenticated;
revoke insert, update, delete, truncate on public.calendar_meal_series, public.calendar_meal_series_exceptions from anon, authenticated;

create function private.series_matches_date(p_series public.calendar_meal_series, p_date date)
returns boolean language sql immutable set search_path = '' as $$
  select p_series.archived_at is null and p_date >= p_series.starts_on and (p_series.ends_on is null or p_date <= p_series.ends_on)
    and case when p_series.frequency='daily' then (p_date-p_series.starts_on) % p_series.repeat_interval = 0
      else extract(isodow from p_date)::integer=any(p_series.weekdays)
        and ((p_date - date_trunc('week',p_series.starts_on::timestamp)::date) / 7) % p_series.repeat_interval = 0 end;
$$;
revoke all on function private.series_matches_date(public.calendar_meal_series,date) from public,anon,authenticated;

create function private.add_series_to_calendar_day(p_day jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  actor uuid := auth.uid();
  local_day date := (p_day->>'local_date')::date;
  occurrences jsonb;
begin
  if p_day->'day'->>'status'='completed' then return p_day; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',pg_catalog.md5(series.id::text || ':' || local_day::text || ':' || entry.position)::uuid,
    'meal_group_id',pg_catalog.md5(series.id::text || ':' || local_day::text)::uuid,
    'series_id',series.id,'series_revision',series.revision,
    'section',entry.value->>'section','state','planned','source','food',
    'selected_amount',entry.value->'amount','selected_unit',entry.value->'unit',
    'planned_payload',jsonb_build_object(
      'name',entry.value->'payload'->'name','source_kind','one_off_food','source_id',null,
      'amount',entry.value->'amount','unit',entry.value->'unit','manual_payload',entry.value->'payload',
      'logging',entry.value->'logging'),
    'eaten_snapshot',null,'eaten_at',null,'revision',series.revision
  ) order by series.id, entry.position),'[]'::jsonb) into occurrences
  from public.calendar_meal_series as series
  cross join lateral jsonb_array_elements(series.entries) with ordinality as entry(value,position)
  where series.user_id=actor and private.series_matches_date(series,local_day)
    and not exists (select 1 from public.calendar_meal_series_exceptions as exception
      where exception.user_id=actor and exception.series_id=series.id and exception.local_date=local_day);
  return jsonb_set(p_day,'{items}',p_day->'items' || occurrences);
end;
$$;
revoke all on function private.add_series_to_calendar_day(jsonb) from public,anon,authenticated;

create function public.read_calendar_day_with_series(p_local_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.add_series_to_calendar_day(public.read_calendar_day(p_local_date));
$$;
create function public.read_calendar_range_with_series(p_from_date date,p_to_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.add_series_to_calendar_day(day) order by day->>'local_date'),'[]'::jsonb)
    from jsonb_array_elements(public.read_calendar_range(p_from_date,p_to_date)) as days(day);
$$;
revoke all on function public.read_calendar_day_with_series(date), public.read_calendar_range_with_series(date,date) from public,anon;
grant execute on function public.read_calendar_day_with_series(date), public.read_calendar_range_with_series(date,date) to authenticated;

-- Overrides and eaten entries are materialized only by an explicit write.
-- Moving the future exceptions with a split preserves skips and consumed occurrences.
create function private.change_calendar_series(
  p_series public.calendar_meal_series, p_request uuid, p_date date, p_scope text, p_remove boolean, p_entries jsonb
)
returns void language plpgsql set search_path = '' as $$
begin
  if p_scope='one' then
    insert into public.calendar_meal_series_exceptions(user_id,series_id,local_date)
      values(p_series.user_id,p_series.id,p_date);
  elsif p_scope='all' or p_date=p_series.starts_on then
    if p_remove then
      update public.calendar_meal_series set archived_at=now(),revision=revision+1 where id=p_series.id;
    else
      update public.calendar_meal_series set entries=p_entries,revision=revision+1 where id=p_series.id;
    end if;
  else
    update public.calendar_meal_series set ends_on=p_date-1,revision=revision+1 where id=p_series.id;
    if not p_remove then
      insert into public.calendar_meal_series(id,user_id,starts_on,ends_on,frequency,repeat_interval,weekdays,entries)
        values(p_request,p_series.user_id,p_date,p_series.ends_on,p_series.frequency,p_series.repeat_interval,p_series.weekdays,p_entries);
      update public.calendar_meal_series_exceptions set series_id=p_request
        where user_id=p_series.user_id and series_id=p_series.id and local_date>=p_date;
    end if;
  end if;
end;
$$;
revoke all on function private.change_calendar_series(public.calendar_meal_series,uuid,date,text,boolean,jsonb) from public,anon,authenticated;

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
    select item.meal_group_id,item.section into replacement_group,section from public.day_items as item
      where item.user_id=actor and item.local_date=p_local_date
        and item.id=(p_replace_group->0->>'id')::uuid and item.state='planned';
    if replacement_group is null or
      (select count(*) from public.day_items as item where item.user_id=actor and item.local_date=p_local_date
        and item.meal_group_id=replacement_group and item.state<>'removed') <> jsonb_array_length(p_replace_group) then
      raise exception using errcode='40001', message='The planned meal has changed';
    end if;
    group_id := replacement_group;
    for replacement in select value from jsonb_array_elements(p_replace_group)
    loop
      select * into replaced from public.day_items as item
        where item.user_id=actor and item.local_date=p_local_date and item.meal_group_id=replacement_group
          and item.id=(replacement->>'id')::uuid and item.state='planned' and item.planned_payload ? 'logging' for update;
      if not found or replaced.revision is distinct from (replacement->>'revision')::integer then
        raise exception using errcode='40001', message='The planned meal has changed';
      end if;
      perform public.remove_planned_day_item(pg_catalog.md5(p_request_id::text || ':remove:' || replaced.id)::uuid,
        p_local_date,replaced.id,replaced.revision);
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
