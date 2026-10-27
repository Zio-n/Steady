create table public.routine_shuffle_suggestions (
  user_id uuid not null,
  local_date date not null,
  day_item_id uuid not null,
  meal_id uuid not null,
  meal_name text not null check (length(trim(meal_name)) between 1 and 160),
  meal_revision integer not null check (meal_revision > 0),
  amount numeric(12,4) not null check (amount > 0 and amount < 100000000),
  suggestion_revision integer not null default 1 check (suggestion_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,day_item_id),
  foreign key (user_id,local_date) references public.days(user_id,local_date) on delete restrict,
  foreign key (user_id,day_item_id) references public.day_items(user_id,id) on delete restrict
);

alter table public.routine_shuffle_suggestions enable row level security;
create policy owner_read on public.routine_shuffle_suggestions for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.routine_shuffle_suggestions from anon,authenticated;
grant select on public.routine_shuffle_suggestions to authenticated;
comment on table public.routine_shuffle_suggestions is
  'Durable per-date/per-occurrence Shuffle choice; it never changes the recurring routine template or the planned day item.';

create or replace function public.save_routine_shuffle_suggestion(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_expected_suggestion_revision integer,
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
  current_meal_revision integer;
  current_meal_name text;
  current_meal_sections public.meal_section[];
  current_meal_archived_at timestamptz;
  existing_suggestion public.routine_shuffle_suggestions%rowtype;
  saved_suggestion public.routine_shuffle_suggestions%rowtype;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_meal_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1
    or p_expected_suggestion_revision is null or p_expected_suggestion_revision<0
    or p_expected_meal_revision is null or p_expected_meal_revision<1 then
    raise exception using errcode='22023',message='A Shuffle occurrence, candidate and current revisions are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_item_revision',p_expected_item_revision,
    'expected_suggestion_revision',p_expected_suggestion_revision,'meal_id',p_meal_id,'expected_meal_revision',p_expected_meal_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_routine_shuffle_suggestion' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  if not found then raise exception using errcode='22023',message='Complete profile setup before using Shuffle'; end if;
  if p_local_date<=(now() at time zone account_timezone)::date then
    raise exception using errcode='22023',message='Shuffle suggestions can only be saved for future plans';
  end if;
  perform 1 from public.days as day where day.user_id=actor_id and day.local_date=p_local_date and day.status='open' for update;
  if not found then raise exception using errcode='40001',message='This day is unavailable or complete'; end if;
  select item.* into item_row from public.day_items as item
    where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'planned' or item_row.source<>'routine' or item_row.revision<>p_expected_item_revision
    or item_row.planned_payload->>'mode'<>'shuffle' or item_row.selected_amount is null
    or lower(coalesce(item_row.selected_unit,'')) not in ('serving','servings') then
    raise exception using errcode='40001',message='This Shuffle occurrence changed; refresh it before saving a suggestion';
  end if;
  select stored.* into existing_suggestion from public.routine_shuffle_suggestions as stored
    where stored.user_id=actor_id and stored.day_item_id=p_item_id for update;
  if found and existing_suggestion.local_date<>p_local_date then
    raise exception using errcode='40001',message='The saved suggestion belongs to a different occurrence date';
  end if;
  if coalesce(existing_suggestion.suggestion_revision,0)<>p_expected_suggestion_revision then
    raise exception using errcode='40001',message='This Shuffle suggestion changed elsewhere; refresh and review the current choice';
  end if;
  select meal.revision,meal.name,meal.sections,meal.archived_at into current_meal_revision,current_meal_name,current_meal_sections,current_meal_archived_at
    from public.meals as meal where meal.user_id=actor_id and meal.id=p_meal_id for share;
  if not found or current_meal_archived_at is not null or not (item_row.section=any(current_meal_sections)) then
    raise exception using errcode='23503',message='Choose an active saved meal tagged for this Shuffle section';
  end if;
  if current_meal_revision<>p_expected_meal_revision then
    raise exception using errcode='40001',message='The suggested meal changed; refresh and choose from its current nutrition';
  end if;
  if p_expected_suggestion_revision=0 then
    insert into public.routine_shuffle_suggestions(user_id,local_date,day_item_id,meal_id,meal_name,meal_revision,amount)
      values(actor_id,p_local_date,p_item_id,p_meal_id,current_meal_name,current_meal_revision,item_row.selected_amount)
      returning * into saved_suggestion;
  else
    update public.routine_shuffle_suggestions as stored set meal_id=p_meal_id,meal_name=current_meal_name,
      meal_revision=current_meal_revision,amount=item_row.selected_amount,suggestion_revision=stored.suggestion_revision+1,updated_at=now()
      where stored.user_id=actor_id and stored.day_item_id=p_item_id returning * into saved_suggestion;
  end if;
  result := jsonb_build_object('item_id',saved_suggestion.day_item_id,'meal_id',saved_suggestion.meal_id,'meal_name',saved_suggestion.meal_name,
    'meal_revision',saved_suggestion.meal_revision,'amount',saved_suggestion.amount,'suggestion_revision',saved_suggestion.suggestion_revision);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'save_routine_shuffle_suggestion',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_routine_shuffle_suggestion(uuid,date,uuid,integer,integer,uuid,integer) from public,anon;
grant execute on function public.save_routine_shuffle_suggestion(uuid,date,uuid,integer,integer,uuid,integer) to authenticated;

drop function public.use_shuffle_suggestion(uuid,date,uuid,integer,uuid,integer);
create function public.use_shuffle_suggestion(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_expected_suggestion_revision integer,
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
  current_meal_revision integer;
  current_meal_sections public.meal_section[];
  current_meal_archived_at timestamptz;
  saved_suggestion public.routine_shuffle_suggestions%rowtype;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_meal_id is null
    or p_expected_item_revision is null or p_expected_item_revision<1
    or p_expected_suggestion_revision is null or p_expected_suggestion_revision<1
    or p_expected_meal_revision is null or p_expected_meal_revision<1 then
    raise exception using errcode='22023',message='A request, Shuffle slot, and current source revisions are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_item_revision',p_expected_item_revision,
    'expected_suggestion_revision',p_expected_suggestion_revision,
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
  select stored.* into saved_suggestion from public.routine_shuffle_suggestions as stored
    where stored.user_id=actor_id and stored.local_date=p_local_date and stored.day_item_id=p_item_id for update;
  select meal.revision,meal.sections,meal.archived_at into current_meal_revision,current_meal_sections,current_meal_archived_at
    from public.meals as meal where meal.user_id=actor_id and meal.id=p_meal_id for share;
  if not found or current_meal_archived_at is not null or not (item_row.section=any(current_meal_sections)) then
    raise exception using errcode='23503',message='Choose an active saved meal tagged for this slot';
  end if;
  if current_meal_revision<>p_expected_meal_revision then
    raise exception using errcode='40001',message='The suggested meal changed; refresh and review its nutrition before using it';
  end if;
  select stored.* into saved_suggestion from public.routine_shuffle_suggestions as stored
    where stored.user_id=actor_id and stored.local_date=p_local_date and stored.day_item_id=p_item_id for update;
  if not found or saved_suggestion.suggestion_revision<>p_expected_suggestion_revision
    or saved_suggestion.meal_id<>p_meal_id or saved_suggestion.meal_revision<>p_expected_meal_revision
    or saved_suggestion.amount<>item_row.selected_amount then
    raise exception using errcode='40001',message='The occurrence suggestion changed; refresh and explicitly review the current choice';
  end if;
  result := public.replace_planned_day_item(gen_random_uuid(),p_local_date,p_item_id,p_expected_item_revision,
    item_row.section,'meal',p_meal_id,item_row.selected_amount,'serving',null);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'use_shuffle_suggestion',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.use_shuffle_suggestion(uuid,date,uuid,integer,integer,uuid,integer) from public,anon;
grant execute on function public.use_shuffle_suggestion(uuid,date,uuid,integer,integer,uuid,integer) to authenticated;
comment on function public.use_shuffle_suggestion(uuid,date,uuid,integer,integer,uuid,integer) is
  'Accepts only the persisted current suggestion for a future Shuffle occurrence, then tombstones that dated row and keeps the recurring routine Shuffle slot unchanged.';
