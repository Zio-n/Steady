begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('87777777-7777-4777-8777-777777777777','authenticated','authenticated','whole-day-shuffle@test.invalid','',now());
create temporary table whole_day_shuffle_ids(label text primary key,id uuid not null);
create temporary table whole_day_shuffle_result(label text primary key,result jsonb not null);
grant all on whole_day_shuffle_ids,whole_day_shuffle_result to authenticated;
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;

select public.complete_profile_onboarding('87777777-7777-4777-8777-777777777778','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'food',(public.save_food('87777777-7777-4777-8777-777777777779',null,null,'Batch oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'breakfast_old',(public.save_meal('87777777-7777-4777-8777-777777777780','Old breakfast','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.whole_day_shuffle_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'breakfast_new',(public.save_meal('87777777-7777-4777-8777-777777777781','New breakfast','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.whole_day_shuffle_ids where label='food'),'amount',30,'unit','g')))->>'id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'lunch_old',(public.save_meal('87777777-7777-4777-8777-777777777782','Old lunch','["lunch"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.whole_day_shuffle_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'lunch_new',(public.save_meal('87777777-7777-4777-8777-777777777783','New lunch','["lunch"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.whole_day_shuffle_ids where label='food'),'amount',25,'unit','g')))->>'id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'wrong_section',(public.save_meal('87777777-7777-4777-8777-777777777784','Dinner meal','["dinner"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.whole_day_shuffle_ids where label='food'),'amount',20,'unit','g')))->>'id')::uuid;

insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'breakfast_slot',(public.plan_day_item('87777777-7777-4777-8777-777777777785',(now() at time zone 'Europe/London')::date+1,
    'breakfast','meal',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_old'),1,'serving',null)->>'item_id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'lunch_slot',(public.plan_day_item('87777777-7777-4777-8777-777777777786',(now() at time zone 'Europe/London')::date+1,
    'lunch','meal',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_old'),1.5,'servings',null)->>'item_id')::uuid;
insert into pg_temp.whole_day_shuffle_result(label,result)
  select 'accepted',public.accept_whole_day_shuffle('87777777-7777-4777-8777-777777777787',(now() at time zone 'Europe/London')::date+1,
    jsonb_build_array(
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_slot'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_new'),'expected_meal_revision',1,'amount',1.5),
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_slot'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_new'),'expected_meal_revision',1,'amount',1)
    ));

select extensions.is(jsonb_array_length((select result->'changes' from pg_temp.whole_day_shuffle_result where label='accepted')),2,
  'the whole-day RPC returns both accepted replacements');
select extensions.is((select count(*)::integer from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date+1 and state='removed'),2,
  'both original planned rows become tombstones');
select extensions.is((select count(*)::integer from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date+1 and state='planned'),2,
  'both accepted rows are planned and the planned count remains stable');
select extensions.is((select count(*)::integer from public.day_items as item join pg_temp.whole_day_shuffle_result as batch on batch.label='accepted'
  cross join lateral jsonb_array_elements(batch.result->'changes') as row(value) where item.user_id=auth.uid() and item.id=(row.value->>'item_id')::uuid
    and item.state='planned' and item.source='meal' and item.eaten_snapshot is null),2,
  'every accepted result points to an uneaten saved-meal plan');
select extensions.is((select count(*)::integer from pg_temp.whole_day_shuffle_result as batch
  cross join lateral jsonb_array_elements(batch.result->'changes') as row(value)
  where (row.value->>'meal_id')::uuid in ((select id from pg_temp.whole_day_shuffle_ids where label='breakfast_new'),(select id from pg_temp.whole_day_shuffle_ids where label='lunch_new'))),2,
  'each replacement uses the saved meal selected in its preview');
select extensions.is((public.accept_whole_day_shuffle('87777777-7777-4777-8777-777777777787',(now() at time zone 'Europe/London')::date+1,
    jsonb_build_array(
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_slot'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_new'),'expected_meal_revision',1,'amount',1.5),
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_slot'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_new'),'expected_meal_revision',1,'amount',1)
    ))),(select result from pg_temp.whole_day_shuffle_result where label='accepted'),'an identical request retry returns the original whole-day receipt');
select extensions.throws_ok(
  $$select public.accept_whole_day_shuffle('87777777-7777-4777-8777-777777777787',(now() at time zone 'Europe/London')::date+1,
    jsonb_build_array(jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_slot'),'expected_item_revision',1,
      'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_new'),'expected_meal_revision',1,'amount',1)))$$,
  '22023',null,'a request id cannot be replayed with a partial or changed selection');
select extensions.is((select day.log_revision=1 from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+1),true,
  'whole-day acceptance never increments the eaten-log revision');

insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'stale_first',(public.plan_day_item('87777777-7777-4777-8777-777777777788',(now() at time zone 'Europe/London')::date+2,
    'breakfast','meal',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_old'),1,'serving',null)->>'item_id')::uuid;
insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'stale_second',(public.plan_day_item('87777777-7777-4777-8777-777777777789',(now() at time zone 'Europe/London')::date+2,
    'lunch','meal',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_old'),1,'serving',null)->>'item_id')::uuid;
select public.resize_planned_day_item('87777777-7777-4777-8777-777777777790',(now() at time zone 'Europe/London')::date+2,
  (select id from pg_temp.whole_day_shuffle_ids where label='stale_second'),1,2);
select extensions.throws_ok(
  $$select public.accept_whole_day_shuffle('87777777-7777-4777-8777-777777777791',(now() at time zone 'Europe/London')::date+2,
    jsonb_build_array(
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='stale_first'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_new'),'expected_meal_revision',1,'amount',1),
      jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='stale_second'),'expected_item_revision',1,
        'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='lunch_new'),'expected_meal_revision',1,'amount',1)
    ))$$,
  '40001',null,'a stale plan rejects the entire whole-day acceptance');
select extensions.is((select count(*)::integer from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date+2 and state='planned'),2,
  'a stale slot leaves every original plan in place and inserts no partial replacement');
select extensions.is((select count(*)::integer from public.day_items where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date+2 and state='removed'),0,
  'a stale slot creates no tombstones for otherwise-current slots');

insert into pg_temp.whole_day_shuffle_ids(label,id)
  select 'section_slot',(public.plan_day_item('87777777-7777-4777-8777-777777777792',(now() at time zone 'Europe/London')::date+3,
    'breakfast','meal',(select id from pg_temp.whole_day_shuffle_ids where label='breakfast_old'),1,'serving',null)->>'item_id')::uuid;
select extensions.throws_ok(
  $$select public.accept_whole_day_shuffle('87777777-7777-4777-8777-777777777793',(now() at time zone 'Europe/London')::date+3,
    jsonb_build_array(jsonb_build_object('item_id',(select id from pg_temp.whole_day_shuffle_ids where label='section_slot'),'expected_item_revision',1,
      'meal_id',(select id from pg_temp.whole_day_shuffle_ids where label='wrong_section'),'expected_meal_revision',1,'amount',1)))$$,
  '23503',null,'every selected meal must still match its plan section');
select extensions.is((select item.state='planned' and item.planned_payload->>'source_id'=(select id::text from pg_temp.whole_day_shuffle_ids where label='breakfast_old')
  from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.whole_day_shuffle_ids where label='section_slot')),true,
  'a mismatched section leaves the original selection untouched');

select * from extensions.finish();
rollback;
