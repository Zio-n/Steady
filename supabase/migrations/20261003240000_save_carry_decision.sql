create or replace function public.save_carry_decision(
  p_request_id uuid,
  p_source_date date,
  p_expected_source_revision integer,
  p_expected_log_revision integer,
  p_week_start date,
  p_expected_week_revision integer,
  p_action public.carry_action,
  p_amount_kcal numeric,
  p_allocations jsonb
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
  week_row public.weeks%rowtype;
  source_row public.days%rowtype;
  destination_row public.days%rowtype;
  carry_difference numeric;
  carry_threshold numeric;
  carry_sign integer;
  amount_cents bigint;
  base_cents bigint;
  residual_cents bigint;
  expected_delta numeric;
  active_carry numeric;
  next_revision integer;
  decision_id uuid;
  source_week_start date;
  result jsonb;
  allocation_result jsonb := '[]'::jsonb;
  entry jsonb;
  destination_dates date[] := array[]::date[];
  delta_values numeric[] := array[]::numeric[];
  expected_revisions integer[] := array[]::integer[];
  next_revisions integer[] := array[]::integer[];
  previous_date date;
  allocation_count integer := 0;
  total_delta numeric := 0;
  index_value integer;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_source_date is null or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_log_revision is null or p_expected_log_revision<1 or p_week_start is null
    or p_expected_week_revision is null or p_expected_week_revision<1 or p_action is null
    or p_amount_kcal is null or p_allocations is null or jsonb_typeof(p_allocations)<>'array' then
    raise exception using errcode='22023',message='A source, current revisions, carry choice, amount and allocation list are required';
  end if;
  if extract(isodow from p_week_start)<>1 or p_amount_kcal<0 or p_amount_kcal>=100000000 then
    raise exception using errcode='22023',message='The carry week or amount is invalid';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'source_date',p_source_date,'expected_source_revision',p_expected_source_revision,
    'expected_log_revision',p_expected_log_revision,'week_start',p_week_start,
    'expected_week_revision',p_expected_week_revision,'action',p_action,
    'amount_kcal',p_amount_kcal,'allocations',p_allocations
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_carry_decision' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile
    where profile.user_id=actor_id and profile.onboarding_complete for share;
  if not found then raise exception using errcode='22023',message='Complete profile setup before saving a carry decision'; end if;
  local_today := (now() at time zone account_timezone)::date;
  source_week_start := pg_catalog.date_trunc('week',p_source_date::timestamp)::date;
  if p_week_start<>source_week_start then raise exception using errcode='22023',message='Carry decisions must use the source day’s Monday-first week'; end if;

  -- Establish the shared week → day lock order used by allocation edits and
  -- completion before materializing/locking any individual day rows.
  perform private.ensure_week_for_planning(actor_id,source_week_start);
  select week.* into week_row from public.weeks as week
    where week.user_id=actor_id and week.week_start=source_week_start for update;
  if not found or week_row.revision<>p_expected_week_revision then
    raise exception using errcode='40001',message='This week changed before the carry decision; refresh the preview';
  end if;
  perform private.ensure_day_for_log(actor_id,p_source_date);
  select day.* into source_row from public.days as day
    where day.user_id=actor_id and day.local_date=p_source_date for update;
  if not found or source_row.status<>'completed' or source_row.completed_target_kcal is null
    or source_row.completed_actual_kcal is null or source_row.completed_log_revision is null then
    raise exception using errcode='40001',message='Only a fully completed day can have a carry decision';
  end if;
  if source_row.revision<>p_expected_source_revision or source_row.log_revision<>p_expected_log_revision
    or source_row.completed_log_revision<>p_expected_log_revision then
    raise exception using errcode='40001',message='The completed day changed before saving; refresh and review it';
  end if;
  if exists(select 1 from public.carry_decisions as decision
      where decision.user_id=actor_id and decision.source_date=p_source_date and decision.state='active') then
    raise exception using errcode='40001',message='A carry decision is already saved for this completed day';
  end if;

  carry_difference := source_row.completed_actual_kcal-source_row.completed_target_kcal;
  carry_threshold := greatest(150,source_row.completed_target_kcal*0.10);
  if abs(carry_difference)<carry_threshold then
    raise exception using errcode='22023',message='This difference is below the carry review threshold';
  end if;

  for entry in select value from jsonb_array_elements(p_allocations) as entries(value)
  loop
    if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'destination_date')<>'string'
      or jsonb_typeof(entry->'signed_delta_kcal')<>'number' or jsonb_typeof(entry->'expected_revision')<>'number' then
      raise exception using errcode='22023',message='Each carry allocation needs a date, signed kcal amount and expected day revision';
    end if;
    begin
      destination_dates := array_append(destination_dates,(entry->>'destination_date')::date);
      delta_values := array_append(delta_values,(entry->>'signed_delta_kcal')::numeric);
      if (entry->>'expected_revision')::numeric<>trunc((entry->>'expected_revision')::numeric) then
        raise exception using errcode='22023',message='A destination revision must be a positive whole number';
      end if;
      expected_revisions := array_append(expected_revisions,(entry->>'expected_revision')::integer);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='A carry allocation contains an invalid date, amount or revision';
    end;
    allocation_count := allocation_count+1;
  end loop;

  if p_action='none' then
    if p_amount_kcal<>0 or allocation_count<>0 then
      raise exception using errcode='22023',message='Do nothing must have a zero amount and no destinations';
    end if;
  else
    if p_amount_kcal<=0 or p_amount_kcal>abs(carry_difference) or p_amount_kcal*100<>trunc(p_amount_kcal*100) then
      raise exception using errcode='22023',message='Carry amount must be positive, available and in 0.01 kcal increments';
    end if;
    if p_action='single_day' and allocation_count<>1 or p_action='spread' and allocation_count<2 then
      raise exception using errcode='22023',message='Choose one recipient for a single-day carry or at least two for a spread';
    end if;
    amount_cents := (p_amount_kcal*100)::bigint;
    base_cents := amount_cents/allocation_count;
    residual_cents := amount_cents%allocation_count;
    carry_sign := case when carry_difference<0 then 1 else -1 end;
    for index_value in 1..allocation_count loop
      if destination_dates[index_value] is null or destination_dates[index_value]<=p_source_date
        or destination_dates[index_value]<local_today or destination_dates[index_value]>=source_week_start+7
        or expected_revisions[index_value]<1
        or (index_value>1 and destination_dates[index_value]<=destination_dates[index_value-1]) then
        raise exception using errcode='22023',message='Carry recipients must be distinct, ascending, open future dates in the same week';
      end if;
      expected_delta := carry_sign*(base_cents+case when index_value<=residual_cents then 1 else 0 end)/100.0;
      if abs(delta_values[index_value])<0.01 or delta_values[index_value]<>expected_delta then
        raise exception using errcode='22023',message='Carry allocations must match the chosen amount and deterministic cent distribution';
      end if;
      total_delta := total_delta+delta_values[index_value];
    end loop;
    if total_delta<>carry_sign*p_amount_kcal then
      raise exception using errcode='22023',message='Signed carry allocations must exactly equal the selected amount';
    end if;

    for index_value in 1..allocation_count loop
      perform private.ensure_day_for_log(actor_id,destination_dates[index_value]);
    end loop;
    perform 1 from public.days as day where day.user_id=actor_id and day.local_date=any(destination_dates)
      order by day.local_date for update;

    for index_value in 1..allocation_count loop
      select day.* into destination_row from public.days as day
        where day.user_id=actor_id and day.local_date=destination_dates[index_value] for update;
      if not found or destination_row.status<>'open' or destination_row.revision<>expected_revisions[index_value]
        or destination_row.week_start<>source_week_start then
        raise exception using errcode='40001',message='A carry destination changed or is no longer open; refresh the preview';
      end if;
      select coalesce(sum(carry.signed_delta_kcal),0) into active_carry
        from public.carry_allocations as carry join public.carry_decisions as decision
          on decision.user_id=carry.user_id and decision.id=carry.decision_id
        where carry.user_id=actor_id and carry.destination_date=destination_dates[index_value] and decision.state='active';
      if destination_row.base_planned_target_kcal+active_carry+delta_values[index_value]<1
        or destination_row.base_planned_target_kcal+active_carry+delta_values[index_value]>=1000000 then
        raise exception using errcode='22023',message='This carry would make a recipient target invalid; adjust the amount or recipients';
      end if;
      next_revisions := array_append(next_revisions,destination_row.revision+1);
    end loop;
  end if;

  insert into public.carry_decisions(user_id,source_date,source_log_revision,completed_target_kcal,actual_kcal,
      difference_kcal,action,amount_kcal,state,needs_review,request_id)
    values(actor_id,p_source_date,source_row.completed_log_revision,source_row.completed_target_kcal,
      source_row.completed_actual_kcal,carry_difference,p_action,p_amount_kcal,'active',false,p_request_id)
    returning id into decision_id;

  if p_action<>'none' then
    for index_value in 1..allocation_count loop
      update public.days as day set revision=next_revisions[index_value],updated_at=now()
        where day.user_id=actor_id and day.local_date=destination_dates[index_value];
      insert into public.carry_allocations(user_id,decision_id,destination_date,signed_delta_kcal,destination_revision)
        values(actor_id,decision_id,destination_dates[index_value],delta_values[index_value],next_revisions[index_value]);
      allocation_result := allocation_result||jsonb_build_array(jsonb_build_object(
        'destination_date',destination_dates[index_value],'signed_delta_kcal',delta_values[index_value],
        'destination_revision',next_revisions[index_value]));
    end loop;
  end if;

  result := jsonb_build_object('decision_id',decision_id,'source_date',p_source_date,'action',p_action,
    'amount_kcal',p_amount_kcal,'difference_kcal',carry_difference,'needs_review',false,'allocations',allocation_result);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'save_carry_decision',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_carry_decision(uuid,date,integer,integer,date,integer,public.carry_action,numeric,jsonb) from public,anon;
