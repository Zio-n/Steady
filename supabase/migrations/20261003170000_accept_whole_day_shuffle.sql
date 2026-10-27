create or replace function public.accept_whole_day_shuffle(
  p_request_id uuid,
  p_local_date date,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_timezone text;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  change jsonb;
  item_id uuid;
  meal_id uuid;
  expected_item_revision integer;
  expected_meal_revision integer;
  amount numeric;
  item_row public.day_items%rowtype;
  meal_revision integer;
  meal_sections public.meal_section[];
  meal_archived_at timestamptz;
  planned_result jsonb;
  planned_item_id uuid;
  planned_item_revision integer;
  accepted_changes jsonb := '[]'::jsonb;
  result jsonb;
  day_revision integer;
  seen_item_ids uuid[] := array[]::uuid[];
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_changes is null then
    raise exception using errcode='22023',message='A request, future date and selected plans are required';
  end if;
  if jsonb_typeof(p_changes)<>'array' then
    raise exception using errcode='22023',message='Selected plans must be provided as a list';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 50 then
    raise exception using errcode='22023',message='Choose between one and fifty planned items to replace';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'changes',p_changes
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'accept_whole_day_shuffle' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before using Shuffle'; end if;
  if p_local_date<=(now() at time zone account_timezone)::date then
    raise exception using errcode='22023',message='Whole-day Shuffle can only replace a future plan';
  end if;
  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;

  -- Lock and validate every selected plan before any insertion or tombstone.
  for change in select rows.value from jsonb_array_elements(p_changes) as rows(value) order by rows.value->>'item_id' loop
    begin
      item_id := (change->>'item_id')::uuid;
      expected_item_revision := (change->>'expected_item_revision')::integer;
      meal_id := (change->>'meal_id')::uuid;
      expected_meal_revision := (change->>'expected_meal_revision')::integer;
      amount := (change->>'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='A selected item, meal, revision or portion is invalid';
    end;
    if jsonb_typeof(change)<>'object' or item_id is null or meal_id is null
      or expected_item_revision is null or expected_item_revision<1
      or expected_meal_revision is null or expected_meal_revision<1
      or amount is null or amount<=0 or amount>=100000000 then
      raise exception using errcode='22023',message='A selected item, meal, revision or portion is invalid';
    end if;
    if item_id=any(seen_item_ids) then raise exception using errcode='22023',message='A planned item can only be selected once'; end if;
    seen_item_ids := array_append(seen_item_ids,item_id);
    select item.* into item_row from public.day_items as item
      where item.user_id=actor_id and item.id=item_id and item.local_date=p_local_date for update;
    if not found or item_row.state<>'planned' or item_row.revision<>expected_item_revision then
      raise exception using errcode='40001',message='At least one selected plan changed; refresh the day and preview all choices again';
    end if;
  end loop;

  -- Lock/validate every source revision and section before any write.
  for change in select rows.value from jsonb_array_elements(p_changes) as rows(value) order by rows.value->>'meal_id' loop
    item_id := (change->>'item_id')::uuid;
    meal_id := (change->>'meal_id')::uuid;
    expected_meal_revision := (change->>'expected_meal_revision')::integer;
    select item.* into item_row from public.day_items as item
      where item.user_id=actor_id and item.id=item_id and item.local_date=p_local_date;
    select meal.revision,meal.sections,meal.archived_at into meal_revision,meal_sections,meal_archived_at
      from public.meals as meal where meal.user_id=actor_id and meal.id=meal_id for share;
    if not found or meal_archived_at is not null or not (item_row.section=any(meal_sections)) then
      raise exception using errcode='23503',message='A suggested meal is unavailable or no longer tagged for its plan';
    end if;
    if meal_revision<>expected_meal_revision then
      raise exception using errcode='40001',message='A suggested meal changed; refresh and review the whole preview again';
    end if;
  end loop;

  for change in select rows.value from jsonb_array_elements(p_changes) as rows(value) order by rows.value->>'item_id' loop
    item_id := (change->>'item_id')::uuid;
    meal_id := (change->>'meal_id')::uuid;
    amount := (change->>'amount')::numeric;
    expected_item_revision := (change->>'expected_item_revision')::integer;
    select item.* into item_row from public.day_items as item
      where item.user_id=actor_id and item.id=item_id and item.local_date=p_local_date;
    planned_result := public.plan_day_item(gen_random_uuid(),p_local_date,item_row.section,'meal',meal_id,amount,'serving',null);
    planned_item_id := (planned_result->>'item_id')::uuid;
    planned_item_revision := (planned_result->>'item_revision')::integer;
    update public.day_items as item set state='removed',revision=item.revision+1,updated_at=now()
      where item.user_id=actor_id and item.id=item_id and item.revision=expected_item_revision;
    if not found then raise exception using errcode='40001',message='A selected plan changed during acceptance; no changes were saved'; end if;
    update public.days as day set revision=day.revision+1,updated_at=now()
      where day.user_id=actor_id and day.local_date=p_local_date returning day.revision into day_revision;
    accepted_changes := accepted_changes || jsonb_build_array(jsonb_build_object(
      'replaced_item_id',item_id,'replaced_item_revision',expected_item_revision+1,
      'item_id',planned_item_id,'item_revision',planned_item_revision,'meal_id',meal_id
    ));
  end loop;

  select jsonb_build_object('changes',accepted_changes,'day_revision',day.revision,'planned_count',count(*) filter (where item.state='planned'))
    into result from public.days as day join public.day_items as item
      on item.user_id=day.user_id and item.local_date=day.local_date
    where day.user_id=actor_id and day.local_date=p_local_date group by day.revision;
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'accept_whole_day_shuffle',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.accept_whole_day_shuffle(uuid,date,jsonb) from public,anon;
grant execute on function public.accept_whole_day_shuffle(uuid,date,jsonb) to authenticated;
comment on function public.accept_whole_day_shuffle(uuid,date,jsonb) is
  'Atomically accepts a whole-day Shuffle preview after prevalidating all planned-item and saved-meal revisions; any failed slot rolls back every replacement.';
