begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('81111111-1111-4111-8111-111111111111','authenticated','authenticated','routine-override-a@test.invalid','',now()),
 ('82222222-2222-4222-8222-222222222222','authenticated','authenticated','routine-override-b@test.invalid','',now());
create temporary table routine_override_ids(label text primary key,id uuid not null);
grant all on routine_override_ids to authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
set local role authenticated;

select public.complete_profile_onboarding('81111111-1111-4111-8111-111111111111','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.routine_override_ids(label,id)
  select 'food',(public.save_food('83333333-3333-4333-8333-333333333333',null,null,'Oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.routine_override_ids(label,id)
  select 'meal',(public.save_meal('84444444-4444-4444-8444-444444444444','Breakfast oats','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_override_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.routine_override_ids(label,id)
  select 'alternate',(public.save_meal('85555555-5555-4555-8555-555555555555','Alternate oats','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_override_ids where label='food'),'amount',60,'unit','g')))->>'id')::uuid;
select public.save_routine_version('86666666-6666-4666-8666-666666666666',(now() at time zone 'Europe/London')::date+1,null,
  jsonb_build_array(
    jsonb_build_object('slot_id','slot-a','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',1,'position',0),
    jsonb_build_object('slot_id','slot-b','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',1,'position',1)
  ));
select extensions.is((public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,2,'routine slots materialize before per-date edits');
insert into pg_temp.routine_override_ids(label,id)
  select 'slot_a',item.id from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:slot-a';
insert into pg_temp.routine_override_ids(label,id)
  select 'slot_b',item.id from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:slot-b';

select extensions.is(
  (public.resize_planned_day_item('87777777-7777-4777-8777-777777777777',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),1,2)->>'selected_amount')::numeric,
  2::numeric,'a planned routine portion can be changed for one date'
);
select extensions.is(
  (select item.planned_payload->>'amount' from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_a')),
  '2','the reviewed quantity and accepted plan payload stay synchronized'
);
select extensions.is(
  (select item.manual_override from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_a')),
  true,'an explicit portion edit is marked as a per-date user override'
);
select extensions.is(
  (select day.log_revision from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+1),
  1,'editing a plan does not change eaten-log revision or intake'
);
select extensions.is(
  (public.resize_planned_day_item('87777777-7777-4777-8777-777777777777',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),1,2)->>'item_revision')::integer,
  2,'an identical resize retry returns its original receipt'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.state='planned'),
  2::bigint,'a resize retry does not create a second plan'
);
select extensions.throws_ok(
  $$select public.resize_planned_day_item('87777777-7777-4777-8777-777777777777',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),1,3)$$,
  '22023',null,'a resize request cannot be replayed with a different amount'
);
select extensions.throws_ok(
  $$select public.resize_planned_day_item('88888888-8888-4888-8888-888888888888',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),1,3)$$,
  '40001',null,'a stale plan revision cannot overwrite a quantity override'
);
select extensions.throws_ok(
  $$select public.resize_planned_day_item('89999999-9999-4999-8999-999999999999',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),2,0)$$,
  '22023',null,'zero is not a valid planned portion'
);

select extensions.is(
  (public.save_routine_version('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',(now() at time zone 'Europe/London')::date+1,1,
    jsonb_build_array(
      jsonb_build_object('slot_id','slot-a','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',3,'position',0),
      jsonb_build_object('slot_id','slot-b','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',3,'position',1)
    ))->>'revision')::integer,
  2,'the weekly template can change after a date-specific portion edit'
);
select extensions.is((public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'updated_count')::integer,1,'refresh updates only the untouched routine slot');
select extensions.is(
  (select item.selected_amount from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_a')),
  2::numeric,'routine refresh preserves the user-chosen portion'
);
select extensions.is(
  (select item.selected_amount from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_b')),
  3::numeric,'routine refresh applies the latest default to an untouched occurrence'
);

select extensions.is(
  (public.replace_planned_day_item('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_b'),2,'breakfast','meal',(select id from pg_temp.routine_override_ids where label='alternate'),1,'serving')->>'planned_count')::integer,
  2,'choosing another future meal leaves a single active replacement alongside the other slot'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_b')),
  'removed','replacing a generated routine occurrence leaves its stable key as a tombstone'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  0,'routine refresh does not recreate a replaced occurrence'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.state='planned' and item.planned_payload->>'source_id'=(select id::text from pg_temp.routine_override_ids where label='alternate')),
  1::bigint,'the accepted date-specific replacement remains planned after refresh'
);
select extensions.is(
  (public.remove_planned_day_item('8ccccccc-cccc-4ccc-8ccc-cccccccccccc',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),2)->>'planned_count')::integer,
  1,'a date-specific plan can be removed without changing its recurring template'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='slot_a')),
  'removed','removal preserves the stable routine occurrence tombstone'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  0,'refresh never resurrects a date-removed occurrence'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.state='planned'),
  1::bigint,'only the accepted replacement remains after its original slot is removed'
);

