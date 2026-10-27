begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(29);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('81111111-1111-4111-8111-111111111111','authenticated','authenticated','log-a@test.invalid','',now()),
  ('82222222-2222-4222-8222-222222222222','authenticated','authenticated','log-b@test.invalid','',now());

create temporary table logging_ids (label text primary key,id uuid not null);
grant all on logging_ids to authenticated;
select set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
set local role authenticated;

select public.complete_profile_onboarding('81111111-1111-4111-8111-811111111111','Europe/London',2100,'["protein"]'::jsonb,'{"protein":125}'::jsonb);
insert into pg_temp.logging_ids(label,id)
  select 'food',(public.save_food('81111111-1111-4111-8111-811111111112',null,null,'Oats',null,100,'g',null,40,'g',380,'{"protein":13.2}'::jsonb)->>'id')::uuid;
insert into pg_temp.logging_ids(label,id)
  select 'other_food',(public.save_food('81111111-1111-4111-8111-811111111113',null,null,'Milk',null,100,'ml',null,100,'ml',60,'{"protein":3.4}'::jsonb)->>'id')::uuid;
insert into pg_temp.logging_ids(label,id)
  select 'unknown_food',(public.save_food('81111111-1111-4111-8111-811111111114',null,null,'Mystery',null,100,'g',null,100,'g',null,'{}'::jsonb)->>'id')::uuid;
insert into pg_temp.logging_ids(label,id)
  select 'meal',(public.save_meal('81111111-1111-4111-8111-811111111115','Oats and milk','["breakfast"]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('food_id',(select id from pg_temp.logging_ids where label='food'),'amount',50,'unit','g'),
      jsonb_build_object('food_id',(select id from pg_temp.logging_ids where label='other_food'),'amount',100,'unit','ml')
    ))->>'id')::uuid;

select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111121',(now() at time zone 'Europe/London')::date,'breakfast','food',(select id from pg_temp.logging_ids where label='food'),50,'g')->>'calories_kcal')::numeric,
  190::numeric,'food log scales calories against its saved basis'
);
select extensions.is(
  (select (eaten_snapshot->'nutrients'->'protein'->>'value')::numeric from public.day_items where user_id=auth.uid() and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
  6.6::numeric,'food log snapshots scaled nutrient values'
);
select extensions.is(
  (select log_revision from public.days where user_id=auth.uid() and local_date=(now() at time zone 'Europe/London')::date),
  2,'first log creates a dated day and advances its log revision'
);
select extensions.is(
  public.log_day_item('81111111-1111-4111-8111-811111111121',(now() at time zone 'Europe/London')::date,'breakfast','food',(select id from pg_temp.logging_ids where label='food'),50,'g')->>'eaten_count',
  '1','same request retry returns the original result without duplicating intake'
);
select extensions.throws_ok(
  $$select public.log_day_item('81111111-1111-4111-8111-811111111121',(now() at time zone 'Europe/London')::date,'breakfast','food',(select id from pg_temp.logging_ids where label='food'),60,'g')$$,
  '22023',null,'same request id cannot be reused with a different portion'
);
select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111122',(now() at time zone 'Europe/London')::date,'lunch','meal',(select id from pg_temp.logging_ids where label='meal'),2,'serving')->>'calories_kcal')::numeric,
  690::numeric,'saved multi-food meal scales each component by the requested serving count'
);
select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111123',(now() at time zone 'Europe/London')::date,'snack','one_off_food',null,50,'g',
    '{"name":"Banana","basisAmount":100,"basisUnit":"g","caloriesKcal":89,"nutrients":{"protein":1.1}}'::jsonb)->>'calories_kcal')::numeric,
  734.5::numeric,'one-off food contributes a scaled nutrition snapshot without becoming a library record'
);
select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111124',(now() at time zone 'Europe/London')::date,'dinner','one_off_meal',null,1,'serving',
    jsonb_build_object('name','Quick bowl','components',jsonb_build_array(
      jsonb_build_object('food_id',(select id from pg_temp.logging_ids where label='food'),'amount',50,'unit','g'),
      jsonb_build_object('food_id',(select id from pg_temp.logging_ids where label='other_food'),'amount',100,'unit','ml')
    )))->>'calories_kcal')::numeric,
  984.5::numeric,'one-off multi-food meal calculates from active saved food components'
);

