-- Shared, source-attributed food catalogue. Private foods remain account-owned.
create extension if not exists pg_trgm with schema extensions;

create table public.catalog_sources (
  id text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  licence text not null,
  source_url text not null,
  attribution text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.catalog_foods (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.catalog_sources(id) on delete restrict,
  source_record_id text not null,
  data_kind text not null check (data_kind in ('generic','branded')),
  name text not null check (length(trim(name)) between 1 and 240),
  brand text check (brand is null or length(brand) <= 160),
  category text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  locale text,
  barcode text,
  preparation text,
  food_form text,
  ingredients text,
  allergens text,
  package_quantity numeric(14,5) check (package_quantity is null or package_quantity > 0),
  package_unit text,
  basis_amount numeric(14,5) not null check (basis_amount > 0),
  basis_unit text not null check (basis_unit in ('g','ml','serving')),
  source_updated_at timestamptz,
  imported_at timestamptz not null default now(),
  quality_status text not null default 'unreviewed'
    check (quality_status in ('unreviewed','usable','incomplete','rejected')),
  source_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(source_metadata) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_record_id)
);

create index catalog_foods_name_trgm_idx on public.catalog_foods using gin (name extensions.gin_trgm_ops);
create index catalog_foods_brand_trgm_idx on public.catalog_foods using gin (brand extensions.gin_trgm_ops);
create index catalog_foods_kind_country_idx on public.catalog_foods(data_kind,country_code) where is_active;
create index catalog_foods_barcode_idx on public.catalog_foods(barcode) where barcode is not null and is_active;

create table public.catalog_nutrient_definitions (
  nutrient_code text primary key check (nutrient_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  name text not null,
  standard_unit text not null,
  sort_order integer not null default 0
);

insert into public.catalog_nutrient_definitions(nutrient_code,name,standard_unit,sort_order) values
  ('energy_kcal','Energy','kcal',10),
  ('protein_g','Protein','g',20),
  ('carbohydrate_g','Carbohydrate','g',30),
  ('sugars_g','Sugars','g',40),
  ('fibre_g','Fibre','g',50),
  ('fat_g','Fat','g',60),
  ('saturated_fat_g','Saturated fat','g',70),
  ('trans_fat_g','Trans fat','g',80),
  ('salt_g','Salt','g',90),
  ('sodium_mg','Sodium','mg',100),
  ('cholesterol_mg','Cholesterol','mg',110),
  ('calcium_mg','Calcium','mg',120),
  ('iron_mg','Iron','mg',130),
  ('potassium_mg','Potassium','mg',140),
  ('vitamin_c_mg','Vitamin C','mg',150)
on conflict (nutrient_code) do nothing;

create table public.catalog_food_nutrients (
  food_id uuid not null references public.catalog_foods(id) on delete cascade,
  nutrient_code text not null references public.catalog_nutrient_definitions(nutrient_code) on delete restrict,
  value numeric(16,7) check (value is null or value >= 0),
  source_unit text not null,
  basis_amount numeric(14,5) not null check (basis_amount > 0),
  basis_unit text not null check (basis_unit in ('g','ml','serving')),
  source_nutrient_name text,
  primary key (food_id,nutrient_code)
);

create table public.catalog_food_aliases (
  food_id uuid not null references public.catalog_foods(id) on delete cascade,
  alias text not null check (length(trim(alias)) between 1 and 240),
  locale text,
  primary key (food_id,alias)
);
create index catalog_food_aliases_trgm_idx on public.catalog_food_aliases using gin (alias extensions.gin_trgm_ops);

create table public.catalog_food_portions (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.catalog_foods(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 100),
  amount numeric(14,5) not null check (amount > 0),
  unit text not null check (length(trim(unit)) between 1 and 32),
  grams numeric(14,5) check (grams is null or grams > 0),
  millilitres numeric(14,5) check (millilitres is null or millilitres > 0),
  is_default boolean not null default false,
  source_record_id text,
  unique (food_id,label,amount,unit),
  check (grams is not null or millilitres is not null)
);

alter table public.catalog_sources enable row level security;
alter table public.catalog_foods enable row level security;
alter table public.catalog_nutrient_definitions enable row level security;
alter table public.catalog_food_nutrients enable row level security;
alter table public.catalog_food_aliases enable row level security;
alter table public.catalog_food_portions enable row level security;

create policy "catalog sources readable" on public.catalog_sources for select to anon, authenticated using (enabled);
create policy "catalog foods readable" on public.catalog_foods for select to anon, authenticated using (is_active);
create policy "catalog nutrient definitions readable" on public.catalog_nutrient_definitions for select to anon, authenticated using (true);
create policy "catalog nutrients readable" on public.catalog_food_nutrients for select to anon, authenticated using (
  exists(select 1 from public.catalog_foods food where food.id=food_id and food.is_active)
);
create policy "catalog aliases readable" on public.catalog_food_aliases for select to anon, authenticated using (
  exists(select 1 from public.catalog_foods food where food.id=food_id and food.is_active)
);
create policy "catalog portions readable" on public.catalog_food_portions for select to anon, authenticated using (
  exists(select 1 from public.catalog_foods food where food.id=food_id and food.is_active)
);

grant select on public.catalog_sources, public.catalog_foods, public.catalog_nutrient_definitions,
  public.catalog_food_nutrients, public.catalog_food_aliases, public.catalog_food_portions to anon, authenticated;
grant all on public.catalog_sources, public.catalog_foods, public.catalog_nutrient_definitions,
  public.catalog_food_nutrients, public.catalog_food_aliases, public.catalog_food_portions to service_role;
