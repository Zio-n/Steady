-- Remember each user's most recently added portion without changing shared food data.
create table public.user_food_portion_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  food_kind text not null check (food_kind in ('library', 'catalogue')),
  food_id uuid not null,
  amount numeric(14,5) not null check (amount > 0 and amount < 100000000),
  unit text not null check (length(trim(unit)) between 1 and 32),
  updated_at timestamptz not null default now(),
  primary key (user_id, food_kind, food_id)
);

alter table public.user_food_portion_preferences enable row level security;
create policy owner_access on public.user_food_portion_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_food_portion_preferences to authenticated;

comment on table public.user_food_portion_preferences is
  'Private last-added portions for food search; these never change the catalogue or saved food defaults.';
