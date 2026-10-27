create or replace function public.ensure_day_snapshot(p_local_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  day_row public.days%rowtype;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_local_date is null then raise exception using errcode='22023',message='A local date is required'; end if;
  if not exists(select 1 from public.profiles as profile where profile.user_id=actor_id and profile.onboarding_complete) then
    raise exception using errcode='22023',message='Complete profile setup before loading a day';
  end if;

  day_row := private.ensure_day_for_log(actor_id,p_local_date);
  return jsonb_build_object('day',to_jsonb(day_row));
end;
$$;

revoke all on function public.ensure_day_snapshot(date) from public,anon;
grant execute on function public.ensure_day_snapshot(date) to authenticated;
comment on function public.ensure_day_snapshot(date) is
  'Idempotently materializes the account-local day target snapshot when one is available, including days without a routine.';
