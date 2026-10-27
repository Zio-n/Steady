create or replace function public.replace_planned_day_item(
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
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  old_item public.day_items%rowtype;
  new_result jsonb;
  result jsonb;
  day_revision integer;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_expected_item_revision is null or p_expected_item_revision<1 then
    raise exception using errcode='22023',message='A request, date, plan and revision are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision,
    'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,'amount',p_amount,'unit',p_unit,'manual_payload',p_manual_payload
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'replace_planned_day_item' or prior_fingerprint<>fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;
  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;
  select item.* into old_item from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or old_item.state<>'planned' or old_item.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This plan changed; refresh and review before replacing it';
  end if;
  new_result := public.plan_day_item(gen_random_uuid(),p_local_date,p_section,p_source_kind,p_source_id,p_amount,p_unit,p_manual_payload);
  update public.day_items as item set state='removed',revision=item.revision+1,updated_at=now()
    where item.user_id=actor_id and item.id=p_item_id returning * into old_item;
  update public.days as day set revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning day.revision into day_revision;
  select new_result || jsonb_build_object('replaced_item_id',p_item_id,'replaced_item_revision',old_item.revision,
    'day_revision',day_revision,'planned_count',count(*)) into result
    from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date and item.state='planned';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'replace_planned_day_item',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.replace_planned_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) from public,anon;
grant execute on function public.replace_planned_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) to authenticated;
comment on function public.replace_planned_day_item(uuid,date,uuid,integer,public.meal_section,text,uuid,numeric,text,jsonb) is
  'Atomically swaps a future planned item for another validated plan under revision checks and an idempotent receipt.';
