begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(24);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('93111111-1111-4111-8111-111111111111','authenticated','authenticated','carry-spread@test.invalid','',now()),
 ('93222222-2222-4222-8222-222222222222','authenticated','authenticated','carry-none@test.invalid','',now());

create temporary table carry_test_dates as
select (now() at time zone 'Europe/London')::date as today,
  pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date as monday;
grant all on carry_test_dates to authenticated;

select set_config('request.jwt.claim.sub','93111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select public.complete_profile_onboarding('93111111-1111-4111-8111-111111111111','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.log_day_item('93111111-1111-4111-8111-111111111112',(select monday from pg_temp.carry_test_dates),
  'breakfast','one_off_food',null,100,'g',
  '{"name":"Toast","basisAmount":100,"basisUnit":"g","caloriesKcal":2400,"nutrients":{}}'::jsonb);
select public.complete_day('93111111-1111-4111-8111-111111111113',(select monday from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)));

select extensions.throws_ok(
  format($sql$select public.save_carry_decision('93111111-1111-4111-8111-111111111114',%L,
    (select revision from public.days where user_id=auth.uid() and local_date=%L),
    (select completed_log_revision from public.days where user_id=auth.uid() and local_date=%L),%L,
    (select revision from public.weeks where user_id=auth.uid() and week_start=%L),'spread',150,
    jsonb_build_array(jsonb_build_object('destination_date',%L,'signed_delta_kcal',-75,'expected_revision',99),
      jsonb_build_object('destination_date',%L,'signed_delta_kcal',-75,'expected_revision',1)))$sql$,
    (select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates),
    (select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates),
    (select today from pg_temp.carry_test_dates),(select today+1 from pg_temp.carry_test_dates)),
  '40001',null,'a stale destination revision rejects the entire carry decision');

create temporary table carry_save_result(result jsonb not null);
grant all on carry_save_result to authenticated;
insert into pg_temp.carry_save_result(result)
select public.save_carry_decision('93111111-1111-4111-8111-111111111115',(select monday from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select monday from pg_temp.carry_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.carry_test_dates)),
  'spread',150,jsonb_build_array(
    jsonb_build_object('destination_date',(select today from pg_temp.carry_test_dates),'signed_delta_kcal',-75,'expected_revision',1),
    jsonb_build_object('destination_date',(select today+1 from pg_temp.carry_test_dates),'signed_delta_kcal',-75,'expected_revision',1)));

select extensions.is((select result->>'action' from pg_temp.carry_save_result),'spread','a selected spread is saved as an active decision');
select extensions.is((select count(*) from public.carry_allocations where user_id=auth.uid()),2::bigint,'a spread writes one ledger row for each selected destination');
select extensions.is((select sum(signed_delta_kcal) from public.carry_allocations where user_id=auth.uid()),-150::numeric,'signed allocations exactly equal the selected amount');
select extensions.is((select difference_kcal from public.carry_decisions where user_id=auth.uid()),300::numeric,'the immutable decision records the completed source-day difference');
select extensions.is((select min(destination_revision) from public.carry_allocations where user_id=auth.uid()),2,'each open destination revision advances once');
select extensions.is(
  (public.save_carry_decision('93111111-1111-4111-8111-111111111115',(select monday from pg_temp.carry_test_dates),
    3,2,(select monday from pg_temp.carry_test_dates),1,'spread',150,jsonb_build_array(
      jsonb_build_object('destination_date',(select today from pg_temp.carry_test_dates),'signed_delta_kcal',-75,'expected_revision',1),
      jsonb_build_object('destination_date',(select today+1 from pg_temp.carry_test_dates),'signed_delta_kcal',-75,'expected_revision',1)))->>'decision_id'),
  (select result->>'decision_id' from pg_temp.carry_save_result),'a same-request retry returns the original decision receipt');
select extensions.throws_ok(
  format($sql$select public.save_carry_decision('93111111-1111-4111-8111-111111111115',%L,3,2,%L,1,'none',0,'[]'::jsonb)$sql$,
    (select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates)),
  '22023',null,'an idempotency key cannot be reused for a different carry choice');
select extensions.throws_ok(
  format($sql$select public.save_carry_decision('93111111-1111-4111-8111-111111111116',%L,
    (select revision from public.days where user_id=auth.uid() and local_date=%L),
    (select completed_log_revision from public.days where user_id=auth.uid() and local_date=%L),%L,
    (select revision from public.weeks where user_id=auth.uid() and week_start=%L),'none',0,'[]'::jsonb)$sql$,
    (select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates),
    (select monday from pg_temp.carry_test_dates),(select monday from pg_temp.carry_test_dates)),
  '40001',null,'a second active decision cannot replace the source day choice');

select public.complete_day('93111111-1111-4111-8111-111111111117',(select today from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)));
select extensions.is((select completed_target_kcal from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),2025::numeric,
  'day completion freezes the base target plus the active inbound carry');
select public.save_carry_decision('93111111-1111-4111-8111-111111111118',(select today from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),
  (select monday from pg_temp.carry_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.carry_test_dates)),
  'none',0,'[]'::jsonb);
create temporary table carry_reverse_result(result jsonb not null);
grant all on carry_reverse_result to authenticated;
insert into pg_temp.carry_reverse_result(result)
select public.reverse_carry_decision('93111111-1111-4111-8111-111111111119',
  (select id from public.carry_decisions where user_id=auth.uid() and source_date=(select monday from pg_temp.carry_test_dates) and action='spread'),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.carry_test_dates)),
  jsonb_build_array(
    jsonb_build_object('destination_date',(select today from pg_temp.carry_test_dates),'expected_revision',
      (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates))),
    jsonb_build_object('destination_date',(select today+1 from pg_temp.carry_test_dates),'expected_revision',
      (select revision from public.days where user_id=auth.uid() and local_date=(select today+1 from pg_temp.carry_test_dates)))));
