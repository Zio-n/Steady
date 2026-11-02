-- Keep possible cross-contact warnings separate from source-listed allergens.
-- A NULL value means the source did not provide this field; it does not mean
-- the food is allergen-free.
alter table public.catalog_foods
  add column allergen_traces text;

comment on column public.catalog_foods.allergens is
  'Source-listed allergen taxonomy tags (currently Open Food Facts allergens_tags). NULL or empty means unreported, not allergen-free.';

comment on column public.catalog_foods.allergen_traces is
  'Source-listed possible allergen traces (currently Open Food Facts traces_tags), stored separately from allergens. NULL or empty means unreported, not trace-free.';
