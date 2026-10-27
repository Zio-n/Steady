create or replace function public.save_week_allocation(
  p_request_id uuid,
  p_week_start date,
  p_expected_revision integer,
  p_targets jsonb,
  p_allocation_kind public.allocation_kind
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
  target_value numeric;
  target_values numeric[] := array[]::numeric[];
  target_sum numeric := 0;
  allocation_count integer;
  next_revision integer;
  entry jsonb;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_week_start is null or extract(isodow from p_week_start)<>1
    or p_expected_revision is null or p_expected_revision<1
    or p_targets is null or jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets)<>7
    or p_allocation_kind is null then
    raise exception using errcode='22023',message='A request, Monday week, current revision, allocation mode and seven daily targets are required';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'week_start',p_week_start,'expected_revision',p_expected_revision,'targets',p_targets,'allocation_kind',p_allocation_kind
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_week_allocation' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id for share;
  if not found then raise exception using errcode='22023',message='Complete profile setup before saving a weekly allocation'; end if;
  local_today := (now() at time zone account_timezone)::date;
  if p_week_start<pg_catalog.date_trunc('week',local_today::timestamp)::date then
    raise exception using errcode='22023',message='Past weekly allocations are read-only';
  end if;

  week_row := private.ensure_week_for_planning(actor_id,p_week_start);
  select week.* into week_row from public.weeks as week
    where week.user_id=actor_id and week.week_start=p_week_start for update;
  if week_row.revision<>p_expected_revision then
    raise exception using errcode='40001',message='This weekly allocation changed elsewhere; refresh before saving';
  end if;

  perform 1 from public.days as day
    where day.user_id=actor_id and day.week_start=p_week_start
    order by day.local_date for update;

  for entry in select value from jsonb_array_elements(p_targets) with ordinality as entries(value,ordinality) order by ordinality
  loop
    if jsonb_typeof(entry)<>'number' then
      raise exception using errcode='22023',message='Each daily target must be a positive whole-kcal number';
    end if;
    begin target_value := (entry #>> '{}')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode='22023',message='Each daily target must be a positive whole-kcal number';
    end;
    if target_value<>trunc(target_value) or target_value<=0 or target_value>=1000000 then
      raise exception using errcode='22023',message='Each daily target must be a positive whole-kcal amount below 1,000,000';
    end if;
    target_values := array_append(target_values,target_value);
    target_sum := target_sum+target_value;
  end loop;
  if target_sum<>week_row.budget_kcal then
    raise exception using errcode='22023',message='The seven daily targets must exactly match this week’s budget';
  end if;

  select count(*) into allocation_count from public.week_allocations as allocation
    where allocation.user_id=actor_id and allocation.week_start=p_week_start;
  if allocation_count<>7 then raise exception using errcode='40001',message='This weekly allocation is incomplete; refresh before saving'; end if;
  if exists(
    select 1 from public.days as day
    join public.week_allocations as allocation on allocation.user_id=day.user_id
      and allocation.week_start=day.week_start
      and allocation.weekday=extract(isodow from day.local_date)::smallint
    where day.user_id=actor_id and day.week_start=p_week_start and day.status='completed'
      and target_values[allocation.weekday]<>(case when week_row.allocation_kind='one_off'
        then coalesce(allocation.override_target_kcal,allocation.base_target_kcal) else allocation.base_target_kcal end)
  ) then raise exception using errcode='40001',message='Completed day targets are locked; refresh and edit only open days'; end if;

  if exists(
    select 1 from public.week_allocations as allocation
    join public.carry_allocations as carry on carry.user_id=allocation.user_id
      and carry.destination_date=p_week_start+(allocation.weekday-1)
    join public.carry_decisions as decision on decision.user_id=carry.user_id and decision.id=carry.decision_id
    where allocation.user_id=actor_id and allocation.week_start=p_week_start
      and decision.state='active' and target_values[allocation.weekday]<>(case when week_row.allocation_kind='one_off'
        then coalesce(allocation.override_target_kcal,allocation.base_target_kcal) else allocation.base_target_kcal end)
  ) then
    raise exception using errcode='40001',message='An accepted carry affects a day being changed; refresh and review its adjustment before saving';
  end if;

  next_revision := week_row.revision+1;
  if p_allocation_kind='one_off' then
    update public.week_allocations as allocation set override_target_kcal=target_values[allocation.weekday]
      where allocation.user_id=actor_id and allocation.week_start=p_week_start;
  else
    update public.week_allocations as allocation set base_target_kcal=target_values[allocation.weekday],override_target_kcal=null
      where allocation.user_id=actor_id and allocation.week_start=p_week_start;
  end if;
  update public.days as day set base_planned_target_kcal=target_values[extract(isodow from day.local_date)::integer],
      revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.week_start=p_week_start and day.status='open'
      and day.base_planned_target_kcal<>target_values[extract(isodow from day.local_date)::integer];
  update public.weeks as week set allocation_kind=p_allocation_kind,revision=next_revision,updated_at=now()
    where week.user_id=actor_id and week.week_start=p_week_start;

  result := jsonb_build_object('week_start',p_week_start,'revision',next_revision,'budget_kcal',week_row.budget_kcal,
    'allocation_kind',p_allocation_kind,'targets',to_jsonb(target_values));
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'save_week_allocation',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_week_allocation(uuid,date,integer,jsonb,public.allocation_kind) from public,anon;
grant execute on function public.save_week_allocation(uuid,date,integer,jsonb,public.allocation_kind) to authenticated;

create or replace function public.save_week_allocation(
  p_request_id uuid,
  p_week_start date,
  p_expected_revision integer,
  p_targets jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.save_week_allocation(p_request_id,p_week_start,p_expected_revision,p_targets,'recurring'::public.allocation_kind);
$$;

revoke all on function public.save_week_allocation(uuid,date,integer,jsonb) from public,anon;
grant execute on function public.save_week_allocation(uuid,date,integer,jsonb) to authenticated;
comment on function public.save_week_allocation(uuid,date,integer,jsonb,public.allocation_kind) is
  'Atomically saves a balanced recurring or selected-week one-off allocation, preserving completed targets and carry decisions with optimistic revisions and idempotency.';
