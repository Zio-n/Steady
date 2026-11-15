begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at) values
  ('d1410000-0000-4000-8000-000000000001','authenticated','authenticated','library-owner@test.invalid','',now()),
  ('d1410000-0000-4000-8000-000000000002','authenticated','authenticated','library-other@test.invalid','',now());
select set_config('request.jwt.claim.sub','d1410000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.complete_calendar_setup(gen_random_uuid(),'UTC',2100);

create temp table reusable_foods as
select (now() at time zone 'UTC')::date as today, '[
  {"section":"unlabelled","amount":0.5,"unit":"cup","payload":{"name":"Rolled oats","basisAmount":1,"basisUnit":"cup","caloriesKcal":300,"nutrients":{"protein":10}},"logging":{"values":{"caloriesKcal":{"certainty":"estimated"}}}},
  {"section":"unlabelled","amount":1,"unit":"serving","payload":{"name":"Banana","basisAmount":1,"basisUnit":"serving","caloriesKcal":110,"nutrients":{}},"logging":{"values":{}}}
]'::jsonb as foods;

select public.save_calendar_composer(gen_random_uuid(),today-3,'eaten',foods) from reusable_foods;
select public.save_calendar_composer(gen_random_uuid(),today-2,'eaten',
  jsonb_build_array(foods->1,foods->0)) from reusable_foods;
select public.save_calendar_composer(gen_random_uuid(),today-1,'eaten',jsonb_set(foods,'{0,amount}','1')) from reusable_foods;
select public.save_calendar_composer(gen_random_uuid(),today+1,'planned',foods) from reusable_foods;
select public.save_calendar_composer(gen_random_uuid(),today,'eaten',jsonb_build_array(foods->0)) from reusable_foods;

select extensions.is((select count(*) from public.list_recent_calendar_meals()),2::bigint,
  'identical food portions deduplicate across dates and order, but a different portion stays distinct');
select extensions.is((select local_date from public.list_recent_calendar_meals(p_limit=>1)),(select today-1 from reusable_foods),
  'recent meals appear newest first');
select extensions.is((select count(*) from public.list_recent_calendar_meals('banana oats')),2::bigint,
  'a recent meal can be found by the names of multiple foods');
select extensions.is((select count(*) from public.list_recent_calendar_meals(p_limit=>1,p_offset=>1)),1::bigint,
  'the recent meal list supports pagination');

create temp table source_recent as select recent.* from public.list_recent_calendar_meals() as recent
where recent.local_date=(select today-2 from reusable_foods);
select extensions.is((select jsonb_array_length(items) from source_recent),2,
  'fetching a recent meal returns its complete group');
select extensions.is((select count(*) from public.meals where user_id=auth.uid()),0::bigint,
  'recent meals do not create extra saved records');

create temp table named_meal as
select public.save_snapshot_meal('d1410000-0000-4000-8000-000000000010','Usual breakfast',foods,history_key) as result
from reusable_foods,source_recent;
select extensions.is((select saved_meal_id::text from public.list_recent_calendar_meals(p_history_key=>(select history_key from source_recent))),
  (select result->>'id' from named_meal),'recent meals link to their named copy');
select extensions.is((select public.save_snapshot_meal('d1410000-0000-4000-8000-000000000010','Usual breakfast',foods,history_key)
  from reusable_foods,source_recent),(select result from named_meal),'retrying a save returns the original meal');

select public.save_snapshot_meal(gen_random_uuid(),'Weekend breakfast',jsonb_set(foods,'{0,amount}','0.75'),
  p_meal_id=>(result->>'id')::uuid,p_expected_revision=>1)
from reusable_foods,named_meal;
select extensions.is((select (snapshot_foods->0->>'amount')::numeric from public.meals where id=(select (result->>'id')::uuid from named_meal)),
  0.75::numeric,'the named meal can be edited');
select extensions.is((select (item->>'selected_amount')::numeric from public.list_recent_calendar_meals(p_history_key=>(select history_key from source_recent))
  cross join lateral jsonb_array_elements(items) as item where item->'eaten_snapshot'->>'name'='Rolled oats'),
  0.5::numeric,'editing the named meal does not change logged portions');

insert into public.hidden_recent_meals(user_id,history_key)
select auth.uid(),history_key from source_recent;
select extensions.is((select count(*) from public.list_recent_calendar_meals()),1::bigint,
  'a hidden meal is filtered before pagination');
select extensions.is((select count(*) from public.list_recent_calendar_meals(p_history_key=>(select history_key from source_recent))),0::bigint,
  'hidden meals do not appear when looked up for reuse');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid()
  and local_date=(select local_date from source_recent) and state='eaten'),2::bigint,
  'hiding a recent meal keeps every logged food in Calendar');

select set_config('request.jwt.claim.sub','d1410000-0000-4000-8000-000000000002',true);
select extensions.is((select count(*) from public.list_recent_calendar_meals()),0::bigint,'other accounts cannot read recent meals');
select extensions.is((select count(*) from public.hidden_recent_meals),0::bigint,'other accounts cannot read hidden meals');
select extensions.throws_ok(
  $$select public.archive_saved_meal(gen_random_uuid(),(result->>'id')::uuid,2) from named_meal$$,
  '40001','The saved meal has changed','other accounts cannot remove saved meals');

select set_config('request.jwt.claim.sub','d1410000-0000-4000-8000-000000000001',true);
delete from public.hidden_recent_meals where history_key=(select history_key from source_recent);
select extensions.is((select count(*) from public.list_recent_calendar_meals()),2::bigint,
  'undo makes the recent meal available again');
select public.archive_saved_meal(gen_random_uuid(),(result->>'id')::uuid,2) from named_meal;
select extensions.is((select count(*) from public.list_recent_calendar_meals()),1::bigint,
  'removing a named meal does not bring its recent copy back to the Library');

select * from extensions.finish();
rollback;
