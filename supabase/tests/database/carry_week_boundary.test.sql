begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(3);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('95333333-3333-4333-8333-333333333333','authenticated','authenticated','carry-week-boundary@test.invalid','',now());
create temporary table boundary_dates as
select pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date-1 as source_sunday,
  pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date-7 as source_monday,
  pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date as next_monday;
grant all on boundary_dates to authenticated;

select set_config('request.jwt.claim.sub','95333333-3333-4333-8333-333333333333',true);
set local role authenticated;
select public.complete_profile_onboarding('95333333-3333-4333-8333-953333333334','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
-- Model an existing account whose initial target and weekly pattern predate this completed Sunday.
reset role;
update public.profile_target_versions set effective_from=(select source_monday from pg_temp.boundary_dates)
  where user_id='95333333-3333-4333-8333-333333333333';
update public.weekly_pattern_versions set effective_week_start=(select source_monday from pg_temp.boundary_dates)
  where user_id='95333333-3333-4333-8333-333333333333';
set local role authenticated;
select public.log_day_item('95333333-3333-4333-8333-953333333335',(select source_sunday from pg_temp.boundary_dates),
  'breakfast','one_off_food',null,100,'g',
  '{"name":"Sunday meal","basisAmount":100,"basisUnit":"g","caloriesKcal":2500,"nutrients":{}}'::jsonb);
select public.complete_day('95333333-3333-4333-8333-953333333336',(select source_sunday from pg_temp.boundary_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select source_sunday from pg_temp.boundary_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select source_sunday from pg_temp.boundary_dates)));

select extensions.throws_ok(
  format($sql$select public.save_carry_decision('95333333-3333-4333-8333-953333333337',%L,
    (select revision from public.days where user_id=auth.uid() and local_date=%L),
    (select completed_log_revision from public.days where user_id=auth.uid() and local_date=%L),%L,
    (select revision from public.weeks where user_id=auth.uid() and week_start=%L),
    'single_day',100,jsonb_build_array(jsonb_build_object('destination_date',%L,
      'signed_delta_kcal',-100,'expected_revision',1)))$sql$,
    (select source_sunday from pg_temp.boundary_dates),(select source_sunday from pg_temp.boundary_dates),
    (select source_sunday from pg_temp.boundary_dates),(select source_monday from pg_temp.boundary_dates),
    (select source_monday from pg_temp.boundary_dates),(select next_monday from pg_temp.boundary_dates)),
  '22023',null,'a Sunday source cannot carry into Monday of the next week');

select public.save_carry_decision('95333333-3333-4333-8333-953333333338',(select source_sunday from pg_temp.boundary_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select source_sunday from pg_temp.boundary_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select source_sunday from pg_temp.boundary_dates)),
  (select source_monday from pg_temp.boundary_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select source_monday from pg_temp.boundary_dates)),
  'none',0,'[]'::jsonb);
select extensions.is((select action::text from public.carry_decisions where user_id=auth.uid()),'none',
  'Do nothing remains available when the completed week has no later dates');
select extensions.is((select count(*) from public.carry_allocations where user_id=auth.uid()),0::bigint,
  'an exhausted week creates no carry allocations');

select * from extensions.finish();
rollback;
