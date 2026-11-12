-- Remove obsolete product execution paths; preserve foods, meal groups and all dated snapshots.
-- Applied migrations remain history. This migration leaves no disabled recipe/routine APIs.
-- Run after a private application backup and isolated upgrade rehearsal.

CREATE OR REPLACE FUNCTION private.ensure_calendar_day_for_entry(p_user_id uuid, p_local_date date)
 RETURNS days
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    user_id, local_date, base_planned_target_kcal, nutrient_target_snapshot
  ) values (
    p_user_id, p_local_date, target_row.base_daily_target_kcal, nutrient_snapshot
  ) on conflict (user_id, local_date) do nothing;

  select day.* into day_row from public.days as day
    where day.user_id = p_user_id and day.local_date = p_local_date for update;
  return day_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_calendar_plan(p_request_id uuid, p_from_date date, p_to_date date, p_item_id uuid, p_expected_item_revision integer, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  source_day public.days%rowtype;
  target_day public.days%rowtype;
  source_item public.day_items%rowtype;
  copied_item public.day_items%rowtype;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_from_date is null or p_to_date is null or p_item_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1 or p_action not in ('copy','move')
    or (p_action='move' and p_from_date=p_to_date) then
    raise exception using errcode='22023',message='Choose a valid planned item action and destination date';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'from_date',p_from_date,'to_date',p_to_date,'item_id',p_item_id,
    'expected_revision',p_expected_item_revision,'action',p_action
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'transfer_calendar_plan' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  -- Create/lock the two dates in a stable order. This remains an explicit write;
  -- no range or day read creates a date row.
  if p_from_date<p_to_date then
    source_day := private.ensure_calendar_day_for_entry(actor_id,p_from_date);
    target_day := private.ensure_calendar_day_for_entry(actor_id,p_to_date);
  else
    target_day := private.ensure_calendar_day_for_entry(actor_id,p_to_date);
    source_day := private.ensure_calendar_day_for_entry(actor_id,p_from_date);
  end if;
  if source_day.status<>'open' or target_day.status<>'open' then
    raise exception using errcode='40001',message='A completed date cannot be changed';
  end if;
  select item.* into source_item from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_from_date for update;
  if not found or source_item.state<>'planned' or source_item.revision<>p_expected_item_revision then
    raise exception using errcode='40001',message='This planned item changed; refresh and review it before continuing';
  end if;
  insert into public.day_items(user_id,local_date,section,state,source,
    selected_amount,selected_unit,manual_override,planned_payload,eaten_snapshot,eaten_at)
  values(actor_id,p_to_date,source_item.section,'planned',source_item.source,
    source_item.selected_amount,source_item.selected_unit,source_item.manual_override,source_item.planned_payload,null,null)
  returning * into copied_item;
  update public.days set revision=revision+1,updated_at=now()
    where user_id=actor_id and local_date=p_to_date;
  if p_action='move' then
    update public.day_items set state='removed',revision=revision+1,updated_at=now()
      where user_id=actor_id and id=p_item_id returning * into source_item;
    update public.days set revision=revision+1,updated_at=now()
      where user_id=actor_id and local_date=p_from_date;
  end if;
  result := jsonb_build_object('item_id',copied_item.id,'local_date',p_to_date,'item_revision',copied_item.revision,
    'source_item_id',p_item_id,'action',p_action);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'transfer_calendar_plan',fingerprint,result);
  return result;
end;
$function$;

-- Explicit names only; no wildcard drops of current calendar/catalogue functions.
do $cleanup$
declare target record;
begin
  for target in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and ((n.nspname='public' and p.proname in ('accept_whole_day_shuffle','complete_day','complete_profile_onboarding','correct_completed_day_item','ensure_day_snapshot','ensure_routine_day','ensure_week','log_day_item','log_day_items','plan_day_item','plan_day_items','replace_day_item','replace_planned_day_item','reverse_carry_decision','save_carry_decision','save_profile_targets','save_routine_shuffle_suggestion','save_routine_version','save_week_allocation','use_shuffle_suggestion'))
      or (n.nspname='private' and p.proname in ('ensure_day_for_log','ensure_week_for_planning')))
  loop
    execute format('drop function %s', target.signature);
  end loop;
end;
$cleanup$;

-- Remove only the obsolete scheduling links, not dated entries or their frozen nutrition.
alter table public.days drop column week_start;
alter table public.day_items drop column routine_occurrence_key;
drop table public.routine_shuffle_suggestions;
drop table public.routine_slots;
drop table public.routine_versions;
drop table public.carry_allocations;
drop table public.carry_decisions;
drop table public.week_allocations;
drop table public.weeks;
drop table public.weekly_pattern_days;
drop table public.weekly_pattern_versions;
drop type public.routine_slot_mode;
drop type public.allocation_kind;
drop type public.carry_action;
drop type public.carry_state;

