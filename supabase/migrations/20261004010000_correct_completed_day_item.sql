create or replace function public.correct_completed_day_item(
  p_request_id uuid,
  p_local_date date,
  p_expected_day_revision integer,
  p_expected_log_revision integer,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_action text,
  p_amount numeric default null,
  p_unit text default null,
  p_section public.meal_section default null,
  p_source_kind text default null,
  p_source_id uuid default null,
  p_manual_payload jsonb default null
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
  week_row public.weeks%rowtype;
  day_row public.days%rowtype;
  item_row public.day_items%rowtype;
  mutation_result jsonb;
  actual_kcal numeric(14,4);
  old_actual_kcal numeric(14,4);
  eaten_count integer;
  calorie_count integer;
  superseded_ids jsonb := '[]'::jsonb;
  result jsonb;
  week_start_value date;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_expected_day_revision is null or p_expected_day_revision<1
    or p_expected_log_revision is null or p_expected_log_revision<1 or p_item_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1 or p_action is null
    or p_action not in ('resize','remove','restore','replace') then
    raise exception using errcode='22023',message='A request, completed day, current revisions and supported correction are required';
  end if;
  if p_action='replace' and (p_section is null or p_source_kind not in ('food','meal','one_off_food','one_off_meal')) then
    raise exception using errcode='22023',message='A replacement needs a valid meal section and source';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'expected_day_revision',p_expected_day_revision,'expected_log_revision',p_expected_log_revision,
    'item_id',p_item_id,'expected_item_revision',p_expected_item_revision,'action',p_action,'amount',p_amount,'unit',p_unit,
    'section',p_section,'source_kind',p_source_kind,'source_id',p_source_id,'manual_payload',p_manual_payload
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'correct_completed_day_item' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  week_start_value := pg_catalog.date_trunc('week',p_local_date::timestamp)::date;
  perform private.ensure_week_for_planning(actor_id,week_start_value);
  select week.* into week_row from public.weeks as week
    where week.user_id=actor_id and week.week_start=week_start_value for update;
  if not found then raise exception using errcode='40001',message='This week is unavailable; refresh before correcting the day'; end if;
  select day.* into day_row from public.days as day
    where day.user_id=actor_id and day.local_date=p_local_date for update;
  if not found or day_row.status<>'completed' then raise exception using errcode='40001',message='This correction applies only to a completed day'; end if;
  if day_row.revision<>p_expected_day_revision or day_row.log_revision<>p_expected_log_revision
    or day_row.completed_log_revision<>p_expected_log_revision then
    raise exception using errcode='40001',message='This completed day changed; refresh and review it before correcting the log';
  end if;
  old_actual_kcal := day_row.completed_actual_kcal;

  perform 1 from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date order by item.id for update;
  select item.* into item_row from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This item changed; refresh and review the current entry';
  end if;
  if exists(select 1 from public.carry_decisions as decision where decision.user_id=actor_id
      and decision.source_date=p_local_date and decision.state='active' and decision.action<>'none') then
    raise exception using errcode='40001',message='Reverse active transfers from this day before correcting its eaten log';
  end if;

  if p_action='resize' and item_row.state<>'eaten' then raise exception using errcode='22023',message='Only eaten items can have their portion edited'; end if;
  if p_action in ('remove','replace') and item_row.state<>'eaten' then raise exception using errcode='40001',message='This item is no longer an eaten entry'; end if;
  if p_action='restore' and (item_row.state<>'removed' or item_row.eaten_snapshot is null) then
    raise exception using errcode='40001',message='This removed entry can no longer be restored';
  end if;

  -- Mutate through the existing correction code so portions, snapshots and history stay identical.
  -- The temporary reopen is invisible outside this transaction and rolls back on every failure.
  update public.days as day set status='open',completed_actual_kcal=null,completed_target_kcal=null,
      completed_at=null,completed_log_revision=null where day.user_id=actor_id and day.local_date=p_local_date;
  if p_action='replace' then
    mutation_result := public.replace_day_item(gen_random_uuid(),p_local_date,p_item_id,p_expected_item_revision,
      p_section,p_source_kind,p_source_id,p_amount,p_unit,p_manual_payload);
  else
    mutation_result := public.revise_day_item(gen_random_uuid(),p_local_date,p_item_id,p_expected_item_revision,
      p_action,p_amount,p_unit);
  end if;

  select count(*) filter (where item.state='eaten'),
      count(*) filter (where item.state='eaten' and jsonb_typeof(item.eaten_snapshot->'calories'->'value')='number'),
      coalesce(sum(case when item.state='eaten' and jsonb_typeof(item.eaten_snapshot->'calories'->'value')='number'
        then (item.eaten_snapshot->'calories'->>'value')::numeric else 0 end),0)
    into eaten_count,calorie_count,actual_kcal from public.day_items as item
    where item.user_id=actor_id and item.local_date=p_local_date;
  if eaten_count<>calorie_count or actual_kcal<0 or actual_kcal>=100000000 then
    raise exception using errcode='22003',message='The corrected eaten log has incomplete or unsupported calorie values';
  end if;

  with changed as (
    update public.carry_decisions as decision set state='superseded'
      where decision.user_id=actor_id and decision.source_date=p_local_date and decision.state='active' and decision.action='none'
      returning decision.id
  ) select coalesce(jsonb_agg(changed.id),'[]'::jsonb) into superseded_ids from changed;
  update public.carry_decisions as decision set needs_review=true
    where decision.user_id=actor_id and decision.source_date=p_local_date and decision.state='active';

  update public.days as day set status='completed',completed_target_kcal=day_row.completed_target_kcal,
      completed_actual_kcal=actual_kcal,completed_at=day_row.completed_at,completed_log_revision=day.log_revision,
      revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning * into day_row;
  result := jsonb_build_object(
    'local_date',p_local_date,'action',p_action,'old_actual_kcal',old_actual_kcal,
    'new_actual_kcal',actual_kcal,'frozen_target_kcal',day_row.completed_target_kcal,
    'old_difference_kcal',old_actual_kcal-day_row.completed_target_kcal,
    'new_difference_kcal',actual_kcal-day_row.completed_target_kcal,
    'completed_log_revision',day_row.completed_log_revision,'revision',day_row.revision,
    'mutation',mutation_result,'superseded_noop_decision_ids',superseded_ids
  );
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'correct_completed_day_item',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.correct_completed_day_item(uuid,date,integer,integer,uuid,integer,text,numeric,text,public.meal_section,text,uuid,jsonb) from public,anon;
grant execute on function public.correct_completed_day_item(uuid,date,integer,integer,uuid,integer,text,numeric,text,public.meal_section,text,uuid,jsonb) to authenticated;
comment on function public.correct_completed_day_item(uuid,date,integer,integer,uuid,integer,text,numeric,text,public.meal_section,text,uuid,jsonb) is
  'Atomically corrects a completed eaten log after active transfers are reversed, preserving the frozen target and recomputing completed actual calories.';
