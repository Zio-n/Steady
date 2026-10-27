-- New calendar entries may exist without a weekly plan or a calorie target.
-- Historical days retain their existing week links and snapshots.
alter table public.days alter column week_start drop not null;
alter table public.days alter column base_planned_target_kcal drop not null;

comment on column public.days.week_start is
  'Legacy weekly-plan link. Null for new calendar-first days created by an explicit entry action.';
comment on column public.days.base_planned_target_kcal is
  'Legacy target snapshot; nullable for a new calendar day without a target. Open-day display uses target history.';

create or replace function private.ensure_calendar_day_for_entry(p_user_id uuid, p_local_date date)
returns public.days
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_row public.profile_target_versions%rowtype;
  day_row public.days%rowtype;
  nutrient_snapshot jsonb := '{}'::jsonb;
begin
  if actor_id is null or actor_id <> p_user_id then
    raise exception using errcode = '28000', message = 'Authentication required for this account';
  end if;
  if p_local_date is null then
    raise exception using errcode = '22023', message = 'A local date is required';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.user_id = p_user_id and profile.onboarding_complete
  ) then
    raise exception using errcode = '22023', message = 'Complete profile setup before adding a dated entry';
  end if;

  select version.* into target_row
    from public.profile_target_versions as version
    where version.user_id = p_user_id and version.effective_from <= p_local_date
    order by version.effective_from desc limit 1;

  if target_row.user_id is not null then
    nutrient_snapshot := jsonb_build_object(
      'targets', target_row.nutrient_targets,
      'fields', target_row.nutrient_field_snapshot
    );
  end if;

  insert into public.days (
    user_id, local_date, week_start, base_planned_target_kcal, nutrient_target_snapshot
  ) values (
    p_user_id, p_local_date, null, target_row.base_daily_target_kcal, nutrient_snapshot
  ) on conflict (user_id, local_date) do nothing;

  select day.* into day_row from public.days as day
    where day.user_id = p_user_id and day.local_date = p_local_date for update;
  return day_row;
end;
$$;

revoke all on function private.ensure_calendar_day_for_entry(uuid,date) from public, anon, authenticated;
comment on function private.ensure_calendar_day_for_entry(uuid,date) is
  'Creates or locks a date only during an explicit owner-authorised entry action; never creates a week or routine.';
