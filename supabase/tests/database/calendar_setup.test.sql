begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('99999999-9999-4999-8999-999999999999','authenticated','authenticated','setup-a@test.invalid','',now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','setup-b@test.invalid','',now());
create temp table legacy_counts as select
  (select count(*) from public.weeks) as weeks,
  (select count(*) from public.weekly_pattern_versions) as patterns,
  (select count(*) from public.routine_versions) as routines;

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
select extensions.is(public.complete_calendar_setup(
  '99999999-9999-4999-8999-000000000001','Europe/London',null)->>'timezone',
  'Europe/London','setup saves a valid account timezone');
select extensions.ok((select onboarding_complete from public.profiles
  where user_id='99999999-9999-4999-8999-999999999999'),
  'targetless account completes setup');
select extensions.is((select base_daily_target_kcal from public.profiles
  where user_id='99999999-9999-4999-8999-999999999999'),null::numeric,
  'setup does not invent a calorie target');
select extensions.is((select count(*) from public.profile_target_versions
  where user_id='99999999-9999-4999-8999-999999999999'),0::bigint,
  'targetless setup stores no target version');
select extensions.ok((select is_displayed from public.nutrient_fields
  where user_id='99999999-9999-4999-8999-999999999999' and field_id='protein'),
  'protein is available by default without a target');
select extensions.is((select count(*) from public.days
  where user_id='99999999-9999-4999-8999-999999999999'),0::bigint,
  'setup creates no dated day');
select extensions.is((select count(*) from public.weeks),(select weeks from legacy_counts),
  'setup creates no week');
select extensions.is((select count(*) from public.weekly_pattern_versions),(select patterns from legacy_counts),
  'setup creates no weekly pattern');
select extensions.is((select count(*) from public.routine_versions),(select routines from legacy_counts),
  'setup creates no routine');
select extensions.is(public.complete_calendar_setup(
  '99999999-9999-4999-8999-000000000001','Europe/London',null),
  (select result from public.mutation_receipts
    where user_id='99999999-9999-4999-8999-999999999999'
      and request_id='99999999-9999-4999-8999-000000000001'),
  'retry returns the original receipt');
select extensions.throws_ok(
  $$select public.complete_calendar_setup('99999999-9999-4999-8999-000000000002','Invalid/Timezone',null)$$,
  '22023',null,'invalid timezone is rejected');
select extensions.throws_ok(
  $$select public.complete_calendar_setup('99999999-9999-4999-8999-000000000003','Europe/London',-1)$$,
  '22023',null,'invalid calorie target is rejected');

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select extensions.is((public.complete_calendar_setup(
  'aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Europe/London',2300)->>'target_kcal')::numeric,
  2300::numeric,'an optional calorie target is saved');
select extensions.is((select count(*) from public.profile_target_versions
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),1::bigint,
  'targeted setup creates one effective version');

select extensions.finish();
rollback;
