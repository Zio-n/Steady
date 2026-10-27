alter table public.profile_target_versions
  add column nutrient_field_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(nutrient_field_snapshot) = 'object');

create or replace function public.capture_profile_nutrient_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nutrient_field_snapshot = '{}'::jsonb then
    select coalesce(
      jsonb_object_agg(
        field.field_id,
        jsonb_build_object(
          'name',field.name,
          'unit',field.unit,
          'standard_key',field.standard_key,
          'is_displayed',field.is_displayed
        )
      ),
      '{}'::jsonb
    )
    into new.nutrient_field_snapshot
    from public.nutrient_fields as field
    where field.user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger profile_target_version_nutrient_snapshot
  before insert on public.profile_target_versions
  for each row execute function public.capture_profile_nutrient_snapshot();
revoke all on function public.capture_profile_nutrient_snapshot() from public,anon,authenticated;

create or replace function public.prevent_nutrient_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.field_id <> old.field_id
    or new.unit <> old.unit or new.standard_key is distinct from old.standard_key then
    raise exception using errcode = '22023', message = 'Nutrient identity and unit are permanent; create a new field for a new unit';
  end if;
  return new;
end;
$$;

create trigger nutrient_field_identity_immutable
  before update on public.nutrient_fields
  for each row execute function public.prevent_nutrient_identity_change();
revoke all on function public.prevent_nutrient_identity_change() from public,anon,authenticated;

revoke delete on public.nutrient_fields from authenticated;

create or replace function public.reorder_nutrient_fields(p_ordered_field_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  requested_field_id text;
  new_order integer := 0;
  active_count integer;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_ordered_field_ids is null or jsonb_typeof(p_ordered_field_ids) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(p_ordered_field_ids) as item(value)
      where jsonb_typeof(item.value) <> 'string'
    )
    or (select count(*) from jsonb_array_elements_text(p_ordered_field_ids)) <>
       (select count(distinct value) from jsonb_array_elements_text(p_ordered_field_ids)) then
    raise exception using errcode = '22023', message = 'Nutrient order must be a unique list of field IDs';
  end if;

  perform field.field_id from public.nutrient_fields as field
    where field.user_id = actor_id and field.archived_at is null for update;
  select count(*) into active_count from public.nutrient_fields as field
    where field.user_id = actor_id and field.archived_at is null;
  if jsonb_array_length(p_ordered_field_ids) <> active_count then
    raise exception using errcode = '22023', message = 'Refresh nutrient fields before reordering';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_ordered_field_ids) as requested(field_id)
    where not exists (
      select 1 from public.nutrient_fields as field
      where field.user_id = actor_id and field.field_id = requested.field_id and field.archived_at is null
    )
  ) then
    raise exception using errcode = '22023', message = 'A nutrient field is no longer available';
  end if;

  for requested_field_id in select value from jsonb_array_elements_text(p_ordered_field_ids)
  loop
    update public.nutrient_fields as field
      set display_order = new_order
      where field.user_id = actor_id and field.field_id = requested_field_id and field.archived_at is null;
    new_order := new_order + 1;
  end loop;
  return jsonb_build_object('field_ids',p_ordered_field_ids);
end;
$$;

revoke all on function public.reorder_nutrient_fields(jsonb) from public,anon;
grant execute on function public.reorder_nutrient_fields(jsonb) to authenticated;
