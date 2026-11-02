-- Correct the first-pass normalization using preserved raw values. The initial
-- pass converted every mass quantity to mg and inferred too much from the
-- shared definition unit. Restore original units first, then convert only
-- explicit, dimension-compatible source/target pairs.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value,
    value_unit = nutrient.source_original_unit,
    normalization_status = case
      when nutrient.normalization_status = 'not_a_nutrient' then 'not_a_nutrient'
      else 'source_unit_only'
    end
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts';

-- Normalize mass units only when both the row and its restored definition use
-- an explicitly recognized mass unit. Target unit remains the definition's
-- unit (e.g. protein in g, vitamin B12 in µg).
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value * (case lower(trim(nutrient.source_original_unit))
      when 'g' then 1000::numeric
      when 'mg' then 1::numeric
      when 'µg' then 0.001::numeric
      when 'μg' then 0.001::numeric
      when 'mcg' then 0.001::numeric
      when 'ug' then 0.001::numeric
    end) / (case lower(trim(definition.standard_unit))
      when 'g' then 1000::numeric
      when 'mg' then 1::numeric
      when 'µg' then 0.001::numeric
      when 'μg' then 0.001::numeric
      when 'mcg' then 0.001::numeric
      when 'ug' then 0.001::numeric
    end),
    value_unit = definition.standard_unit,
    normalization_status = 'normalized'
from public.catalog_foods as food,
     public.catalog_nutrient_definitions as definition
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and definition.nutrient_code = nutrient.nutrient_code
  and nutrient.normalization_status <> 'not_a_nutrient'
  and lower(trim(nutrient.source_original_unit)) in ('g','mg','µg','μg','mcg','ug')
  and lower(trim(definition.standard_unit)) in ('g','mg','µg','μg','mcg','ug')
  and abs(nutrient.source_original_value * (case lower(trim(nutrient.source_original_unit))
      when 'g' then 1000::numeric
      when 'mg' then 1::numeric
      when 'µg' then 0.001::numeric
      when 'μg' then 0.001::numeric
      when 'mcg' then 0.001::numeric
      when 'ug' then 0.001::numeric
    end) / (case lower(trim(definition.standard_unit))
      when 'g' then 1000::numeric
      when 'mg' then 1::numeric
      when 'µg' then 0.001::numeric
      when 'μg' then 0.001::numeric
      when 'mcg' then 0.001::numeric
      when 'ug' then 0.001::numeric
    end)) < 1000000000;

-- Normalize declared kcal/kJ values only where the original and target units
-- are both recognized energy units. Other energy labels remain source-only.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value * (case lower(trim(nutrient.source_original_unit))
      when 'kcal' then 1::numeric
      when 'kilocalorie' then 1::numeric
      when 'kilocalories' then 1::numeric
      when 'kj' then 0.2390057361376673::numeric
      when 'kilojoule' then 0.2390057361376673::numeric
      when 'kilojoules' then 0.2390057361376673::numeric
    end) / (case lower(trim(definition.standard_unit))
      when 'kcal' then 1::numeric
      when 'kj' then 4.184::numeric
    end),
    value_unit = definition.standard_unit,
    normalization_status = 'normalized'
from public.catalog_foods as food,
     public.catalog_nutrient_definitions as definition
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and definition.nutrient_code = nutrient.nutrient_code
  and (nutrient.nutrient_code = 'energy_kcal' or nutrient.nutrient_code like 'off_%energy%')
  and lower(trim(nutrient.source_original_unit)) in ('kcal','kilocalorie','kilocalories','kj','kilojoule','kilojoules')
  and lower(trim(definition.standard_unit)) in ('kcal','kj');

-- Vitamin A IU rows need no conversion where the source and nutrient
-- definition already use IU. Keep mass-unit rows source-only: IU equivalence
-- depends on the form of vitamin A.
update public.catalog_food_nutrients as nutrient
set value_unit = definition.standard_unit,
    normalization_status = 'normalized'
from public.catalog_foods as food,
     public.catalog_nutrient_definitions as definition
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and definition.nutrient_code = nutrient.nutrient_code
  and nutrient.nutrient_code = 'off_vitamin_a'
  and nutrient.source_original_unit = 'IU'
  and definition.standard_unit = 'IU'
  and nutrient.normalization_status = 'source_unit_only';

-- Do not let numeric(16,7) precision turn a positive trace nutrient into zero
-- during unit conversion. Restore those values and leave them source-unit-only.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value,
    value_unit = nutrient.source_original_unit,
    normalization_status = 'source_unit_only'
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and nutrient.normalization_status = 'normalized'
  and nutrient.source_original_value > 0
  and nutrient.value = 0
  and nutrient.source_original_unit is distinct from nutrient.value_unit;
