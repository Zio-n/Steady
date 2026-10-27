alter table public.nutrient_fields
  add column is_displayed boolean not null default false;

create or replace function public.complete_profile_onboarding(
  p_request_id uuid,
  p_timezone text,
  p_base_daily_target_kcal numeric,
  p_displayed_fields jsonb,
  p_nutrient_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  local_today date;
  initial_week_start date;
  loop_field_id text;
  field_target numeric;
  field_order integer;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  pattern_id uuid;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required';
  end if;
  if p_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception using errcode = '22023', message = 'Choose a valid IANA timezone';
  end if;
  if p_base_daily_target_kcal is null
    or p_base_daily_target_kcal <= 0
    or p_base_daily_target_kcal >= 1000000
    or p_base_daily_target_kcal <> trunc(p_base_daily_target_kcal) then
    raise exception using errcode = '22023', message = 'Daily calorie target must be a positive whole number';
  end if;
  if p_displayed_fields is null or jsonb_typeof(p_displayed_fields) <> 'array'
    or jsonb_array_length(p_displayed_fields) > 32 then
    raise exception using errcode = '22023', message = 'Displayed nutrients must be a list';
  end if;
  if p_nutrient_targets is null or jsonb_typeof(p_nutrient_targets) <> 'object'
    or (select count(*) from jsonb_object_keys(p_nutrient_targets)) > 32 then
    raise exception using errcode = '22023', message = 'Nutrient targets must be an object';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_displayed_fields) as item(value)
    where jsonb_typeof(item.value) <> 'string'
  ) or (select count(*) from jsonb_array_elements_text(p_displayed_fields)) <>
       (select count(distinct value) from jsonb_array_elements_text(p_displayed_fields)) then
    raise exception using errcode = '22023', message = 'Displayed nutrients contain invalid or duplicate fields';
  end if;

  fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'timezone',p_timezone,
        'base_daily_target_kcal',p_base_daily_target_kcal,
        'displayed_fields',p_displayed_fields,
        'nutrient_targets',p_nutrient_targets
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || p_request_id::text,0)
  );
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'complete_profile_onboarding' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  if exists (select 1 from public.profiles as profile where profile.user_id = actor_id and profile.onboarding_complete) then
    raise exception using errcode = '40001', message = 'Profile setup is already complete';
  end if;

  insert into public.nutrient_fields(user_id,field_id,name,unit,standard_key,display_order)
  values
    (actor_id,'protein','Protein','g','protein',0),
    (actor_id,'carbohydrate','Carbohydrate','g','carbohydrate',1),
    (actor_id,'fat','Fat','g','fat',2),
    (actor_id,'fibre','Fibre','g','fibre',3),
    (actor_id,'sugar','Sugar','g','sugar',4),
    (actor_id,'saturated_fat','Saturated fat','g','saturated_fat',5),
    (actor_id,'salt','Salt','g','salt',6)
  on conflict (user_id,field_id) do nothing;

  if exists (
    select 1 from jsonb_array_elements_text(p_displayed_fields) as selected(field_id)
    where not exists (
      select 1 from public.nutrient_fields as field
      where field.user_id = actor_id and field.field_id = selected.field_id and field.archived_at is null
    )
  ) then
    raise exception using errcode = '22023', message = 'A displayed nutrient is unavailable';
  end if;
  for loop_field_id,field_target in
    select key,value::text::numeric from jsonb_each(p_nutrient_targets)
  loop
    if field_target < 0 or field_target >= 100000000
      or not exists (
        select 1 from public.nutrient_fields as field
        where field.user_id = actor_id and field.field_id = loop_field_id and field.archived_at is null
      ) then
      raise exception using errcode = '22023', message = 'A nutrient target is invalid or unavailable';
    end if;
  end loop;

  local_today := (now() at time zone p_timezone)::date;
  initial_week_start := pg_catalog.date_trunc('week',local_today::timestamp)::date;
  insert into public.profiles(user_id,timezone,base_daily_target_kcal,onboarding_complete)
    values (actor_id,p_timezone,p_base_daily_target_kcal,true)
    on conflict (user_id) do update
      set timezone = excluded.timezone,
          base_daily_target_kcal = excluded.base_daily_target_kcal,
          onboarding_complete = true,
          revision = public.profiles.revision + 1,
          updated_at = now()
      where not public.profiles.onboarding_complete;
  if not found then
    raise exception using errcode = '40001', message = 'Profile setup is already complete';
  end if;

  field_order := 0;
  for loop_field_id in select value from jsonb_array_elements_text(p_displayed_fields)
  loop
    update public.nutrient_fields as field
      set is_displayed = true,display_order = field_order
      where field.user_id = actor_id and field.field_id = loop_field_id;
    field_order := field_order + 1;
  end loop;

  insert into public.profile_target_versions(user_id,effective_from,base_daily_target_kcal,nutrient_targets,timezone)
    values (actor_id,initial_week_start,p_base_daily_target_kcal,p_nutrient_targets,p_timezone);

  insert into public.weekly_pattern_versions(user_id,effective_week_start,base_daily_target_kcal)
    values (actor_id,initial_week_start,p_base_daily_target_kcal)
    returning id into pattern_id;
  insert into public.weekly_pattern_days(user_id,pattern_version_id,weekday,target_kcal)
    select actor_id,pattern_id,weekday,p_base_daily_target_kcal
      from pg_catalog.generate_series(1,7) as weekday;

  result := jsonb_build_object(
    'user_id',actor_id,
    'timezone',p_timezone,
    'base_daily_target_kcal',p_base_daily_target_kcal,
    'initial_week_start',initial_week_start,
    'revision',1
  );
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'complete_profile_onboarding',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.complete_profile_onboarding(uuid,text,numeric,jsonb,jsonb) from public,anon;
grant execute on function public.complete_profile_onboarding(uuid,text,numeric,jsonb,jsonb) to authenticated;
comment on function public.complete_profile_onboarding(uuid,text,numeric,jsonb,jsonb) is
  'Creates a profile, displayed nutrient choices, effective target snapshot and initial seven-day allocation atomically and idempotently.';
