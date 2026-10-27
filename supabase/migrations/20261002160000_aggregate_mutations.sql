create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.convert_food_amount(
  p_amount numeric,
  p_from_unit text,
  p_to_unit text,
  p_grams_per_serving numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  from_key text := lower(trim(coalesce(p_from_unit,'')));
  to_key text := lower(trim(coalesce(p_to_unit,'')));
  from_dimension text;
  to_dimension text;
  from_factor numeric := 1;
  to_factor numeric := 1;
begin
  if p_amount is null or p_amount <= 0 or from_key = '' or to_key = '' then return null; end if;
  from_key := case from_key
    when 'gram' then 'g' when 'grams' then 'g'
    when 'kilogram' then 'kg' when 'kilograms' then 'kg'
    when 'milligram' then 'mg' when 'milligrams' then 'mg'
    when 'ug' then 'mcg' when 'μg' then 'mcg' when 'µg' then 'mcg'
    when 'milliliter' then 'ml' when 'milliliters' then 'ml'
    when 'millilitre' then 'ml' when 'millilitres' then 'ml'
    when 'liter' then 'l' when 'liters' then 'l' when 'litre' then 'l' when 'litres' then 'l'
    when 'servings' then 'serving' else from_key end;
  to_key := case to_key
    when 'gram' then 'g' when 'grams' then 'g'
    when 'kilogram' then 'kg' when 'kilograms' then 'kg'
    when 'milligram' then 'mg' when 'milligrams' then 'mg'
    when 'ug' then 'mcg' when 'μg' then 'mcg' when 'µg' then 'mcg'
    when 'milliliter' then 'ml' when 'milliliters' then 'ml'
    when 'millilitre' then 'ml' when 'millilitres' then 'ml'
    when 'liter' then 'l' when 'liters' then 'l' when 'litre' then 'l' when 'litres' then 'l'
    when 'servings' then 'serving' else to_key end;
  from_dimension := case from_key when 'g' then 'mass' when 'kg' then 'mass' when 'mg' then 'mass' when 'mcg' then 'mass'
    when 'ml' then 'volume' when 'l' then 'volume' when 'serving' then 'serving' else 'custom' end;
  to_dimension := case to_key when 'g' then 'mass' when 'kg' then 'mass' when 'mg' then 'mass' when 'mcg' then 'mass'
    when 'ml' then 'volume' when 'l' then 'volume' when 'serving' then 'serving' else 'custom' end;
  from_factor := case from_key when 'kg' then 1000 when 'mg' then 0.001 when 'mcg' then 0.000001 when 'l' then 1000 else 1 end;
  to_factor := case to_key when 'kg' then 1000 when 'mg' then 0.001 when 'mcg' then 0.000001 when 'l' then 1000 else 1 end;
  if from_key = to_key then return p_amount; end if;
  if from_dimension = to_dimension and from_dimension in ('mass','volume') then
    return p_amount * from_factor / to_factor;
  end if;
  if from_dimension = 'serving' and to_dimension = 'mass' and p_grams_per_serving > 0 then
    return p_amount * p_grams_per_serving / to_factor;
  end if;
  if from_dimension = 'mass' and to_dimension = 'serving' and p_grams_per_serving > 0 then
    return p_amount * from_factor / p_grams_per_serving;
  end if;
  return null;
end;
$$;
revoke all on function private.convert_food_amount(numeric,text,text,numeric) from public, anon, authenticated;

create or replace function public.save_meal(
  p_request_id uuid,
  p_name text,
  p_sections jsonb,
  p_components jsonb,
  p_meal_id uuid default null,
  p_expected_revision integer default null,
  p_declared_total_weight_g numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  saved_meal_id uuid;
  saved_revision integer;
  parsed_sections public.meal_section[];
  component jsonb;
  component_food_id uuid;
  component_amount numeric;
  component_unit text;
  component_position integer := 0;
  food_basis_unit text;
  food_grams_per_serving numeric;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Meal name must be 1 to 160 characters';
  end if;
  if coalesce(jsonb_typeof(p_sections),'null') <> 'array' or coalesce(jsonb_array_length(p_sections),0) not between 1 and 4 then
    raise exception using errcode = '22023', message = 'sections must contain one to four meal sections';
  end if;
  if coalesce(jsonb_typeof(p_components),'null') <> 'array' or coalesce(jsonb_array_length(p_components),0) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'A meal must contain 1 to 100 components';
  end if;
  if p_declared_total_weight_g is not null and (p_declared_total_weight_g <= 0 or p_declared_total_weight_g >= 100000000) then
    raise exception using errcode = '22023', message = 'Declared weight is outside valid bounds';
  end if;

  select coalesce(array_agg(section_value::public.meal_section), array[]::public.meal_section[])
    into parsed_sections
    from jsonb_array_elements_text(p_sections) as sections(section_value);
  if cardinality(parsed_sections) <> (select count(distinct section_value) from unnest(parsed_sections) as sections(section_value)) then
    raise exception using errcode = '22023', message = 'sections cannot contain duplicates';
  end if;

  fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'meal_id',p_meal_id,'expected_revision',p_expected_revision,'name',p_name,
        'sections',p_sections,'declared_total_weight_g',p_declared_total_weight_g,
        'components',p_components
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serialize identical request IDs before inspecting receipts or mutating rows.
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'save_meal' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  if p_meal_id is null then
    if p_expected_revision is not null then
      raise exception using errcode = '22023', message = 'A new meal cannot have an expected revision';
    end if;
    insert into public.meals(user_id,name,sections,declared_total_weight_g)
      values (actor_id,trim(p_name),parsed_sections,p_declared_total_weight_g)
      returning id,revision into saved_meal_id,saved_revision;
  else
    if p_expected_revision is null or p_expected_revision < 1 then
      raise exception using errcode = '22023', message = 'An expected revision is required when editing';
    end if;
    update public.meals as meal
      set name = trim(p_name),sections = parsed_sections,
          declared_total_weight_g = p_declared_total_weight_g,
          revision = meal.revision + 1,updated_at = now()
      where meal.user_id = actor_id and meal.id = p_meal_id
        and meal.revision = p_expected_revision and meal.archived_at is null
      returning id,revision into saved_meal_id,saved_revision;
    if not found then
      raise exception using errcode = '40001', message = 'Meal changed or is unavailable; reload before saving';
    end if;
    delete from public.meal_components
      where user_id = actor_id and meal_id = saved_meal_id;
  end if;

  for component in select value from jsonb_array_elements(p_components) as component_rows(value)
  loop
    if jsonb_typeof(component) <> 'object'
      or not (component ? 'food_id')
      or not (component ? 'amount')
      or not (component ? 'unit') then
      raise exception using errcode = '22023', message = 'Each component requires food_id, amount, and unit';
    end if;
    begin
      component_food_id := (component->>'food_id')::uuid;
      component_amount := (component->>'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Component ID or amount is invalid';
    end;
    component_unit := trim(component->>'unit');
    if component_amount <= 0 or component_amount >= 100000000
      or length(component_unit) not between 1 and 24 then
      raise exception using errcode = '22023', message = 'Component amount or unit is outside valid bounds';
    end if;
    select food.basis_unit,food.grams_per_serving into food_basis_unit,food_grams_per_serving
      from public.foods as food
      where food.user_id = actor_id and food.id = component_food_id and food.archived_at is null;
    if not found then
      raise exception using errcode = '23503', message = 'Component food is unavailable to this account';
    end if;
    if private.convert_food_amount(component_amount,component_unit,food_basis_unit,food_grams_per_serving) is null then
      raise exception using errcode = '22023', message = 'Component amount unit is incompatible with the food basis';
    end if;
    insert into public.meal_components(user_id,meal_id,food_id,amount,unit,position)
      values (actor_id,saved_meal_id,component_food_id,component_amount,component_unit,component_position);
    component_position := component_position + 1;
  end loop;

  result := jsonb_build_object('id',saved_meal_id,'revision',saved_revision,'name',trim(p_name));
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'save_meal',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer,numeric) from public,anon;
grant execute on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer,numeric) to authenticated;
comment on function public.save_meal(uuid,text,jsonb,jsonb,uuid,integer,numeric) is
  'Atomically saves a meal and same-owner components with optimistic revision checks and idempotent request receipts.';
