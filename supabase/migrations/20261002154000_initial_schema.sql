-- Steady's user-owned data model. Composite owner keys prevent cross-account references.
create type public.meal_section as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type public.routine_slot_mode as enum ('fixed', 'shuffle');
create type public.day_status as enum ('open', 'completed');
create type public.day_item_state as enum ('planned', 'eaten', 'removed');
create type public.day_item_source as enum ('food', 'meal', 'routine');
create type public.allocation_kind as enum ('recurring', 'one_off');
create type public.carry_action as enum ('none', 'single_day', 'spread');
create type public.carry_state as enum ('active', 'reversed', 'superseded');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC' check (length(timezone) between 1 and 100),
  base_daily_target_kcal numeric(12,2) check (base_daily_target_kcal is null or (base_daily_target_kcal > 0 and base_daily_target_kcal < 1000000)),
  onboarding_complete boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_target_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null,
  base_daily_target_kcal numeric(12,2) check (base_daily_target_kcal is null or (base_daily_target_kcal > 0 and base_daily_target_kcal < 1000000)),
  nutrient_targets jsonb not null default '{}'::jsonb check (jsonb_typeof(nutrient_targets) = 'object'),
  timezone text not null check (length(timezone) between 1 and 100),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, effective_from)
);

create table public.nutrient_fields (
  user_id uuid not null references auth.users(id) on delete cascade,
  field_id text not null check (field_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  unit text not null check (length(trim(unit)) between 1 and 24),
  standard_key text check (standard_key is null or standard_key in ('protein','carbohydrate','fat','fibre','sugar','saturated_fat','salt')),
  display_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, field_id)
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  brand text check (brand is null or length(brand) <= 120),
  basis_amount numeric(12,4) not null check (basis_amount > 0 and basis_amount < 100000000),
  basis_unit text not null check (length(trim(basis_unit)) between 1 and 24),
  grams_per_serving numeric(12,4) check (grams_per_serving is null or (grams_per_serving > 0 and grams_per_serving < 100000000)),
  default_portion_amount numeric(12,4) not null default 1 check (default_portion_amount > 0 and default_portion_amount < 100000000),
  default_portion_unit text not null default 'serving' check (length(trim(default_portion_unit)) between 1 and 24),
  calories_kcal numeric(12,4) check (calories_kcal is null or (calories_kcal >= 0 and calories_kcal < 100000000)),
  archived_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.food_nutrients (
  user_id uuid not null,
  food_id uuid not null,
  field_id text not null,
  value numeric(14,6) check (value is null or (value >= 0 and value < 100000000)),
  primary key (user_id, food_id, field_id),
  foreign key (user_id, food_id) references public.foods(user_id,id) on delete cascade,
  foreign key (user_id, field_id) references public.nutrient_fields(user_id,field_id) on update cascade on delete restrict
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  sections public.meal_section[] not null default '{}',
  declared_total_weight_g numeric(12,4) check (declared_total_weight_g is null or (declared_total_weight_g > 0 and declared_total_weight_g < 100000000)),
  archived_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id)
);

create table public.meal_components (
  user_id uuid not null,
  meal_id uuid not null,
  component_id uuid not null default gen_random_uuid(),
  food_id uuid not null,
  amount numeric(12,4) not null check (amount > 0 and amount < 100000000),
  unit text not null check (length(trim(unit)) between 1 and 24),
  position integer not null check (position >= 0),
  primary key (user_id,meal_id,component_id),
  foreign key (user_id,meal_id) references public.meals(user_id,id) on delete cascade,
  foreign key (user_id,food_id) references public.foods(user_id,id) on delete restrict,
  unique (user_id,meal_id,position)
);

create table public.routine_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (user_id,id),
  unique (user_id,effective_from)
);

