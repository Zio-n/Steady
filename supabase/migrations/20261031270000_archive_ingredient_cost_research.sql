-- Preserve the shelved local cost research without keeping it in the app's
-- public data model. The tables and their rows can be moved back if needed.
create schema if not exists steady_research;
revoke all on schema steady_research from public, anon, authenticated;
grant usage on schema steady_research to service_role;

alter table public.steady_ingredient_cost_items set schema steady_research;
alter table public.ingredient_cost_estimates set schema steady_research;
alter table public.ingredient_cost_catalog_matches set schema steady_research;

revoke all on steady_research.steady_ingredient_cost_items from anon, authenticated;
revoke all on steady_research.ingredient_cost_estimates from anon, authenticated;
revoke all on steady_research.ingredient_cost_catalog_matches from anon, authenticated;
