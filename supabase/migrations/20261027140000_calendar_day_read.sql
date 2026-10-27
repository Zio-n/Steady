-- Read a calendar date without creating a day, week, routine occurrence or carry record.
-- Existing completion snapshots remain authoritative for completed legacy days.
create or replace function public.read_calendar_day(p_local_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  day_row public.days%rowtype;
  target_row public.profile_target_versions%rowtype;
  day_value jsonb;
  item_values jsonb;
  target_value jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_local_date is null then
    raise exception using errcode = '22023', message = 'A local date is required';
  end if;

  select day.* into day_row
    from public.days as day
    where day.user_id = actor_id and day.local_date = p_local_date;

  select version.* into target_row
    from public.profile_target_versions as version
    where version.user_id = actor_id and version.effective_from <= p_local_date
    order by version.effective_from desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'section', item.section,
      'state', item.state,
      'source', item.source,
      'selected_amount', item.selected_amount,
      'selected_unit', item.selected_unit,
      'planned_payload', item.planned_payload,
      'eaten_snapshot', item.eaten_snapshot,
      'eaten_at', item.eaten_at,
      'revision', item.revision
    ) order by item.created_at, item.id), '[]'::jsonb)
    into item_values
    from public.day_items as item
    where item.user_id = actor_id and item.local_date = p_local_date
      and item.state <> 'removed';

  if day_row.user_id is null then
    day_value := null;
  else
    day_value := to_jsonb(day_row);
  end if;

  if day_row.status = 'completed' then
    target_value := jsonb_build_object(
      'calories_kcal', day_row.completed_target_kcal,
      'nutrients', day_row.nutrient_target_snapshot,
      'source', 'completed_snapshot'
    );
  elsif target_row.user_id is not null then
    target_value := jsonb_build_object(
      'calories_kcal', target_row.base_daily_target_kcal,
      'nutrients', jsonb_build_object(
        'targets', target_row.nutrient_targets,
        'fields', target_row.nutrient_field_snapshot
      ),
      'source', 'profile_version'
    );
  else
    target_value := jsonb_build_object(
      'calories_kcal', null,
      'nutrients', '{}'::jsonb,
      'source', 'unset'
    );
  end if;

  return jsonb_build_object(
    'local_date', p_local_date,
    'day', day_value,
    'target', target_value,
    'items', item_values
  );
end;
$$;

revoke all on function public.read_calendar_day(date) from public, anon;
grant execute on function public.read_calendar_day(date) to authenticated;
comment on function public.read_calendar_day(date) is
  'Stable account-scoped calendar read. Empty dates and historical routine plans are never materialised by reading.';