-- Historical completed target columns and source labels remain immutable record data.
-- They do not expose a completion/carry workflow or a second logging API.
comment on column public.days.completed_target_kcal is
  'Previously captured date target; read-only history. No completion workflow exists.';
comment on function public.archive_food(uuid,uuid,integer) is
  'Archives an account food while preserving saved food-group references.';

-- Recipe finished-weight authoring is removed; food amounts/conversions stay intact.
drop function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer,numeric);
alter table public.meals drop column declared_total_weight_g;
CREATE OR REPLACE FUNCTION public.save_meal(p_request_id uuid, p_name text, p_sections jsonb, p_components jsonb, p_meal_id uuid DEFAULT NULL::uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  saved_meal_id uuid;
  saved_revision integer;
  parsed_sections public.meal_section[];
  component jsonb;
  component_food_id uuid;
  component_amount numeric;
  component_unit text;
  component_position integer := 0;
  food_basis_unit text;
  food_grams_per_serving numeric;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Meal name must be 1 to 160 characters';
  end if;
  if coalesce(jsonb_typeof(p_sections),'null') <> 'array' or coalesce(jsonb_array_length(p_sections),0) not between 1 and 4 then
    raise exception using errcode = '22023', message = 'sections must contain one to four meal sections';
  end if;
  if coalesce(jsonb_typeof(p_components),'null') <> 'array' or coalesce(jsonb_array_length(p_components),0) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'A meal must contain 1 to 100 components';
  end if;

  select coalesce(array_agg(section_value::public.meal_section), array[]::public.meal_section[])
    into parsed_sections
    from jsonb_array_elements_text(p_sections) as sections(section_value);
  if cardinality(parsed_sections) <> (select count(distinct section_value) from unnest(parsed_sections) as sections(section_value)) then
    raise exception using errcode = '22023', message = 'sections cannot contain duplicates';
  end if;

  fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'meal_id',p_meal_id,'expected_revision',p_expected_revision,'name',p_name,
        'sections',p_sections,
        'components',p_components
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serialize identical request IDs before inspecting receipts or mutating rows.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'save_meal' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  if p_meal_id is null then
    if p_expected_revision is not null then
      raise exception using errcode = '22023', message = 'A new meal cannot have an expected revision';
    end if;
    insert into public.meals(user_id,name,sections)
      values (actor_id,trim(p_name),parsed_sections)
      returning id,revision into saved_meal_id,saved_revision;
  else
    if p_expected_revision is null or p_expected_revision < 1 then
      raise exception using errcode = '22023', message = 'An expected revision is required when editing';
    end if;
    update public.meals as meal
      set name = trim(p_name),sections = parsed_sections,
          revision = meal.revision + 1,updated_at = now()
      where meal.user_id = actor_id and meal.id = p_meal_id
        and meal.revision = p_expected_revision and meal.archived_at is null
      returning id,revision into saved_meal_id,saved_revision;
    if not found then
      raise exception using errcode = '40001', message = 'Meal changed or is unavailable; reload before saving';
    end if;
    delete from public.meal_components
      where user_id = actor_id and meal_id = saved_meal_id;
  end if;

  for component in select value from jsonb_array_elements(p_components) as component_rows(value)
  loop
    if jsonb_typeof(component) <> 'object'
      or not (component ? 'food_id')
      or not (component ? 'amount')
      or not (component ? 'unit') then
      raise exception using errcode = '22023', message = 'Each component requires food_id, amount, and unit';
    end if;
    begin
      component_food_id := (component->>'food_id')::uuid;
      component_amount := (component->>'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Component ID or amount is invalid';
    end;
    component_unit := trim(component->>'unit');
    if component_amount <= 0 or component_amount >= 100000000
      or length(component_unit) not between 1 and 24 then
      raise exception using errcode = '22023', message = 'Component amount or unit is outside valid bounds';
    end if;
    select food.basis_unit,food.grams_per_serving into food_basis_unit,food_grams_per_serving
      from public.foods as food
      where food.user_id = actor_id and food.id = component_food_id and food.archived_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'Component food is unavailable to this account';
    end if;
    if private.convert_food_amount(component_amount,component_unit,food_basis_unit,food_grams_per_serving) is null then
      raise exception using errcode = '22023', message = 'Component amount unit is incompatible with the food basis';
    end if;
    insert into public.meal_components(user_id,meal_id,food_id,amount,unit,position)
      values (actor_id,saved_meal_id,component_food_id,component_amount,component_unit,component_position);
    component_position := component_position + 1;
  end loop;

  result := jsonb_build_object('id',saved_meal_id,'revision',saved_revision,'name',trim(p_name));
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'save_meal',fingerprint,result);
  return result;
end;
$function$;

revoke all on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer) from public,anon;
grant execute on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer) to authenticated;
comment on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer) is
  'Saves a private group of foods with portion amounts, ownership checks, revisions and idempotent requests.';

-- This private schema contains only abandoned ingredient-cost research, backed up before removal.
drop schema if exists steady_research cascade;
