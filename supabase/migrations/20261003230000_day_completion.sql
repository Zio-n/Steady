alter table public.days
  add column completed_actual_kcal numeric(14,4) check (completed_actual_kcal is null or (completed_actual_kcal >= 0 and completed_actual_kcal < 100000000));

comment on column public.days.completed_actual_kcal is
  'Eaten-calorie snapshot captured when the user explicitly completes the day; planned items are excluded.';

update public.days as day set completed_actual_kcal=coalesce((
  select sum(case when item.state='eaten' and jsonb_typeof(item.eaten_snapshot->'calories'->'value')='number'
    then (item.eaten_snapshot->'calories'->>'value')::numeric else 0 end)
  from public.day_items as item where item.user_id=day.user_id and item.local_date=day.local_date
),0)
where day.status='completed' and day.completed_actual_kcal is null;

alter table public.days add constraint days_completion_actual_consistency check (
  (status='open' and completed_actual_kcal is null)
  or (status='completed' and completed_actual_kcal is not null)
);

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

  perform private.ensure_day_for_log(actor_id,p_local_date);
  perform 1 from public.weeks as week
    where week.user_id=actor_id and week.week_start=pg_catalog.date_trunc('week',p_local_date::timestamp)::date for update;
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
  if day_row.base_planned_target_kcal is null or day_row.base_planned_target_kcal<=0 then
    raise exception using errcode='40001',message='This day has no valid target snapshot';
  end if;

  update public.days as day set status='completed',completed_target_kcal=day_row.base_planned_target_kcal,
      completed_actual_kcal=actual_kcal,completed_at=now(),completed_log_revision=day_row.log_revision,
      revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date;
  result := jsonb_build_object('local_date',p_local_date,'completed_target_kcal',day_row.base_planned_target_kcal,
    'completed_actual_kcal',actual_kcal,'completed_log_revision',day_row.log_revision,'revision',day_row.revision+1,
    'planned_items_left_uneaten',planned_count);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'complete_day',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.complete_day(uuid,date,integer,integer) from public,anon;
grant execute on function public.complete_day(uuid,date,integer,integer) to authenticated;
comment on function public.complete_day(uuid,date,integer,integer) is
  'Explicitly completes a non-future day after revision checks, snapshots the effective base target and eaten-only calories, leaves plans uneaten, and records an idempotency receipt.';
