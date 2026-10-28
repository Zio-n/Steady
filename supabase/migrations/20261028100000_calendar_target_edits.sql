create or replace function public.save_calendar_targets(
  p_request_id uuid,
  p_effective_from date,
  p_base_daily_target_kcal numeric,
  p_nutrient_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_timezone text;
  local_today date;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  profile_revision integer;
  result jsonb;
  target_value numeric;
  target_key text;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_effective_from is null
    or p_nutrient_targets is null or jsonb_typeof(p_nutrient_targets)<>'object'
    or (select count(*) from jsonb_object_keys(p_nutrient_targets))>32 then
    raise exception using errcode='22023',message='A request, effective date and nutrient target object are required';
  end if;
  if p_base_daily_target_kcal is not null and (
    p_base_daily_target_kcal<=0 or p_base_daily_target_kcal>=1000000
    or p_base_daily_target_kcal<>trunc(p_base_daily_target_kcal)
  ) then raise exception using errcode='22023',message='Calorie target must be a positive whole number or unset'; end if;

  select profile.timezone into account_timezone from public.profiles as profile
    where profile.user_id=actor_id and profile.onboarding_complete for update;
  if not found then raise exception using errcode='22023',message='Complete calendar setup before changing targets'; end if;
  local_today := (now() at time zone account_timezone)::date;
  if p_effective_from<local_today then raise exception using errcode='22023',message='Targets cannot be changed retroactively'; end if;
  if exists(select 1 from jsonb_each(p_nutrient_targets) as entry(key,value)
    where jsonb_typeof(entry.value)<>'number') then
    raise exception using errcode='22023',message='Nutrient targets must be numeric';
  end if;

  for target_key,target_value in select key,value::text::numeric from jsonb_each(p_nutrient_targets)
  loop
    if target_value<0 or target_value>=100000000
      or not exists(select 1 from public.nutrient_fields as field
        where field.user_id=actor_id and field.field_id=target_key and field.archived_at is null) then
      raise exception using errcode='22023',message='A nutrient target is invalid or unavailable';
    end if;
  end loop;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'effective_from',p_effective_from,'base_target',p_base_daily_target_kcal,'nutrient_targets',p_nutrient_targets
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_calendar_targets' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  update public.profiles as profile set base_daily_target_kcal=p_base_daily_target_kcal,
    revision=profile.revision+1,updated_at=now()
    where profile.user_id=actor_id and profile.onboarding_complete
    returning profile.revision into profile_revision;
  insert into public.profile_target_versions (
    user_id,effective_from,base_daily_target_kcal,nutrient_targets,timezone
  ) values (actor_id,p_effective_from,p_base_daily_target_kcal,p_nutrient_targets,account_timezone)
  on conflict (user_id,effective_from) do update set
    base_daily_target_kcal=excluded.base_daily_target_kcal,
    nutrient_targets=excluded.nutrient_targets,
    timezone=excluded.timezone,
    revision=public.profile_target_versions.revision+1;

  result := jsonb_build_object('effective_from',p_effective_from,
    'base_daily_target_kcal',p_base_daily_target_kcal,'revision',profile_revision);
  insert into public.mutation_receipts (user_id,request_id,operation,input_fingerprint,result)
  values (actor_id,p_request_id,'save_calendar_targets',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_calendar_targets(uuid,date,numeric,jsonb) from public,anon;
grant execute on function public.save_calendar_targets(uuid,date,numeric,jsonb) to authenticated;
