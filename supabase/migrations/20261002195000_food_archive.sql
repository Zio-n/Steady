create or replace function public.archive_food(p_request_id uuid,p_food_id uuid,p_expected_revision integer)
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
  saved_revision integer;
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
    if prior_operation <> 'archive_food' or prior_fingerprint <> fingerprint then
      raise exception using errcode = '22023', message = 'request_id was already used with different input';
    end if;
    return prior_result;
  end if;
  update public.foods as food
    set archived_at = now(),revision = food.revision + 1,updated_at = now()
    where food.user_id = actor_id and food.id = p_food_id
      and food.revision = p_expected_revision and food.archived_at is null
    returning revision into saved_revision;
  if not found then
    raise exception using errcode = '40001', message = 'Food changed or is unavailable; reload before archiving';
  end if;
  result := jsonb_build_object('id',p_food_id,'revision',saved_revision,'archived',true);
  insert into public.mutation_receipts(user_id,request_id,operation,input_fingerprint,result)
    values (actor_id,p_request_id,'archive_food',fingerprint,result);
  return result;
end;
$$;

revoke all on function public.archive_food(uuid,uuid,integer) from public,anon;
grant execute on function public.archive_food(uuid,uuid,integer) to authenticated;
comment on function public.archive_food(uuid,uuid,integer) is
  'Soft-archives a referenced food with optimistic revision and idempotency checks, preserving meal and routine references.';
