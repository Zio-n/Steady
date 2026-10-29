import type { Json, Tables } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';
import { readEatenSnapshot, type DayItem } from '../../domain/daySummary.ts';
import { addLocalDays } from '../../domain/dates.ts';

export type DayViewData = { day: Tables<'days'> | null; items: DayItem[]; carryAdjustments: Array<{ source_date: string; signed_delta_kcal: number; needs_review: boolean }> };
export type CompleteDayInput = { requestId: string; localDate: string; expectedDayRevision: number; expectedLogRevision: number };

export type LogDayItemInput = {
  requestId: string;
  localDate: string;
  section: Tables<'day_items'>['section'];
  sourceKind: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  sourceId: string | null;
  amount: number;
  unit: string;
  manualPayload?: Record<string, unknown>;
  plannedItemId?: string;
  expectedItemRevision?: number;
};

export type PlanDayItemInput = Omit<LogDayItemInput, 'requestId' | 'plannedItemId' | 'expectedItemRevision'> & { requestId: string };
export type ReplacePlannedDayItemInput = PlanDayItemInput & { itemId: string; expectedRevision: number; expectedSourceRevision?: number; expectedSuggestionRevision?: number };
export type WholeDayShuffleChange = { itemId: string; expectedItemRevision: number; mealId: string; expectedMealRevision: number; amount: number };
export type AcceptWholeDayShuffleInput = { requestId: string; localDate: string; changes: WholeDayShuffleChange[] };

export type ReviseDayItemInput = {
  requestId: string;
  localDate: string;
  itemId: string;
  expectedRevision: number;
  action: 'resize' | 'remove' | 'restore';
  amount?: number;
  unit?: string;
};

export type ReplaceDayItemInput = {
  requestId: string;
  localDate: string;
  itemId: string;
  expectedRevision: number;
  section: Tables<'day_items'>['section'];
  sourceKind: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  sourceId: string | null;
  amount: number;
  unit: string;
  manualPayload?: Record<string, unknown>;
};

export type CorrectCompletedDayItemInput = {
  requestId: string;
  localDate: string;
  expectedDayRevision: number;
  expectedLogRevision: number;
  itemId: string;
  expectedRevision: number;
  action: 'resize' | 'remove' | 'restore' | 'replace';
  amount?: number;
  unit?: string;
  section?: Tables<'day_items'>['section'];
  sourceKind?: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  sourceId?: string | null;
  manualPayload?: Record<string, unknown>;
};

export async function loadDayView(userId: string, localDate: string): Promise<DayViewData> {
  if (!supabase) throw new DataError('Connect Supabase before loading your day.', 'configuration');
  const [dayResult, itemResult, carryResult] = await Promise.all([
    supabase.from('days').select('*').eq('user_id', userId).eq('local_date', localDate).maybeSingle(),
    supabase.from('day_items').select('id,section,state,source,selected_amount,selected_unit,planned_payload,eaten_snapshot,eaten_at,revision')
      .eq('user_id', userId).eq('local_date', localDate).neq('state', 'removed')
      .order('section').order('created_at'),
    supabase.from('carry_allocations').select('decision_id,signed_delta_kcal').eq('user_id', userId).eq('destination_date', localDate),
  ]);
  if (dayResult.error) throw toDataError(dayResult.error);
  if (itemResult.error) throw toDataError(itemResult.error);
  if (carryResult.error) throw toDataError(carryResult.error);
  const decisionIds = [...new Set(carryResult.data.map((entry) => entry.decision_id))];
  const decisionsResult = decisionIds.length > 0
    ? await supabase.from('carry_decisions').select('id,source_date,state,needs_review').eq('user_id', userId).in('id', decisionIds)
    : null;
  if (decisionsResult?.error) throw toDataError(decisionsResult.error);
  const decisions = new Map((decisionsResult?.data ?? []).map((decision) => [decision.id, decision]));
  const carryAdjustments = carryResult.data.flatMap((entry) => {
    const decision = decisions.get(entry.decision_id);
    return decision?.state === 'active' ? [{ source_date: decision.source_date, signed_delta_kcal: entry.signed_delta_kcal, needs_review: decision.needs_review }] : [];
  });
  return { day: dayResult.data, items: itemResult.data, carryAdjustments };
}

