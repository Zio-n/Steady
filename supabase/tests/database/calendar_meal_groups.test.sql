begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('77777777-7777-4777-8777-777777777777','authenticated','authenticated','meal-group@test.invalid','',now());
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select public.complete_calendar_setup('77777777-7777-4777-8777-777777777778','Europe/London',2100);

create temp table meal_test_inputs (kind text primary key, payload jsonb);
grant all on meal_test_inputs to authenticated;
insert into meal_test_inputs values
  ('log', jsonb_build_array(
    jsonb_build_object('request_id','77777777-7777-4777-8777-777777777781','meal_group_id','77777777-7777-4777-8777-777777777781','local_date',(now() at time zone 'Europe/London')::date,'section','breakfast','source_kind','one_off_food','amount',100,'unit','g','display_measure',jsonb_build_object('kind','weight','value',100),'manual_payload',jsonb_build_object('name','Oats','brand','Test oats','basisAmount',100,'basisUnit','g','caloriesKcal',380,'nutrients',jsonb_build_object('protein',13))),
    jsonb_build_object('request_id','77777777-7777-4777-8777-777777777782','meal_group_id','77777777-7777-4777-8777-777777777781','local_date',(now() at time zone 'Europe/London')::date,'section','breakfast','source_kind','one_off_food','amount',100,'unit','g','manual_payload',jsonb_build_object('name','Banana','basisAmount',100,'basisUnit','g','caloriesKcal',89,'nutrients',jsonb_build_object('protein',1.1)))
  )),
  ('plan', jsonb_build_array(
    jsonb_build_object('request_id','77777777-7777-4777-8777-777777777783','meal_group_id','77777777-7777-4777-8777-777777777783','local_date',(now() at time zone 'Europe/London')::date,'section','lunch','source_kind','one_off_food','amount',100,'unit','g','manual_payload',jsonb_build_object('name','Rice','basisAmount',100,'basisUnit','g','caloriesKcal',130,'nutrients',jsonb_build_object('protein',2.7))),
    jsonb_build_object('request_id','77777777-7777-4777-8777-777777777784','meal_group_id','77777777-7777-4777-8777-777777777783','local_date',(now() at time zone 'Europe/London')::date,'section','lunch','source_kind','one_off_food','amount',100,'unit','g','manual_payload',jsonb_build_object('name','Beans','basisAmount',100,'basisUnit','g','caloriesKcal',110,'nutrients',jsonb_build_object('protein',7)))
  ));

select extensions.is(jsonb_array_length(public.calendar_log_day_items((select payload from meal_test_inputs where kind='log'))),2,'two foods log atomically');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and meal_group_id='77777777-7777-4777-8777-777777777781'),2::bigint,'logged foods retain one group');
select extensions.is(jsonb_array_length(public.calendar_log_day_items((select payload from meal_test_inputs where kind='log'))),2,'retry returns the same logged group');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and meal_group_id='77777777-7777-4777-8777-777777777781'),2::bigint,'retry does not duplicate foods');
select extensions.is(jsonb_array_length(public.calendar_log_day_items(jsonb_build_array(
  jsonb_build_object('request_id','77777777-7777-4777-8777-777777777785','meal_group_id','77777777-7777-4777-8777-777777777785','local_date',(now() at time zone 'Europe/London')::date,'section','snack','source_kind','one_off_food','amount',100,'unit','g','manual_payload',jsonb_build_object('name','Apple','basisAmount',100,'basisUnit','g','caloriesKcal',52,'nutrients',jsonb_build_object('protein',0.3)))
))),1,'one food can form a meal occurrence');
select extensions.is((select count(*) from public.day_items where user_id=auth.uid() and meal_group_id='77777777-7777-4777-8777-777777777785'),1::bigint,'single-food meal retains its group');
select extensions.is(jsonb_array_length(public.calendar_plan_day_items((select payload from meal_test_inputs where kind='plan'))),2,'two foods plan atomically');
select extensions.is((select count(*) from jsonb_array_elements(public.read_calendar_day((now() at time zone 'Europe/London')::date)->'items') as rows(value) where value->>'meal_group_id' in ('77777777-7777-4777-8777-777777777781','77777777-7777-4777-8777-777777777783')),4::bigint,'calendar read exposes both meal groups');

select extensions.is((select eaten_snapshot->>'brand' from public.day_items where user_id=auth.uid() and eaten_snapshot->>'name'='Oats'),'Test oats','meal snapshot retains brand');
select extensions.is((select eaten_snapshot->'display_measure'->>'value' from public.day_items where user_id=auth.uid() and eaten_snapshot->>'name'='Oats'),'100','meal snapshot retains known weight');
select extensions.finish();
rollback;
