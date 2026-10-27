begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(28);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('89999999-9999-4999-8999-999999999999','authenticated','authenticated','routine-material-a@test.invalid','',now()),
 ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authenticated','authenticated','routine-material-b@test.invalid','',now());
create temporary table routine_material_ids (label text primary key,id uuid not null);
grant all on routine_material_ids to authenticated;
select set_config('request.jwt.claim.sub','89999999-9999-4999-8999-999999999999',true);
set local role authenticated;

select public.complete_profile_onboarding('89999999-9999-4999-8999-999999999999','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.routine_material_ids(label,id)
  select 'food',(public.save_food('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,null,'Oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.routine_material_ids(label,id)
  select 'meal',(public.save_meal('8ccccccc-cccc-4ccc-8ccc-cccccccccccc','Breakfast oats','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_material_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.routine_material_ids(label,id)
  select 'version',(public.save_routine_version('8ddddddd-dddd-4ddd-8ddd-dddddddddddd',(now() at time zone 'Europe/London')::date+1,null,
    jsonb_build_array(
      jsonb_build_object('slot_id','slot-a','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_material_ids where label='meal'),'default_multiplier',1,'position',0),
      jsonb_build_object('slot_id','slot-b','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_material_ids where label='meal'),'default_multiplier',1,'position',1),
      jsonb_build_object('slot_id','slot-c','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1,'position',2)
    ))->>'id')::uuid;

select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  3,'opening a date materializes its fixed and Shuffle routine slots once'
);
insert into pg_temp.routine_material_ids(label,id)
  select 'manual_item',item.id from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.routine_occurrence_key like '%:slot-a';
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1),
  3::bigint,'one date has one persisted row for each stable logical slot'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.source='routine' and item.state='planned'),
  3::bigint,'routine occurrences start planned and do not count as eaten'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.routine_occurrence_key like ((now() at time zone 'Europe/London')::date+1)::text||':%'),
  3::bigint,'occurrence keys are unique to the local date and stable slot identity'
);
select extensions.is(
  (select item.planned_payload->>'source_kind'='meal' and item.planned_payload->>'source_id'=(select id::text from pg_temp.routine_material_ids where label='meal') from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:slot-a'),
  true,'fixed occurrences preserve the saved meal source for explicit logging'
);
select extensions.is(
  (select item.planned_payload->>'mode'='shuffle' and item.planned_payload->'source_id'='null'::jsonb from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:slot-c'),
  true,'Shuffle materializes as an unresolved planned slot rather than eaten food'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  0,'a repeat date load does not create duplicate occurrences'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1),
  3::bigint,'idempotent date materialization leaves the original occurrence count unchanged'
);

reset role;
update public.day_items set manual_override=true,selected_amount=3,revision=revision+1
  where user_id='89999999-9999-4999-8999-999999999999' and id=(select id from pg_temp.routine_material_ids where label='manual_item');
set local role authenticated;
select extensions.is(
  (public.save_routine_version('8eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',(now() at time zone 'Europe/London')::date+1,1,
    jsonb_build_array(
      jsonb_build_object('slot_id','slot-a','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_material_ids where label='meal'),'default_multiplier',2,'position',0),
      jsonb_build_object('slot_id','slot-b','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_material_ids where label='meal'),'default_multiplier',2,'position',1)
    ))->>'revision')::integer,
  2,'tomorrow schedule edits advance the effective routine revision'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'updated_count')::integer,
  1,'materialization refreshes one untouched planned slot from the new routine version'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'removed_count')::integer,
  0,'a repeated materialization does not remove slots twice'
);
select extensions.is(
  (select item.selected_amount from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_material_ids where label='manual_item')),
  3::numeric,'a manually overridden occurrence is never overwritten by a routine edit'
);
select extensions.is(
  (select item.selected_amount from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:slot-b'),
  2::numeric,'an unmodified occurrence receives the new default multiplier'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.routine_occurrence_key like '%:slot-c' and item.state='removed'),
  1::bigint,'removing a routine slot writes a tombstone instead of erasing occurrence history'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.source='routine' and item.state='planned'),
  2::bigint,'after reconciliation only the two current non-removed occurrences remain planned'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'materialized_count')::integer,
  0,'a removed routine occurrence is not resurrected on a later refresh'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+8)->>'materialized_count')::integer,
  2,'the latest effective routine also materializes independently on a later matching weekday'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+8)->>'materialized_count')::integer,
  0,'a later matching weekday remains idempotent after its initial materialization'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+2)->>'materialized_count')::integer,
  0,'a routine slot is not materialized on a different weekday'
);
select extensions.is(
  public.archive_food('81111111-1111-4111-8111-111111111111',(select id from pg_temp.routine_material_ids where label='food'),1)->>'archived',
  'true','archiving an ingredient preserves the fixed meal and its saved routine reference'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+15)->>'materialized_count')::integer,
  2,'a future date still materializes fixed slots whose recipe ingredient has been archived'
);
select extensions.is(
  (select item.state='planned' and item.planned_payload->>'name'='Breakfast oats' and item.planned_payload->>'source_id'=(select id::text from pg_temp.routine_material_ids where label='meal') from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like ((now() at time zone 'Europe/London')::date+15)::text||':slot-a'),
  true,'an unavailable fixed choice remains identifiable and planned for the user to repair or replace'
);
select extensions.is(
  (select count(*) from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+2),
  0::bigint,'an unmatched weekday does not create an empty day record'
);
select extensions.is(
  (public.save_routine_version('8fffffff-ffff-4fff-8fff-ffffffffffff',(now() at time zone 'Europe/London')::date+1,2,'[]'::jsonb)->>'revision')::integer,
  3,'a routine revision may intentionally clear its weekly schedule'
);
select extensions.is(
  (public.ensure_routine_day((now() at time zone 'Europe/London')::date+1)->>'removed_count')::integer,
  1,'an empty effective weekday tombstones stale untouched routine occurrences'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date+1 and item.routine_occurrence_key like '%:slot-b' and item.state='removed'),
  1::bigint,'clearing a schedule preserves the removed occurrence as a tombstone'
);
select extensions.is(
  (select item.state='planned' and item.selected_amount=3 from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.routine_material_ids where label='manual_item')),
  true,'clearing a schedule preserves a user-overridden planned occurrence'
);
reset role;
select set_config('request.jwt.claim.sub','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
set local role authenticated;
select extensions.is((select count(*) from public.day_items),0::bigint,'another account cannot read routine occurrences');

select * from extensions.finish();
rollback;
