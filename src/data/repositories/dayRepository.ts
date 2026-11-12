import type { Json } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';
import { readEatenSnapshot, readItemLogging, type EatenItemSnapshot } from '../../domain/daySummary.ts';
export type ReviseDayItemInput = {
  requestId: string;
  localDate: string;
  itemId: string;
  expectedRevision: number;
  action: 'resize' | 'remove' | 'restore';
  amount?: number;
  unit?: string;
};

export type EditCalendarFoodSnapshotInput = {
  requestId: string;
  localDate: string;
  itemId: string;
  expectedRevision: number;
  componentIndex: number;
  name: string;
  brand: string | null;
  caloriesPerBasis: number;
  nutrientsPerBasis: Record<string, number | null>;
};

export async function removePlannedDayItem(input: { requestId: string; localDate: string; itemId: string; expectedRevision: number }) {
  if (!supabase) throw new DataError('Connect Supabase before changing a plan.', 'configuration');
  const { data, error } = await supabase.rpc('remove_planned_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function restorePlannedCalendarItem(input: { requestId: string; localDate: string; itemId: string; expectedRevision: number }) {
  if (!supabase) throw new DataError('Connect Supabase before restoring a plan.', 'configuration');
  const { data, error } = await supabase.rpc('restore_planned_calendar_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function resizePlannedDayItem(input: { requestId: string; localDate: string; itemId: string; expectedRevision: number; amount: number }) {
  if (!supabase) throw new DataError('Connect Supabase before editing a planned portion.', 'configuration');
  const { data, error } = await supabase.rpc('resize_planned_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_amount: input.amount,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function loadRecentChoices(userId: string) {
  if (!supabase) throw new DataError('Connect Supabase before loading recent choices.', 'configuration');
  const { data, error } = await supabase.from('day_items')
    .select('eaten_snapshot,planned_payload,selected_amount,selected_unit')
    .eq('user_id', userId).eq('state', 'eaten').not('eaten_snapshot', 'is', null)
    .order('eaten_at', { ascending: false }).limit(50);
  if (error) throw toDataError(error);
  const seen = new Set<string>();
  const choices: Array<{
    kind: 'food' | 'meal' | 'snapshot'; id: string; name: string; amount: number; unit: string; snapshot?: EatenItemSnapshot;
  }> = [];
  for (const row of data) {
    const snapshot = readEatenSnapshot(row.eaten_snapshot);
    if (!snapshot) continue;
    const logging = readItemLogging(row);
    if (logging?.kind === 'calorie_block') continue;
    const kind = logging?.foodId ? 'food' : snapshot.source === 'food' || snapshot.source === 'meal' ? snapshot.source : 'snapshot';
    if (kind === 'snapshot' && snapshot.source !== 'one_off_food') continue;
    if (kind !== 'snapshot' && !logging?.foodId && !snapshot.source_id) continue;
    const id = logging?.foodId ?? snapshot.source_id ?? logging?.catalogueFoodId ?? snapshot.name;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      kind, id,
      name: snapshot.name,
      amount: row.selected_amount ?? snapshot.selected_amount,
      unit: row.selected_unit ?? snapshot.selected_unit,
      snapshot: kind === 'snapshot' ? { ...snapshot, logging } : undefined,
    });
    if (choices.length === 8) break;
  }
  return choices;
}

export async function reviseDayItem(input: ReviseDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before correcting a log.', 'configuration');
  const { data, error } = await supabase.rpc('revise_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_action: input.action,
    p_amount: input.amount,
    p_unit: input.unit,
  });
  if (error) throw toDataError(error);
  return data;
}

/** Saves an item-specific nutrition correction into this eaten entry's frozen snapshot. */
export async function editCalendarFoodSnapshot(input: EditCalendarFoodSnapshotInput) {
  if (!supabase) throw new DataError('Connect Supabase before editing this meal.', 'configuration');
  const { data, error } = await supabase.rpc('edit_calendar_food_snapshot', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_component_index: input.componentIndex,
    p_name: input.name,
    // The RPC normalizes an empty brand to SQL NULL.
    p_brand: input.brand ?? '',
    p_calories_per_basis: input.caloriesPerBasis,
    p_nutrients_per_basis: input.nutrientsPerBasis as Json,
  });
  if (error) throw toDataError(error);
  return data;
}
