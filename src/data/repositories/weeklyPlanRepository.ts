import type { Tables } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';

export type WeeklyPlan = {
  week: Tables<'weeks'>;
  allocations: Tables<'week_allocations'>[];
  days: Tables<'days'>[];
  carryAdjustments: WeeklyCarryAdjustment[];
};

export type WeeklyCarryAdjustment = {
  destination_date: string;
  signed_delta_kcal: number;
  source_date: string;
  needs_review: boolean;
};

export type SaveWeeklyAllocationInput = {
  requestId: string;
  weekStart: string;
  expectedRevision: number;
  targets: number[];
  allocationKind: Tables<'weeks'>['allocation_kind'];
};

/** Ensure the immutable week snapshot exists, then load its allocation and dated-day state. */
export async function loadWeeklyPlan(userId: string, weekStart: string): Promise<WeeklyPlan> {
  if (!supabase) throw new DataError('Connect Supabase before loading a weekly plan.', 'configuration');
  const { error: ensureError } = await supabase.rpc('ensure_week', { p_week_start: weekStart });
  if (ensureError) throw toDataError(ensureError);

  const [weekResult, allocationResult, dayResult, carryResult] = await Promise.all([
    supabase.from('weeks').select('*').eq('user_id', userId).eq('week_start', weekStart).maybeSingle(),
    supabase.from('week_allocations').select('*').eq('user_id', userId).eq('week_start', weekStart).order('weekday'),
    supabase.from('days').select('*').eq('user_id', userId).eq('week_start', weekStart).order('local_date'),
    supabase.from('carry_allocations').select('decision_id,destination_date,signed_delta_kcal')
      .eq('user_id', userId).gte('destination_date', weekStart).lt('destination_date', addDays(weekStart, 7)),
  ]);
  if (weekResult.error) throw toDataError(weekResult.error);
  if (allocationResult.error) throw toDataError(allocationResult.error);
  if (dayResult.error) throw toDataError(dayResult.error);
  if (carryResult.error) throw toDataError(carryResult.error);
  if (!weekResult.data) throw new DataError('This weekly plan is no longer available. Refresh and try again.', 'not-found');
  if (allocationResult.data.length !== 7 || allocationResult.data.some((row, index) => row.weekday !== index + 1)) {
    throw new DataError('This weekly allocation is incomplete. Refresh before making changes.', 'conflict');
  }
  const activeTargetHundredths = allocationResult.data.reduce((sum, row) => {
    const target = weekResult.data!.allocation_kind === 'one_off' ? row.override_target_kcal ?? row.base_target_kcal : row.base_target_kcal;
    return sum + Math.round(target * 100);
  }, 0);
  if (activeTargetHundredths !== Math.round(weekResult.data.budget_kcal * 100)) {
    throw new DataError('This weekly allocation no longer matches its budget. Refresh and review it before continuing.', 'conflict');
  }
  const decisionIds = [...new Set(carryResult.data.map((row) => row.decision_id))];
  const decisionResult = decisionIds.length > 0
    ? await supabase.from('carry_decisions').select('id,source_date,state,needs_review').eq('user_id', userId).in('id', decisionIds)
    : null;
  if (decisionResult?.error) throw toDataError(decisionResult.error);
  const decisions = new Map((decisionResult?.data ?? []).map((decision) => [decision.id, decision]));
  const carryAdjustments = carryResult.data.flatMap((row) => {
    const decision = decisions.get(row.decision_id);
    return decision?.state === 'active' ? [{
      destination_date: row.destination_date,
      signed_delta_kcal: row.signed_delta_kcal,
      source_date: decision.source_date,
      needs_review: decision.needs_review,
    }] : [];
  });
  return { week: weekResult.data, allocations: allocationResult.data, days: dayResult.data, carryAdjustments };
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

/** Saves a balanced recurring weekly allocation and updates existing open-day target snapshots atomically. */
export async function saveWeeklyAllocation(input: SaveWeeklyAllocationInput) {
  if (!supabase) throw new DataError('Connect Supabase before saving a weekly allocation.', 'configuration');
  const { data, error } = await supabase.rpc('save_week_allocation', {
    p_request_id: input.requestId,
    p_week_start: input.weekStart,
    p_expected_revision: input.expectedRevision,
    p_targets: input.targets as import('../database.types').Json,
    p_allocation_kind: input.allocationKind,
  });
  if (error) throw toDataError(error);
  return data;
}
