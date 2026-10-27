begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('83333333-3333-4333-8333-333333333333','authenticated','authenticated','replace@test.invalid','',now());
create temporary table replacement_ids (label text primary key,id uuid not null);
grant all on replacement_ids to authenticated;
select set_config('request.jwt.claim.sub','83333333-3333-4333-8333-333333333333',true);
set local role authenticated;

select public.complete_profile_onboarding('83333333-3333-4333-8333-333333333333','Europe/London',2100,'["protein"]'::jsonb,'{"protein":125}'::jsonb);
insert into pg_temp.replacement_ids(label,id)
  select 'food',(public.save_food('83333333-3333-4333-8333-333333333334',null,null,'Oats',null,100,'g',40,40,'g',380,'{"protein":13.2}'::jsonb)->>'id')::uuid;

select public.log_day_item(
  '83333333-3333-4333-8333-333333333335',(now() at time zone 'Europe/London')::date,'breakfast','food',
  (select id from pg_temp.replacement_ids where label='food'),50,'g'
);
insert into pg_temp.replacement_ids(label,id)
  select 'old_item',item.id from public.day_items as item
  where item.user_id=auth.uid() and item.state='eaten' and item.eaten_snapshot->>'source_id'=(select id::text from pg_temp.replacement_ids where label='food');

select extensions.is(
  (select (item.eaten_snapshot->'calories'->>'value')::numeric from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.replacement_ids where label='old_item')),
  190::numeric,'the original entry keeps its original nutrition snapshot'
);

select public.save_food('83333333-3333-4333-8333-333333333336',(select id from pg_temp.replacement_ids where label='food'),1,'Oats',null,100,'g',40,40,'g',500,'{"protein":20}'::jsonb);

select public.replace_day_item(
  '83333333-3333-4333-8333-333333333337',(now() at time zone 'Europe/London')::date,
  (select id from pg_temp.replacement_ids where label='old_item'),1,'breakfast','food',
  (select id from pg_temp.replacement_ids where label='food'),50,'g'
);

select extensions.is(
  (public.replace_day_item(
    '83333333-3333-4333-8333-333333333337',(now() at time zone 'Europe/London')::date,
    (select id from pg_temp.replacement_ids where label='old_item'),1,'breakfast','food',
    (select id from pg_temp.replacement_ids where label='food'),50,'g'
  )->>'calories_kcal')::numeric,
  250::numeric,'replacement returns authoritative totals after logging current Library values'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date and item.state='eaten'),
  1::bigint,'replacement leaves exactly one eaten item'
);
select extensions.is(
  (select item.state::text from public.day_items as item where item.user_id=auth.uid() and item.id=(select id from pg_temp.replacement_ids where label='old_item')),
  'removed','replacement soft-removes the old entry'
);
select extensions.is(
  (select history.action from public.day_item_history as history where history.user_id=auth.uid() and history.item_id=(select id from pg_temp.replacement_ids where label='old_item')),
  'replaced','replacement labels the preserved before-image as replaced'
);
select extensions.is(
  (select (history.eaten_snapshot->'calories'->>'value')::numeric from public.day_item_history as history where history.user_id=auth.uid() and history.item_id=(select id from pg_temp.replacement_ids where label='old_item')),
  190::numeric,'replacement history preserves the old calories'
);
select extensions.is(
  (select (item.eaten_snapshot->'nutrients'->'protein'->>'value')::numeric from public.day_items as item where item.user_id=auth.uid() and item.state='eaten'),
  10::numeric,'replacement captures the edited current nutrient values'
);
select extensions.is(
  (public.replace_day_item(
    '83333333-3333-4333-8333-333333333337',(now() at time zone 'Europe/London')::date,
    (select id from pg_temp.replacement_ids where label='old_item'),1,'breakfast','food',
    (select id from pg_temp.replacement_ids where label='food'),50,'g'
  )->>'eaten_count')::integer,
  1,'an identical replacement retry returns its receipt without duplicating intake'
);
select extensions.throws_ok(
  $$select public.replace_day_item('83333333-3333-4333-8333-333333333337',(now() at time zone 'Europe/London')::date,(select id from pg_temp.replacement_ids where label='old_item'),1,'breakfast','food',(select id from pg_temp.replacement_ids where label='food'),60,'g')$$,
  '22023',null,'a replacement receipt cannot be reused with changed input'
);
select extensions.throws_ok(
  $$select public.replace_day_item('83333333-3333-4333-8333-333333333338',(now() at time zone 'Europe/London')::date,(select id from pg_temp.replacement_ids where label='old_item'),1,'breakfast','food',(select id from pg_temp.replacement_ids where label='food'),50,'g')$$,
  '40001',null,'a stale replacement cannot be applied twice'
);
select extensions.throws_ok(
  $$select public.replace_day_item('83333333-3333-4333-8333-333333333339',(now() at time zone 'Europe/London')::date,(select id from public.day_items where user_id=auth.uid() and state='eaten'),1,'breakfast','food','84444444-4444-4444-8444-444444444444',50,'g')$$,
  '23503',null,'an invalid replacement source fails safely'
);
select extensions.is(
  (select count(*) from public.day_items as item where item.user_id=auth.uid() and item.local_date=(now() at time zone 'Europe/London')::date and item.state='eaten'),
  1::bigint,'a failed replacement rolls back removal and preserves the current eaten item'
);

select * from extensions.finish();
rollback;
