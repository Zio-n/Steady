-- OFF's vitamin D definition inherited an unreliable first-seen unit (g).
-- Use micrograms, matching the FDA's conventional-food nutrition label unit.
update public.catalog_nutrient_definitions
set standard_unit = 'µg'
where nutrient_code = 'off_vitamin_d';

-- Reset this nutrient from preserved source data before normalizing it.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value,
    value_unit = nutrient.source_original_unit,
    normalization_status = 'source_unit_only'
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and nutrient.nutrient_code = 'off_vitamin_d'
  and nutrient.normalization_status <> 'not_a_nutrient';

-- FDA guidance: 1 IU vitamin D = 0.025 µg. Both D2 and D3 use this factor.
-- Plain microgram and milligram quantities are also dimensionally convertible.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value * case lower(trim(nutrient.source_original_unit))
      when 'iu' then 0.025::numeric
      when 'mg' then 1000::numeric
      when 'µg' then 1::numeric
      when 'μg' then 1::numeric
      when 'mcg' then 1::numeric
      when 'ug' then 1::numeric
      when '&#181;g' then 1::numeric
    end,
    value_unit = 'µg',
    normalization_status = 'normalized'
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and nutrient.nutrient_code = 'off_vitamin_d'
  and lower(trim(nutrient.source_original_unit)) in ('iu','mg','µg','μg','mcg','ug','&#181;g')
  and abs(nutrient.source_original_value * case lower(trim(nutrient.source_original_unit))
      when 'iu' then 0.025::numeric
      when 'mg' then 1000::numeric
      when 'µg' then 1::numeric
      when 'μg' then 1::numeric
      when 'mcg' then 1::numeric
      when 'ug' then 1::numeric
      when '&#181;g' then 1::numeric
    end) < 1000000000;

-- The stored numeric precision cannot represent arbitrarily small IU-derived
-- microgram amounts. Preserve those originals instead of recording zero.
update public.catalog_food_nutrients as nutrient
set value = nutrient.source_original_value,
    value_unit = nutrient.source_original_unit,
    normalization_status = 'source_unit_only'
from public.catalog_foods as food
where food.id = nutrient.food_id
  and food.source_id = 'openfoodfacts'
  and nutrient.nutrient_code = 'off_vitamin_d'
  and nutrient.normalization_status = 'normalized'
  and nutrient.source_original_value > 0
  and nutrient.value = 0
  and nutrient.source_original_unit is distinct from nutrient.value_unit;
