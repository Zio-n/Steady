begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('94111111-1111-4111-8111-111111111111','authenticated','authenticated','completed-correction@test.invalid','',now());
create temporary table correction_dates as
select (now() at time zone 'Europe/London')::date as today,
  (now() at time zone 'Europe/London')::date+1 as tomorrow,
  pg_catalog.date_trunc('week',(now() at time zone 'Europe/London')::date::timestamp)::date as monday;
grant all on correction_dates to authenticated;
select set_config('request.jwt.claim.sub','94111111-1111-4111-8111-111111111111',true);
set local role authenticated;

select public.complete_profile_onboarding('94111111-1111-4111-8111-111111111112','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.log_day_item('94111111-1111-4111-8111-111111111113',(select today from pg_temp.correction_dates),
  'breakfast','one_off_food',null,100,'g',
  '{"name":"Toast","basisAmount":100,"basisUnit":"g","caloriesKcal":2400,"nutrients":{}}'::jsonb);
select public.complete_day('94111111-1111-4111-8111-111111111114',(select today from pg_temp.correction_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)));
select extensions.throws_ok(
  format($sql$select public.correct_completed_day_item('94111111-1111-4111-8111-111111111119',%L,
    (select revision-1 from public.days where user_id=auth.uid() and local_date=%L),
    (select log_revision from public.days where user_id=auth.uid() and local_date=%L),
    (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',50,'g')$sql$,
    (select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates)),
  '40001',null,'a stale day revision cannot correct a completed log');
select extensions.throws_ok(
  format($sql$select public.correct_completed_day_item('94111111-1111-4111-8111-111111111120',%L,
    (select revision from public.days where user_id=auth.uid() and local_date=%L),
    (select log_revision-1 from public.days where user_id=auth.uid() and local_date=%L),
    (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',50,'g')$sql$,
    (select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates)),
  '40001',null,'a stale log revision cannot correct a completed log');

select public.save_carry_decision('94111111-1111-4111-8111-111111111115',(select today from pg_temp.correction_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select monday from pg_temp.correction_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.correction_dates)),
  'single_day',300,jsonb_build_array(jsonb_build_object('destination_date',(select tomorrow from pg_temp.correction_dates),
    'signed_delta_kcal',-300,'expected_revision',1)));

select extensions.throws_ok(
  format($sql$select public.correct_completed_day_item('94111111-1111-4111-8111-111111111116',%L,
    (select revision from public.days where user_id=auth.uid() and local_date=%L),
    (select log_revision from public.days where user_id=auth.uid() and local_date=%L),
    (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',50,'g')$sql$,
    (select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates)),
  '40001',null,'a completed log cannot be corrected while a sourced transfer remains active');

select public.reverse_carry_decision('94111111-1111-4111-8111-111111111117',
  (select id from public.carry_decisions where user_id=auth.uid() and source_date=(select today from pg_temp.correction_dates)),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.correction_dates)),
  jsonb_build_array(jsonb_build_object('destination_date',(select tomorrow from pg_temp.correction_dates),
    'expected_revision',(select revision from public.days where user_id=auth.uid() and local_date=(select tomorrow from pg_temp.correction_dates)))));

create temporary table corrected(result jsonb not null);
grant all on corrected to authenticated;
insert into pg_temp.corrected(result)
select public.correct_completed_day_item('94111111-1111-4111-8111-111111111118',(select today from pg_temp.correction_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',50,'g');

select extensions.is((select (result->>'old_actual_kcal')::numeric from pg_temp.corrected),2400::numeric,
  'the correction receipt captures the prior completed actual');
select extensions.is((select (result->>'new_actual_kcal')::numeric from pg_temp.corrected),1200::numeric,
  'the corrected amount recalculates eaten actual from its original nutrition basis');
select extensions.is((select (result->>'frozen_target_kcal')::numeric from pg_temp.corrected),2100::numeric,
  'the correction preserves the target snapshot');
select extensions.is((select completed_actual_kcal from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),1200::numeric,
  'the recomputed actual is persisted while the day remains completed');
select extensions.is((select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  'the completed log revision follows the corrected eaten log');
select extensions.is((select action from public.day_item_history where user_id=auth.uid() order by changed_at desc limit 1),'edited',
  'the existing immutable before-image records the correction');
select extensions.is(
  (public.correct_completed_day_item('94111111-1111-4111-8111-111111111118',(select today from pg_temp.correction_dates),
    (select revision-2 from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),2,
    (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',50,'g')->>'new_actual_kcal')::numeric,
  1200::numeric,'a same-request retry returns its saved result despite stale revisions');
select extensions.throws_ok(
  format($sql$select public.correct_completed_day_item('94111111-1111-4111-8111-111111111118',%L,
    (select revision-2 from public.days where user_id=auth.uid() and local_date=%L),2,
    (select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'resize',60,'g')$sql$,
    (select today from pg_temp.correction_dates),(select today from pg_temp.correction_dates)),
  '22023',null,'the correction request id cannot be reused for a different payload');

select public.save_carry_decision('94111111-1111-4111-8111-111111111122',(select today from pg_temp.correction_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select completed_log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select monday from pg_temp.correction_dates),
  (select revision from public.weeks where user_id=auth.uid() and week_start=(select monday from pg_temp.correction_dates)),
  'none',0,'[]'::jsonb);
create temporary table corrected_again(result jsonb not null);
grant all on corrected_again to authenticated;
insert into pg_temp.corrected_again(result)
select public.correct_completed_day_item('94111111-1111-4111-8111-111111111123',(select today from pg_temp.correction_dates),
  (select revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(select today from pg_temp.correction_dates)),
  (select id from public.day_items where user_id=auth.uid() and state='eaten'),2,'resize',75,'g');
select extensions.is((select state::text from public.carry_decisions where user_id=auth.uid()
  and request_id='94111111-1111-4111-8111-111111111122'),'superseded',
  'a later completed-log correction supersedes an active Do nothing decision');
select extensions.is(
  (select result->'superseded_noop_decision_ids' @> jsonb_build_array(decision.id::text)
     from pg_temp.corrected_again
     cross join public.carry_decisions as decision
     where decision.user_id=auth.uid() and decision.request_id='94111111-1111-4111-8111-111111111122'),
  true,'the correction receipt identifies the superseded decision for review');

select * from extensions.finish();
rollback;
