create or replace function public.read_calendar_range(p_from_date date,p_to_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_from_date is null or p_to_date is null or p_to_date<p_from_date
    or p_to_date-p_from_date>41 then
    raise exception using errcode='22023',message='Choose a date range of 1 to 42 days';
  end if;
  select coalesce(jsonb_agg(public.read_calendar_day(day_date::date) order by day_date),'[]'::jsonb)
    into result
    from generate_series(p_from_date::timestamp,p_to_date::timestamp,interval '1 day') as dates(day_date);
  return result;
end;
$$;

revoke all on function public.read_calendar_range(date,date) from public,anon;
grant execute on function public.read_calendar_range(date,date) to authenticated;
comment on function public.read_calendar_range(date,date) is
  'Reads a bounded account-scoped calendar range without materializing days, plans, routines or transfers.';
