create or replace function public.restore_planned_calendar_item(
  p_request_id uuid,p_local_date date,p_item_id uuid,p_expected_item_revision integer
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
    or p_expected_item_revision is null or p_expected_item_revision<1 then
    raise exception using errcode='22023',message='A valid request, date and plan revision are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'restore_planned_calendar_item' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;
  day_row := private.ensure_calendar_day_for_entry(actor_id,p_local_date);
  if day_row.status<>'open' then raise exception using errcode='40001',message='This date is complete and cannot restore a plan'; end if;
  select item.* into item_row from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'removed' or item_row.eaten_snapshot is not null
    or item_row.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This removed plan can no longer be restored';
  end if;
  update public.day_items set state='planned',revision=revision+1,updated_at=now()
    where user_id=actor_id and id=p_item_id returning * into item_row;
  update public.days set revision=revision+1,updated_at=now()
    where user_id=actor_id and local_date=p_local_date returning revision into day_revision;
  result := jsonb_build_object('item_id',item_row.id,'item_revision',item_row.revision,'day_revision',day_revision);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'restore_planned_calendar_item',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.restore_planned_calendar_item(uuid,date,uuid,integer) from public,anon;
grant execute on function public.restore_planned_calendar_item(uuid,date,uuid,integer) to authenticated;