create table public.routine_slots (
  user_id uuid not null,
  routine_version_id uuid not null,
  slot_id text not null check (slot_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  weekday smallint not null check (weekday between 1 and 7),
  section public.meal_section not null,
  mode public.routine_slot_mode not null,
  meal_id uuid,
  default_multiplier numeric(12,4) not null default 1 check (default_multiplier > 0 and default_multiplier < 1000000),
  position integer not null default 0 check (position >= 0),
  primary key (user_id,routine_version_id,slot_id),
  foreign key (user_id,routine_version_id) references public.routine_versions(user_id,id) on delete cascade,
  foreign key (user_id,meal_id) references public.meals(user_id,id) on delete restrict,
  check ((mode = 'fixed' and meal_id is not null) or (mode = 'shuffle' and meal_id is null))
);

create table public.weekly_pattern_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_week_start date not null check (extract(isodow from effective_week_start) = 1),
  base_daily_target_kcal numeric(12,2) not null check (base_daily_target_kcal > 0 and base_daily_target_kcal < 1000000),
  created_at timestamptz not null default now(),
  unique (user_id,id),
  unique (user_id,effective_week_start)
);

create table public.weekly_pattern_days (
  user_id uuid not null,
  pattern_version_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  target_kcal numeric(12,2) not null check (target_kcal > 0 and target_kcal < 1000000),
  primary key (user_id,pattern_version_id,weekday),
  foreign key (user_id,pattern_version_id) references public.weekly_pattern_versions(user_id,id) on delete cascade
);

create table public.weeks (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  budget_kcal numeric(14,2) not null check (budget_kcal > 0 and budget_kcal < 7000000),
  source_pattern_version_id uuid,
  allocation_kind public.allocation_kind not null default 'recurring',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,week_start),
  foreign key (user_id,source_pattern_version_id) references public.weekly_pattern_versions(user_id,id) on delete restrict
);

create table public.week_allocations (
  user_id uuid not null,
  week_start date not null,
  weekday smallint not null check (weekday between 1 and 7),
  base_target_kcal numeric(12,2) not null check (base_target_kcal > 0 and base_target_kcal < 1000000),
  override_target_kcal numeric(12,2) check (override_target_kcal is null or (override_target_kcal > 0 and override_target_kcal < 1000000)),
  primary key (user_id,week_start,weekday),
  foreign key (user_id,week_start) references public.weeks(user_id,week_start) on delete cascade
);

create table public.days (
  user_id uuid not null,
  local_date date not null,
  week_start date not null,
  base_planned_target_kcal numeric(12,2) not null check (base_planned_target_kcal > 0 and base_planned_target_kcal < 1000000),
  nutrient_target_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(nutrient_target_snapshot) = 'object'),
  status public.day_status not null default 'open',
  completed_target_kcal numeric(12,2) check (completed_target_kcal is null or (completed_target_kcal > 0 and completed_target_kcal < 1000000)),
  completed_at timestamptz,
  completed_log_revision integer,
  log_revision integer not null default 1 check (log_revision > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,local_date),
  foreign key (user_id,week_start) references public.weeks(user_id,week_start) on delete restrict,
  check (local_date >= week_start and local_date < week_start + 7),
  check ((status = 'open' and completed_at is null and completed_target_kcal is null and completed_log_revision is null) or (status = 'completed' and completed_at is not null and completed_target_kcal is not null and completed_log_revision is not null))
);

create table public.day_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  local_date date not null,
  section public.meal_section not null,
  state public.day_item_state not null default 'planned',
  source public.day_item_source not null,
  routine_occurrence_key text,
  selected_amount numeric(12,4) check (selected_amount is null or (selected_amount > 0 and selected_amount < 100000000)),
  selected_unit text check (selected_unit is null or length(trim(selected_unit)) between 1 and 24),
  manual_override boolean not null default false,
  planned_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(planned_payload) = 'object'),
  eaten_snapshot jsonb check (eaten_snapshot is null or jsonb_typeof(eaten_snapshot) = 'object'),
  eaten_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id,local_date) references public.days(user_id,local_date) on delete restrict,
  unique (user_id,id),
  unique (user_id,routine_occurrence_key),
  check ((state = 'eaten' and eaten_snapshot is not null and eaten_at is not null) or (state <> 'eaten' and eaten_at is null)),
  check ((source = 'routine' and routine_occurrence_key is not null) or source <> 'routine')
);

