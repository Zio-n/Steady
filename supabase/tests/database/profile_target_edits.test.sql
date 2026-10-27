begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('51111111-1111-4111-8111-111111111111','authenticated','authenticated','targets-a@test.invalid','',now());
select set_config('request.jwt.claim.sub','51111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select public.complete_profile_onboarding(
  '51111111-1111-4111-8111-511111111111','Europe/London',2000,
  '["protein"]'::jsonb,'{"protein":125}'::jsonb
);
select public.ensure_week(date_trunc('week',now() at time zone 'Europe/London')::date + 7);

reset role;
update public.weekly_pattern_days as day set target_kcal = case day.weekday
  when 1 then 1001 when 2 then 1500 when 3 then 1750 when 4 then 1900
  when 5 then 2100 when 6 then 2500 when 7 then 3249 end
where day.user_id = '51111111-1111-4111-8111-111111111111'
  and day.pattern_version_id = (select pattern.id from public.weekly_pattern_versions as pattern
    where pattern.user_id = day.user_id order by pattern.effective_week_start desc limit 1);

set local role authenticated;
select extensions.is(
  public.save_profile_targets(
    '52222222-2222-4222-8222-522222222222',1,2001,'{"protein":125}'::jsonb,'proportional'
  )->>'revision',
  '2','calorie target edit commits with the next profile revision'
);
select extensions.is(
  (select base_daily_target_kcal from public.profile_target_versions
    where user_id = auth.uid() and effective_from = date_trunc('week',now() at time zone 'Europe/London')::date),
  2000::numeric,'current-week calorie target history is not rewritten'
);
select extensions.is(
  (select effective_week_start::text from public.weekly_pattern_versions
    where user_id = auth.uid() order by effective_week_start desc limit 1),
  (date_trunc('week',now() at time zone 'Europe/London')::date + 7)::text,
  'base target change is effective on the Monday after the current week'
);
select extensions.is(
  (select jsonb_agg(target_kcal order by weekday) from public.weekly_pattern_days
    where user_id = auth.uid() and pattern_version_id = (select id from public.weekly_pattern_versions
      where user_id = auth.uid() order by effective_week_start desc limit 1)),
  '[1001,1501,1751,1901,2101,2501,3251]'::jsonb,
  'proportional preview uses deterministic largest-remainder whole-kcal rounding'
);
select extensions.is(
  (select sum(target_kcal) from public.weekly_pattern_days
    where user_id = auth.uid() and pattern_version_id = (select id from public.weekly_pattern_versions
      where user_id = auth.uid() order by effective_week_start desc limit 1)),
  14007::numeric,'proportional allocation exactly balances the new seven-day budget'
);
select extensions.is(
  (public.ensure_week(date_trunc('week',now() at time zone 'Europe/London')::date + 7)->'week'->>'budget_kcal')::numeric,
  14000::numeric,'a week materialized before the profile edit keeps its frozen budget after the recurring pattern changes'
);
select extensions.is(
  (select sum(base_target_kcal) from public.week_allocations where user_id=auth.uid()
    and week_start=date_trunc('week',now() at time zone 'Europe/London')::date + 7),
  14000::numeric,'existing future weekday snapshots are not silently rescaled by a later base-target change'
);
select extensions.is(
  public.save_profile_targets(
    '52222222-2222-4222-8222-522222222222',1,2001,'{"protein":125}'::jsonb,'proportional'
  )->>'revision',
  '2','an identical request retry returns its committed revision'
);
select extensions.throws_ok(
  $$update public.profiles set timezone = 'UTC' where user_id = auth.uid()$$,
  '42501',null,'profile target fields cannot be changed outside validated RPCs'
);
select extensions.throws_ok(
  $$update public.profile_target_versions set base_daily_target_kcal = 9999 where user_id = auth.uid()$$,
  '42501',null,'target history cannot be rewritten through direct table access'
);
select extensions.is(
  public.save_profile_targets(
    '53333333-3333-4333-8333-533333333333',2,2001,'{"protein":130}'::jsonb,null
  )->>'nutrient_effective_from',
  ((now() at time zone 'Europe/London')::date + 1)::text,
  'nutrient target edits begin on the next local day'
);
select extensions.is(
  (select nutrient_targets->>'protein' from public.profile_target_versions
    where user_id = auth.uid() and effective_from = (now() at time zone 'Europe/London')::date + 1),
  '130','next-day nutrient target snapshot contains the new value'
);
select extensions.is(
  public.save_profile_targets(
    '54444444-4444-4444-8444-544444444444',3,2200,'{"protein":130}'::jsonb,'equal'
  )->'weekly_allocation',
  '[2200,2200,2200,2200,2200,2200,2200]'::jsonb,
  'equal-split preview is persisted as seven matching whole-kcal targets'
);
select extensions.throws_ok(
  $$select public.save_profile_targets('55555555-5555-4555-8555-555555555555',1,2300,'{"protein":130}'::jsonb,'equal')$$,
  '40001',null,'stale profile revisions are rejected'
);

select * from extensions.finish();
rollback;
