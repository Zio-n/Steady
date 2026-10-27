alter table public.day_item_history drop constraint day_item_history_action_check;
alter table public.day_item_history add constraint day_item_history_action_check
  check (action in ('edited','removed','restored','replaced'));

create or replace function public.replace_day_item(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
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
  input_fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  logged_result jsonb;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_expected_item_revision is null or p_expected_item_revision<1 then
    raise exception using errcode='22023',message='A request, date, item and revision are required';
  end if;
  input_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision,
    'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,'amount',p_amount,'unit',p_unit,'manual_payload',p_manual_payload
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'replace_day_item' or prior_fingerprint<>input_fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;
  -- Let revise_day_item acquire locks in its established day-then-item order.
  -- Pre-locking the item here would invert that order and could deadlock with a
  -- concurrent resize/remove request for the same day.
  perform public.revise_day_item(gen_random_uuid(),p_local_date,p_item_id,p_expected_item_revision,'remove');
  update public.day_item_history as history set action='replaced'
    where history.user_id=actor_id and history.item_id=p_item_id and history.item_revision=p_expected_item_revision and history.action='removed';
  logged_result := public.log_day_item(gen_random_uuid(),p_local_date,p_section,p_source_kind,p_source_id,p_amount,p_unit,p_manual_payload);
  result := logged_result || jsonb_build_object('replaced_item_id',p_item_id);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'replace_day_item',input_fingerprint,result);
  return result;
end;
$$;

revoke all on function public.replace_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) from public,anon;
grant execute on function public.replace_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) to authenticated;
comment on function public.replace_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) is
  'Atomically replaces an eaten item with a newly calculated current-source snapshot while preserving an immutable before-image and idempotent receipt.';
