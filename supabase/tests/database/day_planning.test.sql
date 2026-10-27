begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(23);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('85555555-5555-4555-8555-555555555555','authenticated','authenticated','plan-a@test.invalid','',now()),
 ('86666666-6666-4666-8666-666666666666','authenticated','authenticated','plan-b@test.invalid','',now());
create temporary table plan_ids (label text primary key,id uuid not null);
grant all on plan_ids to authenticated;
select set_config('request.jwt.claim.sub','85555555-5555-4555-8555-555555555555',true);
set local role authenticated;

select public.complete_profile_onboarding('85555555-5555-4555-8555-555555555555','Europe/London',2100,'["protein"]'::jsonb,'{"protein":125}'::jsonb);
insert into pg_temp.plan_ids(label,id)
  select 'food',(public.save_food('85555555-5555-4555-8555-555555555556',null,null,'Oats',null,100,'g',40,40,'g',380,'{"protein":13.2}'::jsonb)->>'id')::uuid;

select extensions.is(
  (public.plan_day_item('85555555-5555-4555-8555-555555555557',(now() at time zone 'Europe/London')::date+1,'breakfast','food',(select id from pg_temp.plan_ids where label='food'),40,'g')->>'planned_count')::integer,
  1,'a future saved-food choice is persisted as a planned item'
);
insert into pg_temp.plan_ids(label,id)
  select 'future_item',item.id from public.day_items as item
  where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.state='planned';
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.plan_ids where label='future_item')),
  'planned','a future plan never starts in the eaten state'
);
select extensions.is(
  (select item.planned_payload->>'source_kind' from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.plan_ids where label='future_item')),
  'food','the planned payload retains its source for an explicit later Ate it action'
);
select extensions.is(
  (select item.eaten_snapshot is null from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.plan_ids where label='future_item')),
  true,'a plan has no eaten nutrition snapshot'
);
select extensions.is(
  (select day.log_revision from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+1),
  1,'creating a plan leaves the day log revision at its initial value'
);
select extensions.is(
  (public.plan_day_item('85555555-5555-4555-8555-555555555557',(now() at time zone 'Europe/London')::date+1,'breakfast','food',(select id from pg_temp.plan_ids where label='food'),40,'g')->>'planned_count')::integer,
  1,'an identical plan retry returns its receipt without duplicating the planned row'
);
select extensions.throws_ok(
  $$select public.plan_day_item('85555555-5555-4555-8555-555555555557',(now() at time zone 'Europe/London')::date+1,'breakfast','food',(select id from pg_temp.plan_ids where label='food'),50,'g')$$,
  '22023',null,'a plan request ID cannot be reused with a different portion'
);
select extensions.throws_ok(
  $$select public.plan_day_item('85555555-5555-4555-8555-555555555558',(now() at time zone 'Europe/London')::date,'breakfast','food',(select id from pg_temp.plan_ids where label='food'),40,'g')$$,
  '22023',null,'today cannot be saved as a future-only plan'
);
select extensions.throws_ok(
  $$select public.log_day_item('85555555-5555-4555-8555-555555555559',(now() at time zone 'Europe/London')::date+1,'breakfast','food',(select id from pg_temp.plan_ids where label='food'),40,'g',null,(select id from pg_temp.plan_ids where label='future_item'),1)$$,
  '22023',null,'a future plan cannot be marked eaten before its date'
);
select extensions.is(
  (public.remove_planned_day_item('85555555-5555-4555-8555-555555555560',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.plan_ids where label='future_item'),1)->>'planned_count')::integer,
  0,'removing a plan excludes it from the future list'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.plan_ids where label='future_item')),
  'removed','removing a plan preserves a soft-removed row rather than deleting history'
);
select extensions.throws_ok(
  $$select public.remove_planned_day_item('85555555-5555-4555-8555-555555555561',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.plan_ids where label='future_item'),1)$$,
  '40001',null,'a stale plan removal cannot be applied twice'
);
select extensions.is(
  (public.plan_day_item('85555555-5555-4555-8555-555555555562',(now() at time zone 'Europe/London')::date+2,'snack','one_off_food',null,100,'g',
    '{"name":"Mystery snack","basisAmount":100,"basisUnit":"g","caloriesKcal":null,"nutrients":{"protein":null}}'::jsonb)->>'planned_count')::integer,
  1,'a future one-off food can be planned even while its calories are unknown'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+2 and item.section='snack'),
  'planned','unknown-calorie food remains a plan, not consumed intake'
);
select public.plan_day_item('85555555-5555-4555-8555-555555555563',(now() at time zone 'Europe/London')::date+3,'lunch','food',(select id from pg_temp.plan_ids where label='food'),40,'g');
insert into pg_temp.plan_ids(label,id)
  select 'replace_item',item.id from public.day_items as item
  where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+3 and item.state='planned';
select extensions.is(
  (public.replace_planned_day_item('85555555-5555-4555-8555-555555555564',(now() at time zone 'Europe/London')::date+3,(select id from pg_temp.plan_ids where label='replace_item'),1,'dinner','food',(select id from pg_temp.plan_ids where label='food'),60,'g')->>'planned_count')::integer,
  1,'choosing another item atomically leaves exactly one plan'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.plan_ids where label='replace_item')),
  'removed','the replaced planned row is preserved as removed history'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+3 and item.state='planned'),
  1::bigint,'replacement creates a single active planned row'
);
select extensions.is(
  (public.replace_planned_day_item('85555555-5555-4555-8555-555555555564',(now() at time zone 'Europe/London')::date+3,(select id from pg_temp.plan_ids where label='replace_item'),1,'dinner','food',(select id from pg_temp.plan_ids where label='food'),60,'g')->>'planned_count')::integer,
  1,'an identical choose-instead retry returns its receipt without duplicating'
);
select extensions.throws_ok(
  $$select public.replace_planned_day_item('85555555-5555-4555-8555-555555555564',(now() at time zone 'Europe/London')::date+3,(select id from pg_temp.plan_ids where label='replace_item'),1,'dinner','food',(select id from pg_temp.plan_ids where label='food'),70,'g')$$,
  '22023',null,'a choose-instead request ID cannot be reused with different input'
);
select extensions.throws_ok(
  $$select public.replace_planned_day_item('85555555-5555-4555-8555-555555555565',(now() at time zone 'Europe/London')::date+3,(select id from pg_temp.plan_ids where label='replace_item'),1,'dinner','food','99999999-9999-4999-8999-999999999999',60,'g')$$,
  '40001',null,'a stale plan replacement is rejected'
);
select public.plan_day_item('85555555-5555-4555-8555-555555555566',(now() at time zone 'Europe/London')::date+4,'snack','food',(select id from pg_temp.plan_ids where label='food'),40,'g');
insert into pg_temp.plan_ids(label,id)
  select 'rollback_item',item.id from public.day_items as item
  where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+4 and item.state='planned';
select extensions.throws_ok(
  $$select public.replace_planned_day_item('85555555-5555-4555-8555-555555555567',(now() at time zone 'Europe/London')::date+4,(select id from pg_temp.plan_ids where label='rollback_item'),1,'dinner','food','99999999-9999-4999-8999-999999999999',60,'g')$$,
  '23503',null,'an invalid replacement choice is rejected'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+4 and item.state='planned'),
  1::bigint,'a rejected replacement leaves the active plan unchanged'
);
reset role;
select set_config('request.jwt.claim.sub','86666666-6666-4666-8666-666666666666',true);
set local role authenticated;
select extensions.is((select count(*) from public.day_items),0::bigint,'another account cannot read planned items');

select * from extensions.finish();
rollback;