reset role;
insert into public.day_items(id,user_id,local_date,section,state,source,selected_amount,selected_unit,planned_payload)
  values(
    '81111111-1111-4111-8111-811111111131','81111111-1111-4111-8111-111111111111',
    (now() at time zone 'Europe/London')::date,'snack','planned','food',25,'g',
    jsonb_build_object('source_kind','food','source_id',(select id::text from pg_temp.logging_ids where label='food'),'amount',25,'unit','g')
  );
set local role authenticated;
select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111132',(now() at time zone 'Europe/London')::date,'snack','food',(select id from pg_temp.logging_ids where label='food'),25,'g',null,'81111111-1111-4111-8111-811111111131',1)->>'calories_kcal')::numeric,
  1079.5::numeric,'a revision-matched planned item transitions to eaten and contributes once'
);
select extensions.is(
  public.log_day_item('81111111-1111-4111-8111-811111111132',(now() at time zone 'Europe/London')::date,'snack','food',(select id from pg_temp.logging_ids where label='food'),25,'g',null,'81111111-1111-4111-8111-811111111131',1)->>'eaten_count',
  '5','retrying the accepted planned transition returns its original receipt'
);
select extensions.throws_ok(
  $$select public.log_day_item('81111111-1111-4111-8111-811111111133',(now() at time zone 'Europe/London')::date,'snack','food',(select id from pg_temp.logging_ids where label='food'),25,'g',null,'81111111-1111-4111-8111-811111111131',1)$$,
  '40001',null,'a second request cannot eat the same planned item again'
);
select extensions.is(
  (public.revise_day_item('81111111-1111-4111-8111-811111111141',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and selected_amount=50 and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
    1,'resize',100,'g')->>'calories_kcal')::numeric,
  1269.5::numeric,'portion correction recalculates from the stored food-basis snapshot'
);
select extensions.is(
  (select (eaten_snapshot->'calories'->>'value')::numeric from public.day_item_history where user_id=auth.uid() and action='edited' order by changed_at desc limit 1),
  190::numeric,'resize records an immutable before-image of the prior eaten snapshot'
);
select extensions.is(
  (public.revise_day_item('81111111-1111-4111-8111-811111111142',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and selected_amount=100 and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
    2,'remove')->>'eaten_count')::integer,
  4,'remove stops the item contributing to actual intake without destroying its snapshot'
);
select extensions.is(
  (public.revise_day_item('81111111-1111-4111-8111-811111111143',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='removed' and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
    3,'restore')->>'calories_kcal')::numeric,
  1269.5::numeric,'undo restores the exact corrected snapshot and totals'
);
select extensions.is(
  public.revise_day_item('81111111-1111-4111-8111-811111111143',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and selected_amount=100 and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
    3,'restore')->>'eaten_count',
  '5','undo retry returns the original receipt'
);
select extensions.throws_ok(
  $$select public.revise_day_item('81111111-1111-4111-8111-811111111144',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and selected_amount=100 and eaten_snapshot->>'source_id'=(select id::text from pg_temp.logging_ids where label='food')),
    3,'restore')$$,
  '40001',null,'a stale correction cannot repeat the restore'
);
select extensions.is(
  (public.revise_day_item('81111111-1111-4111-8111-811111111145',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and eaten_snapshot->>'source'='one_off_food'),
    1,'resize',100,'g')->>'calories_kcal')::numeric,
  1314::numeric,'one-off corrections recalculate from their captured manual nutrition basis'
);
select extensions.is(
  (public.revise_day_item('81111111-1111-4111-8111-811111111146',(now() at time zone 'Europe/London')::date,
    (select id from public.day_items where user_id=auth.uid() and state='eaten' and eaten_snapshot->>'source'='meal'),
    1,'resize',1,'serving')->>'calories_kcal')::numeric,
  1064::numeric,'saved meal corrections rescale each original component basis by the new multiplier'
);
select public.save_food('81111111-1111-4111-8111-811111111151',(select id from pg_temp.logging_ids where label='food'),1,
  'Oats',null,100,'g',null,40,'g',500,'{"protein":30}'::jsonb);
