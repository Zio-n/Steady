create table public.calendar_target_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('transfer','reversal')),
  origin_date date not null,
  destination_date date not null,
  amount_kcal numeric(12,2) not null check (amount_kcal > 0 and amount_kcal < 1000000),
  request_id uuid not null,
  reversal_of uuid,
  created_at timestamptz not null default now(),
  unique (user_id,id),
  unique (user_id,request_id),
  foreign key (user_id,origin_date) references public.days(user_id,local_date) on delete restrict,
  foreign key (user_id,destination_date) references public.days(user_id,local_date) on delete restrict,
  foreign key (user_id,reversal_of) references public.calendar_target_transfers(user_id,id) on delete restrict,
  check (origin_date<>destination_date),
  check ((kind='transfer' and reversal_of is null) or (kind='reversal' and reversal_of is not null))
);
create unique index calendar_target_transfer_one_reversal_idx
  on public.calendar_target_transfers(user_id,reversal_of) where kind='reversal';
create index calendar_target_transfer_origin_idx on public.calendar_target_transfers(user_id,origin_date);
create index calendar_target_transfer_destination_idx on public.calendar_target_transfers(user_id,destination_date);
alter table public.calendar_target_transfers enable row level security;
create policy owner_read on public.calendar_target_transfers for select to authenticated
  using ((select auth.uid())=user_id);
revoke all on public.calendar_target_transfers from anon,authenticated;
grant select on public.calendar_target_transfers to authenticated;
comment on table public.calendar_target_transfers is
  'Append-only explicit calorie allowance transfers. Reversals are new rows; no food intake or eaten snapshot moves.';

create or replace function public.save_calendar_target_transfer(
  p_request_id uuid,p_origin_date date,p_destination_date date,p_amount_kcal numeric
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
  origin_day public.days%rowtype;
  destination_day public.days%rowtype;
  origin_target numeric;
  destination_target numeric;
  origin_before numeric;
  destination_before numeric;
  origin_after numeric;
  destination_after numeric;
  receipt_result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_origin_date is null or p_destination_date is null
    or p_origin_date=p_destination_date or p_amount_kcal is null or p_amount_kcal<=0
    or p_amount_kcal>=1000000 or p_amount_kcal<>round(p_amount_kcal,2) then
    raise exception using errcode='22023',message='Choose two different dates and a positive calorie amount';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'origin_date',p_origin_date,'destination_date',p_destination_date,'amount_kcal',p_amount_kcal
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'save_calendar_target_transfer' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;
  select profile.timezone into account_timezone from public.profiles as profile
    where profile.user_id=actor_id and profile.onboarding_complete;
  if not found then raise exception using errcode='22023',message='Complete calendar setup before transferring targets'; end if;
  local_today := (now() at time zone account_timezone)::date;
  if p_origin_date<local_today or p_destination_date<local_today then
    raise exception using errcode='22023',message='Transfers can only affect today or a future date';
  end if;
  if p_origin_date<p_destination_date then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_origin_date::text,1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_destination_date::text,1));
    origin_day := private.ensure_calendar_day_for_entry(actor_id,p_origin_date);
    destination_day := private.ensure_calendar_day_for_entry(actor_id,p_destination_date);
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_destination_date::text,1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_origin_date::text,1));
    destination_day := private.ensure_calendar_day_for_entry(actor_id,p_destination_date);
    origin_day := private.ensure_calendar_day_for_entry(actor_id,p_origin_date);
  end if;
  if origin_day.status<>'open' or destination_day.status<>'open' then
    raise exception using errcode='40001',message='Completed dates cannot receive target transfers';
  end if;
  select version.base_daily_target_kcal into origin_target from public.profile_target_versions as version
    where version.user_id=actor_id and version.effective_from<=p_origin_date order by version.effective_from desc limit 1;
  select version.base_daily_target_kcal into destination_target from public.profile_target_versions as version
    where version.user_id=actor_id and version.effective_from<=p_destination_date order by version.effective_from desc limit 1;
  if origin_target is null or destination_target is null then
    raise exception using errcode='22023',message='Both dates need a saved calorie target before allowance can be transferred';
  end if;
  select origin_target
    + coalesce(sum(case when ledger.destination_date=p_origin_date then ledger.amount_kcal else 0 end),0)
    - coalesce(sum(case when ledger.origin_date=p_origin_date then ledger.amount_kcal else 0 end),0)
    into origin_before
    from public.calendar_target_transfers as ledger
    where ledger.user_id=actor_id and ledger.kind='transfer'
      and (ledger.origin_date=p_origin_date or ledger.destination_date=p_origin_date)
      and not exists(select 1 from public.calendar_target_transfers as reversal
        where reversal.user_id=actor_id and reversal.kind='reversal' and reversal.reversal_of=ledger.id);
  select destination_target
    + coalesce(sum(case when ledger.destination_date=p_destination_date then ledger.amount_kcal else 0 end),0)
    - coalesce(sum(case when ledger.origin_date=p_destination_date then ledger.amount_kcal else 0 end),0)
    into destination_before
    from public.calendar_target_transfers as ledger
    where ledger.user_id=actor_id and ledger.kind='transfer'
      and (ledger.origin_date=p_destination_date or ledger.destination_date=p_destination_date)
      and not exists(select 1 from public.calendar_target_transfers as reversal
        where reversal.user_id=actor_id and reversal.kind='reversal' and reversal.reversal_of=ledger.id);
  origin_after := origin_before-p_amount_kcal;
  destination_after := destination_before+p_amount_kcal;
  if origin_after<0 then raise exception using errcode='22023',message='The origin date does not have enough allowance to transfer'; end if;
  insert into public.calendar_target_transfers(user_id,kind,origin_date,destination_date,amount_kcal,request_id)
    values(actor_id,'transfer',p_origin_date,p_destination_date,p_amount_kcal,p_request_id);
  receipt_result := jsonb_build_object('origin_date',p_origin_date,'destination_date',p_destination_date,
    'amount_kcal',p_amount_kcal,'origin_before',origin_before,'origin_after',origin_after,
    'destination_before',destination_before,'destination_after',destination_after);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'save_calendar_target_transfer',fingerprint,receipt_result);
  return receipt_result;
