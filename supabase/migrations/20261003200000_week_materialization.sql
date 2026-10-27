create or replace function private.ensure_week_for_planning(p_user_id uuid,p_week_start date)
returns public.weeks
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
  target_version public.profile_target_versions%rowtype;
  pattern_version public.weekly_pattern_versions%rowtype;
  week_row public.weeks%rowtype;
  allocation_count integer;
  allocation_sum numeric;
  target_budget numeric(14,2);
begin
  if p_user_id is null or p_week_start is null or extract(isodow from p_week_start)<>1 then
    raise exception using errcode='22023',message='Choose a Monday as the start of the week';
  end if;

  select profile.* into profile_row from public.profiles as profile
    where profile.user_id=p_user_id and profile.onboarding_complete for share;
  if not found then raise exception using errcode='22023',message='Complete profile setup before loading a weekly plan'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||p_week_start::text,0));

  select week.* into week_row from public.weeks as week
    where week.user_id=p_user_id and week.week_start=p_week_start for update;
  if found then
    select count(*),coalesce(sum(allocation.base_target_kcal),0)
      into allocation_count,allocation_sum from public.week_allocations as allocation
      where allocation.user_id=p_user_id and allocation.week_start=p_week_start;
    if allocation_count<>7 or allocation_sum<>week_row.budget_kcal then
      raise exception using errcode='40001',message='This week snapshot is incomplete or no longer balances; refresh before editing';
    end if;
    return week_row;
  end if;

  select pattern.* into pattern_version from public.weekly_pattern_versions as pattern
    where pattern.user_id=p_user_id and pattern.effective_week_start<=p_week_start
    order by pattern.effective_week_start desc limit 1 for share;
  if found then
    select count(*),coalesce(sum(day.target_kcal),0) into allocation_count,target_budget
      from public.weekly_pattern_days as day
      where day.user_id=p_user_id and day.pattern_version_id=pattern_version.id;
    if allocation_count<>7 or target_budget<>pattern_version.base_daily_target_kcal*7 then
      raise exception using errcode='40001',message='The applicable recurring allocation must contain seven days matching its weekly budget';
    end if;
    insert into public.weeks(user_id,week_start,budget_kcal,source_pattern_version_id,allocation_kind)
      values(p_user_id,p_week_start,target_budget,pattern_version.id,'recurring')
      returning * into week_row;
    insert into public.week_allocations(user_id,week_start,weekday,base_target_kcal)
      select p_user_id,p_week_start,day.weekday,day.target_kcal from public.weekly_pattern_days as day
      where day.user_id=p_user_id and day.pattern_version_id=pattern_version.id order by day.weekday;
  else
    select version.* into target_version from public.profile_target_versions as version
      where version.user_id=p_user_id and version.effective_from<=p_week_start
      order by version.effective_from desc limit 1 for share;
    if not found or target_version.base_daily_target_kcal is null then
      raise exception using errcode='22023',message='A calorie target is not available for this week';
    end if;
    target_budget := target_version.base_daily_target_kcal*7;
    insert into public.weeks(user_id,week_start,budget_kcal,source_pattern_version_id,allocation_kind)
      values(p_user_id,p_week_start,target_budget,null,'recurring')
      returning * into week_row;
    insert into public.week_allocations(user_id,week_start,weekday,base_target_kcal)
      select p_user_id,p_week_start,weekday,target_version.base_daily_target_kcal
      from pg_catalog.generate_series(1,7) as weekdays(weekday);
  end if;

  select count(*),coalesce(sum(allocation.base_target_kcal),0)
    into allocation_count,allocation_sum from public.week_allocations as allocation
    where allocation.user_id=p_user_id and allocation.week_start=p_week_start;
  if allocation_count<>7 or allocation_sum<>week_row.budget_kcal then
    raise exception using errcode='40001',message='The materialized week does not balance to its saved budget';
  end if;
  return week_row;
end;
$$;

revoke all on function private.ensure_week_for_planning(uuid,date) from public,anon,authenticated;

create or replace function public.ensure_week(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  week_row public.weeks%rowtype;
  allocations jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  week_row := private.ensure_week_for_planning(actor_id,p_week_start);
  select coalesce(jsonb_agg(to_jsonb(allocation) order by allocation.weekday),'[]'::jsonb)
    into allocations from public.week_allocations as allocation
    where allocation.user_id=actor_id and allocation.week_start=p_week_start;
  return jsonb_build_object('week',to_jsonb(week_row),'allocations',allocations);
end;
$$;

revoke all on function public.ensure_week(date) from public,anon;
grant execute on function public.ensure_week(date) to authenticated;
comment on function public.ensure_week(date) is
  'Idempotently materializes a Monday-first weekly budget snapshot from the applicable recurring pattern; existing one-off week snapshots remain authoritative.';

create or replace function private.ensure_day_for_log(p_user_id uuid, p_local_date date)
returns public.days
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_row public.days%rowtype;
  week_row public.weeks%rowtype;
  target_version public.profile_target_versions%rowtype;
  day_target numeric;
  monday date := pg_catalog.date_trunc('week',p_local_date::timestamp)::date;
  weekday_value integer := extract(isodow from p_local_date)::integer;
begin
  select version.* into target_version from public.profile_target_versions as version
    where version.user_id=p_user_id and version.effective_from<=p_local_date
    order by version.effective_from desc limit 1;
  if not found or target_version.base_daily_target_kcal is null then
    raise exception using errcode='22023',message='A calorie target is not available for this date';
  end if;
  week_row := private.ensure_week_for_planning(p_user_id,monday);
  select case when week_row.allocation_kind='one_off'
      then coalesce(allocation.override_target_kcal,allocation.base_target_kcal)
      else allocation.base_target_kcal end
    into day_target from public.week_allocations as allocation
    where allocation.user_id=p_user_id and allocation.week_start=monday and allocation.weekday=weekday_value;
  if day_target is null then raise exception using errcode='40001',message='This week has no saved allocation for the requested date'; end if;
  insert into public.days(user_id,local_date,week_start,base_planned_target_kcal,nutrient_target_snapshot)
    values(p_user_id,p_local_date,monday,day_target,jsonb_build_object(
      'targets',target_version.nutrient_targets,'fields',target_version.nutrient_field_snapshot
    )) on conflict(user_id,local_date) do nothing;
  select day.* into day_row from public.days as day where day.user_id=p_user_id and day.local_date=p_local_date for update;
  return day_row;
end;
$$;

revoke all on function private.ensure_day_for_log(uuid,date) from public,anon,authenticated;