select extensions.is(
  (select food.calories_kcal from public.foods as food where food.user_id=auth.uid() and food.id=(select id from pg_temp.logging_ids where label='food')),
  500::numeric,'the edited Library food now has different current nutrition'
);
select extensions.is(
  (select (item.eaten_snapshot->'calories'->>'value')::numeric from public.day_items as item where item.user_id=auth.uid() and item.eaten_snapshot->>'source'='meal'),
  250::numeric,'changing a component food does not rewrite the corrected eaten meal snapshot'
);
select extensions.is(
  (select (history.eaten_snapshot->'calories'->>'value')::numeric from public.day_item_history as history where history.user_id=auth.uid() and history.item_id=(select item.id from public.day_items as item where item.user_id=auth.uid() and item.eaten_snapshot->>'source'='meal') and history.action='edited' order by history.changed_at desc limit 1),
  500::numeric,'the immutable pre-correction meal snapshot remains available in history'
);
select public.save_meal('81111111-1111-4111-8111-811111111152','Oats and milk revised','["breakfast"]'::jsonb,
  jsonb_build_array(jsonb_build_object('food_id',(select id from pg_temp.logging_ids where label='other_food'),'amount',100,'unit','ml')),
  (select id from pg_temp.logging_ids where label='meal'),1);
select extensions.is(
  (select count(*) from public.meal_components as component where component.user_id=auth.uid() and component.meal_id=(select id from pg_temp.logging_ids where label='meal')),
  1::bigint,'the current recipe has been edited to a single component'
);
select extensions.is(
  jsonb_array_length((select item.eaten_snapshot->'components' from public.day_items as item where item.user_id=auth.uid() and item.eaten_snapshot->>'source'='meal')),
  2,'the earlier eaten meal retains its original two-component snapshot after recipe edit'
);
select extensions.is(
  (public.log_day_item('81111111-1111-4111-8111-811111111122',(now() at time zone 'Europe/London')::date,'lunch','meal',(select id from pg_temp.logging_ids where label='meal'),2,'serving')->>'calories_kcal')::numeric,
  690::numeric,'an uncertain retry after recipe edits returns the original receipt and original day total'
);
select public.archive_food('81111111-1111-4111-8111-811111111153',(select id from pg_temp.logging_ids where label='food'),2);
select extensions.is(
  (select (item.eaten_snapshot->'calories'->>'value')::numeric from public.day_items as item where item.user_id=auth.uid() and item.eaten_snapshot->>'source'='food' and item.selected_amount=100 limit 1),
  380::numeric,'archiving a source food leaves its earlier eaten nutrition snapshot unchanged'
);
select extensions.throws_ok(
  $$select public.log_day_item('81111111-1111-4111-8111-811111111125',(now() at time zone 'Europe/London')::date,'snack','food',(select id from pg_temp.logging_ids where label='unknown_food'),100,'g')$$,
  '22023',null,'unknown-calorie foods cannot be logged'
);
select extensions.throws_ok(
  $$select public.log_day_item('81111111-1111-4111-8111-811111111126',((now() at time zone 'Europe/London')::date+1),'snack','food',(select id from pg_temp.logging_ids where label='food'),10,'g')$$,
  '22023',null,'future dates are reserved for the planning flow'
);

reset role;
select set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select extensions.is((select count(*) from public.day_items),0::bigint,'another account cannot read logged snapshots');

select * from extensions.finish();
rollback;
