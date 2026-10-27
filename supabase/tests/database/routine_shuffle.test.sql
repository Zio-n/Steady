begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('86666666-6666-4666-8666-666666666666','authenticated','authenticated','routine-shuffle@test.invalid','',now());
create temporary table routine_shuffle_ids(label text primary key,id uuid not null);
grant all on routine_shuffle_ids to authenticated;
select set_config('request.jwt.claim.sub','86666666-6666-4666-8666-666666666666',true);
set local role authenticated;

select public.complete_profile_onboarding('86666666-6666-4666-8666-666666666666','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'food',(public.save_food('86666666-6666-4666-8666-666666666667',null,null,'Shuffle oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'meal',(public.save_meal('86666666-6666-4666-8666-666666666668','Shuffle oats','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_shuffle_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'wrong_section_meal',(public.save_meal('86666666-6666-4666-8666-666666666669','Dinner oats','["dinner"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_shuffle_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
select extensions.is(
  (public.save_routine_version('86666666-6666-4666-8666-666666666670',(now() at time zone 'Europe/London')::date+1,null,
    jsonb_build_array(jsonb_build_object('slot_id','shuffle-breakfast','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,
      'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1.5,'position',0)))->>'slot_count')::integer,
  1,'the test account saves one future Shuffle occurrence'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  1,'the future Shuffle slot materializes once before acceptance'
);
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'slot',item.id from public.day_items as item where item.user_id=auth.uid()
    and item.routine_occurrence_key like '%:shuffle-breakfast';
select public.save_routine_shuffle_suggestion('86666666-6666-4666-8666-666666666674',
  (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_shuffle_ids where label='slot'),1,0,
  (select id from pg_temp.routine_shuffle_ids where label='meal'),1);
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'accepted_item',(public.use_shuffle_suggestion('86666666-6666-4666-8666-666666666671',
    (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_shuffle_ids where label='slot'),1,
    1,
    (select id from pg_temp.routine_shuffle_ids where label='meal'),1)->>'item_id')::uuid;
select extensions.is(
  (select item.state='removed' and item.planned_payload->>'mode'='shuffle' from public.day_items as item
    where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_shuffle_ids where label='slot')),
  true,'acceptance preserves the original Shuffle occurrence as a tombstone'
);
select extensions.is(
  (select item.state='planned' and item.source='meal' and item.selected_amount=1.5 and item.eaten_snapshot is null
    from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_shuffle_ids where label='accepted_item')),
  true,'acceptance writes the saved meal at the slot portion as planned, never eaten'
);
select extensions.is(
  (public.use_shuffle_suggestion('86666666-6666-4666-8666-666666666671',
    (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_shuffle_ids where label='slot'),1,
    1,
    (select id from pg_temp.routine_shuffle_ids where label='meal'),1)->>'item_id')::uuid,
  (select id from pg_temp.routine_shuffle_ids where label='accepted_item'),'an identical acceptance retry returns the same committed planned item'
);
select public.ensure_routine_day((now() at time zone 'Europe/London')::date+8);
insert into pg_temp.routine_shuffle_ids(label,id)
  select 'next_slot',item.id from public.day_items as item where item.user_id=auth.uid()
    and item.routine_occurrence_key like ((now() at time zone 'Europe/London')::date+8)::text||':shuffle-breakfast';
select public.save_routine_shuffle_suggestion('86666666-6666-4666-8666-666666666675',
  (now() at time zone 'Europe/London')::date+8,(select id from pg_temp.routine_shuffle_ids where label='next_slot'),1,0,
  (select id from pg_temp.routine_shuffle_ids where label='meal'),1);
select extensions.throws_ok(
  $$select public.use_shuffle_suggestion('86666666-6666-4666-8666-666666666672',(now() at time zone 'Europe/London')::date+8,
    (select id from pg_temp.routine_shuffle_ids where label='next_slot'),1,1,(select id from pg_temp.routine_shuffle_ids where label='meal'),9)$$,
  '40001',null,'a changed saved-meal revision requires a fresh preview'
);
select extensions.throws_ok(
  $$select public.use_shuffle_suggestion('86666666-6666-4666-8666-666666666673',(now() at time zone 'Europe/London')::date+8,
    (select id from pg_temp.routine_shuffle_ids where label='next_slot'),1,1,(select id from pg_temp.routine_shuffle_ids where label='wrong_section_meal'),1)$$,
  '23503',null,'the accepted meal must remain tagged for the Shuffle slot section'
);
select extensions.is(
  (select item.state='planned' and item.planned_payload->>'mode'='shuffle'
    from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_shuffle_ids where label='next_slot')),
  true,'rejected stale or mismatched previews leave the future Shuffle slot untouched'
);
select extensions.is(
  (select day.log_revision=1 from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+1),
  true,'accepting a Shuffle suggestion does not increment the eaten-log revision'
);

select * from extensions.finish();
rollback;
