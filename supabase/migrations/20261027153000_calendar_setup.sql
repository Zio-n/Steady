-- First-use setup records an account timezone and optional target without
-- creating weekly patterns, allocations, dates, or routine defaults.
create or replace function public.complete_calendar_setup(
  p_request_id uuid,
  p_timezone text,
  p_target_kcal numeric default null
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
  profile_row public.profiles%rowtype;
  local_today date;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode='28000',message='Authentication required';
  end if;
  if p_request_id is null or p_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then
    raise exception using errcode='22023',message='A request ID and valid IANA timezone are required';
  end if;
  if p_target_kcal is not null and (
    p_target_kcal<=0 or p_target_kcal>=1000000 or p_target_kcal<>trunc(p_target_kcal)
  ) then
    raise exception using errcode='22023',message='Calorie target must be a positive whole number';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'timezone',p_timezone,'target_kcal',p_target_kcal
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'complete_calendar_setup' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  if exists (select 1 from public.profiles where user_id=actor_id and onboarding_complete) then
    raise exception using errcode='40001',message='Profile setup is already complete';
  end if;

  insert into public.profiles (user_id,timezone,base_daily_target_kcal,onboarding_complete)
  values (actor_id,p_timezone,p_target_kcal,true)
  on conflict (user_id) do update
    set timezone=excluded.timezone,
        base_daily_target_kcal=excluded.base_daily_target_kcal,
        onboarding_complete=true,
        revision=public.profiles.revision+1,
        updated_at=now()
    where not public.profiles.onboarding_complete
  returning * into profile_row;
  if profile_row.user_id is null then
    raise exception using errcode='40001',message='Profile setup is already complete';
  end if;

  insert into public.nutrient_fields (user_id,field_id,name,unit,standard_key,display_order,is_displayed)
  values
    (actor_id,'protein','Protein','g','protein',0,true),
    (actor_id,'carbohydrate','Carbohydrate','g','carbohydrate',1,true),
    (actor_id,'fat','Fat','g','fat',2,true),
    (actor_id,'fibre','Fibre','g','fibre',3,true),
    (actor_id,'sugar','Sugar','g','sugar',4,false),
    (actor_id,'saturated_fat','Saturated fat','g','saturated_fat',5,false),
    (actor_id,'salt','Salt','g','salt',6,false)
  on conflict (user_id,field_id) do nothing;

  local_today := (now() at time zone p_timezone)::date;
  if p_target_kcal is not null then
    insert into public.profile_target_versions (
      user_id,effective_from,base_daily_target_kcal,nutrient_targets,timezone
    ) values (actor_id,local_today,p_target_kcal,'{}'::jsonb,p_timezone);
  end if;

  result := jsonb_build_object(
    'user_id',actor_id,'timezone',p_timezone,
    'target_kcal',p_target_kcal,'revision',profile_row.revision
  );
  insert into public.mutation_receipts (user_id,request_id,operation,input_fingerprint,result)
  values (actor_id,p_request_id,'complete_calendar_setup',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.complete_calendar_setup(uuid,text,numeric) from public,anon;
grant execute on function public.complete_calendar_setup(uuid,text,numeric) to authenticated;
