revoke insert,update,delete on public.foods,public.food_nutrients from authenticated;

create or replace function public.save_food(
  p_request_id uuid,
  p_food_id uuid,
  p_expected_revision integer,
  p_name text,
  p_brand text,
  p_basis_amount numeric,
  p_basis_unit text,
  p_grams_per_serving numeric,
  p_default_portion_amount numeric,
  p_default_portion_unit text,
  p_calories_kcal numeric,
  p_nutrients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  saved_food_id uuid;
  saved_revision integer;
  nutrient_key text;
  nutrient_value numeric;
  fingerprint text;
  prior_operation text;
  prior_fingerprint text;
  prior_result jsonb;
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required';
  end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 160
    or (p_brand is not null and length(trim(p_brand)) > 120)
    or p_basis_amount is null or p_basis_amount <= 0 or p_basis_amount >= 100000000
    or length(trim(coalesce(p_basis_unit,''))) not between 1 and 24
    or (p_grams_per_serving is not null and (p_grams_per_serving <= 0 or p_grams_per_serving >= 100000000))
    or p_default_portion_amount is null or p_default_portion_amount <= 0 or p_default_portion_amount >= 100000000
    or length(trim(coalesce(p_default_portion_unit,''))) not between 1 and 24
    or (p_calories_kcal is not null and (p_calories_kcal < 0 or p_calories_kcal >= 100000000)) then
    raise exception using errcode = '22023', message = 'Food details are outside valid bounds';
  end if;
  if p_nutrients is null or jsonb_typeof(p_nutrients) <> 'object'
    or (select count(*) from jsonb_object_keys(p_nutrients)) > 64 then
    raise exception using errcode = '22023', message = 'Nutrients must be an object';
  end if;

  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'food_id',p_food_id,'expected_revision',p_expected_revision,'name',p_name,'brand',p_brand,
    'basis_amount',p_basis_amount,'basis_unit',p_basis_unit,'grams_per_serving',p_grams_per_serving,
    'default_portion_amount',p_default_portion_amount,'default_portion_unit',p_default_portion_unit,
    'calories_kcal',p_calories_kcal,'nutrients',p_nutrients
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'save_food' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;

  if p_food_id is null then
    if p_expected_revision is not null then
      raise exception using errcode = '22023', message = 'A new food cannot have an expected revision';
    end if;
    insert into public.foods(user_id,name,brand,basis_amount,basis_unit,grams_per_serving,
      default_portion_amount,default_portion_unit,calories_kcal)
      values (actor_id,trim(p_name),nullif(trim(coalesce(p_brand,'')),''),p_basis_amount,trim(p_basis_unit),
        p_grams_per_serving,p_default_portion_amount,trim(p_default_portion_unit),p_calories_kcal)
      returning id,revision into saved_food_id,saved_revision;
  else
    if p_expected_revision is null or p_expected_revision < 1 then
      raise exception using errcode = '22023', message = 'An expected revision is required when editing';
    end if;
    update public.foods as food
      set name = trim(p_name),brand = nullif(trim(coalesce(p_brand,'')),''),
        basis_amount = p_basis_amount,basis_unit = trim(p_basis_unit),grams_per_serving = p_grams_per_serving,
        default_portion_amount = p_default_portion_amount,default_portion_unit = trim(p_default_portion_unit),
        calories_kcal = p_calories_kcal,revision = food.revision + 1,updated_at = now()
      where food.user_id = actor_id and food.id = p_food_id
        and food.revision = p_expected_revision and food.archived_at is null
      returning id,revision into saved_food_id,saved_revision;
    if not found then
      raise exception using errcode = '40001', message = 'Food changed or is unavailable; reload before saving';
    end if;
  end if;

  delete from public.food_nutrients as saved
    where saved.user_id = actor_id and saved.food_id = saved_food_id
      and exists (select 1 from public.nutrient_fields as field
        where field.user_id = actor_id and field.field_id = saved.field_id and field.archived_at is null)
      and not (p_nutrients ? saved.field_id);
  for nutrient_key,nutrient_value in
    select key,value::text::numeric from jsonb_each(p_nutrients)
  loop
    if jsonb_typeof(p_nutrients->nutrient_key) <> 'number' or nutrient_value < 0 or nutrient_value >= 100000000
      or not exists (select 1 from public.nutrient_fields as field
        where field.user_id = actor_id and field.field_id = nutrient_key and field.archived_at is null) then
      raise exception using errcode = '22023', message = 'A nutrient value or field is invalid';
    end if;
    insert into public.food_nutrients(user_id,food_id,field_id,value)
      values (actor_id,saved_food_id,nutrient_key,nutrient_value)
      on conflict (user_id,food_id,field_id) do update set value = excluded.value;
  end loop;

  result := jsonb_build_object('id',saved_food_id,'revision',saved_revision);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'save_food',fingerprint,result);
  return result;
end;
$$;

create or replace function public.delete_food(p_request_id uuid,p_food_id uuid,p_expected_revision integer)
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
  result jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_request_id is null or p_food_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'A food and current revision are required';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'food_id',p_food_id,'expected_revision',p_expected_revision
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || p_request_id::text,0));
  select receipt.operation,receipt.input_fingerprint,receipt.result
    into prior_operation,prior_fingerprint,prior_result
    from public.mutation_receipts as receipt
    where receipt.user_id = actor_id and receipt.request_id = p_request_id
    for update;
  if found then
    if prior_operation <> 'delete_food' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;
  if exists (select 1 from public.meal_components as component
    where component.user_id = actor_id and component.food_id = p_food_id) then
    raise exception using errcode = '23503', message = 'Food is used by a saved meal; review those references before deleting it';
  end if;
  delete from public.foods as food
    where food.user_id = actor_id and food.id = p_food_id
      and food.revision = p_expected_revision and food.archived_at is null;
  if not found then
    raise exception using errcode = '40001', message = 'Food changed or is unavailable; reload before deleting';
  end if;
  result := jsonb_build_object('id',p_food_id,'deleted',true);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'delete_food',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.save_food(uuid,uuid,integer,text,text,numeric,text,numeric,numeric,text,numeric,jsonb) from public,anon;
grant execute on function public.save_food(uuid,uuid,integer,text,text,numeric,text,numeric,numeric,text,numeric,jsonb) to authenticated;
revoke all on function public.delete_food(uuid,uuid,integer) from public,anon;
grant execute on function public.delete_food(uuid,uuid,integer) to authenticated;

comment on function public.save_food(uuid,uuid,integer,text,text,numeric,text,numeric,numeric,text,numeric,jsonb) is
  'Atomically saves a food and its active nutrient values with owner checks, optimistic revisions and idempotency receipts.';
comment on function public.delete_food(uuid,uuid,integer) is
  'Deletes an unreferenced food with owner/revision checks; rejects foods still used by saved meals.';
