create or replace function public.transfer_calendar_plan(
  p_request_id uuid,
  p_from_date date,
  p_to_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_action text
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
  source_day public.days%rowtype;
  target_day public.days%rowtype;
  source_item public.day_items%rowtype;
  copied_item public.day_items%rowtype;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_from_date is null or p_to_date is null or p_item_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1 or p_action not in ('copy','move')
    or (p_action='move' and p_from_date=p_to_date) then
    raise exception using errcode='22023',message='Choose a valid planned item action and destination date';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'from_date',p_from_date,'to_date',p_to_date,'item_id',p_item_id,
    'expected_revision',p_expected_item_revision,'action',p_action
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'transfer_calendar_plan' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  -- Create/lock the two dates in a stable order. This remains an explicit write;
  -- no range or day read creates a date row.
  if p_from_date<p_to_date then
    source_day := private.ensure_calendar_day_for_entry(actor_id,p_from_date);
    target_day := private.ensure_calendar_day_for_entry(actor_id,p_to_date);
  else
    target_day := private.ensure_calendar_day_for_entry(actor_id,p_to_date);
    source_day := private.ensure_calendar_day_for_entry(actor_id,p_from_date);
  end if;
  if source_day.status<>'open' or target_day.status<>'open' then
    raise exception using errcode='40001',message='A completed date cannot be changed';
  end if;
  select item.* into source_item from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_from_date for update;
  if not found or source_item.state<>'planned' or source_item.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This planned item changed; refresh and review it before continuing';
  end if;
  insert into public.day_items(user_id,local_date,section,state,source,routine_occurrence_key,
    selected_amount,selected_unit,manual_override,planned_payload,eaten_snapshot,eaten_at)
  values(actor_id,p_to_date,source_item.section,'planned',source_item.source,null,
    source_item.selected_amount,source_item.selected_unit,source_item.manual_override,source_item.planned_payload,null,null)
  returning * into copied_item;
  update public.days set revision=revision+1,updated_at=now()
    where user_id=actor_id and local_date=p_to_date;
  if p_action='move' then
    update public.day_items set state='removed',revision=revision+1,updated_at=now()
      where user_id=actor_id and id=p_item_id returning * into source_item;
    update public.days set revision=revision+1,updated_at=now()
      where user_id=actor_id and local_date=p_from_date;
  end if;
  result := jsonb_build_object('item_id',copied_item.id,'local_date',p_to_date,'item_revision',copied_item.revision,
    'source_item_id',p_item_id,'action',p_action);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'transfer_calendar_plan',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.transfer_calendar_plan(uuid,date,date,uuid,integer,text) from public,anon;
grant execute on function public.transfer_calendar_plan(uuid,date,date,uuid,integer,text) to authenticated;
comment on function public.transfer_calendar_plan(uuid,date,date,uuid,integer,text) is
  'Copies or moves only a planned entry between two open dates. Eaten entries cannot be transferred.';
