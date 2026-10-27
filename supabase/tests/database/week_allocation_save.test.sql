begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at)
values ('87777777-7777-4777-8777-777777777777','authenticated','authenticated','week-save@test.invalid','',now());
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select public.complete_profile_onboarding('87777777-7777-4777-8777-777777777778','Europe/London',2000,'[]'::jsonb,'{}'::jsonb);
select public.ensure_week(date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date);

reset role;
insert into public.days(user_id,local_date,week_start,base_planned_target_kcal,status,completed_target_kcal,completed_actual_kcal,completed_at,completed_log_revision)
values
 ('87777777-7777-4777-8777-777777777777',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2000,'open',null,null,null,null),
  ('87777777-7777-4777-8777-777777777777',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+1,
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2000,'completed',2000,0,now(),1),
 ('87777777-7777-4777-8777-777777777777',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+2,
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2000,'open',null,null,null,null);

select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777779',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,
    '[2100,2000,1900,2000,2000,2000,2000]'::jsonb)->>'revision'),
  '2','a balanced allocation saves with an incremented week revision'
);
select extensions.is(
  (select sum(allocation.base_target_kcal) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  14000::numeric,'the saved seven allocations exactly equal the frozen weekly budget'
);
select extensions.is(
  (select day.base_planned_target_kcal from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  2100::numeric,'an existing open day receives its saved base allocation'
);
select extensions.is(
  (select day.base_planned_target_kcal from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+1),
  2000::numeric,'a completed day retains its original base target'
);
select extensions.is(
  (select day.revision from public.days as day where day.user_id=auth.uid()
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+1),
  1,'a locked completed day is not revised during the save'
);
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777779',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,
    '[2100,2000,1900,2000,2000,2000,2000]'::jsonb)->>'revision'),
  '2','an identical request retry returns its original receipt without another write'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777779',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,'[2101,1999,1900,2000,2000,2000,2000]'::jsonb)$$,
  '22023',null,'reusing a request ID with changed inputs is rejected'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777780',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,1,'[2100,2000,1900,2000,2000,2000,2000]'::jsonb)$$,
  '40001',null,'a stale weekly revision cannot overwrite the saved allocation'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777781',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,'[2100,2000,1900,2000,2000,2000,2001]'::jsonb)$$,
  '22023',null,'an unbalanced seven-day allocation is rejected'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777782',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,'[2101,1999,1900,2000,2000,2000,2000]'::jsonb)$$,
  '40001',null,'a changed completed-day target is rejected'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777783',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,'[2100,2000,1900,2000.5,1999.5,2000,2000]'::jsonb)$$,
  '22023',null,'fractional calorie targets are rejected'
);
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777784',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date-7,1,'[2000,2000,2000,2000,2000,2000,2000]'::jsonb)$$,
  '22023',null,'a past week cannot be edited'
);

reset role;
insert into public.carry_decisions(user_id,id,source_date,source_log_revision,completed_target_kcal,actual_kcal,difference_kcal,action,amount_kcal,state,request_id)
values ('87777777-7777-4777-8777-777777777777','87777777-7777-4777-8777-777777777785',
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+1,1,2000,1900,100,'single_day',100,'active',
  '87777777-7777-4777-8777-777777777786');
insert into public.carry_allocations(user_id,decision_id,destination_date,signed_delta_kcal,destination_revision)
select '87777777-7777-4777-8777-777777777777','87777777-7777-4777-8777-777777777785',
  date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+2,100,
  day.revision from public.days as day where day.user_id='87777777-7777-4777-8777-777777777777'
    and day.local_date=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date+2;
select set_config('request.jwt.claim.sub','87777777-7777-4777-8777-777777777777',true);
set local role authenticated;
select extensions.throws_ok(
  $$select public.save_week_allocation('87777777-7777-4777-8777-777777777787',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,'[2100,2000,1901,2000,1999,2000,2000]'::jsonb)$$,
  '40001',null,'changing an accepted carry destination requires review instead of silently altering the adjustment'
);
select extensions.is(
  (select carry.signed_delta_kcal from public.carry_allocations as carry where carry.user_id=auth.uid()
    and carry.decision_id='87777777-7777-4777-8777-777777777785'),
  100::numeric,'a rejected allocation edit leaves the accepted carry ledger unchanged'
);
select extensions.is(
  (public.save_week_allocation('87777777-7777-4777-8777-777777777788',date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date,2,
    '[2100,2000,1900,2000,1999,2001,2000]'::jsonb)->>'revision'),
  '3','unrelated open days can still be changed without discarding the carry decision'
);
select extensions.is(
  (select sum(allocation.base_target_kcal) from public.week_allocations as allocation where allocation.user_id=auth.uid()
    and allocation.week_start=date_trunc('week',(now() at time zone 'Europe/London')::timestamp)::date),
  14000::numeric,'the allocation remains exactly balanced after a later valid save'
);

select * from extensions.finish();
rollback;
