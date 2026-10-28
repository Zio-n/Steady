-- Calendar mutations preserve source validation and nutrition capture while replacing
-- the legacy week/routine day materialisation path. Separate names keep old clients working.
create or replace function public.calendar_plan_day_item(
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
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,
    'amount',p_amount,'unit',trim(p_unit),'manual_payload',p_manual_payload
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'calendar_plan_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  day_row := private.ensure_calendar_day_for_entry(actor_id,p_local_date);
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
    values(actor_id,p_request_id,'calendar_plan_day_item',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.calendar_plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) from public,anon;
grant execute on function public.calendar_plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) to authenticated;

create or replace function public.calendar_log_day_item(
  p_request_id uuid,
  p_local_date date,
  p_section public.meal_section,
  p_source_kind text,
  p_source_id uuid,
  p_amount numeric,
  p_unit text,
  p_manual_payload jsonb default null,
  p_planned_item_id uuid default null,
  p_expected_item_revision integer default null
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
  parent_name text;
  source_table public.day_item_source;
  component_rows jsonb := '[]'::jsonb;
  component_row jsonb;
  component_id uuid;
  component_amount numeric;
  component_unit text;
  component_nutrition jsonb;
  component_count integer := 0;
  calorie_total numeric := 0;
  calorie_known integer := 0;
  nutrient_totals jsonb := '{}'::jsonb;
  nutrient_row record;
  metric_value numeric;
  known_count integer;
  portion_multiplier numeric := 1;
  snapshot jsonb;
  result jsonb;
  new_revision integer;
  entry_source text := p_source_kind;
  entry_amount numeric := p_amount;
  entry_unit text := p_unit;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_section is null then raise exception using errcode='22023',message='Request, date and meal section are required'; end if;
  if coalesce(p_source_kind,'') not in ('food','meal','one_off_food','one_off_meal') then raise exception using errcode='22023',message='Unknown item source'; end if;
  if p_amount is null or p_amount<=0 or p_amount>=100000000 or p_unit is null or length(trim(p_unit)) not between 1 and 24 then raise exception using errcode='22023',message='Portion amount or unit is invalid'; end if;
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before logging'; end if;
  if p_local_date>(now() at time zone account_timezone)::date then raise exception using errcode='22023',message='Future dates are planning-only'; end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'date',p_local_date,'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,
    'amount',p_amount,'unit',trim(p_unit),'manual_payload',p_manual_payload,
    'planned_item_id',p_planned_item_id,'expected_item_revision',p_expected_item_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'calendar_log_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  day_row := private.ensure_calendar_day_for_entry(actor_id,p_local_date);
  if day_row.status<>'open' then raise exception using errcode='40001',message='This day is complete; reopen it through the correction flow before logging'; end if;
  if p_planned_item_id is not null then
    if p_expected_item_revision is null or p_expected_item_revision<1 then raise exception using errcode='22023',message='A planned item revision is required'; end if;
    select item.* into item_row from public.day_items as item where item.user_id=actor_id and item.id=p_planned_item_id and item.local_date=p_local_date for update;
    if not found or item_row.state<>'planned' or item_row.revision<>p_expected_item_revision then raise exception using errcode='40001',message='Planned item changed or is no longer available'; end if;
    if item_row.section<>p_section or coalesce(item_row.planned_payload->>'source_kind','')<>p_source_kind
      or nullif(item_row.planned_payload->>'source_id','')::uuid is distinct from p_source_id
      or coalesce((item_row.planned_payload->>'amount')::numeric,-1)<>p_amount
      or coalesce(item_row.planned_payload->>'unit','')<>trim(p_unit) then
      raise exception using errcode='40001',message='The item no longer matches its accepted plan; refresh and review it';
    end if;
    entry_amount := coalesce(item_row.selected_amount,p_amount);
    entry_unit := coalesce(item_row.selected_unit,p_unit);
  elsif p_expected_item_revision is not null then
    raise exception using errcode='22023',message='A new log entry cannot include an item revision';
  end if;

  if p_source_kind='food' then
    if p_source_id is null or p_manual_payload is not null then raise exception using errcode='22023',message='Saved food reference is invalid'; end if;
    source_table := 'food';
    select food.name into parent_name from public.foods as food where food.user_id=actor_id and food.id=p_source_id and food.archived_at is null;
    if not found then raise exception using errcode='23503',message='Food is no longer active'; end if;
    component_nutrition := private.capture_food_component(actor_id,p_source_id,p_amount,p_unit,1);
    component_rows := jsonb_build_array(component_nutrition);
    calorie_total := (component_nutrition->'calories'->>'value')::numeric;
    calorie_known := 1;
    nutrient_totals := component_nutrition->'nutrients';
  elsif p_source_kind in ('meal','one_off_meal') then
    source_table := 'meal';
    if p_source_kind='meal' then
      if p_source_id is null or p_manual_payload is not null then raise exception using errcode='22023',message='Saved meal reference is invalid'; end if;
      select meal.name into parent_name from public.meals as meal where meal.user_id=actor_id and meal.id=p_source_id and meal.archived_at is null;
      if not found then raise exception using errcode='23503',message='Meal is no longer active'; end if;
      if lower(trim(p_unit)) not in ('serving','servings') then raise exception using errcode='22023',message='Saved meal portions use servings'; end if;
      for component_row in select jsonb_build_object('food_id',component.food_id,'amount',component.amount,'unit',component.unit)
        from public.meal_components as component where component.user_id=actor_id and component.meal_id=p_source_id order by component.position
      loop
        component_id := (component_row->>'food_id')::uuid;
        component_amount := (component_row->>'amount')::numeric;
        component_unit := component_row->>'unit';
        component_nutrition := private.capture_food_component(actor_id,component_id,component_amount,component_unit,p_amount);
        component_rows := component_rows || jsonb_build_array(component_nutrition);
        component_count := component_count+1;
      end loop;
    else
      if p_source_id is not null or p_manual_payload is null or jsonb_typeof(p_manual_payload)<>'object'
        or jsonb_typeof(p_manual_payload->'components')<>'array' or jsonb_array_length(p_manual_payload->'components') not between 1 and 100 then
        raise exception using errcode='22023',message='One-off meal components are invalid';
      end if;
      parent_name := nullif(trim(p_manual_payload->>'name'),'');
      if parent_name is null or length(parent_name)>160 or lower(trim(p_unit)) not in ('serving','servings') then raise exception using errcode='22023',message='One-off meal name or portion is invalid'; end if;
      for component_row in select value from jsonb_array_elements(p_manual_payload->'components') as rows(value)
      loop
        begin
          component_id := (component_row->>'food_id')::uuid;
          component_amount := (component_row->>'amount')::numeric;
        exception when invalid_text_representation or numeric_value_out_of_range then
          raise exception using errcode='22023',message='One-off meal component is invalid';
        end;
        component_unit := trim(component_row->>'unit');
        component_nutrition := private.capture_food_component(actor_id,component_id,component_amount,component_unit,p_amount);
        component_rows := component_rows || jsonb_build_array(component_nutrition);
        component_count := component_count+1;
      end loop;
    end if;
    if component_count=0 then raise exception using errcode='22023',message='A meal needs at least one component'; end if;
    select coalesce(sum((component->'calories'->>'value')::numeric),0),count(*) filter(where component->'calories'->>'value' is not null)
      into calorie_total,calorie_known from jsonb_array_elements(component_rows) as component;
    if calorie_known<>component_count then raise exception using errcode='22023',message='Every meal component needs known calories before logging'; end if;
    select coalesce(jsonb_object_agg(field.field_id,jsonb_build_object(
      'name',field.name,'unit',field.unit,'value',aggregate.known_value,'complete',aggregate.known_count=component_count,
      'knownComponents',aggregate.known_count,'totalComponents',component_count
    ) order by field.display_order),'{}'::jsonb)
      into nutrient_totals
      from public.nutrient_fields as field
      cross join lateral (
        select sum((component.value->'nutrients'->field.field_id->>'value')::numeric) filter(where component.value->'nutrients'->field.field_id->>'value' is not null) as known_value,
          count(*) filter(where component.value->'nutrients'->field.field_id->>'value' is not null) as known_count
        from jsonb_array_elements(component_rows) as component(value)
      ) as aggregate
      where field.user_id=actor_id and field.archived_at is null;
  elsif p_source_kind='one_off_food' then
    source_table := 'food';
    if p_source_id is not null or p_manual_payload is null or jsonb_typeof(p_manual_payload)<>'object' then raise exception using errcode='22023',message='One-off food data is invalid'; end if;
    parent_name := nullif(trim(p_manual_payload->>'name'),'');
    if parent_name is null or length(parent_name)>160 then raise exception using errcode='22023',message='One-off food name is invalid'; end if;
    begin
      component_amount := (p_manual_payload->>'basisAmount')::numeric;
      metric_value := nullif(p_manual_payload->>'caloriesKcal','')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='One-off food nutrition is invalid';
    end;
    component_unit := trim(p_manual_payload->>'basisUnit');
    if component_amount is null or component_amount<=0 or component_amount>=100000000 or length(component_unit) not between 1 and 24 then raise exception using errcode='22023',message='One-off food basis is invalid'; end if;
    if metric_value is null then raise exception using errcode='22023',message='Calories must be known before logging'; end if;
    component_amount := private.convert_food_amount(p_amount,p_unit,component_unit,null);
    if component_amount is null then raise exception using errcode='22023',message='One-off food portion uses incompatible units'; end if;
    portion_multiplier := component_amount/(p_manual_payload->>'basisAmount')::numeric;
    calorie_total := metric_value*portion_multiplier;
    calorie_known := 1;
    if jsonb_typeof(p_manual_payload->'nutrients')<>'object' then raise exception using errcode='22023',message='One-off nutrient values are invalid'; end if;
    if exists (
      select 1 from jsonb_each(p_manual_payload->'nutrients') as values(field_id,value)
      where jsonb_typeof(values.value) not in ('number','null')
        or (jsonb_typeof(values.value)='number' and ((values.value::text)::numeric<0 or (values.value::text)::numeric>=100000000))
        or not exists(select 1 from public.nutrient_fields as field where field.user_id=actor_id and field.field_id=values.field_id and field.archived_at is null)
    ) then raise exception using errcode='22023',message='One-off nutrient values are invalid'; end if;
    select coalesce(jsonb_object_agg(field.field_id,jsonb_build_object(
      'name',field.name,'unit',field.unit,'value',case when p_manual_payload->'nutrients' ? field.field_id and p_manual_payload->'nutrients'->field.field_id<>'null'::jsonb then (p_manual_payload->'nutrients'->>field.field_id)::numeric*portion_multiplier else null end,
      'complete',p_manual_payload->'nutrients' ? field.field_id and p_manual_payload->'nutrients'->field.field_id<>'null'::jsonb,
      'knownComponents',case when p_manual_payload->'nutrients' ? field.field_id and p_manual_payload->'nutrients'->field.field_id<>'null'::jsonb then 1 else 0 end,'totalComponents',1
    ) order by field.display_order),'{}'::jsonb) into nutrient_totals
      from public.nutrient_fields as field where field.user_id=actor_id and field.archived_at is null;
    component_rows := jsonb_build_array(jsonb_build_object(
      'food_name',parent_name,'amount',p_amount,'unit',p_unit,
      'basis_amount',p_manual_payload->>'basisAmount','basis_unit',component_unit,'grams_per_serving',null,
      'calories_per_basis',metric_value,
      'nutrients_per_basis',coalesce((
        select jsonb_object_agg(field.field_id,jsonb_build_object(
          'value',case when p_manual_payload->'nutrients' ? field.field_id and p_manual_payload->'nutrients'->field.field_id<>'null'::jsonb then (p_manual_payload->'nutrients'->>field.field_id)::numeric else null end,
          'name',field.name,'unit',field.unit
        )) from public.nutrient_fields as field where field.user_id=actor_id and field.archived_at is null
      ),'{}'::jsonb)
    ));
  end if;

  if p_source_kind='food' then parent_name := coalesce(parent_name,'Food'); end if;
  snapshot := jsonb_build_object(
    'schema_version',1,'name',parent_name,'source',p_source_kind,'source_id',p_source_id,
    'selected_amount',p_amount,'selected_unit',trim(p_unit),'captured_at',now(),
    'calories',jsonb_build_object('value',calorie_total,'complete',true,'knownComponents',calorie_known,'totalComponents',case when component_count=0 then 1 else component_count end),
    'nutrients',nutrient_totals,'components',component_rows
  );
  if p_planned_item_id is null then
    insert into public.day_items(user_id,local_date,section,state,source,selected_amount,selected_unit,planned_payload,eaten_snapshot,eaten_at)
      values(actor_id,p_local_date,p_section,'eaten',source_table,p_amount,trim(p_unit),'{}'::jsonb,snapshot,now()) returning * into item_row;
  else
    update public.day_items as item set state='eaten',selected_amount=entry_amount,selected_unit=entry_unit,
      eaten_snapshot=snapshot,eaten_at=now(),revision=item.revision+1,updated_at=now()
      where item.user_id=actor_id and item.id=p_planned_item_id and item.state='planned' and item.revision=p_expected_item_revision returning * into item_row;
    if not found then raise exception using errcode='40001',message='Planned item was already logged or changed'; end if;
  end if;
  update public.days as day set log_revision=day.log_revision+1,revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning log_revision into new_revision;
  select jsonb_build_object(
    'item_id',item_row.id,'day_log_revision',new_revision,'eaten_count',count(*),
    'calories_kcal',coalesce(sum((item.eaten_snapshot->'calories'->>'value')::numeric),0)
  ) into result from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date and item.state='eaten';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'calendar_log_day_item',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.calendar_log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) from public,anon;
grant execute on function public.calendar_log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) to authenticated;

comment on function public.calendar_plan_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb) is
  'Plans one validated choice on an explicitly selected calendar date without creating a week or routine.';

comment on function public.calendar_log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) is
  'Logs one validated choice with a frozen nutrition snapshot on an explicit calendar date; does not create a week or routine.';
