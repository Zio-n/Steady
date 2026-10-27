begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(25);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','steady-a@test.invalid','',now()),
  ('22222222-2222-4222-8222-222222222222','authenticated','authenticated','steady-b@test.invalid','',now());

insert into public.profiles (user_id,timezone) values
  ('11111111-1111-4111-8111-111111111111','Europe/London'),
  ('22222222-2222-4222-8222-222222222222','Europe/London');

insert into public.foods (id,user_id,name,basis_amount,basis_unit,calories_kcal) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','A oats',100,'g',380),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','B oats',100,'g',380);

insert into public.meals (id,user_id,name) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','A breakfast');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select extensions.is((select count(*) from public.foods),1::bigint,'account A sees only its own food');
select extensions.lives_ok(
  $$select public.save_food('a1111111-1111-4111-8111-111111111111',null,null,'A yogurt',null,100,'g',null,1,'serving',90,'{}'::jsonb)$$,
  'account A can add its own food through the atomic owner-scoped RPC'
);
select extensions.throws_ok(
  $$insert into public.foods(user_id,name,basis_amount,basis_unit,calories_kcal) values ('22222222-2222-4222-8222-222222222222','forged food',100,'g',90)$$,
  '42501',null,'account A cannot forge account B as owner'
);

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select extensions.is((select count(*) from public.foods),1::bigint,'account B sees only its own food');
select extensions.is((select count(*) from public.foods where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),0::bigint,'account B cannot read account A food');
select extensions.throws_ok(
  $$select public.save_food('c1111111-1111-4111-8111-111111111111',null,null,'invalid amount',null,0,'g',null,1,'serving',90,'{}'::jsonb)$$,
  '22023',null,'database rejects non-positive food basis amounts'
);
select extensions.throws_ok(
  $$insert into public.meals(user_id,name) values ('22222222-2222-4222-8222-222222222222','direct meal write')$$,
  '42501',null,'aggregate writes require a transaction function'
);
select extensions.is(
  public.save_meal('dddddddd-dddd-4ddd-8ddd-dddddddddddd','B breakfast','["breakfast"]'::jsonb,
    '[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb,null,null,450)->>'revision',
  '1','authenticated owner saves meal and same-owner components atomically'
);
select extensions.is(
  public.save_meal('dddddddd-dddd-4ddd-8ddd-dddddddddddd','B breakfast','["breakfast"]'::jsonb,
    '[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb,null,null,450)->>'revision',
  '1','retry returns the original committed result'
);
select extensions.is((select count(*) from public.meals where user_id = '22222222-2222-4222-8222-222222222222'),1::bigint,'idempotent retry does not create a duplicate meal');
select extensions.is(
  public.save_meal('ffffffff-ffff-4fff-8fff-ffffffffffff','B breakfast edited','["breakfast"]'::jsonb,
    '[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":120,"unit":"g"}]'::jsonb,
    (select id from public.meals where user_id = '22222222-2222-4222-8222-222222222222' and name = 'B breakfast'),1,500)->>'revision',
  '2','matching expected revision updates meal and component rows atomically'
);
select extensions.is((select declared_total_weight_g from public.meals where user_id='22222222-2222-4222-8222-222222222222' and name='B breakfast edited'),500::numeric,'declared whole-recipe weight persists on edit');
select extensions.throws_ok(
  $$select public.save_meal('a9999999-9999-4999-8999-999999999999','No section','[]'::jsonb,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb)$$,
  '22023',null,'saved meals require at least one section tag'
);
select extensions.throws_ok(
  $$select public.save_meal('b9999999-9999-4999-8999-999999999999','Duplicate section','["breakfast","breakfast"]'::jsonb,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb)$$,
  '22023',null,'duplicate section tags are rejected'
);
select extensions.throws_ok(
  $$select public.save_meal('d9999999-9999-4999-8999-999999999999','Null sections',null,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb)$$,
  '22023',null,'null section arrays are rejected'
);
select extensions.throws_ok(
  $$select public.save_meal('e9999999-9999-4999-8999-999999999999','Incompatible amount','["lunch"]'::jsonb,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"ml"}]'::jsonb)$$,
  '22023',null,'incompatible component units are rejected by the database'
);
select extensions.throws_ok(
  $$select public.save_meal('c9999999-9999-4999-8999-999999999999','Atomic failure','["lunch"]'::jsonb,'[{"food_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","amount":100,"unit":"g"}]'::jsonb,(select id from public.meals where user_id='22222222-2222-4222-8222-222222222222' and name='B breakfast edited'),2,700)$$,
  '23503',null,'an unavailable component fails the full recipe edit'
);
select extensions.is(
  (select jsonb_build_object('name',meal.name,'revision',meal.revision,'weight',meal.declared_total_weight_g,'amount',component.amount)
   from public.meals meal join public.meal_components component on component.user_id=meal.user_id and component.meal_id=meal.id
   where meal.user_id='22222222-2222-4222-8222-222222222222' and meal.name='B breakfast edited'),
  '{"name":"B breakfast edited","revision":2,"weight":500,"amount":120}'::jsonb,
  'failed component edit rolls back parent values and preserves the previous recipe rows'
);
select extensions.throws_ok(
  $$select public.save_meal('99999999-9999-4999-8999-999999999999','Stale edit','["breakfast"]'::jsonb,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb,(select id from public.meals where user_id = '22222222-2222-4222-8222-222222222222' and name = 'B breakfast edited'),1,null)$$,
  '40001',null,'stale meal revision is rejected rather than overwritten'
);
select extensions.throws_ok(
  $$select public.save_meal('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Forged meal','["breakfast"]'::jsonb,'[{"food_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","amount":100,"unit":"g"}]'::jsonb)$$,
  '23503',null,'transaction function rejects another account food'
);
select extensions.throws_ok(
  $$select public.save_meal('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Different payload','["breakfast"]'::jsonb,'[{"food_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","amount":100,"unit":"g"}]'::jsonb)$$,
  '22023',null,'a reused request ID with different input is rejected'
);

reset role;
select extensions.throws_ok(
  $$insert into public.meal_components(user_id,meal_id,food_id,amount,unit,position) values ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'serving',0)$$,
  '23503',null,'owner-aware foreign keys reject another account food'
);

set local role anon;
select extensions.throws_ok('select * from public.foods','42501',null,'anonymous role has no food-table access');
select extensions.ok(
  not exists (select 1 from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as schema on schema.oid = relation.relnamespace where schema.nspname = 'public' and relation.relkind = 'r' and not relation.relrowsecurity),
  'every public table has row-level security enabled'
);
select extensions.ok(not pg_catalog.has_table_privilege('anon','public.foods','select'),'anonymous role has no direct food-table grant');

select * from extensions.finish();
rollback;
