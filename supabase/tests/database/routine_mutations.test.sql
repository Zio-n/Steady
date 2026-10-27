begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('87777777-7777-4777-8777-777777777777','authenticated','authenticated','routine-a@test.invalid','',now()),
 ('88888888-8888-4888-8888-888888888888','authenticated','authenticated','routine-b@test.invalid','',now());
create temporary table routine_test_ids (label text primary key,id uuid not null);
grant all on routine_test_ids to authenticated;
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;

select public.complete_profile_onboarding('87777777-7777-4777-8777-777777777777','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.routine_test_ids(label,id)
  select 'food',(public.save_food('87777777-7777-4777-8777-777777777778',null,null,'Oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.routine_test_ids(label,id)
  select 'meal',(public.save_meal('87777777-7777-4777-8777-777777777779','Breakfast oats','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.routine_test_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;

select extensions.is(
  (public.save_routine_version('87777777-7777-4777-8777-777777777780',(now() at time zone 'Europe/London')::date+1,null,
    jsonb_build_array(
      jsonb_build_object('slot_id','fixed-breakfast','weekday',1,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_test_ids where label='meal'),'default_multiplier',1,'position',0),
      jsonb_build_object('slot_id','shuffle-breakfast','weekday',1,'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1.5,'position',1)
    ))->>'revision')::integer,
  1,'a new routine is saved as the first version effective tomorrow'
);
insert into pg_temp.routine_test_ids(label,id)
  select 'version',version.id from public.routine_versions as version where version.user_id=auth.uid() and version.effective_from=(now() at time zone 'Europe/London')::date+1;
select extensions.is(
  (select version.effective_from=(now() at time zone 'Europe/London')::date+1 from public.routine_versions as version where version.user_id=auth.uid() and version.id=(select id from pg_temp.routine_test_ids where label='version')),
  true,'routine edits are dated in the account timezone'
);
select extensions.is(
  (select string_agg(slot.position::text,',' order by slot.position) from public.routine_slots as slot where slot.user_id=auth.uid() and slot.routine_version_id=(select id from pg_temp.routine_test_ids where label='version')),
  '0,1','slots preserve explicit stable ordering within a meal section'
);
select extensions.is(
  (select slot.meal_id=(select id from pg_temp.routine_test_ids where label='meal') from public.routine_slots as slot where slot.user_id=auth.uid() and slot.slot_id='fixed-breakfast'),
  true,'a fixed slot stores its same-owner saved meal'
);
select extensions.is(
  (select slot.mode::text='shuffle' and slot.meal_id is null from public.routine_slots as slot where slot.user_id=auth.uid() and slot.slot_id='shuffle-breakfast'),
  true,'a Shuffle slot remains Shuffle with no fixed meal reference'
);
select extensions.is(
  (public.save_routine_version('87777777-7777-4777-8777-777777777780',(now() at time zone 'Europe/London')::date+1,null,
    jsonb_build_array(
      jsonb_build_object('slot_id','fixed-breakfast','weekday',1,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_test_ids where label='meal'),'default_multiplier',1,'position',0),
      jsonb_build_object('slot_id','shuffle-breakfast','weekday',1,'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1.5,'position',1)
    ))->>'slot_count')::integer,
  2,'an identical routine save retry returns its receipt without duplicating slots'
);
select extensions.throws_ok(
  $$select public.save_routine_version('87777777-7777-4777-8777-777777777780',(now() at time zone 'Europe/London')::date+1,null,'[]'::jsonb)$$,
  '22023',null,'a routine request ID cannot be reused with different contents'
);
select extensions.throws_ok(
  $$select public.save_routine_version('87777777-7777-4777-8777-777777777781',(now() at time zone 'Europe/London')::date,null,'[]'::jsonb)$$,
  '22023',null,'a routine cannot be changed effective today'
);
select extensions.throws_ok(
  $$select public.save_routine_version('87777777-7777-4777-8777-777777777782',(now() at time zone 'Europe/London')::date+1,1,
    jsonb_build_array(jsonb_build_object('slot_id','wrong-section','weekday',1,'section','dinner','mode','fixed','meal_id',(select id from pg_temp.routine_test_ids where label='meal'),'default_multiplier',1,'position',0)))$$,
  '23503',null,'fixed meals must be active and tagged for their routine section'
);
select extensions.is(
  (select count(*) from public.routine_slots as slot where slot.user_id=auth.uid() and slot.routine_version_id=(select id from pg_temp.routine_test_ids where label='version')),
  2::bigint,'a failed routine edit rolls back and retains the previous schedule'
);
select extensions.throws_ok(
  $$select public.save_routine_version('87777777-7777-4777-8777-777777777783',(now() at time zone 'Europe/London')::date+1,9,'[]'::jsonb)$$,
  '40001',null,'stale routine revisions cannot replace a newer schedule'
);
select extensions.throws_ok(
  $$select public.save_routine_version('87777777-7777-4777-8777-777777777784',(now() at time zone 'Europe/London')::date+1,1,
    jsonb_build_array(
      jsonb_build_object('slot_id','duplicate','weekday',2,'section','breakfast','mode','fixed','meal_id',(select id from pg_temp.routine_test_ids where label='meal'),'default_multiplier',1,'position',0),
      jsonb_build_object('slot_id','duplicate','weekday',2,'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1,'position',1)
    ))$$,
  '22023',null,'stable routine slot IDs must be unique within a version'
);
select extensions.is(
  (select count(*) from public.routine_slots as slot where slot.user_id=auth.uid() and slot.routine_version_id=(select id from pg_temp.routine_test_ids where label='version')),
  2::bigint,'duplicate-slot rejection preserves all prior routine rows'
);
reset role;
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
set local role authenticated;
select extensions.is((select count(*) from public.routine_versions),0::bigint,'another account cannot read a routine schedule');

select * from extensions.finish();
rollback;
