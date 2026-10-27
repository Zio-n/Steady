begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('87777777-7777-4777-8777-777777777777','authenticated','authenticated','week-a@test.invalid','',now());
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select public.complete_profile_onboarding('87777777-7777-4777-8777-777777777778','Europe/London',2000,'[]'::jsonb,'{}'::jsonb);

reset role;
create temporary table week_test_ids(label text primary key,id uuid not null);
grant all on week_test_ids to authenticated;
insert into pg_temp.week_test_ids(label,id)
select 'custom_pattern',gen_random_uuid();
insert into public.weekly_pattern_versions(user_id,id,effective_week_start,base_daily_target_kcal)
values ('87777777-7777-4777-8777-777777777777',(select id from pg_temp.week_test_ids where label='custom_pattern'),
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+7,2000);
insert into public.weekly_pattern_days(user_id,pattern_version_id,weekday,target_kcal)
select '87777777-7777-4777-8777-777777777777',(select id from pg_temp.week_test_ids where label='custom_pattern'),weekday,target_kcal
from (values (1,1800::numeric),(2,1900),(3,2000),(4,2100),(5,2200),(6,2000),(7,2000)) as days(weekday,target_kcal);

select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select extensions.is(
  (public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+7)->'week'->>'source_pattern_version_id')::uuid,
  (select id from pg_temp.week_test_ids where label='custom_pattern'),
  'a new week snapshots the latest recurring pattern effective on its Monday'
);
select extensions.is(
  (select count(*) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+7),
  7::bigint,'a materialized week stores all seven weekday allocations'
);
select extensions.is(
  (select sum(allocation.base_target_kcal) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+7),
  14000::numeric,'the recurring week snapshot balances exactly to its frozen budget'
);
select extensions.is(
  (public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+7)->'week'->>'allocation_kind'),
  'recurring','a newly materialized week is clearly marked recurring'
);
select extensions.throws_ok(
  $$select public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+8)$$,
  '22023',null,'week materialization rejects dates that are not Monday'
);

reset role;
insert into pg_temp.week_test_ids(label,id) values('one_off_pattern',gen_random_uuid());
insert into public.weekly_pattern_versions(user_id,id,effective_week_start,base_daily_target_kcal)
values ('87777777-7777-4777-8777-777777777777',(select id from pg_temp.week_test_ids where label='one_off_pattern'),
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14,2000);
insert into public.weekly_pattern_days(user_id,pattern_version_id,weekday,target_kcal)
select '87777777-7777-4777-8777-777777777777',(select id from pg_temp.week_test_ids where label='one_off_pattern'),weekday,target_kcal
from (values (1,1800::numeric),(2,1550),(3,2250),(4,2100),(5,2300),(6,2000),(7,2000)) as days(weekday,target_kcal);
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14);
reset role;
update public.weeks set allocation_kind='one_off' where user_id='87777777-7777-4777-8777-777777777777'
  and week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14;
update public.week_allocations as allocation set override_target_kcal=case allocation.weekday
  when 1 then 1800 when 2 then 1550 when 3 then 2250 when 4 then 2100 when 5 then 2300 when 6 then 2000 else 2000 end
  where allocation.user_id='87777777-7777-4777-8777-777777777777'
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14;
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select extensions.is(
  (public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14)->'week'->>'allocation_kind'),
  'one_off','an existing one-off allocation keeps precedence over recurring materialization'
);
select extensions.is(
  (select allocation.override_target_kcal from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14 and allocation.weekday=3),
  2250::numeric,'repeat materialization preserves the explicit one-off weekday overrides'
);
select public.plan_day_item('87777777-7777-4777-8777-777777777779',
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+16,'breakfast','one_off_food',null,100,'g',
  '{"name":"Week snapshot check","basisAmount":100,"basisUnit":"g","caloriesKcal":100,"nutrients":{}}'::jsonb);
select extensions.is(
  (select day.base_planned_target_kcal from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+16),
  2250::numeric,'a new dated day snapshots its one-off override rather than the recurring weekday target'
);
select extensions.is(
  (select count(*) from public.weeks as week where week.user_id=auth.uid()
    and week.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14),
  1::bigint,'repeat ensure calls keep one weekly budget snapshot'
);
select extensions.is(
  (select week.budget_kcal from public.weeks as week where week.user_id=auth.uid()
    and week.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+14),
  14000::numeric,'a one-off allocation retains the recurring weekly budget snapshot'
);

select * from extensions.finish();
rollback;