end;
$$;
revoke all on function public.save_calendar_target_transfer(uuid,date,date,numeric) from public,anon;
grant execute on function public.save_calendar_target_transfer(uuid,date,date,numeric) to authenticated;

create or replace function public.reverse_calendar_target_transfer(p_request_id uuid,p_transfer_id uuid)
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
  transfer_row public.calendar_target_transfers%rowtype;
  account_timezone text;
  local_today date;
  origin_day public.days%rowtype;
  destination_day public.days%rowtype;
  destination_target numeric;
  destination_after numeric;
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_transfer_id is null then raise exception using errcode='22023',message='A transfer and request are required'; end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('transfer_id',p_transfer_id)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'reverse_calendar_target_transfer' or prior_fingerprint<>fingerprint then
      raise exception using errcode='22023',message='request_id was already used with different input';
    end if;
    return prior_result;
  end if;
  select * into transfer_row from public.calendar_target_transfers as ledger
    where ledger.user_id=actor_id and ledger.id=p_transfer_id and ledger.kind='transfer' for update;
  if not found or exists(select 1 from public.calendar_target_transfers as reversal
    where reversal.user_id=actor_id and reversal.kind='reversal' and reversal.reversal_of=p_transfer_id) then
    raise exception using errcode='40001',message='This transfer is unavailable or already reversed';
  end if;
  select profile.timezone into account_timezone from public.profiles as profile where profile.user_id=actor_id;
  local_today := (now() at time zone account_timezone)::date;
  if transfer_row.origin_date<local_today or transfer_row.destination_date<local_today then
    raise exception using errcode='22023',message='Transfers affecting past dates cannot be reversed';
  end if;
  if transfer_row.origin_date<transfer_row.destination_date then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||transfer_row.origin_date::text,1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||transfer_row.destination_date::text,1));
    origin_day := private.ensure_calendar_day_for_entry(actor_id,transfer_row.origin_date);
    destination_day := private.ensure_calendar_day_for_entry(actor_id,transfer_row.destination_date);
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||transfer_row.destination_date::text,1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||transfer_row.origin_date::text,1));
    destination_day := private.ensure_calendar_day_for_entry(actor_id,transfer_row.destination_date);
    origin_day := private.ensure_calendar_day_for_entry(actor_id,transfer_row.origin_date);
  end if;
  if origin_day.status<>'open' or destination_day.status<>'open' then
    raise exception using errcode='40001',message='Completed dates cannot have transfers reversed';
  end if;
  select version.base_daily_target_kcal into destination_target from public.profile_target_versions as version
    where version.user_id=actor_id and version.effective_from<=transfer_row.destination_date order by version.effective_from desc limit 1;
  select destination_target
    + coalesce(sum(case when ledger.destination_date=transfer_row.destination_date then ledger.amount_kcal else 0 end),0)
    - coalesce(sum(case when ledger.origin_date=transfer_row.destination_date then ledger.amount_kcal else 0 end),0)
    into destination_after
    from public.calendar_target_transfers as ledger
    where ledger.user_id=actor_id and ledger.kind='transfer'
      and (ledger.origin_date=transfer_row.destination_date or ledger.destination_date=transfer_row.destination_date)
      and not exists(select 1 from public.calendar_target_transfers as reversal
        where reversal.user_id=actor_id and reversal.kind='reversal' and reversal.reversal_of=ledger.id);
  destination_after := destination_after-transfer_row.amount_kcal;
  if destination_after<0 then raise exception using errcode='22023',message='The destination date no longer has enough allowance to reverse this transfer'; end if;
  insert into public.calendar_target_transfers(user_id,kind,origin_date,destination_date,amount_kcal,request_id,reversal_of)
    values(actor_id,'reversal',transfer_row.origin_date,transfer_row.destination_date,transfer_row.amount_kcal,p_request_id,p_transfer_id);
  result := jsonb_build_object('reversed_transfer_id',p_transfer_id,'origin_date',transfer_row.origin_date,
    'destination_date',transfer_row.destination_date,'amount_kcal',transfer_row.amount_kcal);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'reverse_calendar_target_transfer',fingerprint,result);
  return result;
end;
$$;
revoke all on function public.reverse_calendar_target_transfer(uuid,uuid) from public,anon;
grant execute on function public.reverse_calendar_target_transfer(uuid,uuid) to authenticated;
