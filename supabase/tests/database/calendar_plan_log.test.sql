begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(20);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('77777777-7777-4777-8777-777777777777','authenticated','authenticated','plan-owner@test.invalid','',now()),
  ('88888888-8888-4888-8888-888888888888','authenticated','authenticated','plan-other@test.invalid','',now());
insert into public.profiles (user_id,timezone,base_daily_target_kcal,onboarding_complete)
values
  ('77777777-7777-4777-8777-777777777777','Europe/London',null,true),
  ('88888888-8888-4888-8888-888888888888','Europe/London',null,true);
insert into public.foods (id,user_id,name,basis_amount,basis_unit,calories_kcal)
values
  ('77777777-7777-4777-8777-000000000001','77777777-7777-4777-8777-777777777777','Owner food',100,'g',150),
  ('88888888-8888-4888-8888-000000000001','88888888-8888-4888-8888-888888888888','Other food',100,'g',200);

create temp table legacy_counts as select
  (select count(*) from public.weeks) as weeks,
  (select count(*) from public.routine_versions) as routines;
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);

select extensions.is((public.calendar_plan_day_item(
  '77777777-7777-4777-8777-000000000010','2026-10-15','breakfast','food',
  '77777777-7777-4777-8777-000000000001',50,'g')->>'planned_count')::bigint,
  1::bigint,'a targetless selected date accepts a saved-food plan');
select extensions.is((select count(*) from public.days where user_id='77777777-7777-4777-8777-777777777777'),
  1::bigint,'planning creates one dated day');
select extensions.is((select week_start from public.days where user_id='77777777-7777-4777-8777-777777777777'),
  null::date,'planned calendar day is not linked to a week');
select extensions.is((select base_planned_target_kcal from public.days where user_id='77777777-7777-4777-8777-777777777777'),
  null::numeric,'planned calendar day does not invent a target');
select extensions.is((select count(*) from public.weeks),(select weeks from legacy_counts),
  'planning does not materialise a week');
select extensions.is((select count(*) from public.routine_versions),(select routines from legacy_counts),
  'planning does not materialise a routine');
select extensions.is((select state::text from public.day_items where user_id='77777777-7777-4777-8777-777777777777'),
  'planned','the new entry remains planned');
select extensions.is((select count(*) from public.day_items where user_id='77777777-7777-4777-8777-777777777777' and state='eaten'),
  0::bigint,'planning does not raise actual intake');
select extensions.is(public.calendar_plan_day_item(
  '77777777-7777-4777-8777-000000000010','2026-10-15','breakfast','food',
  '77777777-7777-4777-8777-000000000001',50,'g'),
  (select result from public.mutation_receipts where user_id='77777777-7777-4777-8777-777777777777'
    and request_id='77777777-7777-4777-8777-000000000010'),
  'repeating a request returns its original receipt');
select extensions.is((select count(*) from public.day_items where user_id='77777777-7777-4777-8777-777777777777'),
  1::bigint,'repeating a plan does not duplicate an entry');
select extensions.throws_ok(
  $$select public.calendar_plan_day_item('77777777-7777-4777-8777-000000000010','2026-10-15','breakfast','food','77777777-7777-4777-8777-000000000001',70,'g')$$,
  '22023',null,'a request ID cannot be reused with different input');
select extensions.throws_ok(
  $$select public.calendar_plan_day_item('77777777-7777-4777-8777-000000000011','2026-10-15','lunch','food','88888888-8888-4888-8888-000000000001',50,'g')$$,
  '23503',null,'another account’s food cannot be planned');

select extensions.is((public.calendar_log_day_item(
  '77777777-7777-4777-8777-000000000012','2026-10-15','breakfast','food',
  '77777777-7777-4777-8777-000000000001',50,'g',null,
  (select (result->>'item_id')::uuid from public.mutation_receipts
    where user_id='77777777-7777-4777-8777-777777777777' and request_id='77777777-7777-4777-8777-000000000010'),1)
  ->>'calories_kcal')::numeric,75::numeric,
  'logging the accepted plan captures authoritative scaled calories');
select extensions.is((select state::text from public.day_items where user_id='77777777-7777-4777-8777-777777777777'),
  'eaten','accepted plan becomes eaten exactly once');
select extensions.is((select (eaten_snapshot->'calories'->>'value')::numeric
  from public.day_items where user_id='77777777-7777-4777-8777-777777777777'),
  75::numeric,'eaten snapshot freezes the scaled value');
select extensions.is((public.calendar_log_day_item(
  '77777777-7777-4777-8777-000000000012','2026-10-15','breakfast','food',
  '77777777-7777-4777-8777-000000000001',50,'g',null,
  (select (result->>'item_id')::uuid from public.mutation_receipts
    where user_id='77777777-7777-4777-8777-777777777777' and request_id='77777777-7777-4777-8777-000000000010'),1)
  ->>'calories_kcal')::numeric,75::numeric,
  'repeating a log request returns the original result');
select extensions.is((select count(*) from public.day_items where user_id='77777777-7777-4777-8777-777777777777'),
  1::bigint,'repeating a log does not create a second entry');
select extensions.is((select count(*) from public.weeks),(select weeks from legacy_counts),
  'logging does not materialise a week');
select extensions.is((select count(*) from public.routine_versions),(select routines from legacy_counts),
  'logging does not materialise a routine');
select extensions.ok(not has_function_privilege('anon',
  'public.calendar_log_day_item(uuid,date,public.meal_section,text,uuid,numeric,text,jsonb,uuid,integer)','EXECUTE'),
  'anonymous clients cannot log a calendar item');

select extensions.finish();
rollback;
