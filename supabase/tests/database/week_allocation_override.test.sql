begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('87777777-7777-4777-8777-777777777799','authenticated','authenticated','week-override@test.invalid','',now());
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777799',true);
set local role authenticated;
select public.complete_profile_onboarding('87777777-7777-4777-8777-777777777798','Europe/London',2000,'[]'::jsonb,'{}'::jsonb);
select public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date);

reset role;
insert into public.days(user_id,local_date,week_start,base_planned_target_kcal,status,completed_target_kcal,completed_actual_kcal,completed_at,completed_log_revision)
values
 ('87777777-7777-4777-8777-777777777799',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2000,'open',null,null,null,null),
 ('87777777-7777-4777-8777-777777777799',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+1,
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2000,'completed',2000,0,now(),1);
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777799',true);
set local role authenticated;

select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777797',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,'[2100,1900,2000,2000,2000,2000,2000]'::jsonb,'one_off')$$,
  '40001',null,'creating a one-off week cannot change a completed date target'
);
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777796',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,
    '[2100,2000,1900,2000,2000,2000,2000]'::jsonb,'one_off')->>'allocation_kind'),
  'one_off','saving selected-week values explicitly marks only this week one-off'
);
select extensions.is(
  (select sum(allocation.base_target_kcal) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  14000::numeric,'one-off mode preserves the recurring base allocation snapshot'
);
select extensions.is(
  (select sum(allocation.override_target_kcal) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  14000::numeric,'all seven explicit overrides balance to the same frozen weekly budget'
);
select extensions.is(
  (select day.base_planned_target_kcal from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  2100::numeric,'an existing open date receives its one-off target'
);
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777796',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,
    '[2100,2000,1900,2000,2000,2000,2000]'::jsonb,'one_off')->>'revision'),
  '2','a repeated one-off save request returns its original idempotent receipt'
);
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777795',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,
    '[2000,2000,2000,2000,2000,2000,2000]'::jsonb,'recurring')->>'allocation_kind'),
  'recurring','an explicit reset returns this selected week to its saved recurring amounts'
);
select extensions.is(
  (select count(*) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date
    and allocation.override_target_kcal is not null),
  0::bigint,'reset removes the one-off override values'
);
select extensions.is(
  (select day.base_planned_target_kcal from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  2000::numeric,'reset updates an existing open date to the recurring target'
);
select extensions.is(
  (select sum(pattern_day.target_kcal) from public.weekly_pattern_days as pattern_day
    join public.weekly_pattern_versions as pattern on pattern.user_id=pattern_day.user_id and pattern.id=pattern_day.pattern_version_id
    where pattern.user_id=auth.uid()),
  14000::numeric,'one-off creation and reset never rewrite the recurring pattern definition'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777794',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,'[2000,2000,2000,2000,2000,2000,2000]'::jsonb,'recurring')$$,
  '40001',null,'a stale allocation-mode reset is rejected'
);

select * from extensions.finish();
rollback;
