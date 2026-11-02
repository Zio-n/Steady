import type { Tables, TablesInsert } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';

export type FoodPortionPreference = Pick<Tables<'user_food_portion_preferences'>, 'food_kind' | 'food_id' | 'amount' | 'unit'>;
export type PortionPreferenceKey = `library:${string}` | `catalogue:${string}`;
export type FoodPortionPreferences = Partial<Record<PortionPreferenceKey, { amount: string; unit: string }>>;

export async function loadFoodPortionPreferences(userId: string): Promise<FoodPortionPreferences> {
  if (!supabase) throw new DataError('Connect Supabase before loading saved portions.', 'configuration');
  const { data, error } = await supabase.from('user_food_portion_preferences')
    .select('food_kind,food_id,amount,unit').eq('user_id', userId);
  if (error) throw toDataError(error);
  return Object.fromEntries(data.map((entry) => [
    `${entry.food_kind}:${entry.food_id}`,
    { amount: String(entry.amount), unit: entry.unit },
  ])) as FoodPortionPreferences;
}

export type AddedFoodPortion = {
  sourceKind: string;
  sourceId: string | null;
  amount: number;
  unit: string;
  manualPayload?: Record<string, unknown>;
};

/** Saves last-used portions only after the corresponding log or plan was committed. */
export async function rememberAddedFoodPortions(userId: string, entries: AddedFoodPortion[]) {
  if (!supabase) throw new DataError('Connect Supabase before saving portion preferences.', 'configuration');
  const preferences = new Map<string, TablesInsert<'user_food_portion_preferences'>>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0 || !entry.unit.trim()) continue;
    if (entry.sourceKind === 'food' && entry.sourceId) {
      preferences.set(`library:${entry.sourceId}`, {
        user_id: userId, food_kind: 'library', food_id: entry.sourceId,
        amount: entry.amount, unit: entry.unit.trim(),
      });
    } else if (entry.sourceKind === 'one_off_food' && typeof entry.manualPayload?.catalogueFoodId === 'string') {
      const foodId = entry.manualPayload.catalogueFoodId;
      preferences.set(`catalogue:${foodId}`, {
        user_id: userId, food_kind: 'catalogue', food_id: foodId,
        amount: entry.amount, unit: entry.unit.trim(),
      });
    }
  }
  if (preferences.size === 0) return;
  const { error } = await supabase.from('user_food_portion_preferences')
    .upsert([...preferences.values()], { onConflict: 'user_id,food_kind,food_id' });
  if (error) throw toDataError(error);
}
