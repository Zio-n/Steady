import type { Json, Tables } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';
import type { DayItem } from '../../domain/daySummary';

export type CalendarTarget = {
  caloriesKcal: number | null;
  nutrients: Json;
  source: 'completed_snapshot' | 'profile_version' | 'unset';
};
export type CalendarDay = {
  localDate: string;
  day: Tables<'days'> | null;
  target: CalendarTarget;
  items: DayItem[];
};
export type CalendarChoice = {
  requestId: string;
  localDate: string;
  section: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unlabelled';
  sourceKind: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  sourceId: string | null;
  amount: number;
  unit: string;
  manualPayload?: Record<string, unknown>;
  plannedItemId?: string;
  expectedItemRevision?: number;
};

function record(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseCalendarDay(data: Json, localDate: string): CalendarDay {
  const row = record(data);
  const target = record(row?.target);
  if (!row || row.local_date !== localDate || !target || !Array.isArray(row.items)
    || !['completed_snapshot', 'profile_version', 'unset'].includes(String(target.source))) {
    throw new DataError('The calendar response was incomplete. Refresh this date.', 'unknown');
  }
  return {
    localDate,
    day: row.day === null ? null : row.day as unknown as Tables<'days'>,
    target: {
      caloriesKcal: typeof target.calories_kcal === 'number' ? target.calories_kcal : null,
      nutrients: target.nutrients ?? {},
      source: target.source as CalendarTarget['source'],
    },
    items: row.items as unknown as DayItem[],
  };
}

export async function readCalendarDay(localDate: string): Promise<CalendarDay> {
  if (!supabase) throw new DataError('Connect Supabase before loading your calendar.', 'configuration');
  const { data, error } = await supabase.rpc('read_calendar_day', { p_local_date: localDate });
  if (error) throw toDataError(error);
  return parseCalendarDay(data, localDate);
}

export async function readCalendarRange(fromDate: string, toDate: string): Promise<CalendarDay[]> {
  if (!supabase) throw new DataError('Connect Supabase before loading your calendar.', 'configuration');
  const { data, error } = await supabase.rpc('read_calendar_range', { p_from_date: fromDate, p_to_date: toDate });
  if (error) throw toDataError(error);
  if (!Array.isArray(data)) throw new DataError('The calendar range response was incomplete. Refresh this view.', 'unknown');
  return data.map((row) => {
    const rowRecord = record(row);
    const localDate = rowRecord?.local_date;
    if (typeof localDate !== 'string') throw new DataError('A calendar date was missing from the range. Refresh this view.', 'unknown');
    return parseCalendarDay(row, localDate);
  });
}

function choiceArgs(input: CalendarChoice) {
  return {
    p_request_id: input.requestId,
    p_local_date: input.localDate,
    p_section: input.section,
    p_source_kind: input.sourceKind,
    // The SQL argument accepts NULL for one-off choices; generated types omit that nullability.
    p_source_id: input.sourceId as string,
    p_amount: input.amount,
    p_unit: input.unit,
    p_manual_payload: input.manualPayload as Json | undefined,
  };
}

export async function planCalendarItem(input: CalendarChoice) {
  if (!supabase) throw new DataError('Connect Supabase before planning a meal.', 'configuration');
  const { data, error } = await supabase.rpc('calendar_plan_day_item', choiceArgs(input));
  if (error) throw toDataError(error);
  return data;
}

export async function logCalendarItem(input: CalendarChoice) {
  if (!supabase) throw new DataError('Connect Supabase before logging a meal.', 'configuration');
  const { data, error } = await supabase.rpc('calendar_log_day_item', {
    ...choiceArgs(input),
    p_planned_item_id: input.plannedItemId,
    p_expected_item_revision: input.expectedItemRevision,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function transferCalendarPlan(input: {
  requestId: string; fromDate: string; toDate: string; itemId: string; expectedRevision: number; action: 'copy' | 'move';
}) {
  if (!supabase) throw new DataError('Connect Supabase before changing a plan date.', 'configuration');
  const { data, error } = await supabase.rpc('transfer_calendar_plan', {
    p_request_id: input.requestId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedRevision,
    p_action: input.action,
  });
  if (error) throw toDataError(error);
  return data;
}