create table public.carry_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_date date not null,
  source_log_revision integer not null check (source_log_revision > 0),
  completed_target_kcal numeric(12,2) not null check (completed_target_kcal > 0 and completed_target_kcal < 1000000),
  actual_kcal numeric(14,4) not null check (actual_kcal >= 0 and actual_kcal < 100000000),
  difference_kcal numeric(14,4) not null check (difference_kcal > -100000000 and difference_kcal < 100000000),
  action public.carry_action not null,
  amount_kcal numeric(14,4) not null default 0 check (amount_kcal >= 0 and amount_kcal < 100000000),
  state public.carry_state not null default 'active',
  needs_review boolean not null default false,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  foreign key (user_id,source_date) references public.days(user_id,local_date) on delete restrict,
  unique (user_id,id),
  check ((action = 'none' and amount_kcal = 0) or (action <> 'none' and amount_kcal > 0)),
  check ((state = 'reversed' and reversed_at is not null) or state <> 'reversed')
);

create unique index carry_one_active_decision_per_source
  on public.carry_decisions(user_id,source_date) where state = 'active';

create table public.carry_allocations (
  user_id uuid not null,
  decision_id uuid not null,
  destination_date date not null,
  signed_delta_kcal numeric(14,4) not null check (signed_delta_kcal <> 0 and signed_delta_kcal > -100000000 and signed_delta_kcal < 100000000),
  destination_revision integer not null check (destination_revision > 0),
  primary key (user_id,decision_id,destination_date),
  foreign key (user_id,decision_id) references public.carry_decisions(user_id,id) on delete restrict,
  foreign key (user_id,destination_date) references public.days(user_id,local_date) on delete restrict
);

create table public.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{1,63}$'),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id,request_id)
);

create index foods_owner_active_name_idx on public.foods(user_id,lower(name)) where archived_at is null;
create index meals_owner_active_name_idx on public.meals(user_id,lower(name)) where archived_at is null;
create index meal_components_by_food_idx on public.meal_components(user_id,food_id);
create index routine_versions_effective_idx on public.routine_versions(user_id,effective_from desc);
create index weekly_patterns_effective_idx on public.weekly_pattern_versions(user_id,effective_week_start desc);
create index days_owner_week_idx on public.days(user_id,week_start,local_date);
create index day_items_owner_date_idx on public.day_items(user_id,local_date,section,created_at);
create index day_items_recent_eaten_idx on public.day_items(user_id,eaten_at desc) where state = 'eaten';
create index carry_allocations_destination_idx on public.carry_allocations(user_id,destination_date);

do $$
declare
  table_name text;
  table_names text[] := array[
    'profiles','profile_target_versions','nutrient_fields','foods','food_nutrients',
    'meals','meal_components','routine_versions','routine_slots',
    'weekly_pattern_versions','weekly_pattern_days','weeks','week_allocations',
    'days','day_items','carry_decisions','carry_allocations','mutation_receipts'
  ];
begin
  foreach table_name in array table_names loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format(
      'create policy owner_access on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
    execute format('revoke all on public.%I from anon,authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
  end loop;
end
$$;

grant usage on schema public to authenticated;
grant insert,update,delete on public.profiles,public.profile_target_versions,public.nutrient_fields,public.foods,public.food_nutrients to authenticated;
-- Aggregate records have read access only until their atomic, validated RPCs are installed.
revoke insert,update,delete on public.meals,public.meal_components,public.routine_versions,public.routine_slots,
  public.weekly_pattern_versions,public.weekly_pattern_days,public.weeks,public.week_allocations,
  public.days,public.day_items,public.carry_decisions,public.carry_allocations,public.mutation_receipts from authenticated;

comment on table public.day_items is 'Planned items do not count as intake; eaten_snapshot freezes logged nutrition.';
comment on table public.carry_allocations is 'Signed ledger: positive adds allowance; negative removes allowance.';
comment on table public.mutation_receipts is 'Idempotency records for aggregate writes; accessed only by transaction functions.';
