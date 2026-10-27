create or replace function public.reverse_carry_decision(
  p_request_id uuid,
  p_decision_id uuid,
  p_expected_week_revision integer,
  p_expected_revisions jsonb
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
  source_date_value date;
  week_start_value date;
  week_row public.weeks%rowtype;
  decision_row public.carry_decisions%rowtype;
  destination_row public.days%rowtype;
  entry jsonb;
  destination_dates date[] := array[]::date[];
  expected_revisions integer[] := array[]::integer[];
  reversed_dates jsonb := '[]'::jsonb;
  review_decisions jsonb := '[]'::jsonb;
  result jsonb;
  allocation_count integer := 0;
  allocation_total integer;
  index_value integer;
  previous_date date;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_decision_id is null or p_expected_week_revision is null or p_expected_week_revision<1
    or p_expected_revisions is null or jsonb_typeof(p_expected_revisions)<>'array' then
    raise exception using errcode='22023',message='A request, decision, current week revision and destination revisions are required';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'decision_id',p_decision_id,'expected_week_revision',p_expected_week_revision,'expected_revisions',p_expected_revisions
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'reverse_carry_decision' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select decision.source_date into source_date_value from public.carry_decisions as decision
    where decision.user_id=actor_id and decision.id=p_decision_id;
  if not found then raise exception using errcode='P0002',message='Carry decision not found'; end if;
  week_start_value := pg_catalog.date_trunc('week',source_date_value::timestamp)::date;
  perform private.ensure_week_for_planning(actor_id,week_start_value);
  select week.* into week_row from public.weeks as week
    where week.user_id=actor_id and week.week_start=week_start_value for update;
  if not found or week_row.revision<>p_expected_week_revision then
    raise exception using errcode='40001',message='This week changed before reversal; refresh and review the carry history';
  end if;

  for entry in select value from jsonb_array_elements(p_expected_revisions) as entries(value)
  loop
    if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'destination_date')<>'string'
      or jsonb_typeof(entry->'expected_revision')<>'number' then
      raise exception using errcode='22023',message='Each reversal destination needs a date and current day revision';
    end if;
    begin
      destination_dates := array_append(destination_dates,(entry->>'destination_date')::date);
      if (entry->>'expected_revision')::numeric<>trunc((entry->>'expected_revision')::numeric) then
        raise exception using errcode='22023',message='A destination revision must be a positive whole number';
      end if;
      expected_revisions := array_append(expected_revisions,(entry->>'expected_revision')::integer);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='A reversal destination contains an invalid date or revision';
    end;
    allocation_count := allocation_count+1;
  end loop;

  select count(*) into allocation_total from public.carry_allocations as allocation
    where allocation.user_id=actor_id and allocation.decision_id=p_decision_id;
  if allocation_total=0 or allocation_total<>allocation_count then
    raise exception using errcode='22023',message='Only a saved transfer with its complete recipient list can be reversed';
  end if;
  for index_value in 1..allocation_count loop
    if destination_dates[index_value] is null or expected_revisions[index_value]<1
      or (index_value>1 and destination_dates[index_value]<=destination_dates[index_value-1]) then
      raise exception using errcode='22023',message='Reversal destinations must be distinct, ascending dates with positive revisions';
    end if;
  end loop;
  if exists(
    select 1 from public.carry_allocations as allocation
    where allocation.user_id=actor_id and allocation.decision_id=p_decision_id
      and not (allocation.destination_date=any(destination_dates))
  ) or exists(
    select 1 from unnest(destination_dates) as supplied(destination_date)
    where not exists(select 1 from public.carry_allocations as allocation
      where allocation.user_id=actor_id and allocation.decision_id=p_decision_id
        and allocation.destination_date=supplied.destination_date)
  ) then raise exception using errcode='22023',message='The recipient list no longer matches the saved decision'; end if;

  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=any(destination_dates)
    order by day.local_date for update;
  for index_value in 1..allocation_count loop
    select day.* into destination_row from public.days as day
      where day.user_id=actor_id and day.local_date=destination_dates[index_value] for update;
    if not found or destination_row.week_start<>week_start_value
      or destination_row.revision<>expected_revisions[index_value] then
      raise exception using errcode='40001',message='A carry recipient changed before reversal; refresh and review the updated state';
    end if;
  end loop;

  select decision.* into decision_row from public.carry_decisions as decision
    where decision.user_id=actor_id and decision.id=p_decision_id for update;
  if not found or decision_row.state<>'active' or decision_row.action='none' then
    raise exception using errcode='40001',message='This carry decision is no longer an active transfer';
  end if;

  update public.carry_decisions as decision set state='reversed',reversed_at=now()
    where decision.user_id=actor_id and decision.id=p_decision_id;
  for index_value in 1..allocation_count loop
    select day.* into destination_row from public.days as day
      where day.user_id=actor_id and day.local_date=destination_dates[index_value];
    update public.days as day set revision=day.revision+1,updated_at=now()
      where day.user_id=actor_id and day.local_date=destination_dates[index_value];
    reversed_dates := reversed_dates||jsonb_build_array(jsonb_build_object(
      'destination_date',destination_dates[index_value],'was_completed',destination_row.status='completed',
      'signed_delta_kcal',(select allocation.signed_delta_kcal from public.carry_allocations as allocation
        where allocation.user_id=actor_id and allocation.decision_id=p_decision_id
          and allocation.destination_date=destination_dates[index_value])));
    if destination_row.status='completed' then
      with changed as (
        update public.carry_decisions as downstream set needs_review=true
          where downstream.user_id=actor_id and downstream.source_date=destination_dates[index_value]
            and downstream.state='active' and downstream.needs_review=false
          returning downstream.id,downstream.source_date
      )
      select review_decisions||coalesce(jsonb_agg(jsonb_build_object('decision_id',changed.id,'source_date',changed.source_date)),'[]'::jsonb)
        into review_decisions from changed;
    end if;
  end loop;

  result := jsonb_build_object('decision_id',p_decision_id,'state','reversed','reversed_destinations',reversed_dates,
    'downstream_decisions_needing_review',review_decisions);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'reverse_carry_decision',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.reverse_carry_decision(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.reverse_carry_decision(uuid,uuid,integer,jsonb) to authenticated;
comment on function public.reverse_carry_decision(uuid,uuid,integer,jsonb) is
  'Reverses an active carry atomically. Open targets lose the ledger effect; completed snapshots stay frozen and downstream decisions are flagged for review.';