reset role;
with inserted_version as (
  insert into public.routine_versions(user_id,effective_from)
    values('81111111-1111-4111-8111-111111111111',(now() at time zone 'Europe/London')::date)
    returning id
)
insert into pg_temp.routine_override_ids(label,id) select 'today_version',id from inserted_version;
insert into public.routine_slots(user_id,routine_version_id,slot_id,weekday,section,mode,meal_id,default_multiplier,position)
  values('81111111-1111-4111-8111-111111111111',(select id from pg_temp.routine_override_ids where label='today_version'),
    'today-slot',extract(isodow from (now() at time zone 'Europe/London')::date)::smallint,'breakfast','fixed',
    (select id from pg_temp.routine_override_ids where label='meal'),1,0);
set local role authenticated;
select extensions.is((public.ensure_routine_day((now() at time zone 'Europe/London')::date)->>'materialized_count')::integer,1,'the pre-edit routine creates today’s matching occurrence');
insert into pg_temp.routine_override_ids(label,id)
  select 'today_item',item.id from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:today-slot';
select public.log_day_item('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',(now() at time zone 'Europe/London')::date,'breakfast','meal',
  (select id from pg_temp.routine_override_ids where label='meal'),1,'serving',null,
  (select id from pg_temp.routine_override_ids where label='today_item'),1);
select extensions.is(
  (public.save_routine_version('89999999-9999-4999-8999-999999999998',(now() at time zone 'Europe/London')::date+1,2,
    jsonb_build_array(
      jsonb_build_object('slot_id','slot-a','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',4,'position',0),
      jsonb_build_object('slot_id','slot-b','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_override_ids where label='meal'),'default_multiplier',4,'position',1)
    ))->>'revision')::integer,
  3,'an explicit routine edit creates a newer version effective tomorrow'
);
select extensions.is((public.ensure_routine_day((now() at time zone 'Europe/London')::date)->>'updated_count')::integer,0,'tomorrow’s routine edit does not rewrite today’s routine occurrence');
select extensions.is(
  (select item.state::text='eaten' and item.selected_amount=1 from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='today_item')),
  true,'today’s already-eaten routine item retains its state and portion');
select extensions.is(
  (select item.eaten_snapshot->>'name'='Breakfast oats' and (item.eaten_snapshot->'calories'->>'value')::numeric=152 from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_override_ids where label='today_item')),
  true,'the today snapshot remains unchanged after a future template edit');
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+8)->>'materialized_count')::integer,
  2,'a later matching date resolves the tomorrow-effective routine version');
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+8 and item.selected_amount=4 and item.state='planned'),
  2::bigint,'later generated dates use the new routine defaults');
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+8)->>'materialized_count')::integer,
  0,'opening the same later date again is still idempotent');
select extensions.is(
  (select day.log_revision from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date),
  2,'saving future routine versions does not change today’s eaten-log revision');
reset role;
select set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.resize_planned_day_item('8ddddddd-dddd-4ddd-8ddd-dddddddddddd',(now() at time zone 'Europe/London')::date+1,(select id from pg_temp.routine_override_ids where label='slot_a'),2,4)$$,
  '40001',null,'another account cannot resize the routine owner’s planned item'
);
select * from extensions.finish();
rollback;
