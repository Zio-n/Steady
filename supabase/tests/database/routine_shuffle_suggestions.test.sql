begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at) values
  ('88888888-8888-4888-8888-888888888888','authenticated','authenticated','shuffle-suggestion@test.invalid','',now()),
  ('88888888-8888-4888-8888-888888888889','authenticated','authenticated','shuffle-other@test.invalid','',now());
create temporary table shuffle_suggestion_ids(label text primary key,id uuid not null);
create temporary table shuffle_suggestion_results(label text primary key,result jsonb not null);
grant all on shuffle_suggestion_ids,shuffle_suggestion_results to authenticated;
select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
set local role authenticated;

select public.complete_profile_onboarding('88888888-8888-4888-8888-888888888890','Europe/London',2100,'["protein"]'::jsonb,'{"protein":120}'::jsonb);
insert into pg_temp.shuffle_suggestion_ids(label,id)
  select 'food',(public.save_food('88888888-8888-4888-8888-888888888891',null,null,'Persist oats',null,100,'g',null,40,'g',380,'{"protein":13}'::jsonb)->>'id')::uuid;
insert into pg_temp.shuffle_suggestion_ids(label,id)
  select 'meal_one',(public.save_meal('88888888-8888-4888-8888-888888888892','Persisted first bowl','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.shuffle_suggestion_ids where label='food'),'amount',40,'unit','g')))->>'id')::uuid;
insert into pg_temp.shuffle_suggestion_ids(label,id)
  select 'meal_two',(public.save_meal('88888888-8888-4888-8888-888888888893','Persisted second bowl','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.shuffle_suggestion_ids where label='food'),'amount',30,'unit','g')))->>'id')::uuid;
insert into pg_temp.shuffle_suggestion_ids(label,id)
  select 'wrong_section',(public.save_meal('88888888-8888-4888-8888-888888888894','Dinner-only bowl','["dinner"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.shuffle_suggestion_ids where label='food'),'amount',20,'unit','g')))->>'id')::uuid;
select public.save_routine_version('88888888-8888-4888-8888-888888888895',(now() at time zone 'Europe/London')::date+1,null,
  jsonb_build_array(jsonb_build_object('slot_id','persistent-shuffle','weekday',extract(isodow from (now() at time zone 'Europe/London')::date+1)::integer,
    'section','breakfast','mode','shuffle','meal_id',null,'default_multiplier',1.5,'position',0)));
select public.ensure_routine_day((now() at time zone 'Europe/London')::date+1);
insert into pg_temp.shuffle_suggestion_ids(label,id)
  select 'slot',item.id from public.day_items as item where item.user_id=auth.uid() and item.routine_occurrence_key like '%:persistent-shuffle';

insert into pg_temp.shuffle_suggestion_results(label,result)
  select 'initial',public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888896',
    (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,0,
    (select id from pg_temp.shuffle_suggestion_ids where label='meal_one'),1);
select extensions.is((select suggestion.meal_id=(select id from pg_temp.shuffle_suggestion_ids where label='meal_one')
  and suggestion.suggestion_revision=1 and suggestion.amount=1.5 from public.routine_shuffle_suggestions as suggestion
  where suggestion.user_id=auth.uid() and suggestion.day_item_id=(select id from pg_temp.shuffle_suggestion_ids where label='slot')),true,
  'the occurrence stores its first candidate, recipe revision and routine serving amount');
select extensions.is((select item.state='planned' and item.revision=1 and item.planned_payload->>'mode'='shuffle'
  from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.shuffle_suggestion_ids where label='slot')),true,
  'persisting a suggestion does not change the dated Shuffle item or its recurring template');

insert into pg_temp.shuffle_suggestion_results(label,result)
  select 'rerolled',public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888897',
    (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,1,
    (select id from pg_temp.shuffle_suggestion_ids where label='meal_two'),1);
select extensions.is((select result->>'meal_id'=(select id::text from pg_temp.shuffle_suggestion_ids where label='meal_two')
  and (result->>'suggestion_revision')::integer=2 from pg_temp.shuffle_suggestion_results where label='rerolled'),true,
  'reroll advances the persisted occurrence-specific suggestion revision');
select extensions.is(public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888897',
    (now() at time zone 'Europe/London')::date+1,(select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,1,
    (select id from pg_temp.shuffle_suggestion_ids where label='meal_two'),1),
  (select result from pg_temp.shuffle_suggestion_results where label='rerolled'),'an exact reroll retry returns its original receipt without advancing again');
select extensions.throws_ok(
  $$select public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888897',(now() at time zone 'Europe/London')::date+1,
    (select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,1,(select id from pg_temp.shuffle_suggestion_ids where label='meal_one'),1)$$,
  '22023',null,'a saved request ID cannot be reused to select a different suggestion');
select extensions.throws_ok(
  $$select public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888898',(now() at time zone 'Europe/London')::date+1,
    (select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,1,(select id from pg_temp.shuffle_suggestion_ids where label='meal_one'),1)$$,
  '40001',null,'a concurrent stale reroll cannot overwrite a newer occurrence suggestion');
select extensions.throws_ok(
  $$select public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888899',(now() at time zone 'Europe/London')::date+1,
    (select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,2,(select id from pg_temp.shuffle_suggestion_ids where label='meal_two'),9)$$,
  '40001',null,'a changed source revision requires a fresh preview before persistence');
select extensions.throws_ok(
  $$select public.save_routine_shuffle_suggestion('88888888-8888-4888-8888-888888888900',(now() at time zone 'Europe/London')::date+1,
    (select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,2,(select id from pg_temp.shuffle_suggestion_ids where label='wrong_section'),1)$$,
  '23503',null,'a persisted candidate must remain tagged for the routine section');
select extensions.throws_ok(
  $$select public.use_shuffle_suggestion('88888888-8888-4888-8888-888888888901',(now() at time zone 'Europe/London')::date+1,
    (select id from pg_temp.shuffle_suggestion_ids where label='slot'),1,1,(select id from pg_temp.shuffle_suggestion_ids where label='meal_two'),1)$$,
  '40001',null,'Use cannot accept a suggestion revision that has already been rerolled');
select extensions.is((select suggestion.suggestion_revision=2 and suggestion.meal_id=(select id from pg_temp.shuffle_suggestion_ids where label='meal_two')
  from public.routine_shuffle_suggestions as suggestion where suggestion.user_id=auth.uid() and suggestion.day_item_id=(select id from pg_temp.shuffle_suggestion_ids where label='slot')),true,
  'failed stale, source or section checks leave the current persisted suggestion unchanged');
select extensions.is((select day.log_revision=1 from public.days as day where day.user_id=auth.uid() and day.local_date=(now() at time zone 'Europe/London')::date+1),true,
  'saving and rerolling a suggestion does not count as eaten activity');

select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888889',true);
select extensions.is((select count(*)::integer from public.routine_shuffle_suggestions),0,
  'another authenticated account cannot read this occurrence suggestion');

select * from extensions.finish();
rollback;