grant execute on function public.save_carry_decision(uuid,date,integer,integer,date,integer,public.carry_action,numeric,jsonb) to authenticated;
comment on function public.save_carry_decision(uuid,date,integer,integer,date,integer,public.carry_action,numeric,jsonb) is
  'Persists an explicit no-carry or signed same-week carry decision atomically with optimistic day/week checks and an idempotency receipt.';

create or replace function public.complete_day(
  p_request_id uuid,
  p_local_date date,
  p_expected_day_revision integer,
  p_expected_log_revision integer
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
  day_row public.days%rowtype;
  actual_kcal numeric(14,4);
  effective_target_kcal numeric(12,2);
  active_carry numeric;
  eaten_count integer;
  calorie_count integer;
  planned_count integer;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_expected_day_revision is null or p_expected_day_revision<1
    or p_expected_log_revision is null or p_expected_log_revision<1 then
    raise exception using errcode='22023',message='A completion request, date, and current day and log revisions are required';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'expected_day_revision',p_expected_day_revision,'expected_log_revision',p_expected_log_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'complete_day' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id for share;
  if not found then raise exception using errcode='22023',message='Complete profile setup before finishing a day'; end if;
  local_today := (now() at time zone account_timezone)::date;
  if p_local_date>local_today then raise exception using errcode='22023',message='A future day cannot be completed'; end if;

  perform private.ensure_week_for_planning(actor_id,pg_catalog.date_trunc('week',p_local_date::timestamp)::date);
  perform 1 from public.weeks as week
    where week.user_id=actor_id and week.week_start=pg_catalog.date_trunc('week',p_local_date::timestamp)::date for update;
  perform private.ensure_day_for_log(actor_id,p_local_date);
  select day.* into day_row from public.days as day
    where day.user_id=actor_id and day.local_date=p_local_date for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable; refresh before finishing it'; end if;
  if day_row.status<>'open' then raise exception using errcode='40001',message='This day is already complete'; end if;
  if day_row.revision<>p_expected_day_revision or day_row.log_revision<>p_expected_log_revision then
    raise exception using errcode='40001',message='This day changed before completion; refresh and review its entries';
  end if;

  perform 1 from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date order by item.id for update;
  select count(*) filter (where item.state='eaten'),
      count(*) filter (where item.state='eaten' and jsonb_typeof(item.eaten_snapshot->'calories'->'value')='number'),
      count(*) filter (where item.state='planned'),
      coalesce(sum(case when item.state='eaten' and jsonb_typeof(item.eaten_snapshot->'calories'->'value')='number'
        then (item.eaten_snapshot->'calories'->>'value')::numeric else 0 end),0)
    into eaten_count,calorie_count,planned_count,actual_kcal
    from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date;
  if eaten_count<>calorie_count then
    raise exception using errcode='40001',message='An eaten entry is missing its captured calorie value; review the day before completing it';
  end if;
  if actual_kcal<0 or actual_kcal>=100000000 then raise exception using errcode='22003',message='The eaten calorie total is outside the supported range'; end if;
  select coalesce(sum(carry.signed_delta_kcal),0) into active_carry
    from public.carry_allocations as carry join public.carry_decisions as decision
      on decision.user_id=carry.user_id and decision.id=carry.decision_id
    where carry.user_id=actor_id and carry.destination_date=p_local_date and decision.state='active';
  effective_target_kcal := day_row.base_planned_target_kcal+active_carry;
  if effective_target_kcal<=0 or effective_target_kcal>=1000000 then
    raise exception using errcode='40001',message='This day has no valid effective target snapshot';
  end if;

  update public.days as day set status='completed',completed_target_kcal=effective_target_kcal,
      completed_actual_kcal=actual_kcal,completed_at=now(),completed_log_revision=day_row.log_revision,
      revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date;
  result := jsonb_build_object('local_date',p_local_date,'completed_target_kcal',effective_target_kcal,
    'completed_actual_kcal',actual_kcal,'completed_log_revision',day_row.log_revision,'revision',day_row.revision+1,
    'planned_items_left_uneaten',planned_count);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'complete_day',fingerprint,result);
  return result;
end;
$$;

comment on function public.complete_day(uuid,date,integer,integer) is
  'Explicitly completes a non-future day after revision checks, snapshots the effective target including active inbound carries and eaten-only calories, leaves plans uneaten, and records an idempotency receipt.';
