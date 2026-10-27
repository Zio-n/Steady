create or replace function public.resize_planned_day_item(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_amount numeric
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
  day_revision integer;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1
    or p_amount is null or p_amount<=0 or p_amount>=100000000 then
    raise exception using errcode='22023',message='A valid request, plan revision and positive portion are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision,'amount',p_amount
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'resize_planned_day_item' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select day.* into day_row from public.days as day
    where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;
  select item.* into item_row from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'planned' or item_row.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This plan changed; refresh and review before editing its portion';
  end if;
  if coalesce(item_row.planned_payload->>'source_kind','') not in ('food','meal','one_off_food','one_off_meal')
    or item_row.selected_unit is null or item_row.planned_payload->>'unit' is distinct from item_row.selected_unit then
    raise exception using errcode='22023',message='This unresolved plan has no editable portion';
  end if;

  update public.day_items as item set selected_amount=p_amount,
    planned_payload=jsonb_set(item.planned_payload,'{amount}',to_jsonb(p_amount),true),
    manual_override=true,revision=item.revision+1,updated_at=now()
    where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  update public.days as day set revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning day.revision into day_revision;
  result := jsonb_build_object('item_id',item_row.id,'item_revision',item_row.revision,'day_revision',day_revision,
    'selected_amount',item_row.selected_amount,'selected_unit',item_row.selected_unit,'planned_payload',item_row.planned_payload);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'resize_planned_day_item',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.resize_planned_day_item(uuid,date,uuid,integer,numeric) from public,anon;
grant execute on function public.resize_planned_day_item(uuid,date,uuid,integer,numeric) to authenticated;
comment on function public.resize_planned_day_item(uuid,date,uuid,integer,numeric) is
  'Persists a date-specific planned portion override under a day/item revision check and idempotent request receipt.';
