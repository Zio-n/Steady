begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(41);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at) values
  ('d1220000-0000-4000-8000-000000000001','authenticated','authenticated','composer-owner@test.invalid','',now()),
  ('d1220000-0000-4000-8000-000000000002','authenticated','authenticated','composer-other@test.invalid','',now());
select set_config('request.jwt.claim.sub','d1220000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.complete_calendar_setup('d1220000-0000-4000-8000-000000000003','Europe/London',2100);

create temp table composer_fixtures as
select (now() at time zone 'Europe/London')::date as today,
  '[{"section":"unlabelled","amount":1,"unit":"serving",
     "payload":{"name":"Dinner","basisAmount":1,"basisUnit":"serving","caloriesKcal":600,"nutrients":{}},
     "logging":{"kind":"calorie_block","values":{"caloriesKcal":{"certainty":"estimated","source":"Your entry"}}}}]'::jsonb as block,
  '[{"section":"unlabelled","amount":2,"unit":"slice",
     "payload":{"name":"Bread","basisAmount":1,"basisUnit":"slice","caloriesKcal":95,"nutrients":{"protein":3.8}},
     "logging":{"values":{"caloriesKcal":{"certainty":"provided","source":"Your entry"},"protein":{"certainty":"estimated"}}},
     "variant":{"name":"Bread","basisAmount":1,"basisUnit":"slice","caloriesKcal":95,"nutrients":{"protein":3.8},
                "logging":{"values":{"caloriesKcal":{"certainty":"provided","source":"Your entry"},"protein":{"certainty":"estimated"}}}}},
    {"section":"unlabelled","amount":1,"unit":"serving",
     "payload":{"name":"Soup","basisAmount":1,"basisUnit":"serving","caloriesKcal":350,"nutrients":{}},
     "logging":{"values":{}}}]'::jsonb as foods;
create temp table composer_result (key text primary key, result jsonb);

insert into composer_result
select 'block', public.save_calendar_composer('d1220000-0000-4000-8000-000000000010',today,'planned',block)
from composer_fixtures;
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and state='eaten'),0::bigint,'a planned block records no intake');
select extensions.is((select planned_payload->'logging'->>'kind' from public.day_items where user_id=auth.uid()),'calorie_block','planned block keeps its kind');
insert into composer_result
select 'estimate', public.calendar_log_day_item('d1220000-0000-4000-8000-000000000011',today,'unlabelled',
  'one_off_food',null,1,'serving',block->0->'payload',(result->'item_ids'->>0)::uuid,1)
from composer_fixtures join composer_result on key='block';
select extensions.is((select sum((eaten_snapshot->'calories'->>'value')::numeric) from public.day_items where user_id=auth.uid() and state='eaten'),600::numeric,'explicitly logging the estimate counts it once');
select extensions.throws_ok(
  $$select public.save_calendar_composer('d1220000-0000-4000-8000-000000000012',today,'eaten',
    jsonb_set(foods,'{1,payload,caloriesKcal}','null'),
    (result->'item_ids'->>0)::uuid,2) from composer_fixtures join composer_result on key='block'$$,
  '22023','Calories must be known before logging','an invalid second food rolls back replacement and variant save');
select extensions.is((select sum((eaten_snapshot->'calories'->>'value')::numeric) from public.day_items where user_id=auth.uid() and state='eaten'),600::numeric,'a failed replacement preserves the estimate');
select extensions.is((select count(*) from public.foods where user_id=auth.uid()),0::bigint,'a failed replacement leaves no private copy');

insert into composer_result
select 'replacement',public.save_calendar_composer('d1220000-0000-4000-8000-000000000013',today,'eaten',foods,
  (result->'item_ids'->>0)::uuid,2) from composer_fixtures join composer_result on key='block';
select extensions.is((select sum((eaten_snapshot->'calories'->>'value')::numeric) from public.day_items where user_id=auth.uid() and state='eaten'),540::numeric,'foods replace the estimate in actual intake');
select extensions.is((select count(distinct meal_group_id) from public.day_items where user_id=auth.uid()),1::bigint,'replacement keeps the same meal occurrence');
select extensions.is((select result from composer_result where key='replacement'),
  (select public.save_calendar_composer('d1220000-0000-4000-8000-000000000013',today,'eaten',foods,
    (result->'item_ids'->>0)::uuid,2) from composer_fixtures join composer_result on key='block'),'retry returns the same result');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and state='eaten'),2::bigint,'retry creates no additional intake');
select extensions.is((select count(*) from public.foods where user_id=auth.uid()),1::bigint,'nutrition correction is remembered once');
select extensions.is((select eaten_snapshot->'logging'->'values'->'protein'->>'certainty' from public.day_items
  where user_id=auth.uid() and state='eaten' and eaten_snapshot->>'name'='Bread'),'estimated','other nutrients keep their own certainty');

select public.save_calendar_composer('d1220000-0000-4000-8000-000000000020',today,'planned',foods,null,null,
  '{"frequency":"daily","interval":1,"weekdays":[]}')
