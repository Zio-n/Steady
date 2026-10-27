revoke insert,update,delete on public.profiles,public.profile_target_versions from authenticated;

create or replace function public.save_profile_targets(
  p_request_id uuid,
  p_expected_revision integer,
  p_base_daily_target_kcal numeric,
  p_nutrient_targets jsonb,
  p_allocation_strategy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_timezone text;
  profile_revision integer;
  local_today date;
  nutrient_effective_date date;
  allocation_effective_monday date;
  tomorrow_version public.profile_target_versions%rowtype;
  allocation_version public.profile_target_versions%rowtype;
  active_pattern_id uuid;
  new_pattern_id uuid;
  current_nutrient_value numeric;
  nutrient_key text;
  target_value numeric;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  allocation_base numeric[];
  target_week_budget numeric;
  prior_week_budget numeric;
  remaining_kcal numeric;
  allocation_valid boolean;
  base_changed boolean;
  nutrients_changed boolean;
  updated_revision integer;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'A profile revision is required';
  end if;
  if p_base_daily_target_kcal is null or p_base_daily_target_kcal <= 0
    or p_base_daily_target_kcal >= 1000000
    or p_base_daily_target_kcal <> trunc(p_base_daily_target_kcal) then
    raise exception using errcode = '22023', message = 'Daily calorie target must be a positive whole number';
  end if;
  if p_nutrient_targets is null or jsonb_typeof(p_nutrient_targets) <> 'object'
    or (select count(*) from jsonb_object_keys(p_nutrient_targets)) > 32 then
    raise exception using errcode = '22023', message = 'Nutrient targets must be an object';
  end if;

  fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'expected_revision',p_expected_revision,
        'base_daily_target_kcal',p_base_daily_target_kcal,
        'nutrient_targets',p_nutrient_targets,
        'allocation_strategy',p_allocation_strategy
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || p_request_id::text,0)
  );
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'save_profile_targets' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.revision,profile.timezone
    into profile_revision,actor_timezone
    from public.profiles as profile
    where profile.user_id = actor_id and profile.onboarding_complete
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Complete profile setup before changing targets';
  end if;
  if profile_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'Profile changed; refresh and review the target preview';
  end if;

  for nutrient_key,target_value in
    select key,value::text::numeric from jsonb_each(p_nutrient_targets)
  loop
    if target_value is null or target_value < 0 or target_value >= 100000000
      or not exists (
        select 1 from public.nutrient_fields as field
        where field.user_id = actor_id and field.field_id = nutrient_key and field.archived_at is null
      ) then
      raise exception using errcode = '22023', message = 'A nutrient target is invalid or unavailable';
    end if;
  end loop;

  local_today := (now() at time zone actor_timezone)::date;
  nutrient_effective_date := local_today + 1;
  allocation_effective_monday := pg_catalog.date_trunc('week',local_today::timestamp)::date + 7;
  select version.* into tomorrow_version
    from public.profile_target_versions as version
    where version.user_id = actor_id and version.effective_from <= nutrient_effective_date
    order by version.effective_from desc limit 1;
  select version.* into allocation_version
    from public.profile_target_versions as version
    where version.user_id = actor_id and version.effective_from <= allocation_effective_monday
    order by version.effective_from desc limit 1;
  if tomorrow_version.user_id is null or allocation_version.user_id is null then
    raise exception using errcode = '40001', message = 'Profile target history is incomplete; refresh before saving';
  end if;

  nutrients_changed := p_nutrient_targets <> tomorrow_version.nutrient_targets;
  base_changed := p_base_daily_target_kcal <> allocation_version.base_daily_target_kcal;
  if not nutrients_changed and not base_changed then
    raise exception using errcode = '22023', message = 'There are no target changes to save';
  end if;
  if base_changed and (p_allocation_strategy is null or p_allocation_strategy not in ('proportional','equal')) then
    raise exception using errcode = '22023', message = 'Choose a weekly allocation preview before changing the calorie target';
  end if;
  if not base_changed and p_allocation_strategy is not null then
    raise exception using errcode = '22023', message = 'An allocation strategy is only valid with a calorie target change';
  end if;

  if base_changed then
    target_week_budget := p_base_daily_target_kcal * 7;
    select pattern.id into active_pattern_id
      from public.weekly_pattern_versions as pattern
      where pattern.user_id = actor_id and pattern.effective_week_start <= allocation_effective_monday
      order by pattern.effective_week_start desc limit 1
      for update;
    if active_pattern_id is null then
      raise exception using errcode = '40001', message = 'No recurring weekly allocation exists for the preview';
    end if;
    select sum(day.target_kcal),count(*) into prior_week_budget,updated_revision
      from public.weekly_pattern_days as day
      where day.user_id = actor_id and day.pattern_version_id = active_pattern_id;
    if updated_revision <> 7 or prior_week_budget <= 0 then
      raise exception using errcode = '40001', message = 'The recurring allocation must contain seven valid days';
    end if;
    if prior_week_budget <> (select pattern.base_daily_target_kcal * 7
      from public.weekly_pattern_versions as pattern where pattern.user_id = actor_id and pattern.id = active_pattern_id) then
      raise exception using errcode = '40001', message = 'The recurring allocation does not match its weekly budget';
    end if;

    if p_allocation_strategy = 'equal' then
      allocation_base := array_fill(p_base_daily_target_kcal,array[7]);
    else
      with previous_days as (
        select day.weekday,day.target_kcal
          from public.weekly_pattern_days as day
          where day.user_id = actor_id and day.pattern_version_id = active_pattern_id
      ), scaled as (
        select weekday,target_kcal * target_week_budget / prior_week_budget as exact_kcal
          from previous_days
      ), floored as (
        select weekday,exact_kcal,pg_catalog.trunc(exact_kcal) as base_kcal,
          pg_catalog.row_number() over (order by exact_kcal - pg_catalog.trunc(exact_kcal) desc,weekday) as residual_rank,
          target_week_budget - sum(pg_catalog.trunc(exact_kcal)) over () as residual_kcal
          from scaled
      ), distributed as (
        select weekday,base_kcal + case when residual_rank <= residual_kcal then 1 else 0 end as final_kcal
          from floored
      )
      select array_agg(final_kcal order by weekday),bool_and(final_kcal > 0)
        into allocation_base,allocation_valid from distributed;
      if not coalesce(allocation_valid,false) then
        raise exception using errcode = '22023', message = 'Proportional allocation would create a zero day; select equal split';
      end if;
    end if;

    insert into public.weekly_pattern_versions(user_id,effective_week_start,base_daily_target_kcal)
      values (actor_id,allocation_effective_monday,p_base_daily_target_kcal)
      on conflict (user_id,effective_week_start) do update
        set base_daily_target_kcal = excluded.base_daily_target_kcal
      returning id into new_pattern_id;
    delete from public.weekly_pattern_days as day
      where day.user_id = actor_id and day.pattern_version_id = new_pattern_id;
    insert into public.weekly_pattern_days(user_id,pattern_version_id,weekday,target_kcal)
      select actor_id,new_pattern_id,weekday,allocation_base[weekday]
        from pg_catalog.generate_series(1,7) as weekdays(weekday);
  end if;

  if nutrients_changed then
    insert into public.profile_target_versions(user_id,effective_from,base_daily_target_kcal,nutrient_targets,timezone)
      values (
        actor_id,
        nutrient_effective_date,
        case when base_changed and nutrient_effective_date = allocation_effective_monday
          then p_base_daily_target_kcal else tomorrow_version.base_daily_target_kcal end,
        p_nutrient_targets,
        actor_timezone
      )
      on conflict (user_id,effective_from) do update
        set base_daily_target_kcal = excluded.base_daily_target_kcal,
            nutrient_targets = excluded.nutrient_targets,
            timezone = excluded.timezone,
            nutrient_field_snapshot = excluded.nutrient_field_snapshot,
            revision = public.profile_target_versions.revision + 1;
  end if;

  if base_changed or nutrients_changed then
    if allocation_effective_monday <> nutrient_effective_date then
      insert into public.profile_target_versions(user_id,effective_from,base_daily_target_kcal,nutrient_targets,timezone)
        values (
          actor_id,
          allocation_effective_monday,
          case when base_changed then p_base_daily_target_kcal else allocation_version.base_daily_target_kcal end,
          case when nutrients_changed then p_nutrient_targets else allocation_version.nutrient_targets end,
          actor_timezone
        )
        on conflict (user_id,effective_from) do update
          set base_daily_target_kcal = excluded.base_daily_target_kcal,
              nutrient_targets = excluded.nutrient_targets,
              timezone = excluded.timezone,
              nutrient_field_snapshot = excluded.nutrient_field_snapshot,
              revision = public.profile_target_versions.revision + 1;
    end if;
  end if;

  update public.profiles as profile
    set base_daily_target_kcal = case when base_changed then p_base_daily_target_kcal else profile.base_daily_target_kcal end,
        revision = profile.revision + 1,
        updated_at = now()
    where profile.user_id = actor_id
    returning revision into updated_revision;

  result := jsonb_build_object(
    'revision',updated_revision,
    'nutrient_effective_from',case when nutrients_changed then nutrient_effective_date else null end,
    'calorie_effective_week_start',case when base_changed then allocation_effective_monday else null end,
    'allocation_strategy',case when base_changed then p_allocation_strategy else null end,
    'weekly_allocation',case when base_changed then to_jsonb(allocation_base) else null end
  );
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'save_profile_targets',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_profile_targets(uuid,integer,numeric,jsonb,text) from public,anon;
grant execute on function public.save_profile_targets(uuid,integer,numeric,jsonb,text) to authenticated;
