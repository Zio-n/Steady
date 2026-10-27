create or replace function public.plan_day_item(
  p_request_id uuid,
  p_local_date date,
  p_section public.meal_section,
  p_source_kind text,
  p_source_id uuid,
  p_amount numeric,
  p_unit text,
  p_manual_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_timezone text;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  day_row public.days%rowtype;
  item_row public.day_items%rowtype;
  source_table public.day_item_source;
  item_name text;
  component jsonb;
  component_food public.foods%rowtype;
  result jsonb;
  next_day_revision integer;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_section is null
    or p_source_kind not in ('food','meal','one_off_food','one_off_meal')
    or p_amount is null or p_amount<=0 or p_amount>=100000000
    or p_unit is null or length(trim(p_unit)) not between 1 and 24 then
    raise exception using errcode='22023',message='A valid date, source, section and positive portion are required';
  end if;
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before planning food'; end if;
  if p_local_date<=(now() at time zone account_timezone)::date then
    raise exception using errcode='22023',message='Only future dates can be saved as plans';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,
    'amount',p_amount,'unit',trim(p_unit),'manual_payload',p_manual_payload
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'plan_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  day_row := private.ensure_day_for_log(actor_id,p_local_date);
  if day_row.status<>'open' then raise exception using errcode='40001',message='This day is complete and cannot accept a plan'; end if;
  if p_source_kind='food' then
    if p_source_id is null or p_manual_payload is not null then raise exception using errcode='22023',message='Saved food reference is invalid'; end if;
    select food.* into component_food from public.foods as food where food.user_id=actor_id and food.id=p_source_id and food.archived_at is null;
    if not found then raise exception using errcode='23503',message='Food is no longer active'; end if;
    if private.convert_food_amount(p_amount,p_unit,component_food.basis_unit,component_food.grams_per_serving) is null then
      raise exception using errcode='22023',message='Food portion uses incompatible units';
    end if;
    item_name := component_food.name;
    source_table := 'food';
  elsif p_source_kind='meal' then
    if p_source_id is null or p_manual_payload is not null or lower(trim(p_unit)) not in ('serving','servings') then
      raise exception using errcode='22023',message='Saved meal reference or portion is invalid';
    end if;
    select meal.name into item_name from public.meals as meal where meal.user_id=actor_id and meal.id=p_source_id and meal.archived_at is null;
    if not found then raise exception using errcode='23503',message='Meal is no longer active'; end if;
    if not exists(select 1 from public.meal_components as meal_component where meal_component.user_id=actor_id and meal_component.meal_id=p_source_id) then
      raise exception using errcode='22023',message='A meal needs at least one active component';
    end if;
    for component in select jsonb_build_object('food_id',meal_component.food_id,'amount',meal_component.amount,'unit',meal_component.unit)
      from public.meal_components as meal_component where meal_component.user_id=actor_id and meal_component.meal_id=p_source_id
    loop
      select food.* into component_food from public.foods as food
        where food.user_id=actor_id and food.id=(component->>'food_id')::uuid and food.archived_at is null;
      if not found or private.convert_food_amount((component->>'amount')::numeric,component->>'unit',component_food.basis_unit,component_food.grams_per_serving) is null then
        raise exception using errcode='22023',message='A meal component is no longer available or has incompatible units';
      end if;
    end loop;
    source_table := 'meal';
  elsif p_source_kind='one_off_food' then
    if p_source_id is not null or p_manual_payload is null or jsonb_typeof(p_manual_payload)<>'object'
      or jsonb_typeof(p_manual_payload->'nutrients')<>'object' then
      raise exception using errcode='22023',message='One-off food data is invalid';
    end if;
    item_name := nullif(trim(p_manual_payload->>'name'),'');
    begin
      component_food.basis_amount := (p_manual_payload->>'basisAmount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='One-off food basis is invalid';
    end;
    component_food.basis_unit := trim(p_manual_payload->>'basisUnit');
    if item_name is null or length(item_name)>160 or component_food.basis_amount is null or component_food.basis_amount<=0
      or component_food.basis_amount>=100000000 or length(component_food.basis_unit) not between 1 and 24
      or private.convert_food_amount(p_amount,p_unit,component_food.basis_unit,null) is null then
      raise exception using errcode='22023',message='One-off food name, basis or portion is invalid';
    end if;
    if p_manual_payload->'caloriesKcal' is not null and p_manual_payload->'caloriesKcal'<>'null'::jsonb
      and (jsonb_typeof(p_manual_payload->'caloriesKcal')<>'number'
        or ((p_manual_payload->>'caloriesKcal')::numeric<0 or (p_manual_payload->>'caloriesKcal')::numeric>=100000000)) then
      raise exception using errcode='22023',message='One-off calories are invalid';
    end if;
    if exists(select 1 from jsonb_each(p_manual_payload->'nutrients') as nutrient(field_id,value)
      where jsonb_typeof(nutrient.value) not in ('number','null')
        or (jsonb_typeof(nutrient.value)='number' and ((nutrient.value::text)::numeric<0 or (nutrient.value::text)::numeric>=100000000))
        or not exists(select 1 from public.nutrient_fields as field where field.user_id=actor_id and field.field_id=nutrient.field_id and field.archived_at is null)) then
      raise exception using errcode='22023',message='One-off nutrient values are invalid';
    end if;
    source_table := 'food';
  else
    if p_source_id is not null or p_manual_payload is null or jsonb_typeof(p_manual_payload)<>'object'
      or jsonb_typeof(p_manual_payload->'components')<>'array' or jsonb_array_length(p_manual_payload->'components') not between 1 and 100
      or lower(trim(p_unit)) not in ('serving','servings') then
      raise exception using errcode='22023',message='One-off meal data or portion is invalid';
    end if;
    item_name := nullif(trim(p_manual_payload->>'name'),'');
    if item_name is null or length(item_name)>160 then raise exception using errcode='22023',message='One-off meal name is invalid'; end if;
    for component in select value from jsonb_array_elements(p_manual_payload->'components') as rows(value)
    loop
      begin
        component_food.id := (component->>'food_id')::uuid;
        component_food.basis_amount := (component->>'amount')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode='22023',message='One-off meal component is invalid';
      end;
      component_food.basis_unit := trim(component->>'unit');
      if component_food.basis_amount is null or component_food.basis_amount<=0 or component_food.basis_amount>=100000000
        or length(component_food.basis_unit) not between 1 and 24 then
        raise exception using errcode='22023',message='One-off meal component amount is invalid';
      end if;
      select food.* into component_food from public.foods as food
        where food.user_id=actor_id and food.id=component_food.id and food.archived_at is null;
      if not found or private.convert_food_amount((component->>'amount')::numeric,component->>'unit',component_food.basis_unit,component_food.grams_per_serving) is null then
        raise exception using errcode='22023',message='A one-off meal component is unavailable or has incompatible units';
      end if;
    end loop;
    source_table := 'meal';
  end if;

  insert into public.day_items(user_id,local_date,section,state,source,selected_amount,selected_unit,planned_payload,eaten_snapshot,eaten_at)
    values(actor_id,p_local_date,p_section,'planned',source_table,p_amount,trim(p_unit),jsonb_build_object(
      'name',item_name,'source_kind',p_source_kind,'source_id',p_source_id,'amount',p_amount,'unit',trim(p_unit),
      'manual_payload',p_manual_payload
    ),null,null) returning * into item_row;
  update public.days as day set revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning day.revision into next_day_revision;
  select jsonb_build_object('item_id',item_row.id,'item_revision',item_row.revision,'day_revision',next_day_revision,
    'planned_count',count(*)) into result from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date and item.state='planned';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'plan_day_item',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) from public,anon;
grant execute on function public.plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) to authenticated;
comment on function public.plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) is
  'Persists a future-only planned item after validating its source and portion; planned values are not eaten snapshots or calorie intake.';

create or replace function public.remove_planned_day_item(
  p_request_id uuid,p_local_date date,p_item_id uuid,p_expected_item_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  item_row public.day_items%rowtype;
  day_revision integer;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_expected_item_revision is null or p_expected_item_revision<1 then
    raise exception using errcode='22023',message='A request, date, item and revision are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'remove_planned_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;
  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;
  select item.* into item_row from public.day_items as item where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'planned' or item_row.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This plan changed; refresh and review before removing it';
  end if;
  update public.day_items as item set state='removed',revision=item.revision+1,updated_at=now()
    where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  update public.days as day set revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning day.revision into day_revision;
  select jsonb_build_object('item_id',p_item_id,'item_revision',item_row.revision,'day_revision',day_revision,'planned_count',count(*))
    into result from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date and item.state='planned';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'remove_planned_day_item',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.remove_planned_day_item(uuid,date,uuid,integer) from public,anon;
grant execute on function public.remove_planned_day_item(uuid,date,uuid,integer) to authenticated;
comment on function public.remove_planned_day_item(uuid,date,uuid,integer) is
  'Soft-removes an open-day planned item under a revision check and idempotent request receipt.';