select extensions.is((select result->>'state' from pg_temp.carry_reverse_result),'reversed','explicit reversal returns a reversed receipt');
select extensions.is((select state::text from public.carry_decisions where user_id=auth.uid() and source_date=(select monday from pg_temp.carry_test_dates) and action='spread'),'reversed','the transfer stays in the ledger as a reversed historical decision');
select extensions.is((select base_planned_target_kcal+coalesce(sum(case when decision.id is not null then carry.signed_delta_kcal else 0 end),0) from public.days as day
  left join public.carry_allocations as carry on carry.user_id=day.user_id and carry.destination_date=day.local_date
  left join public.carry_decisions as decision on decision.user_id=carry.user_id and decision.id=carry.decision_id and decision.state='active'
  where day.user_id=auth.uid() and day.local_date=(select today+1 from pg_temp.carry_test_dates)
  group by day.base_planned_target_kcal),2100::numeric,'reversal removes the carry from an open recipient target');
select extensions.is((select completed_target_kcal from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),2025::numeric,
  'reversal never rewrites a completed recipient target snapshot');
select extensions.is((select needs_review from public.carry_decisions where user_id=auth.uid() and source_date=(select today from pg_temp.carry_test_dates)),true,
  'a downstream decision from a completed recipient is flagged for review');
select extensions.is((select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.carry_test_dates)),4,
  'reversal advances the completed recipient revision once without changing its snapshot');
select extensions.is((select revision from public.days where user_id=auth.uid() and local_date=(select today+1 from pg_temp.carry_test_dates)),3,
  'reversal advances the open recipient revision once');
select extensions.is(
  (public.reverse_carry_decision('93111111-1111-4111-8111-111111111119',
    (select id from public.carry_decisions where user_id=auth.uid() and source_date=(select monday from pg_temp.carry_test_dates) and action='spread'),1,
    jsonb_build_array(jsonb_build_object('destination_date',(select today from pg_temp.carry_test_dates),'expected_revision',3),
      jsonb_build_object('destination_date',(select today+1 from pg_temp.carry_test_dates),'expected_revision',2)))->>'decision_id'),
  (select result->>'decision_id' from pg_temp.carry_reverse_result),'a same-request reversal retry returns its original receipt');
select public.save_carry_decision('93111111-1111-4111-8111-111111111120',(select monday from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select monday from pg_temp.carry_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.carry_test_dates)),
  'single_day',100,jsonb_build_array(jsonb_build_object('destination_date',(select today+1 from pg_temp.carry_test_dates),
    'signed_delta_kcal',-100,'expected_revision',(select revision from public.days where user_id=auth.uid() and local_date=(select today+1 from pg_temp.carry_test_dates)))));
select extensions.throws_ok(
  format($sql$select public.reverse_carry_decision('93111111-1111-4111-8111-111111111121',%L,
    (select revision from public.weeks where user_id=auth.uid() and week_start=%L),
    jsonb_build_array(jsonb_build_object('destination_date',%L,'expected_revision',3)))$sql$,
    (select id from public.carry_decisions where user_id=auth.uid() and source_date=(select monday from pg_temp.carry_test_dates) and action='single_day'),
    (select monday from pg_temp.carry_test_dates),(select today+1 from pg_temp.carry_test_dates)),
  '40001',null,'a reversal with a stale recipient revision is rejected atomically');
select extensions.is((select state::text from public.carry_decisions where user_id=auth.uid() and source_date=(select monday from pg_temp.carry_test_dates) and action='single_day'),'active',
  'a rejected stale reversal leaves its active ledger decision untouched');

select set_config('request.jwt.claim.sub','93222222-2222-4222-8222-222222222222',true);
select public.complete_profile_onboarding('93222222-2222-4222-8222-222222222222','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.ensure_day_snapshot((select monday from pg_temp.carry_test_dates));
select public.complete_day('93222222-2222-4222-8222-222222222224',(select monday from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)));
select public.save_carry_decision('93222222-2222-4222-8222-222222222225',(select monday from pg_temp.carry_test_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select monday from pg_temp.carry_test_dates)),
  (select monday from pg_temp.carry_test_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.carry_test_dates)),
  'none',0,'[]'::jsonb);
select extensions.is((select action::text from public.carry_decisions where user_id=auth.uid()),'none','do nothing is persisted as an explicit decision');
select extensions.is((select count(*) from public.carry_allocations where user_id=auth.uid()),0::bigint,'do nothing records no target allocations');
select extensions.is((select count(*) from public.mutation_receipts where user_id=auth.uid() and request_id='93222222-2222-4222-8222-222222222225'),1::bigint,'do nothing also receives an idempotency receipt');
select extensions.throws_ok(
  format($sql$select public.reverse_carry_decision('93222222-2222-4222-8222-222222222226',%L,
    (select revision from public.weeks where user_id=auth.uid() and week_start=%L),'[]'::jsonb)$sql$,
    (select id from public.carry_decisions where user_id=auth.uid()),(select monday from pg_temp.carry_test_dates)),
  '22023',null,'an explicit Do nothing decision has no transfer to reverse');

select * from extensions.finish();
rollback;
