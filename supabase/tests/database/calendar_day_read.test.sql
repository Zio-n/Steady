begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('33333333-3333-4333-8333-333333333333','authenticated','authenticated','calendar-a@test.invalid','',now()),
  ('44444444-4444-4444-8444-444444444444','authenticated','authenticated','calendar-b@test.invalid','',now());

insert into public.profiles (user_id,timezone,base_daily_target_kcal,onboarding_complete)
values
  ('33333333-3333-4333-8333-333333333333','Europe/London',2200,true),
  ('44444444-4444-4444-8444-444444444444','Europe/London',null,true);

insert into public.profile_target_versions (user_id,effective_from,base_daily_target_kcal,timezone)
values
  ('33333333-3333-4333-8333-333333333333','2026-10-01',2100,'Europe/London'),
  ('33333333-3333-4333-8333-333333333333','2026-10-20',2200,'Europe/London');

select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
set local role authenticated;

select extensions.is((public.read_calendar_day('2026-10-15')->'target'->>'calories_kcal')::numeric,
  2100::numeric,'an empty past date resolves the target effective on that date');
select extensions.is((public.read_calendar_day('2026-10-27')->'target'->>'calories_kcal')::numeric,
  2200::numeric,'an empty later date resolves the newer target without a day row');
select extensions.is(public.read_calendar_day('2026-10-27')->'target'->>'source',
  'profile_version','an open date uses target history rather than a weekly allocation');
select extensions.is(public.read_calendar_day('2026-10-27')->>'day',
  null::text,'an empty date has no materialised day');
select extensions.is(jsonb_array_length(public.read_calendar_day('2026-10-27')->'items'),
  0,'an empty date has no entries');
select extensions.is((select count(*) from public.days),0::bigint,'reading did not insert a day');
select extensions.is((select count(*) from public.weeks),0::bigint,'reading did not insert a week');
select extensions.is((select count(*) from public.day_items),0::bigint,'reading did not generate routine entries');

reset role;
insert into public.weeks (user_id,week_start,budget_kcal)
values
  ('33333333-3333-4333-8333-333333333333','2026-10-12',14700),
  ('44444444-4444-4444-8444-444444444444','2026-10-12',12600);
insert into public.days (
  user_id,local_date,week_start,base_planned_target_kcal,nutrient_target_snapshot,
  status,completed_target_kcal,completed_at,completed_log_revision,completed_actual_kcal
)
values
  ('33333333-3333-4333-8333-333333333333','2026-10-15','2026-10-12',2100,
   '{"targets":{"protein":110},"fields":{}}','completed',2050,now(),1,100),
  ('44444444-4444-4444-8444-444444444444','2026-10-15','2026-10-12',1800,
   '{}'::jsonb,'open',null,null,null,null);
insert into public.day_items (user_id,local_date,section,state,source,planned_payload)
values
  ('33333333-3333-4333-8333-333333333333','2026-10-15','breakfast','planned','food','{"name":"Owner plan"}'),
  ('44444444-4444-4444-8444-444444444444','2026-10-15','breakfast','planned','food','{"name":"Other account plan"}');

set local role authenticated;
select extensions.is(public.read_calendar_day('2026-10-15')->'target'->>'source',
  'completed_snapshot','legacy completed day keeps its frozen target source');
select extensions.is((public.read_calendar_day('2026-10-15')->'target'->>'calories_kcal')::numeric,
  2050::numeric,'legacy completed day keeps its frozen target value');
select extensions.is(jsonb_array_length(public.read_calendar_day('2026-10-15')->'items'),
  1,'the calendar read excludes another account’s dated item');
select extensions.throws_ok(
  $$select public.read_calendar_day(null)$$,'22023',null,'a local date is required');

reset role;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
set local role authenticated;
select extensions.is(public.read_calendar_day('2026-10-27')->'target'->>'source',
  'unset','an account without a target can still read an empty date');

reset role;
select extensions.ok(not has_function_privilege('anon','public.read_calendar_day(date)','EXECUTE'),
  'anonymous users cannot call the private calendar read');
select extensions.ok(has_function_privilege('authenticated','public.read_calendar_day(date)','EXECUTE'),
  'authenticated users may call the private calendar read');

select extensions.finish();
rollback;
