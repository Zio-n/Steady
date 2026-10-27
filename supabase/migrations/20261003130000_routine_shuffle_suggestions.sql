create or replace function public.use_shuffle_suggestion(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_meal_id uuid,
  p_expected_meal_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_timezone text;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  item_row public.day_items%rowtype;
  meal_revision integer;
  meal_sections public.meal_section[];
  meal_archived_at timestamptz;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_meal_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1
    or p_expected_meal_revision is null or p_expected_meal_revision<1 then
    raise exception using errcode='22023',message='A request, Shuffle slot, and current source revisions are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_item_revision',p_expected_item_revision,
    'meal_id',p_meal_id,'expected_meal_revision',p_expected_meal_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'use_shuffle_suggestion' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before using Shuffle'; end if;
  if p_local_date<=(now() at time zone account_timezone)::date then
    raise exception using errcode='22023',message='Shuffle suggestions can only replace a future plan';
  end if;
  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;
  select item.* into item_row from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'planned' or item_row.source<>'routine'
    or item_row.revision<>p_expected_item_revision or item_row.planned_payload->>'mode'<>'shuffle'
    or item_row.selected_amount is null or lower(coalesce(item_row.selected_unit,'')) not in ('serving','servings') then
    raise exception using errcode='40001',message='This Shuffle slot changed; refresh and preview it again';
  end if;
  select meal.revision,meal.sections,meal.archived_at into meal_revision,meal_sections,meal_archived_at
    from public.meals as meal where meal.user_id=actor_id and meal.id=p_meal_id for share;
  if not found or meal_archived_at is not null or not (item_row.section=any(meal_sections)) then
    raise exception using errcode='23503',message='Choose an active saved meal tagged for this slot';
  end if;
  if meal_revision<>p_expected_meal_revision then
    raise exception using errcode='40001',message='The suggested meal changed; refresh and review its nutrition before using it';
  end if;

  result := public.replace_planned_day_item(gen_random_uuid(),p_local_date,p_item_id,p_expected_item_revision,
    item_row.section,'meal',p_meal_id,item_row.selected_amount,'serving',null);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'use_shuffle_suggestion',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.use_shuffle_suggestion(uuid,date,uuid,integer,uuid,integer) from public,anon;
grant execute on function public.use_shuffle_suggestion(uuid,date,uuid,integer,uuid,integer) to authenticated;
comment on function public.use_shuffle_suggestion(uuid,date,uuid,integer,uuid,integer) is
  'Atomically accepts a future Shuffle preview after validating the slot and meal revisions; replacement remains planned and the Shuffle occurrence is retained as a tombstone.';
