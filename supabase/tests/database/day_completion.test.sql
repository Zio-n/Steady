begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('91111111-1111-4111-8111-111111111111','authenticated','authenticated','day-completion@test.invalid','',now()),
 ('92222222-2222-4222-8222-222222222222','authenticated','authenticated','empty-day-completion@test.invalid','',now());
select set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
set local role authenticated;

select public.complete_profile_onboarding('91111111-1111-4111-8111-111111111111','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select public.log_day_item('91111111-1111-4111-8111-111111111112',(now() at time zone 'Europe/London')::date,
  'breakfast','one_off_food',null,100,'g',
  '{"name":"Toast","basisAmount":100,"basisUnit":"g","caloriesKcal":325,"nutrients":{}}'::jsonb);

reset role;
insert into public.day_items(id,user_id,local_date,section,state,source,selected_amount,selected_unit,planned_payload)
values('91111111-1111-4111-8111-111111111113','91111111-1111-4111-8111-111111111111',
  (now() at time zone 'Europe/London')::date,'lunch','planned','food',100,'g',
  '{"source_kind":"one_off_food","source_id":null,"amount":100,"unit":"g","name":"Planned sandwich"}'::jsonb);
set local role authenticated;

select extensions.throws_ok(
  $$select public.complete_day('91111111-1111-4111-8111-111111111114',(now() at time zone 'Europe/London')::date,
    (select revision-1 from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
    (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date))$$,
  '40001',null,'a stale day revision cannot complete the day');
select extensions.throws_ok(
  $$select public.complete_day('91111111-1111-4111-8111-111111111115',(now() at time zone 'Europe/London')::date,
    (select revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
    (select log_revision-1 from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date))$$,
  '40001',null,'a stale eaten-log revision cannot complete the day');
select extensions.throws_ok(
  $$select public.complete_day('91111111-1111-4111-8111-111111111116',(now() at time zone 'Europe/London')::date+1,1,1)$$,
  '22023',null,'a future date cannot be completed');

create temporary table completion_result(result jsonb not null);
grant all on completion_result to authenticated;
insert into pg_temp.completion_result(result)
select public.complete_day('91111111-1111-4111-8111-111111111117',(now() at time zone 'Europe/London')::date,
  (select revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date));

select extensions.is((select (result->>'completed_actual_kcal')::numeric from pg_temp.completion_result),325::numeric,
  'completion snapshots calories from eaten entries only');
select extensions.is((select (result->>'completed_target_kcal')::numeric from pg_temp.completion_result),2100::numeric,
  'completion freezes the day target');
select extensions.is((select (result->>'planned_items_left_uneaten')::integer from pg_temp.completion_result),1,
  'completion reports planned items without counting them');
select extensions.is((select completed_actual_kcal from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),325::numeric,
  'the eaten total is persisted as an immutable day snapshot');
select extensions.is((select status::text from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),'completed',
  'successful confirmation marks the day complete');
select extensions.is((select completed_target_kcal from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),2100::numeric,
  'the persisted target snapshot matches the confirmed target');
select extensions.is((select completed_log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
  (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
  'completion records the exact eaten-log revision');
select extensions.is((select completed_log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),2,
  'the saved log revision reflects only the eaten entry');
select extensions.is((select state::text from public.day_items where id='91111111-1111-4111-8111-111111111113'),'planned',
  'planned items remain planned after completion');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date and state='planned'),1::bigint,
  'completion does not transition a planned row into the eaten count');
select extensions.is((select completed_at is not null from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),true,
  'completion stores its timestamp');
select extensions.is((select revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
  (select (result->>'revision')::integer from pg_temp.completion_result),'completion advances the day revision exactly once');
select extensions.is((select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),2,
  'completion does not increment the eaten-log revision');
select extensions.is(
  (public.complete_day('91111111-1111-4111-8111-111111111117',(now() at time zone 'Europe/London')::date,
    (select revision-1 from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
    (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date))->>'revision'),
  (select result->>'revision' from pg_temp.completion_result),'same-request retry returns its original completion receipt');
select extensions.throws_ok(
  $$select public.complete_day('91111111-1111-4111-8111-111111111118',(now() at time zone 'Europe/London')::date,
    (select revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
    (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date))$$,
  '40001',null,'a second completion request cannot complete the same day again');
select extensions.throws_ok(
  $$select public.log_day_item('91111111-1111-4111-8111-111111111119',(now() at time zone 'Europe/London')::date,
    'snack','one_off_food',null,50,'g','{"name":"Apple","basisAmount":100,"basisUnit":"g","caloriesKcal":50,"nutrients":{}}'::jsonb)$$,
  '40001',null,'a completed day rejects further food logging');

select set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
select public.complete_profile_onboarding('92222222-2222-4222-8222-222222222223','Europe/London',2100,'[]'::jsonb,'{}'::jsonb);
select extensions.is((public.ensure_day_snapshot((now() at time zone 'Europe/London')::date)->'day'->>'status'),'open',
  'a routine-free date receives a completion-capable day snapshot');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),0::bigint,
  'materializing an empty day does not fabricate meal items');
set local role authenticated;
select extensions.is(
  (public.complete_day('92222222-2222-4222-8222-222222222224',(now() at time zone 'Europe/London')::date,
    (select revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
    (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date))->>'completed_actual_kcal')::numeric,
  0::numeric,'an explicitly completed empty day snapshots zero eaten calories');
select extensions.is((select status::text from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),'completed',
  'the routine-free empty day is completed only by the explicit RPC');

select * from extensions.finish();
rollback;
