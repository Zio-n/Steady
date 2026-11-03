create or replace function public.edit_calendar_food_snapshot(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_component_index integer,
  p_name text,
  p_brand text,
  p_calories_per_basis numeric,
  p_nutrients_per_basis jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  day_row public.days%rowtype;
  item_row public.day_items%rowtype;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  input_fingerprint text;
  snapshot jsonb;
  component jsonb;
  next_snapshot jsonb;
  result jsonb;
  next_log_revision integer;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_expected_item_revision is null or p_expected_item_revision<1
    or p_component_index is null or p_component_index<0 or p_component_index>99
    or p_name is null or length(trim(p_name)) not between 1 and 160
    or p_brand is not null and length(trim(p_brand))>120
    or p_calories_per_basis is null or p_calories_per_basis<0 or p_calories_per_basis>=100000000
    or p_nutrients_per_basis is null or jsonb_typeof(p_nutrients_per_basis)<>'object' then
    raise exception using errcode='22023',message='Food details are invalid';
  end if;
  if exists(select 1 from jsonb_each(p_nutrients_per_basis) as entry(field_id,value)
    where jsonb_typeof(entry.value) not in ('number','null')
      or jsonb_typeof(entry.value)='number' and (entry.value::text)::numeric not between 0 and 99999999.9999
      or not exists(select 1 from public.nutrient_fields as field where field.user_id=actor_id and field.field_id=entry.field_id and field.archived_at is null)) then
    raise exception using errcode='22023',message='Food nutrient values are invalid';
  end if;

  input_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'date',p_local_date,'item_id',p_item_id,'revision',p_expected_item_revision,'component_index',p_component_index,'name',trim(p_name),
    'brand',nullif(trim(coalesce(p_brand,'')),''),'calories',p_calories_per_basis,'nutrients',p_nutrients_per_basis
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'edit_calendar_food_snapshot' or prior_fingerprint<>input_fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;

  select day.* into day_row from public.days as day where day.user_id=actor_id and day.local_date=p_local_date for update;
  if not found then raise exception using errcode='P0002',message='Day not found'; end if;
  if day_row.status<>'open' then raise exception using errcode='40001',message='Completed-day corrections require the correction flow'; end if;
  select item.* into item_row from public.day_items as item where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.state<>'eaten' or item_row.revision<>p_expected_item_revision then raise exception using errcode='40001',message='This item changed; refresh and review the current entry'; end if;
  snapshot := item_row.eaten_snapshot;
  if snapshot->>'source' not in ('food','one_off_food','meal','one_off_meal') or jsonb_typeof(snapshot->'components')<>'array'
    or p_component_index>=jsonb_array_length(snapshot->'components') then
    raise exception using errcode='22023',message='This meal does not have an editable food at that position';
  end if;
  component := snapshot->'components'->p_component_index;
  component := component || jsonb_build_object('food_name',trim(p_name),'calories_per_basis',p_calories_per_basis,'nutrients_per_basis',
    coalesce((select jsonb_object_agg(field.field_id,jsonb_build_object(
      'value',case when p_nutrients_per_basis ? field.field_id then p_nutrients_per_basis->field.field_id else component->'nutrients_per_basis'->field.field_id->'value' end,
      'name',field.name,'unit',field.unit
    ) order by field.display_order) from public.nutrient_fields as field where field.user_id=actor_id and field.archived_at is null),'{}'::jsonb));
  if snapshot->>'source' in ('food','one_off_food') then
    snapshot := jsonb_set(snapshot,'{name}',to_jsonb(trim(p_name)),true)
      || jsonb_build_object('brand',nullif(trim(coalesce(p_brand,'')),''));
  end if;
  snapshot := jsonb_set(snapshot,array['components',p_component_index::text],component,true);
  next_snapshot := private.rescale_eaten_snapshot(snapshot,item_row.selected_amount,item_row.selected_unit,item_row.revision+1);
  next_snapshot := next_snapshot || jsonb_build_object('brand',nullif(trim(coalesce(p_brand,'')),''));

  insert into public.day_item_history(user_id,item_id,item_revision,action,state,selected_amount,selected_unit,eaten_snapshot)
    values(actor_id,item_row.id,item_row.revision,'edited',item_row.state,item_row.selected_amount,item_row.selected_unit,item_row.eaten_snapshot);
  update public.day_items as item set eaten_snapshot=next_snapshot,revision=item.revision+1,updated_at=now()
    where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  update public.days as day set log_revision=day.log_revision+1,revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning log_revision into next_log_revision;
  select jsonb_build_object('item_id',item_row.id,'item_revision',item_row.revision,'day_log_revision',next_log_revision,
    'eaten_count',count(*),'calories_kcal',coalesce(sum((item.eaten_snapshot->'calories'->>'value')::numeric),0)) into result
    from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date and item.state='eaten';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'edit_calendar_food_snapshot',input_fingerprint,result);
  return result;
end;
$$;

revoke all on function public.edit_calendar_food_snapshot(uuid,date,uuid,integer,integer,text,text,numeric,jsonb) from public,anon;
grant execute on function public.edit_calendar_food_snapshot(uuid,date,uuid,integer,integer,text,text,numeric,jsonb) to authenticated;
comment on function public.edit_calendar_food_snapshot(uuid,date,uuid,integer,integer,text,text,numeric,jsonb) is
  'Edits an individual food in one eaten entry only, recalculates its frozen snapshot from that food basis, and records an immutable before-image.';
