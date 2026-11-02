-- Preserve imported units/values and record the unit actually used by each value.
-- This lets source-unit-only rows remain visible without being mistaken for a
-- normalized nutrition value.
alter table public.catalog_food_nutrients
  add column source_original_value numeric(16,7),
  add column source_original_unit text,
  add column value_unit text,
  add column normalization_status text not null default 'unreviewed'
    check (normalization_status in ('unreviewed','normalized','source_unit_only','not_a_nutrient','out_of_range'));

update public.catalog_food_nutrients as nutrient
set source_original_value = nutrient.value,
    source_original_unit = nutrient.source_unit,
    value_unit = nutrient.source_unit,
    normalization_status = case
      when nutrient.source_unit = definition.standard_unit then 'normalized'
      else 'source_unit_only'
    end
from public.catalog_nutrient_definitions as definition
where definition.nutrient_code = nutrient.nutrient_code;

-- These Open Food Facts values are product attributes/scores rather than
-- nutrient quantities. Retain them, but prevent their use in nutrient sums.
update public.catalog_food_nutrients as nutrient
set normalization_status = 'not_a_nutrient'
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and (
    nutrient.nutrient_code in ('off_nova_group','off_nutrition_score_fr','off_nutrition_score_uk')
    or nutrient.nutrient_code like 'off_fruits_vegetables%'
    or nutrient.nutrient_code like 'off_carbon_footprint%'
  );

comment on column public.catalog_food_nutrients.source_original_value is
  'Numeric value as imported from the source before unit normalization.';
comment on column public.catalog_food_nutrients.source_original_unit is
  'Unit label as imported from the source before unit normalization.';
comment on column public.catalog_food_nutrients.value_unit is
  'Unit of value; normalized values use the nutrient definition standard unit.';
comment on column public.catalog_food_nutrients.normalization_status is
  'Whether the value is normalized, only available in its source unit, not a nutrient quantity, or out of range.';
