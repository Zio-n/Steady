-- Reviewed UK/US search vocabulary for generic foods. These are aliases only;
-- the distinct source records and their preparation/nutrition remain separate.
with reviewed_aliases(source_id, name_pattern, alias, locale) as (
  values
    ('cofid_2021', '^Aubergine,', 'eggplant', 'en-US'),
    ('usda_fndds', '^Eggplant', 'aubergine', 'en-GB'),
    ('cofid_2021', '^Courgette(s)?,', 'zucchini', 'en-US'),
    ('usda_fndds', '^Zucchini,', 'courgette', 'en-GB'),
    ('cofid_2021', '^Beetroot,', 'beet', 'en-US'),
    ('usda_fndds', '^Beets,', 'beetroot', 'en-GB'),
    ('usda_foundation', '^Beets,', 'beetroot', 'en-GB'),
    ('cofid_2021', '^Coriander leaves,', 'cilantro', 'en-US'),
    ('usda_fndds', '^Cilantro,', 'coriander leaves', 'en-GB'),
    ('cofid_2021', '^Rocket, raw$', 'arugula', 'en-US'),
    ('usda_fndds', '^Lettuce, arugula, raw$', 'rocket', 'en-GB'),
    ('usda_foundation', '^Arugula, baby, raw$', 'rocket', 'en-GB'),
    ('cofid_2021', '^Spring onions,', 'scallions', 'en-US'),
    ('usda_foundation', '^Green onion, \(scallion\)', 'spring onions', 'en-GB'),
    ('cofid_2021', '^Yogurt,', 'yoghurt', 'en-GB'),
    ('usda_fndds', '^Yogurt', 'yoghurt', 'en-GB'),
    ('usda_foundation', '^Yogurt', 'yoghurt', 'en-GB'),
    ('usda_fndds', '^Chickpeas,', 'garbanzo beans', 'en-US'),
    ('usda_fndds', '^Oatmeal,', 'porridge', 'en-GB')
)
insert into public.catalog_food_aliases(food_id, alias, locale, origin, source_field)
select food.id, reviewed.alias, reviewed.locale, 'steady', null
from public.catalog_foods as food
join reviewed_aliases as reviewed
  on reviewed.source_id = food.source_id
 and food.name ~* reviewed.name_pattern
where food.data_kind = 'generic'
on conflict (food_id, alias, locale) do update
set origin = 'steady', source_field = null;
