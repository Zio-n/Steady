-- Log or plan a small group of food entries atomically. Each item keeps its own
-- idempotency receipt and snapshot; a failure rolls the entire group back.
create or replace function public.log_day_items(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 2 and 50 then raise exception using errcode='22023',message='Add between 2 and 50 entries'; end if;
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    result := public.log_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end,
      nullif(item->>'planned_item_id','')::uuid,
      nullif(item->>'expected_item_revision','')::integer
    );
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;
revoke all on function public.log_day_items(jsonb) from public, anon;
grant execute on function public.log_day_items(jsonb) to authenticated;

create or replace function public.plan_day_items(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 2 and 50 then raise exception using errcode='22023',message='Add between 2 and 50 entries'; end if;
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    result := public.plan_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end
    );
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;
revoke all on function public.plan_day_items(jsonb) from public, anon;
grant execute on function public.plan_day_items(jsonb) to authenticated;

create or replace function public.calendar_log_day_items(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 2 and 50 then raise exception using errcode='22023',message='Add between 2 and 50 entries'; end if;
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    result := public.calendar_log_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end,
      nullif(item->>'planned_item_id','')::uuid,
      nullif(item->>'expected_item_revision','')::integer
    );
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;
revoke all on function public.calendar_log_day_items(jsonb) from public, anon;
grant execute on function public.calendar_log_day_items(jsonb) to authenticated;

create or replace function public.calendar_plan_day_items(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  result jsonb;
  results jsonb := '[]'::jsonb;
  item_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode='22023',message='Entries must be an array'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count not between 2 and 50 then raise exception using errcode='22023',message='Add between 2 and 50 entries'; end if;
  for item in select value from jsonb_array_elements(p_items) as rows(value)
  loop
    result := public.calendar_plan_day_item(
      (item->>'request_id')::uuid,
      (item->>'local_date')::date,
      (item->>'section')::public.meal_section,
      item->>'source_kind',
      nullif(item->>'source_id','')::uuid,
      (item->>'amount')::numeric,
      item->>'unit',
      case when item ? 'manual_payload' and item->'manual_payload' <> 'null'::jsonb then item->'manual_payload' else null end
    );
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end;
$$;
revoke all on function public.calendar_plan_day_items(jsonb) from public, anon;
grant execute on function public.calendar_plan_day_items(jsonb) to authenticated;
