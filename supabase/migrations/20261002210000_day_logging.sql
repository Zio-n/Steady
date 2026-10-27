create or replace function private.ensure_day_for_log(p_user_id uuid, p_local_date date)
returns public.days
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_row public.days%rowtype;
  account_timezone text;
  monday date := pg_catalog.date_trunc('week',p_local_date::timestamp)::date;
  target_version public.profile_target_versions%rowtype;
  pattern_id uuid;
  target_budget numeric;
  weekday_value integer := extract(isodow from p_local_date)::integer;
  day_target numeric;
begin
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=p_user_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before logging food'; end if;
  select version.* into target_version from public.profile_target_versions as version
    where version.user_id=p_user_id and version.effective_from<=p_local_date
    order by version.effective_from desc limit 1;
  if not found or target_version.base_daily_target_kcal is null then
    raise exception using errcode='22023',message='A calorie target is not available for this date';
  end if;
  select version.id into pattern_id from public.weekly_pattern_versions as version
    where version.user_id=p_user_id and version.effective_week_start<=monday
    order by version.effective_week_start desc limit 1;
  if pattern_id is not null then
    select sum(pattern_day.target_kcal) into target_budget from public.weekly_pattern_days as pattern_day
      where pattern_day.user_id=p_user_id and pattern_day.pattern_version_id=pattern_id;
  else
    target_budget := target_version.base_daily_target_kcal*7;
  end if;
  insert into public.weeks(user_id,week_start,budget_kcal,source_pattern_version_id)
    values(p_user_id,monday,target_budget,pattern_id) on conflict(user_id,week_start) do nothing;
  if pattern_id is not null then
    insert into public.week_allocations(user_id,week_start,weekday,base_target_kcal)
      select p_user_id,monday,pattern_day.weekday,pattern_day.target_kcal from public.weekly_pattern_days as pattern_day
      where pattern_day.user_id=p_user_id and pattern_day.pattern_version_id=pattern_id
      on conflict(user_id,week_start,weekday) do nothing;
  else
    insert into public.week_allocations(user_id,week_start,weekday,base_target_kcal)
      select p_user_id,monday,week_day,target_version.base_daily_target_kcal
      from pg_catalog.generate_series(1,7) as weekdays(week_day)
      on conflict(user_id,week_start,weekday) do nothing;
  end if;
  select coalesce(allocation.override_target_kcal,allocation.base_target_kcal)
    into day_target from public.week_allocations as allocation
    where allocation.user_id=p_user_id and allocation.week_start=monday and allocation.weekday=weekday_value;
  day_target := coalesce(day_target,target_version.base_daily_target_kcal);
  insert into public.days(user_id,local_date,week_start,base_planned_target_kcal,nutrient_target_snapshot)
    values(p_user_id,p_local_date,monday,day_target,jsonb_build_object(
      'targets',target_version.nutrient_targets,'fields',target_version.nutrient_field_snapshot
    )) on conflict(user_id,local_date) do nothing;
  select day.* into day_row from public.days as day where day.user_id=p_user_id and day.local_date=p_local_date for update;
  return day_row;
end;
$$;

create or replace function private.capture_food_component(
  p_user_id uuid,p_food_id uuid,p_amount numeric,p_unit text,p_multiplier numeric default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  food_row public.foods%rowtype;
  basis_amount numeric;
  ratio numeric;
  nutrient_map jsonb;
  calorie_metric jsonb;
begin
  if p_amount is null or p_amount<=0 or p_amount>=100000000 or p_multiplier is null or p_multiplier<=0 or p_multiplier>=100000000 then
    raise exception using errcode='22023',message='Food amount or multiplier is invalid';
  end if;
  select food.* into food_row from public.foods as food
    where food.user_id=p_user_id and food.id=p_food_id and food.archived_at is null;
  if not found then raise exception using errcode='23503',message='A food is no longer active'; end if;
  basis_amount := private.convert_food_amount(p_amount,p_unit,food_row.basis_unit,food_row.grams_per_serving);
  if basis_amount is null then raise exception using errcode='22023',message='A food portion uses incompatible units'; end if;
  ratio := basis_amount/food_row.basis_amount*p_multiplier;
  if food_row.calories_kcal is null then raise exception using errcode='22023',message='Calories must be known before logging'; end if;
  select coalesce(jsonb_object_agg(field.field_id,jsonb_build_object(
      'name',field.name,'unit',field.unit,'value',nutrient.value*ratio,
      'complete',nutrient.value is not null,'knownComponents',case when nutrient.value is null then 0 else 1 end,'totalComponents',1
    ) order by field.display_order),'{}'::jsonb)
    into nutrient_map
    from public.nutrient_fields as field
    left join public.food_nutrients as nutrient on nutrient.user_id=field.user_id and nutrient.field_id=field.field_id and nutrient.food_id=p_food_id
    where field.user_id=p_user_id and field.archived_at is null;
  calorie_metric := jsonb_build_object('value',food_row.calories_kcal*ratio,'complete',true,'knownComponents',1,'totalComponents',1);
  return jsonb_build_object(
    'food_id',food_row.id,'food_name',food_row.name,'amount',p_amount,'unit',trim(p_unit),
    'basis_amount',food_row.basis_amount,'basis_unit',food_row.basis_unit,'grams_per_serving',food_row.grams_per_serving,
    'calories_per_basis',food_row.calories_kcal,'nutrients_per_basis',coalesce((
      select jsonb_object_agg(field.field_id,jsonb_build_object('value',nutrient.value,'name',field.name,'unit',field.unit))
      from public.nutrient_fields as field left join public.food_nutrients as nutrient
        on nutrient.user_id=field.user_id and nutrient.field_id=field.field_id and nutrient.food_id=p_food_id
      where field.user_id=p_user_id and field.archived_at is null
    ),'{}'::jsonb),
    'calories',calorie_metric,'nutrients',nutrient_map
  );
end;
$$;

revoke all on function private.ensure_day_for_log(uuid,date) from public,anon,authenticated;
revoke all on function private.capture_food_component(uuid,uuid,numeric,text,numeric) from public,anon,authenticated;

create or replace function public.log_day_item(
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
    if prior_operation<>'log_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  day_row := private.ensure_day_for_log(actor_id,p_local_date);
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
    values(actor_id,p_request_id,'log_day_item',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) from public,anon;
grant execute on function public.log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) to authenticated;
comment on function public.log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer) is
  'Atomically ensures a dated day, validates and snapshots one saved or one-off food/meal, marks planned items eaten exactly once, and returns authoritative totals under an idempotency receipt.';
