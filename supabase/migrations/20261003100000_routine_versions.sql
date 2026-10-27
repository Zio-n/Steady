alter table public.routine_versions
  add column revision integer not null default 1 check (revision >= 1);

create or replace function public.save_routine_version(
  p_request_id uuid,
  p_effective_from date,
  p_expected_revision integer,
  p_slots jsonb
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
  version_id uuid;
  next_revision integer;
  slot jsonb;
  slot_id_value text;
  weekday_value smallint;
  section_value public.meal_section;
  mode_value public.routine_slot_mode;
  meal_id_value uuid;
  multiplier_value numeric;
  position_value integer;
  slot_count integer := 0;
  item_error text;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_effective_from is null or p_slots is null or jsonb_typeof(p_slots)<>'array'
    or jsonb_array_length(p_slots)>100 then
    raise exception using errcode='22023',message='A request and up to 100 routine slots are required';
  end if;
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before saving a routine'; end if;
  local_today := (now() at time zone account_timezone)::date;
  if p_effective_from<>local_today+1 then raise exception using errcode='22023',message='Routine changes take effect tomorrow'; end if;
  if p_expected_revision is not null and p_expected_revision<1 then raise exception using errcode='22023',message='Routine revision is invalid'; end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'effective_from',p_effective_from,'expected_revision',p_expected_revision,'slots',p_slots
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_routine_version' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  select version.id,version.revision into version_id,next_revision
    from public.routine_versions as version where version.user_id=actor_id and version.effective_from=p_effective_from for update;
  if found then
    if p_expected_revision is null or p_expected_revision<>next_revision then raise exception using errcode='40001',message='Routine changed elsewhere; refresh before saving'; end if;
    next_revision := next_revision+1;
    update public.routine_versions as version set revision=next_revision where version.user_id=actor_id and version.id=version_id;
    delete from public.routine_slots as saved where saved.user_id=actor_id and saved.routine_version_id=version_id;
  else
    if p_expected_revision is not null then raise exception using errcode='40001',message='Routine changed elsewhere; refresh before saving'; end if;
    insert into public.routine_versions(user_id,effective_from) values(actor_id,p_effective_from) returning id,revision into version_id,next_revision;
  end if;

  for slot in select value from jsonb_array_elements(p_slots) as entries(value)
  loop
    if jsonb_typeof(slot)<>'object'
      or not (slot ? 'slot_id' and slot ? 'weekday' and slot ? 'section' and slot ? 'mode' and slot ? 'meal_id' and slot ? 'default_multiplier' and slot ? 'position') then
      raise exception using errcode='22023',message='Each routine slot requires its identity, weekday, section, mode, meal, multiplier and order';
    end if;
    begin
      slot_id_value := slot->>'slot_id';
      weekday_value := (slot->>'weekday')::smallint;
      section_value := (slot->>'section')::public.meal_section;
      mode_value := (slot->>'mode')::public.routine_slot_mode;
      meal_id_value := nullif(slot->>'meal_id','')::uuid;
      multiplier_value := (slot->>'default_multiplier')::numeric;
      position_value := (slot->>'position')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='A routine slot contains an invalid value';
    end;
    if coalesce(slot_id_value,'') !~ '^[a-zA-Z0-9_-]{1,64}$' or weekday_value is null or weekday_value not between 1 and 7
      or section_value is null or mode_value is null
      or multiplier_value is null or multiplier_value<=0 or multiplier_value>=1000000
      or position_value is null or position_value<0 then
      raise exception using errcode='22023',message='A routine slot is outside valid bounds';
    end if;
    if exists(select 1 from public.routine_slots as prior where prior.user_id=actor_id and prior.routine_version_id=version_id and prior.slot_id=slot_id_value) then
      raise exception using errcode='22023',message='Routine slot IDs must be unique';
    end if;
    if exists(select 1 from public.routine_slots as prior where prior.user_id=actor_id and prior.routine_version_id=version_id and prior.weekday=weekday_value and prior.section=section_value and prior.position=position_value) then
      raise exception using errcode='22023',message='Slot ordering must be unique within a day and section';
    end if;
    if (mode_value='fixed' and meal_id_value is null) or (mode_value='shuffle' and meal_id_value is not null) then
      raise exception using errcode='22023',message='Fixed slots require a saved meal and Shuffle slots cannot have one';
    end if;
    if mode_value='fixed' and not exists(
      select 1 from public.meals as meal where meal.user_id=actor_id and meal.id=meal_id_value
        and meal.archived_at is null and section_value=any(meal.sections)
    ) then raise exception using errcode='23503',message='Choose an active meal tagged for this section'; end if;
    insert into public.routine_slots(user_id,routine_version_id,slot_id,weekday,section,mode,meal_id,default_multiplier,position)
      values(actor_id,version_id,slot_id_value,weekday_value,section_value,mode_value,meal_id_value,multiplier_value,position_value);
    slot_count := slot_count+1;
  end loop;

  result := jsonb_build_object('id',version_id,'effective_from',p_effective_from,'revision',next_revision,'slot_count',slot_count);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'save_routine_version',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_routine_version(uuid,date,integer,jsonb) from public,anon;
grant execute on function public.save_routine_version(uuid,date,integer,jsonb) to authenticated;
comment on function public.save_routine_version(uuid,date,integer,jsonb) is
  'Atomically saves tomorrow-effective fixed or Shuffle routine slots with stable identities, ordering, revisions and idempotency.';
