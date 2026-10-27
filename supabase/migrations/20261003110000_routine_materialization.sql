create or replace function public.ensure_routine_day(p_local_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_timezone text;
  routine_version public.routine_versions%rowtype;
  day_row public.days%rowtype;
  slot_row public.routine_slots%rowtype;
  existing_item public.day_items%rowtype;
  occurrence_key text;
  payload jsonb;
  item_name text;
  source_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  removed_count integer := 0;
  planned_count integer := 0;
  changed boolean := false;
  matching_slot_count integer := 0;
  existing_planned_count integer := 0;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_local_date is null then raise exception using errcode='22023',message='A local date is required'; end if;
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before loading a routine'; end if;
  select version.* into routine_version from public.routine_versions as version
    where version.user_id=actor_id and version.effective_from<=p_local_date
    order by version.effective_from desc limit 1 for share;
  if not found then return jsonb_build_object('local_date',p_local_date,'materialized_count',0,'planned_count',0,'no_routine',true); end if;
  select count(*) into matching_slot_count from public.routine_slots as slot
    where slot.user_id=actor_id and slot.routine_version_id=routine_version.id
      and slot.weekday=extract(isodow from p_local_date)::smallint;
  select count(*) into existing_planned_count from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date and item.source='routine'
      and item.state='planned' and not item.manual_override;
  if matching_slot_count=0 and existing_planned_count=0 then
    return jsonb_build_object('local_date',p_local_date,'routine_version_id',routine_version.id,'materialized_count',0,'planned_count',0,'no_routine',true);
  end if;
  if matching_slot_count>0 then
    day_row := private.ensure_day_for_log(actor_id,p_local_date);
  else
    select day.* into day_row from public.days as day where day.user_id=actor_id and day.local_date=p_local_date for update;
    if not found then return jsonb_build_object('local_date',p_local_date,'routine_version_id',routine_version.id,'materialized_count',0,'planned_count',0,'no_routine',true); end if;
  end if;
  if day_row.status<>'open' then
    select count(*) into planned_count from public.day_items as item
      where item.user_id=actor_id and item.local_date=p_local_date and item.source='routine' and item.state='planned';
    return jsonb_build_object('local_date',p_local_date,'routine_version_id',routine_version.id,'materialized_count',0,'planned_count',planned_count,'day_completed',true);
  end if;

  for existing_item in
    select item.* from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date and item.source='routine'
      and item.state='planned' and not item.manual_override
      and not exists(select 1 from public.routine_slots as slot where slot.user_id=actor_id
        and slot.routine_version_id=routine_version.id and slot.weekday=extract(isodow from p_local_date)::smallint
        and slot.slot_id=item.planned_payload->>'routine_slot_id')
    order by item.id for update
  loop
    update public.day_items as item set state='removed',revision=item.revision+1,updated_at=now()
      where item.user_id=actor_id and item.id=existing_item.id;
    removed_count := removed_count+1;
    changed := true;
  end loop;

  for slot_row in
    select slot.* from public.routine_slots as slot where slot.user_id=actor_id and slot.routine_version_id=routine_version.id
      and slot.weekday=extract(isodow from p_local_date)::smallint
    order by slot.weekday,slot.section,slot.position,slot.slot_id
  loop
    occurrence_key := p_local_date::text||':'||slot_row.slot_id;
    source_id := slot_row.meal_id;
    if slot_row.mode='fixed' then
      select meal.name into item_name from public.meals as meal where meal.user_id=actor_id and meal.id=slot_row.meal_id;
      item_name := coalesce(item_name,'Unavailable saved meal');
    else
      item_name := 'Shuffle '||case slot_row.section when 'snack' then 'snack' else slot_row.section::text end;
      source_id := null;
    end if;
    payload := jsonb_build_object(
      'mode',slot_row.mode,'name',item_name,'source_kind',case when slot_row.mode='fixed' then 'meal' else null end,
      'source_id',source_id,'amount',slot_row.default_multiplier,'unit','serving',
      'routine_version_id',routine_version.id,'routine_slot_id',slot_row.slot_id
    );
    select item.* into existing_item from public.day_items as item
      where item.user_id=actor_id and item.local_date=p_local_date and item.routine_occurrence_key=occurrence_key for update;
    if not found then
      insert into public.day_items(user_id,local_date,section,state,source,routine_occurrence_key,selected_amount,selected_unit,manual_override,planned_payload)
        values(actor_id,p_local_date,slot_row.section,'planned','routine',occurrence_key,slot_row.default_multiplier,'serving',false,payload);
      inserted_count := inserted_count+1;
      changed := true;
    elsif existing_item.state='planned' and not existing_item.manual_override
      and (existing_item.section is distinct from slot_row.section or existing_item.selected_amount is distinct from slot_row.default_multiplier
        or existing_item.selected_unit is distinct from 'serving' or existing_item.planned_payload is distinct from payload) then
      update public.day_items as item set section=slot_row.section,selected_amount=slot_row.default_multiplier,
        selected_unit='serving',planned_payload=payload,revision=item.revision+1,updated_at=now()
        where item.user_id=actor_id and item.id=existing_item.id;
      updated_count := updated_count+1;
      changed := true;
    end if;
  end loop;

  if changed then
    update public.days as day set revision=day.revision+1,updated_at=now()
      where day.user_id=actor_id and day.local_date=p_local_date;
  end if;
  select count(*) into planned_count from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date and item.source='routine' and item.state='planned';
  result := jsonb_build_object('local_date',p_local_date,'routine_version_id',routine_version.id,
    'materialized_count',inserted_count,'updated_count',updated_count,'removed_count',removed_count,'planned_count',planned_count);
  return result;
end;
$$;

revoke all on function public.ensure_routine_day(date) from public,anon;
grant execute on function public.ensure_routine_day(date) to authenticated;
comment on function public.ensure_routine_day(date) is
  'Lazily materializes the effective routine using stable date/slot keys, preserving removed, eaten and manually overridden occurrences.';
