begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('95111111-1111-4111-8111-111111111111','authenticated','authenticated','carry-over-sign@test.invalid','',now()),
 ('95222222-2222-4222-8222-222222222222','authenticated','authenticated','carry-under-sign@test.invalid','',now());
create temporary table sign_test_dates as
select pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date as monday,
  (now() at time zone 'Europe/London')::date as today;
grant all on sign_test_dates to authenticated;

select set_config('request.jwt.claim.sub','95111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select public.complete_profile_onboarding('95111111-1111-4111-8111-951111111112','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.log_day_item('95111111-1111-4111-8111-951111111113',(select monday from pg_temp.sign_test_dates),
  'breakfast','one_off_food',null,100,'g','{"name":"Toast","basisAmount":100,"basisUnit":"g","caloriesKcal":2400,"nutrients":{}}'::jsonb);
select public.complete_day('95111111-1111-4111-8111-951111111114',(select monday from pg_temp.sign_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)));
select public.save_carry_decision('95111111-1111-4111-8111-951111111115',(select monday from pg_temp.sign_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select monday from pg_temp.sign_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.sign_test_dates)),
  'single_day',150,jsonb_build_array(jsonb_build_object(
    'destination_date',case when (select today from pg_temp.sign_test_dates)=(select monday from pg_temp.sign_test_dates)
      then (select monday+1 from pg_temp.sign_test_dates) else (select today from pg_temp.sign_test_dates) end,
    'signed_delta_kcal',-150,'expected_revision',1)));
select extensions.is((select difference_kcal from public.carry_decisions where user_id=auth.uid()),300::numeric,
  'an over-target source records the positive actual-minus-target sign');
select extensions.is((select abs(difference_kcal)-amount_kcal from public.carry_decisions where user_id=auth.uid()),150::numeric,
  'a partial overage transfer leaves half the source difference unresolved');
select extensions.is((select signed_delta_kcal from public.carry_allocations where user_id=auth.uid()),-150::numeric,
  'an over-target source reduces the recipient target by the signed allocation');

select set_config('request.jwt.claim.sub','95222222-2222-4222-8222-222222222222',true);
select public.complete_profile_onboarding('95222222-2222-4222-8222-952222222223','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.log_day_item('95222222-2222-4222-8222-952222222224',(select monday from pg_temp.sign_test_dates),
  'breakfast','one_off_food',null,100,'g','{"name":"Toast","basisAmount":100,"basisUnit":"g","caloriesKcal":1000,"nutrients":{}}'::jsonb);
select public.complete_day('95222222-2222-4222-8222-952222222225',(select monday from pg_temp.sign_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)));
select public.save_carry_decision('95222222-2222-4222-8222-952222222226',(select monday from pg_temp.sign_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.sign_test_dates)),
  (select monday from pg_temp.sign_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.sign_test_dates)),
  'single_day',150,jsonb_build_array(jsonb_build_object(
    'destination_date',case when (select today from pg_temp.sign_test_dates)=(select monday from pg_temp.sign_test_dates)
      then (select monday+1 from pg_temp.sign_test_dates) else (select today from pg_temp.sign_test_dates) end,
    'signed_delta_kcal',150,'expected_revision',1)));
select extensions.is((select difference_kcal from public.carry_decisions where user_id=auth.uid()),-1100::numeric,
  'an under-target source records the negative actual-minus-target sign');
select extensions.is((select signed_delta_kcal from public.carry_allocations where user_id=auth.uid()),150::numeric,
  'an under-target source increases the recipient target by the signed allocation');
select extensions.is((select abs(difference_kcal)-amount_kcal from public.carry_decisions where user_id=auth.uid()),950::numeric,
  'partial under-target transfer keeps the remaining shortfall visible');

select * from extensions.finish();
rollback;
