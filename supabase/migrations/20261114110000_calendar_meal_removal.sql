-- Remove an entire occurrence in one transaction. Undo reuses the exact
-- revisions returned by that removal, including for previously eaten foods.
create function public.change_calendar_meal_removal(
  p_request_id uuid, p_local_date date, p_items jsonb default null, p_removal_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := encode(extensions.digest(convert_to(
    jsonb_build_array(p_local_date,p_items,p_removal_request_id)::text,'UTF8'),'sha256'),'hex');
  prior public.mutation_receipts%rowtype;
  entry public.day_items%rowtype;
  reference jsonb;
  group_id uuid;
  child_request uuid;
  item_refs jsonb := p_items;
  removed_items jsonb := '[]'::jsonb;
  result jsonb;
  restoring boolean := p_removal_request_id is not null;
begin
  if actor is null then raise exception using errcode='28000', message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or (restoring and p_items is not null) then
    raise exception using errcode='22023', message='A date and meal are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_request_id::text,0));
  select * into prior from public.mutation_receipts where user_id=actor and request_id=p_request_id;
  if found then
    if prior.operation<>'change_calendar_meal_removal' or prior.input_fingerprint<>fingerprint then
      raise exception using errcode='22023', message='Request ID was already used with different input';
    end if;
    return prior.result;
  end if;

  perform 1 from public.days where user_id=actor and local_date=p_local_date and status='open' for update;
  if not found then raise exception using errcode='40001', message='The calendar date is unavailable or complete'; end if;

  if restoring then
    select receipt.result->'removed_items', (receipt.result->>'meal_group_id')::uuid
      into item_refs, group_id from public.mutation_receipts as receipt
      where receipt.user_id=actor and receipt.request_id=p_removal_request_id
        and receipt.operation='change_calendar_meal_removal' and receipt.result->>'date'=p_local_date::text;
  end if;
  if jsonb_typeof(item_refs) is distinct from 'array' then
    raise exception using errcode='22023', message='A meal is required';
  end if;
  if jsonb_array_length(item_refs) not between 1 and 50 then
    raise exception using errcode='22023', message='Choose one meal to update';
  end if;
  if not restoring then
    select coalesce(item.meal_group_id,item.id) into group_id from public.day_items as item
      where item.user_id=actor and item.local_date=p_local_date
        and item.id=(item_refs->0->>'id')::uuid and item.state<>'removed';
  end if;
  if group_id is null or (select count(*) from public.day_items as item
    where item.user_id=actor and item.local_date=p_local_date
      and coalesce(item.meal_group_id,item.id)=group_id and item.state<>'removed')
    <> (case when restoring then 0 else jsonb_array_length(item_refs) end) then
    raise exception using errcode='40001', message='The meal has changed';
  end if;

  for reference in select value from jsonb_array_elements(item_refs)
  loop
    select * into entry from public.day_items as item
      where item.user_id=actor and item.local_date=p_local_date and coalesce(item.meal_group_id,item.id)=group_id
        and item.id=(reference->>'id')::uuid for update;
    if not found or entry.revision is distinct from (reference->>'revision')::integer
      or (entry.state='removed')<>restoring then
      raise exception using errcode='40001', message='The meal has changed';
    end if;
    child_request := pg_catalog.md5(p_request_id::text || ':meal-removal:' || entry.id)::uuid;
    if restoring then
      if entry.eaten_snapshot is null then
        perform public.restore_planned_calendar_item(child_request,p_local_date,entry.id,entry.revision);
      else
        perform public.revise_day_item(child_request,p_local_date,entry.id,entry.revision,'restore');
      end if;
    else
      if entry.state='planned' then
        perform public.remove_planned_day_item(child_request,p_local_date,entry.id,entry.revision);
      else
        perform public.revise_day_item(child_request,p_local_date,entry.id,entry.revision,'remove');
      end if;
      removed_items := removed_items || jsonb_build_array(jsonb_build_object('id',entry.id,'revision',entry.revision+1));
    end if;
  end loop;

  result := jsonb_build_object('date',p_local_date,'meal_group_id',group_id,'removed_items',removed_items);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor,p_request_id,'change_calendar_meal_removal',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.change_calendar_meal_removal(uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.change_calendar_meal_removal(uuid,date,jsonb,uuid) to authenticated;
