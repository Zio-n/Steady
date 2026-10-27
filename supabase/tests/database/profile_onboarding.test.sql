begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values
  ('31111111-1111-4111-8111-111111111111','authenticated','authenticated','profile-a@test.invalid','',now()),
  ('32222222-2222-4222-8222-222222222222','authenticated','authenticated','profile-b@test.invalid','',now());

select set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
set local role authenticated;

select extensions.is(
  public.complete_profile_onboarding(
    '31111111-1111-4111-8111-311111111111','Europe/London',2100,
    '["protein","fibre"]'::jsonb,'{"protein":125}'::jsonb
  )->>'base_daily_target_kcal',
  '2100','first profile save persists the explicitly chosen target'
);
select extensions.is(
  (select count(*) from public.profiles where user_id = auth.uid() and onboarding_complete),
  1::bigint,'onboarding creates exactly one complete profile'
);
select extensions.is(
  (select count(*) from public.nutrient_fields where user_id = auth.uid() and is_displayed),
  2::bigint,'only the two selected nutrients are displayed'
);
select extensions.is(
  (select nutrient_targets->>'protein' from public.profile_target_versions where user_id = auth.uid()),
  '125','optional nutrient targets are stored in the dated snapshot'
);
select extensions.is(
  (select nutrient_field_snapshot->'protein'->>'unit' from public.profile_target_versions where user_id = auth.uid()),
  'g','target versions preserve nutrient names and units for history'
);
select extensions.is(
  (select count(*) from public.weekly_pattern_days where user_id = auth.uid()),
  7::bigint,'onboarding creates all seven weekday allocations atomically'
);
select extensions.is(
  (select sum(target_kcal) from public.weekly_pattern_days where user_id = auth.uid()),
  14700::numeric,'initial weekly allocations exactly match seven daily targets'
);
select extensions.is(
  (select count(*) from public.profile_target_versions where user_id = auth.uid()),
  1::bigint,'initial target version is created once'
);
select extensions.is(
  public.complete_profile_onboarding(
    '31111111-1111-4111-8111-311111111111','Europe/London',2100,
    '["protein","fibre"]'::jsonb,'{"protein":125}'::jsonb
  )->>'initial_week_start',
  (select effective_week_start::text from public.weekly_pattern_versions where user_id = auth.uid()),
  'same request retry returns its committed result without duplicate records'
);
select extensions.throws_ok(
  $$select public.complete_profile_onboarding('39999999-9999-4999-8999-399999999999','Europe/London',2100,'[]'::jsonb,'{}'::jsonb)$$,
  '40001',null,'a different request cannot overwrite completed onboarding'
);

reset role;
select set_config('request.jwt.claim.sub','32222222-2222-4222-8222-222222222222',true);
set local role authenticated;
select extensions.is(
  (select count(*) from public.profiles),
  0::bigint,'another account cannot read the onboarding profile'
);

select * from extensions.finish();
rollback;
