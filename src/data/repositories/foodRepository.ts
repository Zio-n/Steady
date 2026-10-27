import type { Json, Tables } from '../database.types';
import { supabase } from '../supabaseClient';
import { DataError, toDataError } from '../dataError';

export type Food = Tables<'foods'>;
export type FoodWithNutrients = { food: Food; nutrients: Record<string, number> };
export type FoodReferences = { meals: { id: string; name: string }[]; routineSlots: { weekday: number; section: string; effectiveFrom: string }[] };

/** Searches only active foods owned by the authenticated account; RLS remains authoritative. */
export async function searchFoods(userId: string, search: string, limit = 50): Promise<Food[]> {
  if (!supabase) throw new DataError('Connect Supabase before loading saved foods.', 'configuration');

  const query = supabase.from('foods').select('*').eq('user_id', userId).is('archived_at', null)
    .order('name', { ascending: true }).limit(Math.min(Math.max(limit, 1), 100));
  const { data, error } = search.trim()
    ? await query.ilike('name', `%${escapeLike(search.trim())}%`)
    : await query;

  if (error) throw toDataError(error);
  return data;
}

export async function loadFoodEntry(userId: string, foodId: string): Promise<FoodWithNutrients | null> {
  if (!supabase) throw new DataError('Connect Supabase before loading a saved food.', 'configuration');
  const { data: food, error } = await supabase.from('foods').select('*')
    .eq('user_id', userId).eq('id', foodId).is('archived_at', null).maybeSingle();
  if (error) throw toDataError(error);
  if (!food) return null;
  const { data: values, error: nutrientError } = await supabase.from('food_nutrients').select('field_id,value')
    .eq('user_id', userId).eq('food_id', foodId);
  if (nutrientError) throw toDataError(nutrientError);
  return { food, nutrients: Object.fromEntries(values.flatMap((value) => value.value === null ? [] : [[value.field_id, value.value]])) };
}

export async function loadFoodLibrary(userId: string, search = '', offset = 0, pageSize = 20, sort: 'name' | 'recent' = 'name') {
  if (!supabase) throw new DataError('Connect Supabase before loading saved foods.', 'configuration');
  const trimmedSearch = search.trim();
  let query = supabase.from('foods').select('*', { count: 'exact' }).eq('user_id', userId).is('archived_at', null);
  if (trimmedSearch) query = query.or(`name.ilike.%${escapeLike(trimmedSearch)}%,brand.ilike.%${escapeLike(trimmedSearch)}%`);
  query = sort === 'recent' ? query.order('created_at', { ascending: false }) : query.order('name', { ascending: true });
  const { data: foods, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) throw toDataError(error);
  if (foods.length === 0) return { entries: [] as FoodWithNutrients[], hasMore: false };

  const { data: values, error: nutrientError } = await supabase.from('food_nutrients').select('*')
    .eq('user_id', userId).in('food_id', foods.map((food) => food.id));
  if (nutrientError) throw toDataError(nutrientError);
  const nutrientsByFood = new Map<string, Record<string, number>>();
  for (const value of values) {
    if (value.value === null) continue;
    const nutrients = nutrientsByFood.get(value.food_id) ?? {};
    nutrients[value.field_id] = value.value;
    nutrientsByFood.set(value.food_id, nutrients);
  }
  return {
    entries: foods.map((food) => ({ food, nutrients: nutrientsByFood.get(food.id) ?? {} })),
    hasMore: (count ?? 0) > offset + foods.length,
  };
}

export async function loadFoodReferences(userId: string, foodId: string): Promise<FoodReferences> {
  if (!supabase) throw new DataError('Connect Supabase before checking food references.', 'configuration');
  const { data: components, error: componentError } = await supabase.from('meal_components')
    .select('meal_id').eq('user_id', userId).eq('food_id', foodId);
  if (componentError) throw toDataError(componentError);
  const mealIds = [...new Set(components.map((component) => component.meal_id))];
  if (mealIds.length === 0) return { meals: [], routineSlots: [] };
  const [mealsResult, slotsResult] = await Promise.all([
    supabase.from('meals').select('id,name').eq('user_id', userId).in('id', mealIds),
    supabase.from('routine_slots').select('weekday,section,routine_version_id,meal_id')
      .eq('user_id', userId).in('meal_id', mealIds),
  ]);
  if (mealsResult.error) throw toDataError(mealsResult.error);
  if (slotsResult.error) throw toDataError(slotsResult.error);
  const versionIds = [...new Set(slotsResult.data.map((slot) => slot.routine_version_id))];
  const versionsResult = versionIds.length
    ? await supabase.from('routine_versions').select('id,effective_from').eq('user_id', userId).in('id', versionIds)
    : { data: [], error: null };
  if (versionsResult.error) throw toDataError(versionsResult.error);
  const effectiveFromById = new Map(versionsResult.data.map((version) => [version.id, version.effective_from]));
  return {
    meals: mealsResult.data,
    routineSlots: slotsResult.data.map((slot) => ({
      weekday: slot.weekday,
      section: slot.section,
      effectiveFrom: effectiveFromById.get(slot.routine_version_id) ?? '',
    })),
  };
}

export type SaveFoodInput = {
  requestId: string;
  id: string | null;
  expectedRevision: number | null;
  name: string;
  brand: string | null;
  basisAmount: number;
  basisUnit: string;
  gramsPerServing: number | null;
  defaultPortionAmount: number;
  defaultPortionUnit: string;
  caloriesKcal: number | null;
  nutrients: Record<string, number>;
};

export async function saveFood(input: SaveFoodInput) {
  if (!supabase) throw new DataError('Connect Supabase before saving a food.', 'configuration');
  const { data, error } = await supabase.rpc('save_food', {
    p_request_id: input.requestId,
    p_food_id: input.id,
    p_expected_revision: input.expectedRevision,
    p_name: input.name,
    p_brand: input.brand,
    p_basis_amount: input.basisAmount,
    p_basis_unit: input.basisUnit,
    p_grams_per_serving: input.gramsPerServing,
    p_default_portion_amount: input.defaultPortionAmount,
    p_default_portion_unit: input.defaultPortionUnit,
    p_calories_kcal: input.caloriesKcal,
    p_nutrients: input.nutrients as unknown as Json,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function deleteFood(requestId: string, foodId: string, expectedRevision: number) {
  if (!supabase) throw new DataError('Connect Supabase before deleting a food.', 'configuration');
  const { data, error } = await supabase.rpc('delete_food', {
    p_request_id: requestId,
    p_food_id: foodId,
    p_expected_revision: expectedRevision,
  });
  if (error?.code === '23503') throw new DataError('This food is used by a saved meal. Review those references before deleting it.', 'conflict', error.code);
  if (error) throw toDataError(error);
  return data;
}

export async function archiveFood(requestId: string, foodId: string, expectedRevision: number) {
  if (!supabase) throw new DataError('Connect Supabase before archiving a food.', 'configuration');
  const { data, error } = await supabase.rpc('archive_food', {
    p_request_id: requestId,
    p_food_id: foodId,
    p_expected_revision: expectedRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
