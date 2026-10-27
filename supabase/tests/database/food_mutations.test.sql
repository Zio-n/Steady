begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('61111111-1111-4111-8111-111111111111','authenticated','authenticated','food-a@test.invalid','',now()),
  ('62222222-2222-4222-8222-222222222222','authenticated','authenticated','food-b@test.invalid','',now());
insert into public.nutrient_fields(user_id,field_id,name,unit,standard_key,display_order)
values
  ('61111111-1111-4111-8111-111111111111','protein','Protein','g','protein',0),
  ('61111111-1111-4111-8111-111111111111','salt','Salt','g','salt',1),
  ('62222222-2222-4222-8222-222222222222','custom_private','Private','g',null,0);
create temporary table food_test_ids (label text primary key,id uuid not null);
grant all on food_test_ids to authenticated;

select set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select extensions.is(
  public.save_food('a1111111-1111-4111-8111-111111111111',null,null,'Rolled oats','Steady Mill',100,'g',null,40,'g',380,'{"protein":13.2,"salt":0}'::jsonb)->>'revision',
  '1','create saves food details and nullable serving weight atomically'
);
select extensions.is(
  (select count(*) from public.food_nutrients where user_id = '61111111-1111-4111-8111-111111111111' and food_id = (select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats')),
  2::bigint,'known values including explicit zero are stored in the same transaction'
);
select extensions.is(
  public.save_food('a1111111-1111-4111-8111-111111111111',null,null,'Rolled oats','Steady Mill',100,'g',null,40,'g',380,'{"protein":13.2,"salt":0}'::jsonb)->>'revision',
  '1','retry returns the original food result'
);
select extensions.is(
  (select count(*) from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),
  1::bigint,'retry does not duplicate the food'
);
select extensions.is(
  public.save_food('b1111111-1111-4111-8111-111111111111',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),1,'Rolled oats','Steady Mill',100,'g',null,40,'g',380,'{"protein":0}'::jsonb)->>'revision',
  '2','matching revision edits parent and nutrient values atomically'
);
select extensions.is(
  (select value from public.food_nutrients where user_id = '61111111-1111-4111-8111-111111111111' and food_id = (select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats') and field_id = 'protein'),
  0::numeric,'zero remains distinct from an absent nutrient value'
);
select extensions.is(
  (select count(*) from public.food_nutrients where user_id = '61111111-1111-4111-8111-111111111111' and food_id = (select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats') and field_id = 'salt'),
  0::bigint,'blank active nutrient fields remove only their current value'
);
select extensions.throws_ok(
  $$select public.save_food('c1111111-1111-4111-8111-111111111111',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),1,'Stale oats',null,100,'g',null,40,'g',380,'{"protein":12}'::jsonb)$$,
  '40001',null,'stale food revisions cannot overwrite a newer edit'
);
select extensions.throws_ok(
  $$select public.save_food('d1111111-1111-4111-8111-111111111111',null,null,'Forged nutrient',null,100,'g',null,1,'serving',100,'{"custom_private":12}'::jsonb)$$,
  '22023',null,'a nutrient belonging to another account cannot be attached'
);
insert into pg_temp.food_test_ids(label,id)
  select 'meal',(public.save_meal('e1111111-1111-4111-8111-111111111111','Oats bowl','["breakfast"]'::jsonb,
    jsonb_build_array(jsonb_build_object('food_id',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),'amount',40,'unit','g')))->>'id')::uuid;
reset role;
insert into public.routine_versions(id,user_id,effective_from)
  values ('71111111-1111-4111-8111-111111111111','61111111-1111-4111-8111-111111111111','2026-10-05');
insert into public.routine_slots(user_id,routine_version_id,slot_id,weekday,section,mode,meal_id)
  select '61111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','breakfast',1,'breakfast','fixed',id
  from pg_temp.food_test_ids where label = 'meal';
set local role authenticated;
select extensions.throws_ok(
  $$select public.delete_food('f1111111-1111-4111-8111-111111111111',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),2)$$,
  '23503',null,'food referenced by a saved meal cannot be deleted'
);
select extensions.is(
  public.archive_food('01111111-1111-4111-8111-111111111111',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),2)->>'archived',
  'true','referenced food can be removed from future library selection by archive'
);
select extensions.is(
  public.archive_food('01111111-1111-4111-8111-111111111111',(select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),2)->>'archived',
  'true','archive retry returns its original result'
);
select extensions.is(
  (select count(*) from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats' and archived_at is not null),
  1::bigint,'archiving preserves the food record for history'
);
select extensions.is(
  (select count(*) from public.meal_components where user_id = '61111111-1111-4111-8111-111111111111' and food_id = (select id from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats')),
  1::bigint,'archiving preserves the saved meal reference'
);
select extensions.is(
  (select count(*) from public.routine_slots where user_id = '61111111-1111-4111-8111-111111111111' and meal_id = (select id from pg_temp.food_test_ids where label = 'meal')),
  1::bigint,'archiving preserves the scheduled routine reference to the saved meal'
);
insert into pg_temp.food_test_ids(label,id)
  select 'unused',(public.save_food('11111111-1111-4111-8111-111111111111',null,null,'Unused tea',null,250,'ml',null,250,'ml',0,'{}'::jsonb)->>'id')::uuid;
select extensions.is(
  (select food.revision::text from public.foods as food where food.id = (select id from pg_temp.food_test_ids where label = 'unused')),
  '1','a food may have known zero calories and no optional nutrients'
);
select extensions.is(
  public.delete_food('21111111-1111-4111-8111-111111111111',(select id from pg_temp.food_test_ids where label = 'unused'),1)->>'deleted',
  'true','unreferenced food can be deleted with a revision check'
);
select extensions.is(
  public.delete_food('21111111-1111-4111-8111-111111111111',(select id from pg_temp.food_test_ids where label = 'unused'),1)->>'deleted',
  'true','delete retry is idempotent'
);
select extensions.is(
  (select count(*) from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Unused tea'),
  0::bigint,'deleted food is absent from active data'
);
select public.save_food('31111111-1111-4111-8111-111111111111',null,null,'Rolled oats',null,50,'g',null,1,'serving',190,'{}'::jsonb);
select extensions.is(
  (select count(*) from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Rolled oats'),
  2::bigint,'duplicate food names remain separate user-created records'
);
select public.save_food('41111111-1111-4111-8111-111111111111',null,null,'Müsli 山',null,100,'g',null,1,'serving',350,'{}'::jsonb);
select extensions.is(
  (select name from public.foods where user_id = '61111111-1111-4111-8111-111111111111' and name = 'Müsli 山'),
  'Müsli 山','Unicode food names round-trip without normalization loss'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated','public.foods','insert') and not pg_catalog.has_table_privilege('authenticated','public.foods','delete'),
  'food parent writes are only available through validated functions'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated','public.food_nutrients','insert') and not pg_catalog.has_table_privilege('authenticated','public.food_nutrients','delete'),
  'food nutrient writes are only available through validated functions'
);
select extensions.throws_ok(
  $$insert into public.foods(user_id,name,basis_amount,basis_unit) values ('61111111-1111-4111-8111-111111111111','Direct write',100,'g')$$,
  '42501',null,'direct client food writes are revoked'
);

reset role;
select set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select extensions.is((select count(*) from public.foods),0::bigint,'another account cannot read private foods');

select * from extensions.finish();
rollback;
