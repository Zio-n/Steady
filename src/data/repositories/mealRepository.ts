import type { Json } from '../database.types';
import { supabase } from '../supabaseClient';
import { DataError, toDataError } from '../dataError';

export type MealComponentInput = { food_id: string; amount: number; unit: string };
export type SavedMeal = {
  meal: import('../database.types').Tables<'meals'>;
  components: Array<MealComponentInput & { component_id: string; position: number; food: import('../database.types').Tables<'foods'> | null; nutrients: Record<string, number> }>;
};

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Load the saved-meal library and its food components without relying on live joins. */
export async function loadMeals(userId: string, search = '', limit?: number, sort: 'name' | 'recent' = 'name'): Promise<SavedMeal[]> {
  if (!supabase) throw new DataError('Connect Supabase before loading saved meals.', 'configuration');
  let mealsQuery = supabase.from('meals').select('*').eq('user_id', userId).is('archived_at', null);
  mealsQuery = sort === 'recent' ? mealsQuery.order('created_at', { ascending: false }) : mealsQuery.order('name');
  if (search.trim()) mealsQuery = mealsQuery.ilike('name', `%${escapeLike(search.trim())}%`);
  if (limit !== undefined) mealsQuery = mealsQuery.limit(Math.min(Math.max(limit, 1), 100));
  const { data: meals, error } = await mealsQuery;
  if (error) throw toDataError(error);
  if (meals.length === 0) return [];
  const { data: components, error: componentError } = await supabase.from('meal_components').select('*')
    .eq('user_id', userId).in('meal_id', meals.map((meal) => meal.id)).order('position');
  if (componentError) throw toDataError(componentError);
  const foodIds = [...new Set(components.map((component) => component.food_id))];
  const foodsResult = foodIds.length
    ? await supabase.from('foods').select('*').eq('user_id', userId).in('id', foodIds)
    : { data: [], error: null };
  if (foodsResult.error) throw toDataError(foodsResult.error);
  const foodById = new Map((foodsResult.data ?? []).map((food) => [food.id, food]));
  const nutrientsResult = foodIds.length
    ? await supabase.from('food_nutrients').select('food_id,field_id,value').eq('user_id', userId).in('food_id', foodIds)
    : { data: [], error: null };
  if (nutrientsResult.error) throw toDataError(nutrientsResult.error);
  const nutrientsByFood = new Map<string, Record<string, number>>();
  for (const nutrient of nutrientsResult.data ?? []) {
    if (nutrient.value === null) continue;
    const values = nutrientsByFood.get(nutrient.food_id) ?? {};
    values[nutrient.field_id] = nutrient.value;
    nutrientsByFood.set(nutrient.food_id, values);
  }
  const componentsByMeal = new Map<string, SavedMeal['components']>();
  for (const component of components) {
    const rows = componentsByMeal.get(component.meal_id) ?? [];
    rows.push({ ...component, food: foodById.get(component.food_id) ?? null, nutrients: nutrientsByFood.get(component.food_id) ?? {} });
    componentsByMeal.set(component.meal_id, rows);
  }
  return meals.map((meal) => ({ meal, components: componentsByMeal.get(meal.id) ?? [] }));
}

export async function loadMealEntry(userId: string, mealId: string): Promise<SavedMeal | null> {
  const meals = await loadMeals(userId);
  return meals.find((entry) => entry.meal.id === mealId) ?? null;
}

export async function saveMeal(input: {
  requestId: string;
  name: string;
  sections: string[];
  components: MealComponentInput[];
  mealId?: string;
  expectedRevision?: number;
}) {
  if (!supabase) throw new DataError('Connect Supabase before saving a meal.', 'configuration');
  const { data, error } = await supabase.rpc('save_meal', {
    p_request_id: input.requestId,
    p_name: input.name,
    p_sections: input.sections as Json,
    p_components: input.components as unknown as Json,
    p_meal_id: input.mealId,
    p_expected_revision: input.expectedRevision as number,
  });
  if (error) throw toDataError(error);
  return data;
}
