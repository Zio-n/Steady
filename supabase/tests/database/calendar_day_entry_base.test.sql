begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('55555555-5555-4555-8555-555555555555','authenticated','authenticated','entry-a@test.invalid','',now()),
  ('66666666-6666-4666-8666-666666666666','authenticated','authenticated','entry-b@test.invalid','',now());

insert into public.profiles (user_id,timezone,base_daily_target_kcal,onboarding_complete)
values
  ('55555555-5555-4555-8555-555555555555','Europe/London',null,true),
  ('66666666-6666-4666-8666-666666666666','Europe/London',2200,false);

create temp table legacy_counts as select
  (select count(*) from public.weeks) as weeks,
  (select count(*) from public.routine_versions) as routines;

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);

select extensions.is((private.ensure_calendar_day_for_entry(
  '55555555-5555-4555-8555-555555555555','2026-11-02')).local_date,
  '2026-11-02'::date,'an explicit action creates the requested local date');
select extensions.is((select count(*) from public.days
  where user_id='55555555-5555-4555-8555-555555555555'),1::bigint,
  'the first action creates exactly one day');
select extensions.is((select week_start from public.days
  where user_id='55555555-5555-4555-8555-555555555555'),null::date,
  'new calendar day has no legacy week link');
select extensions.is((select base_planned_target_kcal from public.days
  where user_id='55555555-5555-4555-8555-555555555555'),null::numeric,
  'new calendar day permits a missing target');
select extensions.is((select nutrient_target_snapshot from public.days
  where user_id='55555555-5555-4555-8555-555555555555'),'{}'::jsonb,
  'missing nutrient targets stay unknown');
select extensions.is((select count(*) from public.weeks),(select weeks from legacy_counts),
  'explicit day creation does not create a week');
select extensions.is((select count(*) from public.routine_versions),(select routines from legacy_counts),
  'explicit day creation does not create a routine');

select private.ensure_calendar_day_for_entry(
  '55555555-5555-4555-8555-555555555555','2026-11-02');
select extensions.is((select count(*) from public.days
  where user_id='55555555-5555-4555-8555-555555555555'),1::bigint,
  'repeating the explicit action reuses the day');
select extensions.throws_ok(
  $$select private.ensure_calendar_day_for_entry('66666666-6666-4666-8666-666666666666','2026-11-02')$$,
  '28000',null,'an actor cannot create another account’s day');
select extensions.throws_ok(
  $$select private.ensure_calendar_day_for_entry('55555555-5555-4555-8555-555555555555',null)$$,
  '22023',null,'an explicit action requires a local date');

insert into public.profile_target_versions (user_id,effective_from,base_daily_target_kcal,timezone)
values ('55555555-5555-4555-8555-555555555555','2026-11-03',2100,'Europe/London');
select private.ensure_calendar_day_for_entry(
  '55555555-5555-4555-8555-555555555555','2026-11-04');
select extensions.is((select base_planned_target_kcal from public.days
  where user_id='55555555-5555-4555-8555-555555555555' and local_date='2026-11-04'),
  2100::numeric,'a new day snapshots the target effective for its date');
select extensions.is((select base_planned_target_kcal from public.days
  where user_id='55555555-5555-4555-8555-555555555555' and local_date='2026-11-02'),
  null::numeric,'a later target does not backfill an older day');

insert into public.weeks (user_id,week_start,budget_kcal)
values ('55555555-5555-4555-8555-555555555555','2026-10-26',14700);
insert into public.days (user_id,local_date,week_start,base_planned_target_kcal)
values ('55555555-5555-4555-8555-555555555555','2026-10-27','2026-10-26',2100);
select private.ensure_calendar_day_for_entry(
  '55555555-5555-4555-8555-555555555555','2026-10-27');
select extensions.is((select week_start from public.days
  where user_id='55555555-5555-4555-8555-555555555555' and local_date='2026-10-27'),
  '2026-10-26'::date,'an older week-linked day keeps its week');
select extensions.is((select base_planned_target_kcal from public.days
  where user_id='55555555-5555-4555-8555-555555555555' and local_date='2026-10-27'),
  2100::numeric,'an older target snapshot stays unchanged');

select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
select extensions.throws_ok(
  $$select private.ensure_calendar_day_for_entry('66666666-6666-4666-8666-666666666666','2026-11-02')$$,
  '22023',null,'an incomplete profile cannot create a day');
select extensions.is((select count(*) from public.days
  where user_id='66666666-6666-4666-8666-666666666666'),0::bigint,
  'failed account setup creates no day');

select extensions.ok(not has_function_privilege('authenticated',
  'private.ensure_calendar_day_for_entry(uuid,date)','EXECUTE'),
  'client roles cannot call the internal helper directly');
select extensions.finish();
rollback;
