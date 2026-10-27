begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('41111111-1111-4111-8111-111111111111','authenticated','authenticated','nutrient-a@test.invalid','',now()),
  ('42222222-2222-4222-8222-222222222222','authenticated','authenticated','nutrient-b@test.invalid','',now());
insert into public.nutrient_fields(user_id,field_id,name,unit,standard_key,display_order)
values
  ('41111111-1111-4111-8111-111111111111','protein','Protein','g','protein',0),
  ('41111111-1111-4111-8111-111111111111','custom_hydration_a1','Hydration','ml',null,1),
  ('41111111-1111-4111-8111-111111111111','salt','Salt','g','salt',2);

select set_config('request.jwt.claim.sub','41111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select extensions.is(
  (select count(*) from public.nutrient_fields where field_id = 'custom_hydration_a1'),
  1::bigint,'custom nutrient uses a stable account-scoped identity'
);
select extensions.lives_ok(
  $$update public.nutrient_fields set name = 'Water' where field_id = 'custom_hydration_a1'$$,
  'a custom nutrient label can be renamed without changing its stable identity'
);
select extensions.throws_ok(
  $$update public.nutrient_fields set unit = 'g' where field_id = 'custom_hydration_a1'$$,
  '22023',null,'changing a unit requires a new nutrient field identity'
);
select extensions.is(
  public.reorder_nutrient_fields('["salt","custom_hydration_a1","protein"]'::jsonb)->'field_ids',
  '["salt","custom_hydration_a1","protein"]'::jsonb,'field order is saved atomically in requested order'
);
select extensions.throws_ok(
  $$select public.reorder_nutrient_fields('["protein"]'::jsonb)$$,
  '22023',null,'partial reorder lists are rejected rather than hiding omitted fields'
);
select extensions.lives_ok(
  $$update public.nutrient_fields set archived_at = now(),is_displayed = false where field_id = 'custom_hydration_a1'$$,
  'a custom nutrient can be archived without hard deletion'
);
select extensions.is(
  (select count(*) from public.nutrient_fields where field_id = 'custom_hydration_a1' and archived_at is not null),
  1::bigint,'archived nutrient definition remains stored for history'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated','public.nutrient_fields','delete'),
  'authenticated clients cannot hard-delete nutrient definitions'
);

reset role;
select set_config('request.jwt.claim.sub','42222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select extensions.is(
  (select count(*) from public.nutrient_fields),
  0::bigint,'another account cannot read nutrient definitions'
);

select * from extensions.finish();
rollback;