from composer_fixtures;
select extensions.is((select count(*) from public.foods where user_id=auth.uid()),1::bigint,'the matching variant is reused in the repeat');
select extensions.is((select jsonb_array_length(public.read_calendar_day_with_series(today+1)->'items') from composer_fixtures),2,'series occurrences are visible on a later date');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and local_date>(select today from composer_fixtures)),0::bigint,'reading recurrence writes no dated items');

select public.save_calendar_composer('d1220000-0000-4000-8000-000000000021',today+2,'removed','[]',null,null,null,
  '{"id":"d1220000-0000-4000-8000-000000000020","revision":1,"scope":"one"}') from composer_fixtures;
select public.save_calendar_composer('d1220000-0000-4000-8000-000000000022',today+1,'planned',jsonb_set(foods,'{0,amount}','3'),null,null,null,
  '{"id":"d1220000-0000-4000-8000-000000000020","revision":1,"scope":"following"}') from composer_fixtures;
select extensions.is((select (public.read_calendar_day_with_series(today+1)->'items'->0->>'selected_amount')::numeric from composer_fixtures),3::numeric,'following scope splits and changes future portions');
select extensions.is((select jsonb_array_length(public.read_calendar_day_with_series(today+2)->'items') from composer_fixtures),0,'split retains a skipped date');
select extensions.is((select (item->>'selected_amount')::numeric from composer_fixtures
  cross join lateral jsonb_array_elements(public.read_calendar_day_with_series(today)->'items') as item
  where item->>'series_id'='d1220000-0000-4000-8000-000000000020' and item->'planned_payload'->>'name'='Bread'),2::numeric,'earlier occurrences retain their original portions');

insert into composer_result
select 'incomplete_plan',public.save_calendar_composer('d1220000-0000-4000-8000-000000000024',today-1,'planned',
  jsonb_set(foods,'{1,payload,caloriesKcal}','null')) from composer_fixtures;
insert into composer_result
select 'log_corrected_plan',public.save_calendar_composer('d1220000-0000-4000-8000-000000000025',today-1,'eaten',foods,
  p_replace_group => (select jsonb_agg(jsonb_build_object('id',value,'revision',1)) from jsonb_array_elements(result->'item_ids')))
from composer_fixtures join composer_result on key='incomplete_plan';
select extensions.is((select result->>'meal_group_id' from composer_result where key='log_corrected_plan'),
  (select result->>'meal_group_id' from composer_result where key='incomplete_plan'),'correcting a plan retains its meal group');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and local_date=(select today-1 from composer_fixtures) and state='planned'),
  0::bigint,'logging the corrected plan leaves no duplicate planned entries');
select extensions.is((select sum((eaten_snapshot->'calories'->>'value')::numeric) from public.day_items
  where user_id=auth.uid() and local_date=(select today-1 from composer_fixtures) and state='eaten'),540::numeric,'only corrected food calories are counted');

create temp table meal_to_replan as
select today-1 as local_date, (result->>'meal_group_id')::uuid as group_id,
  jsonb_agg(jsonb_build_object('id',item.id,'revision',item.revision) order by item.id) as items,
  jsonb_object_agg(item.id,item.eaten_snapshot) as snapshots
from composer_fixtures join composer_result on key='log_corrected_plan'
join public.day_items as item on item.id in (select value::uuid from jsonb_array_elements_text(result->'item_ids'))
group by today,result;

select extensions.throws_ok(
  $$select public.set_calendar_meal_state(gen_random_uuid(),local_date,'planned',jsonb_set(items,'{1,revision}','99')) from meal_to_replan$$,
  '40001','The meal has changed','a stale item aborts the entire state change');
select extensions.is((select count(*) from public.day_items as item join meal_to_replan as meal on item.meal_group_id=meal.group_id
  where item.state='eaten'),2::bigint,'a stale item leaves both foods eaten');
insert into composer_result
select 'replanned', public.set_calendar_meal_state('d1220000-0000-4000-8000-000000000030',local_date,'planned',items)
from meal_to_replan;
select extensions.is((select count(*) from public.day_items as item join meal_to_replan as meal on item.meal_group_id=meal.group_id
  where item.state='planned' and item.eaten_at is null and item.eaten_snapshot is null),2::bigint,'marking as not eaten keeps both foods planned');
select extensions.is((select jsonb_object_agg(item.id,item.planned_payload->'frozen_snapshot') from public.day_items as item
  join meal_to_replan as meal on item.meal_group_id=meal.group_id where item.state='planned'),
  (select snapshots from meal_to_replan),'returning to Planned preserves the original portions and nutrition');
select extensions.is((select result from composer_result where key='replanned'),
  (select public.set_calendar_meal_state('d1220000-0000-4000-8000-000000000030',local_date,'planned',items) from meal_to_replan),
  'a state change can be retried safely');
select extensions.is((select count(*) from public.day_item_history where action='replanned'),2::bigint,'replanning captures the eaten history once');

select public.set_calendar_meal_state('d1220000-0000-4000-8000-000000000031',meal.local_date,'eaten',
  jsonb_agg(jsonb_build_object('id',item.id,'revision',item.revision) order by item.id))
