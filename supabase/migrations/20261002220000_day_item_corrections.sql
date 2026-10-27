create table public.day_item_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  event_id uuid not null default gen_random_uuid(),
  item_revision integer not null check (item_revision > 0),
  action text not null check (action in ('edited','removed','restored')),
  state public.day_item_state not null,
  selected_amount numeric(12,4),
  selected_unit text,
  eaten_snapshot jsonb not null check (jsonb_typeof(eaten_snapshot)='object'),
  changed_at timestamptz not null default now(),
  primary key (user_id,event_id),
  unique (user_id,item_id,item_revision),
  foreign key (user_id,item_id) references public.day_items(user_id,id) on delete cascade
);
alter table public.day_item_history enable row level security;
create policy owner_access on public.day_item_history for select to authenticated
  using ((select auth.uid())=user_id);
revoke all on public.day_item_history from anon,authenticated;
grant select on public.day_item_history to authenticated;
create index day_item_history_item_idx on public.day_item_history(user_id,item_id,item_revision desc);
comment on table public.day_item_history is 'Immutable before-images for confirmed edits, removals and undos of eaten day items.';

create or replace function private.rescale_eaten_snapshot(p_snapshot jsonb,p_amount numeric,p_unit text,p_next_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_kind text := p_snapshot->>'source';
  source_components jsonb := p_snapshot->'components';
  component jsonb;
  next_components jsonb := '[]'::jsonb;
  next_component jsonb;
  raw_nutrient jsonb;
  nutrient jsonb;
  nutrient_map jsonb := '{}'::jsonb;
  nutrient_values jsonb := '{}'::jsonb;
  nutrient_counts jsonb := '{}'::jsonb;
  nutrient_names jsonb := '{}'::jsonb;
  nutrient_units jsonb := '{}'::jsonb;
  nutrient_id text;
  scaled_amount numeric;
  ratio numeric;
  basis_amount numeric;
  basis_unit text;
  component_unit text;
  grams_per_serving numeric;
  calories_per_basis numeric;
  calories_total numeric := 0;
  component_count integer := 0;
  raw_value numeric;
  known_count integer;
begin
  if p_amount is null or p_amount<=0 or p_amount>=100000000 or p_unit is null or length(trim(p_unit)) not between 1 and 24 then
    raise exception using errcode='22023',message='Portion amount or unit is invalid';
  end if;
  if source_kind not in ('food','meal','one_off_food','one_off_meal')
    or coalesce(jsonb_typeof(source_components),'null')<>'array' or jsonb_array_length(source_components)=0 then
    raise exception using errcode='22023',message='This snapshot does not contain enough source detail to edit its portion';
  end if;
  if source_kind in ('meal','one_off_meal') and lower(trim(p_unit)) not in ('serving','servings') then
    raise exception using errcode='22023',message='Meal portions use servings';
  end if;
  for component in select value from jsonb_array_elements(source_components) as rows(value)
  loop
    component_count := component_count+1;
    basis_amount := nullif(component->>'basis_amount','')::numeric;
    basis_unit := component->>'basis_unit';
    grams_per_serving := nullif(component->>'grams_per_serving','')::numeric;
    if source_kind in ('food','one_off_food') then
      scaled_amount := p_amount;
      component_unit := trim(p_unit);
    else
      scaled_amount := (component->>'amount')::numeric*p_amount;
      component_unit := component->>'unit';
    end if;
    if basis_amount is null or basis_amount<=0 or basis_unit is null then
      raise exception using errcode='22023',message='This snapshot is missing its original food basis';
    end if;
    basis_amount := private.convert_food_amount(scaled_amount,component_unit,basis_unit,grams_per_serving);
    if basis_amount is null then raise exception using errcode='22023',message='This portion cannot be converted to the original food basis'; end if;
    ratio := basis_amount/nullif((component->>'basis_amount')::numeric,0);
    calories_per_basis := nullif(component->>'calories_per_basis','')::numeric;
    if calories_per_basis is null then raise exception using errcode='22023',message='This snapshot lacks original calorie values'; end if;
    calories_total := calories_total+calories_per_basis*ratio;
    nutrient := '{}'::jsonb;
    for nutrient_id,raw_nutrient in select key,value from jsonb_each(coalesce(component->'nutrients_per_basis','{}'::jsonb))
    loop
      raw_value := nullif(raw_nutrient->>'value','')::numeric;
      if raw_value is not null then
        nutrient_values := jsonb_set(nutrient_values,array[nutrient_id],to_jsonb(coalesce((nutrient_values->>nutrient_id)::numeric,0)+raw_value*ratio),true);
        nutrient_counts := jsonb_set(nutrient_counts,array[nutrient_id],to_jsonb(coalesce((nutrient_counts->>nutrient_id)::integer,0)+1),true);
      end if;
      nutrient_names := jsonb_set(nutrient_names,array[nutrient_id],to_jsonb(raw_nutrient->>'name'),true);
      nutrient_units := jsonb_set(nutrient_units,array[nutrient_id],to_jsonb(raw_nutrient->>'unit'),true);
      nutrient := jsonb_set(nutrient,array[nutrient_id],jsonb_build_object(
        'name',raw_nutrient->>'name','unit',raw_nutrient->>'unit',
        'value',case when raw_value is null then null else raw_value*ratio end,
        'complete',raw_value is not null,'knownComponents',case when raw_value is null then 0 else 1 end,'totalComponents',1
      ),true);
    end loop;
    next_component := jsonb_set(component,'{calories}',jsonb_build_object(
      'value',calories_per_basis*ratio,'complete',true,'knownComponents',1,'totalComponents',1
    ),true);
    next_component := jsonb_set(next_component,'{nutrients}',nutrient,true);
    if source_kind in ('food','one_off_food') then
      next_component := jsonb_set(next_component,'{amount}',to_jsonb(p_amount),true);
      next_component := jsonb_set(next_component,'{unit}',to_jsonb(trim(p_unit)),true);
    end if;
    next_components := next_components || jsonb_build_array(next_component);
  end loop;
  for nutrient_id in select jsonb_object_keys(nutrient_names)
  loop
    known_count := coalesce((nutrient_counts->>nutrient_id)::integer,0);
    nutrient_map := jsonb_set(nutrient_map,array[nutrient_id],jsonb_build_object(
      'name',nutrient_names->>nutrient_id,'unit',nutrient_units->>nutrient_id,
      'value',case when known_count=0 then null else (nutrient_values->>nutrient_id)::numeric end,
      'complete',known_count=component_count,'knownComponents',known_count,'totalComponents',component_count
    ),true);
  end loop;
  return p_snapshot || jsonb_build_object(
    'selected_amount',p_amount,'selected_unit',trim(p_unit),
    'calories',jsonb_build_object('value',calories_total,'complete',true,'knownComponents',component_count,'totalComponents',component_count),
    'nutrients',nutrient_map,'components',next_components,'snapshot_revision',p_next_revision,'last_revised_at',now()
  );
end;
$$;
revoke all on function private.rescale_eaten_snapshot(jsonb,numeric,text,integer) from public,anon,authenticated;

create or replace function public.revise_day_item(
  p_request_id uuid,
  p_local_date date,
  p_item_id uuid,
  p_expected_item_revision integer,
  p_action text,
  p_amount numeric default null,
  p_unit text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  input_fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  day_row public.days%rowtype;
  item_row public.day_items%rowtype;
  next_snapshot jsonb;
  result jsonb;
  next_log_revision integer;
begin
  if actor_id is null then raise exception using errcode='28000',message='Authentication required'; end if;
  if p_request_id is null or p_local_date is null or p_item_id is null or p_expected_item_revision is null or p_expected_item_revision<1
    or p_action not in ('resize','remove','restore') then
    raise exception using errcode='22023',message='A valid correction action, item revision and request are required';
  end if;
  input_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'local_date',p_local_date,'item_id',p_item_id,'expected_revision',p_expected_item_revision,
    'action',p_action,'amount',p_amount,'unit',p_unit
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text||p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt where receipt.user_id=actor_id and receipt.request_id=p_request_id for update;
  if found then
    if prior_operation<>'revise_day_item' or prior_fingerprint<>input_fingerprint then raise exception using errcode='22023',message='request_id was already used with different input'; end if;
    return prior_result;
  end if;
  select day.* into day_row from public.days as day where day.user_id=actor_id and day.local_date=p_local_date for update;
  if not found then raise exception using errcode='P0002',message='Day not found'; end if;
  if day_row.status<>'open' then raise exception using errcode='40001',message='Completed-day corrections require the correction flow'; end if;
  select item.* into item_row from public.day_items as item where item.user_id=actor_id and item.id=p_item_id and item.local_date=p_local_date for update;
  if not found or item_row.revision<>p_expected_item_revision then raise exception using errcode='40001',message='This item changed; refresh and review the current entry'; end if;
  if p_action='resize' and item_row.state<>'eaten' then raise exception using errcode='22023',message='Only eaten items can have their portion edited'; end if;
  if p_action='remove' and item_row.state<>'eaten' then raise exception using errcode='40001',message='This item is no longer an eaten entry'; end if;
  if p_action='restore' and (item_row.state<>'removed' or item_row.eaten_snapshot is null) then raise exception using errcode='40001',message='This removed entry can no longer be restored'; end if;
  if p_action='resize' then
    next_snapshot := private.rescale_eaten_snapshot(item_row.eaten_snapshot,p_amount,p_unit,item_row.revision+1);
  end if;
  insert into public.day_item_history(user_id,item_id,item_revision,action,state,selected_amount,selected_unit,eaten_snapshot)
    values(actor_id,item_row.id,item_row.revision,
      case p_action when 'resize' then 'edited' when 'remove' then 'removed' else 'restored' end,
      item_row.state,item_row.selected_amount,item_row.selected_unit,item_row.eaten_snapshot);
  if p_action='resize' then
    update public.day_items as item set selected_amount=p_amount,selected_unit=trim(p_unit),eaten_snapshot=next_snapshot,
      revision=item.revision+1,updated_at=now() where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  elsif p_action='remove' then
    update public.day_items as item set state='removed',eaten_at=null,revision=item.revision+1,updated_at=now()
      where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  else
    update public.day_items as item set state='eaten',eaten_at=now(),revision=item.revision+1,updated_at=now()
      where item.user_id=actor_id and item.id=p_item_id returning * into item_row;
  end if;
  update public.days as day set log_revision=day.log_revision+1,revision=day.revision+1,updated_at=now()
    where day.user_id=actor_id and day.local_date=p_local_date returning log_revision into next_log_revision;
  select jsonb_build_object(
    'item_id',item_row.id,'item_revision',item_row.revision,'day_log_revision',next_log_revision,
    'eaten_count',count(*),'calories_kcal',coalesce(sum((item.eaten_snapshot->'calories'->>'value')::numeric),0)
  ) into result from public.day_items as item where item.user_id=actor_id and item.local_date=p_local_date and item.state='eaten';
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values(actor_id,p_request_id,'revise_day_item',input_fingerprint,result);
  return result;
end;
$$;

revoke all on function public.revise_day_item(uuid,date,uuid,integer,text,numeric,text) from public,anon;
grant execute on function public.revise_day_item(uuid,date,uuid,integer,text,numeric,text) to authenticated;
comment on function public.revise_day_item(uuid,date,uuid,integer,text,numeric,text) is
  'Rescales from the logged snapshot or soft-removes/restores an eaten item with revision checks, immutable before-images and idempotent returned totals.';
