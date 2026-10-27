import type { Json, Tables } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';

export type SavedCarryDecision = Pick<Tables<'carry_decisions'>,
  'id' | 'source_date' | 'source_log_revision' | 'completed_target_kcal' | 'actual_kcal' | 'difference_kcal' | 'action' | 'amount_kcal' | 'state' | 'needs_review' | 'created_at'
> & { allocations: Array<Pick<Tables<'carry_allocations'>, 'destination_date' | 'signed_delta_kcal' | 'destination_revision'>> };

export type SaveCarryDecisionInput = {
  requestId: string;
  sourceDate: string;
  expectedSourceRevision: number;
  expectedLogRevision: number;
  weekStart: string;
  expectedWeekRevision: number;
  action: Tables<'carry_decisions'>['action'];
  amountKcal: number;
  allocations: Array<{ destinationDate: string; signedDeltaKcal: number; expectedRevision: number }>;
};

export type ReverseCarryDecisionInput = {
  requestId: string;
  decisionId: string;
  expectedWeekRevision: number;
  expectedRevisions: Array<{ destinationDate: string; expectedRevision: number }>;
};

export async function loadCarryDecisions(userId: string, sourceDate: string): Promise<SavedCarryDecision[]> {
  if (!supabase) throw new DataError('Connect Supabase before loading carry history.', 'configuration');
  const { data: decisions, error } = await supabase.from('carry_decisions').select('*')
    .eq('user_id', userId).eq('source_date', sourceDate).order('created_at');
  if (error) throw toDataError(error);
  if (decisions.length === 0) return [];
  const { data: allocations, error: allocationError } = await supabase.from('carry_allocations')
    .select('decision_id,destination_date,signed_delta_kcal,destination_revision')
    .eq('user_id', userId).in('decision_id', decisions.map((decision) => decision.id)).order('destination_date');
  if (allocationError) throw toDataError(allocationError);
  return decisions.map((decision) => ({ ...decision,
    allocations: allocations.filter((allocation) => allocation.decision_id === decision.id)
      .map((allocation) => ({ destination_date: allocation.destination_date,
        signed_delta_kcal: allocation.signed_delta_kcal, destination_revision: allocation.destination_revision })),
  }));
}

export async function saveCarryDecision(input: SaveCarryDecisionInput) {
  if (!supabase) throw new DataError('Connect Supabase before saving this carry choice.', 'configuration');
  const { data, error } = await supabase.rpc('save_carry_decision', {
    p_request_id: input.requestId,
    p_source_date: input.sourceDate,
    p_expected_source_revision: input.expectedSourceRevision,
    p_expected_log_revision: input.expectedLogRevision,
    p_week_start: input.weekStart,
    p_expected_week_revision: input.expectedWeekRevision,
    p_action: input.action,
    p_amount_kcal: input.amountKcal,
    p_allocations: input.allocations.map((allocation) => ({
      destination_date: allocation.destinationDate,
      signed_delta_kcal: allocation.signedDeltaKcal,
      expected_revision: allocation.expectedRevision,
    })) as Json,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function reverseCarryDecision(input: ReverseCarryDecisionInput) {
  if (!supabase) throw new DataError('Connect Supabase before reversing this carry choice.', 'configuration');
  const { data, error } = await supabase.rpc('reverse_carry_decision', {
    p_request_id: input.requestId,
    p_decision_id: input.decisionId,
    p_expected_week_revision: input.expectedWeekRevision,
    p_expected_revisions: input.expectedRevisions.map((revision) => ({
      destination_date: revision.destinationDate,
      expected_revision: revision.expectedRevision,
    })) as Json,
  });
  if (error) throw toDataError(error);
  return data;
}
