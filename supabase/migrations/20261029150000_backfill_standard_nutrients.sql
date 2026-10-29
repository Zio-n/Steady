-- Older local profiles can have only Protein. Make the standard nutrient
-- choices available for food entry without changing what appears on the day.
insert into public.nutrient_fields (user_id, field_id, name, unit, standard_key, display_order, is_displayed)
select profile.user_id, standard.field_id, standard.name, standard.unit,
  standard.standard_key, standard.display_order, false
from public.profiles as profile
cross join (values
  ('carbohydrate', 'Carbohydrate', 'g', 'carbohydrate', 1),
  ('fat', 'Fat', 'g', 'fat', 2),
  ('fibre', 'Fibre', 'g', 'fibre', 3),
  ('sugar', 'Sugar', 'g', 'sugar', 4),
  ('saturated_fat', 'Saturated fat', 'g', 'saturated_fat', 5),
  ('salt', 'Salt', 'g', 'salt', 6)
) as standard(field_id, name, unit, standard_key, display_order)
where profile.onboarding_complete
on conflict (user_id, field_id) do nothing;