from meal_to_replan as meal join public.day_items as item on item.meal_group_id=meal.group_id and item.state='planned'
group by meal.local_date;
select extensions.is((select jsonb_object_agg(item.id,item.eaten_snapshot) from public.day_items as item
  join meal_to_replan as meal on item.meal_group_id=meal.group_id where item.state='eaten'),
  (select snapshots from meal_to_replan),'logging again restores the exact snapshot');

insert into composer_result
select 'edited_eaten', public.save_calendar_composer('d1220000-0000-4000-8000-000000000032',meal.local_date,'eaten',
  jsonb_set(jsonb_set(foods,'{0,section}','"breakfast"'),'{0,amount}','1'),
  p_replace_group => jsonb_agg(jsonb_build_object('id',item.id,'revision',item.revision) order by item.id))
from composer_fixtures, meal_to_replan as meal join public.day_items as item on item.meal_group_id=meal.group_id and item.state='eaten'
group by meal.local_date,foods;
select extensions.is((select result->>'meal_group_id' from composer_result where key='edited_eaten'),
  (select group_id::text from meal_to_replan),'editing an eaten meal retains the occurrence identity');
select extensions.is((select count(*) from public.day_items as item join meal_to_replan as meal on item.meal_group_id=meal.group_id
  where item.state='eaten' and item.section='breakfast'),2::bigint,'editing in the composer can relabel the whole meal');
select extensions.is((select sum((item.eaten_snapshot->'calories'->>'value')::numeric) from public.day_items as item
  join meal_to_replan as meal on item.meal_group_id=meal.group_id where item.state='eaten'),445::numeric,
  'editing the meal replaces the old intake in the daily total');

create temp table meal_to_remove as
select meal.local_date,meal.group_id,
  jsonb_agg(jsonb_build_object('id',item.id,'revision',item.revision) order by item.id) as items,
  jsonb_object_agg(item.id,item.eaten_snapshot) as snapshots
from meal_to_replan as meal join public.day_items as item on item.meal_group_id=meal.group_id and item.state='eaten'
group by meal.local_date,meal.group_id;
select extensions.throws_ok(
  $$select public.change_calendar_meal_removal(gen_random_uuid(),local_date,jsonb_set(items,'{1,revision}','99')) from meal_to_remove$$,
  '40001','The meal has changed','a stale second food rolls back the entire deletion');
select extensions.is((select count(*) from public.day_items as item join meal_to_remove as meal on item.meal_group_id=meal.group_id
  where item.state='eaten'),2::bigint,'a failed removal retains both foods');
insert into composer_result
select 'removed',public.change_calendar_meal_removal('d1220000-0000-4000-8000-000000000033',local_date,items)
from meal_to_remove;
select extensions.is((select count(*) from public.day_items as item join meal_to_remove as meal on item.meal_group_id=meal.group_id
  where item.state<>'removed'),0::bigint,'removing a meal takes out all its foods together');
select extensions.is((select result from composer_result where key='removed'),
  (select public.change_calendar_meal_removal('d1220000-0000-4000-8000-000000000033',local_date,items) from meal_to_remove),
  'retrying removal returns the original receipt');
insert into composer_result
select 'restored',public.change_calendar_meal_removal('d1220000-0000-4000-8000-000000000034',local_date,
  p_removal_request_id => 'd1220000-0000-4000-8000-000000000033') from meal_to_remove;
select extensions.is((select jsonb_object_agg(item.id,item.eaten_snapshot) from public.day_items as item
  join meal_to_remove as meal on item.meal_group_id=meal.group_id where item.state='eaten'),
  (select snapshots from meal_to_remove),'undo restores every food with its exact logged nutrition');
select extensions.is((select result from composer_result where key='restored'),
  (select public.change_calendar_meal_removal('d1220000-0000-4000-8000-000000000034',local_date,
    p_removal_request_id => 'd1220000-0000-4000-8000-000000000033') from meal_to_remove),'undo is safe to retry');

select set_config('request.jwt.claim.sub','d1220000-0000-4000-8000-000000000002',true);
select extensions.throws_ok(
  $$select public.change_calendar_meal_removal(gen_random_uuid(),local_date,
    p_removal_request_id => 'd1220000-0000-4000-8000-000000000033') from meal_to_remove$$,
  '40001','The calendar date is unavailable or complete','another account cannot reuse the removal receipt');
select extensions.throws_ok(
  $$select public.set_calendar_meal_state(gen_random_uuid(),local_date,'planned',items) from meal_to_replan$$,
  '40001','The calendar date is unavailable or complete','another account cannot change a meal’s state');
select extensions.is((select jsonb_array_length(public.read_calendar_day_with_series(today+1)->'items') from composer_fixtures),0,'another account cannot read the repeat');
select extensions.throws_ok(
  $$select public.save_calendar_composer('d1220000-0000-4000-8000-000000000023',today+1,'removed','[]',null,null,null,
    '{"id":"d1220000-0000-4000-8000-000000000022","revision":1,"scope":"all"}') from composer_fixtures$$,
  '40001','Recurring plan changed or is unavailable','another account cannot mutate the repeat');

select extensions.finish();
rollback;