/** Materializes a target snapshot even when the date has no recurring routine. */
export async function ensureDaySnapshot(localDate: string) {
  if (!supabase) throw new DataError('Connect Supabase before loading this day.', 'configuration');
  const { data, error } = await supabase.rpc('ensure_day_snapshot', { p_local_date: localDate });
  if (error) throw toDataError(error);
  return data;
}

/** Explicitly freezes the day's target and eaten-only calorie total. Planned items stay planned. */
export async function completeDay(input: CompleteDayInput) {
  if (!supabase) throw new DataError('Connect Supabase before completing this day.', 'configuration');
  const { data, error } = await supabase.rpc('complete_day', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_expected_day_revision: input.expectedDayRevision,
    p_expected_log_revision: input.expectedLogRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

/** Logs a reviewed choice and lets PostgreSQL calculate the authoritative snapshot. */
export async function logDayItem(input: LogDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before logging food.', 'configuration');
  const { data, error } = await supabase.rpc('log_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId as string,
    p_amount: input.amount,
    p_unit: input.unit,
    p_manual_payload: input.manualPayload as Json | undefined,
    p_planned_item_id: input.plannedItemId,
    p_expected_item_revision: input.expectedItemRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function planDayItem(input: PlanDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before planning food.', 'configuration');
  const { data, error } = await supabase.rpc('plan_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId as string,
    p_amount: input.amount,
    p_unit: input.unit,
    p_manual_payload: input.manualPayload as Json | undefined,
  });
  if (error) throw toDataError(error);
  return data;
}

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

export async function replacePlannedDayItem(input: ReplacePlannedDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before changing a plan.', 'configuration');
  if (input.expectedSourceRevision !== undefined && input.expectedSuggestionRevision !== undefined && input.sourceKind === 'meal' && input.sourceId) {
    const { data, error } = await supabase.rpc('use_shuffle_suggestion', {
      p_request_id: input.requestId,
      p_local_date: input.localDate,
      p_item_id: input.itemId,
      p_expected_item_revision: input.expectedRevision,
      p_expected_suggestion_revision: input.expectedSuggestionRevision,
      p_meal_id: input.sourceId,
      p_expected_meal_revision: input.expectedSourceRevision,
    });
    if (error) throw toDataError(error);
    return data;
  }
  const { data, error } = await supabase.rpc('replace_planned_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId as string,
    p_amount: input.amount,
    p_unit: input.unit,
    p_manual_payload: input.manualPayload as Json | undefined,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function loadRoutineShuffleSuggestion(userId: string, localDate: string, itemId: string) {
  if (!supabase) throw new DataError('Connect Supabase before loading this Shuffle suggestion.', 'configuration');
  const { data, error } = await supabase.from('routine_shuffle_suggestions').select('*')
    .eq('user_id', userId).eq('local_date', localDate).eq('day_item_id', itemId).maybeSingle();
  if (error) throw toDataError(error);
  return data;
}

export async function saveRoutineShuffleSuggestion(input: {
  requestId: string;
  localDate: string;
  itemId: string;
  expectedItemRevision: number;
  expectedSuggestionRevision: number;
  mealId: string;
  expectedMealRevision: number;
}) {
  if (!supabase) throw new DataError('Connect Supabase before saving this Shuffle suggestion.', 'configuration');
  const { data, error } = await supabase.rpc('save_routine_shuffle_suggestion', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedItemRevision,
    p_expected_suggestion_revision: input.expectedSuggestionRevision,
    p_meal_id: input.mealId,
    p_expected_meal_revision: input.expectedMealRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

/** Accepts every reviewed whole-day replacement in one database transaction. */
export async function acceptWholeDayShuffle(input: AcceptWholeDayShuffleInput) {
  if (!supabase) throw new DataError('Connect Supabase before accepting a whole-day preview.', 'configuration');
  const { data, error } = await supabase.rpc('accept_whole_day_shuffle', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_changes: input.changes.map((change) => ({
      item_id: change.itemId,
      expected_item_revision: change.expectedItemRevision,
      meal_id: change.mealId,
      expected_meal_revision: change.expectedMealRevision,
      amount: change.amount,
    })) as Json,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function loadRecentChoices(userId: string) {
  if (!supabase) throw new DataError('Connect Supabase before loading recent choices.', 'configuration');
  const { data, error } = await supabase.from('day_items')
    .select('eaten_snapshot,selected_amount,selected_unit')
    .eq('user_id', userId).eq('state', 'eaten').not('eaten_snapshot', 'is', null)
    .order('eaten_at', { ascending: false }).limit(50);
  if (error) throw toDataError(error);
  const seen = new Set<string>();
  const choices = [] as Array<{ kind: 'food' | 'meal'; id: string; name: string; amount: number; unit: string }>;
  for (const row of data) {
    const snapshot = readEatenSnapshot(row.eaten_snapshot);
    if (!snapshot || (snapshot.source !== 'food' && snapshot.source !== 'meal') || !snapshot.source_id) continue;
    const key = `${snapshot.source}:${snapshot.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      kind: snapshot.source,
      id: snapshot.source_id,
      name: snapshot.name,
      amount: row.selected_amount ?? snapshot.selected_amount,
      unit: row.selected_unit ?? snapshot.selected_unit,
    });
    if (choices.length === 8) break;
  }
  return choices;
}

/** Distinct saved meals used or selected during the preceding seven account-local dates. */
export async function loadRecentShuffleMealIds(userId: string, localDate: string) {
  if (!supabase) throw new DataError('Connect Supabase before loading recent meals.', 'configuration');
  const fromDate = addLocalDays(localDate, -7);
  const { data, error } = await supabase.from('day_items')
    .select('state,planned_payload,eaten_snapshot')
    .eq('user_id', userId).gte('local_date', fromDate).lt('local_date', localDate)
    .in('state', ['planned', 'eaten']);
  if (error) throw toDataError(error);
  const mealIds = new Set<string>();
  for (const row of data) {
    if (row.state === 'eaten') {
      const snapshot = readEatenSnapshot(row.eaten_snapshot);
      if (snapshot?.source === 'meal' && snapshot.source_id) mealIds.add(snapshot.source_id);
      continue;
    }
    const payload = row.planned_payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)
      && payload.source_kind === 'meal' && typeof payload.source_id === 'string') mealIds.add(payload.source_id);
  }
  return [...mealIds];
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

/** Atomically replaces an eaten entry and captures current source nutrition. */
export async function replaceDayItem(input: ReplaceDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before replacing a log.', 'configuration');
  const { data, error } = await supabase.rpc('replace_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId as string,
    p_amount: input.amount,
    p_unit: input.unit,
    p_manual_payload: input.manualPayload as Json | undefined,
  });
  if (error) throw toDataError(error);
  return data;
}

/** Corrects a completed log while preserving its frozen completion target. */
export async function correctCompletedDayItem(input: CorrectCompletedDayItemInput) {
  if (!supabase) throw new DataError('Connect Supabase before correcting a completed day.', 'configuration');
  const { data, error } = await supabase.rpc('correct_completed_day_item', {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_expected_day_revision: input.expectedDayRevision,
    p_expected_log_revision: input.expectedLogRevision,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_action: input.action,
    p_amount: input.amount,
    p_unit: input.unit,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId as string | undefined,
    p_manual_payload: input.manualPayload as Json | undefined,
  });
  if (error) throw toDataError(error);
  return data;
}
