begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','authenticated','authenticated','calendar-owner@test.invalid','',now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','authenticated','authenticated','calendar-other@test.invalid','',now());
insert into public.profiles(user_id,timezone,base_daily_target_kcal,onboarding_complete) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Europe/London',null,true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Europe/London',null,true);
insert into public.foods(id,user_id,name,basis_amount,basis_unit,calories_kcal) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Owner food',100,'g',180);
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);

select public.calendar_plan_day_item(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000010','2026-11-02','breakfast','food',
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',50,'g'
);
select extensions.is((public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000011','2026-11-02','2026-11-03',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-02'),1,'copy'
)->>'action'),'copy','copy adds a planned entry to another date');
select extensions.is((select count(*) from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-03' and state='planned'),
  1::bigint,'copy creates exactly one planned destination entry');
select extensions.is((select state::text from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-02'),
  'planned','copy leaves the source plan unchanged');
select extensions.is(public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000011','2026-11-02','2026-11-03',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-02'),1,'copy'
), (select result from public.mutation_receipts where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  and request_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000011'),'copy retries return the original receipt');
select extensions.throws_ok($$select public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000011','2026-11-02','2026-11-04',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-02'),1,'copy')$$,
  '22023',null,'the request ID cannot be reused with different transfer input');

select public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000012','2026-11-03','2026-11-04',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-03'),1,'move'
);
select extensions.is((select state::text from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-03'),
  'removed','move removes the source planned item');
select extensions.is((select count(*) from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-04' and state='planned'),
  1::bigint,'move creates exactly one destination planned item');
select extensions.throws_ok($$select public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000013','2026-11-04','2026-11-04',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-04'),1,'move')$$,
  '22023',null,'a planned item cannot be moved to the same date');

select public.remove_planned_day_item(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000014','2026-11-04',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-04'),1
);
select extensions.is((public.restore_planned_calendar_item(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000015','2026-11-04',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-04'),2
)->>'item_revision')::integer,3,'removed planned items can be restored under a revision check');
select extensions.is((select state::text from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-11-04'),
  'planned','restore returns the item to planned state');

select public.calendar_log_day_item('bbbbbbbb-bbbb-4bbb-8bbb-000000000016','2026-10-15','lunch','food',
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',50,'g');
select extensions.throws_ok($$select public.transfer_calendar_plan(
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000017','2026-10-15','2026-10-16',
  (select id from public.day_items where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and local_date='2026-10-15'),1,'move')$$,
  '40001',null,'eaten entries cannot be moved');

select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
select extensions.throws_ok($$select public.transfer_calendar_plan(
  'cccccccc-cccc-4ccc-8ccc-000000000010','2026-11-02','2026-11-03',
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',1,'copy')$$,
  '40001',null,'another account cannot copy the owner plan');
select extensions.ok(not has_function_privilege('anon',
  'public.transfer_calendar_plan(uuid,date,date,uuid,integer,text)','EXECUTE'),
  'anonymous clients cannot copy or move plans');

select extensions.finish();
rollback;
