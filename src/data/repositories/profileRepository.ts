import type { Json, Tables } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';
import { savedNutrientMatches } from '../../domain/nutrientCreate';

export type Profile = Tables<'profiles'>;
export type NutrientField = Tables<'nutrient_fields'>;
export type ProfileTargetVersion = Tables<'profile_target_versions'>;
export type WeeklyPattern = {
  version: Tables<'weekly_pattern_versions'>;
  days: Tables<'weekly_pattern_days'>[];
};
export type ProfileBundle = {
  profile: Profile;
  nutrientFields: NutrientField[];
  targetVersions: ProfileTargetVersion[];
  weeklyPatterns: WeeklyPattern[];
};

export async function loadProfile(userId: string): Promise<ProfileBundle | null> {
  if (!supabase) throw new DataError('Connect Supabase before loading your profile.', 'configuration');

  const [profileResult, fieldsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('nutrient_fields').select('*').eq('user_id', userId).is('archived_at', null)
      .order('display_order', { ascending: true }).order('name', { ascending: true }),
  ]);
  if (profileResult.error) throw toDataError(profileResult.error);
  if (fieldsResult.error) throw toDataError(fieldsResult.error);
  if (!profileResult.data) return null;

  const { data: targets, error: targetError } = await supabase.from('profile_target_versions')
    .select('*').eq('user_id', userId).order('effective_from', { ascending: true });
  if (targetError) throw toDataError(targetError);
  const { data: versions, error: patternError } = await supabase.from('weekly_pattern_versions')
    .select('*').eq('user_id', userId).order('effective_week_start', { ascending: true });
  if (patternError) throw toDataError(patternError);
  const patternIds = versions.map((version) => version.id);
  const daysResult = patternIds.length
    ? await supabase.from('weekly_pattern_days').select('*').eq('user_id', userId).in('pattern_version_id', patternIds)
    : { data: [], error: null };
  if (daysResult.error) throw toDataError(daysResult.error);
  const weeklyPatterns = versions.map((version) => ({
    version,
    days: daysResult.data.filter((day) => day.pattern_version_id === version.id)
      .sort((left, right) => left.weekday - right.weekday),
  }));
  return { profile: profileResult.data, nutrientFields: fieldsResult.data, targetVersions: targets, weeklyPatterns };
}

export type CompleteOnboardingInput = {
  requestId: string;
  timezone: string;
  baseDailyTargetKcal: number;
  displayedFields: string[];
  nutrientTargets: Record<string, number>;
};

export async function completeCalendarSetup(input: { requestId: string; timezone: string; targetKcal: number | null }) {
  if (!supabase) throw new DataError('Connect Supabase before saving your profile.', 'configuration');
  const { data, error } = await supabase.rpc('complete_calendar_setup', {
    p_request_id: input.requestId,
    p_timezone: input.timezone,
    // The SQL argument is nullable; generated function argument types omit nullability.
    p_target_kcal: input.targetKcal as number,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function saveCalendarTargets(input: {
  requestId: string;
  effectiveFrom: string;
  baseDailyTargetKcal: number | null;
  nutrientTargets: Record<string, number>;
}) {
  if (!supabase) throw new DataError('Connect Supabase before saving targets.', 'configuration');
  const { data, error } = await supabase.rpc('save_calendar_targets', {
    p_request_id: input.requestId,
    p_effective_from: input.effectiveFrom,
    p_base_daily_target_kcal: input.baseDailyTargetKcal as number,
    p_nutrient_targets: input.nutrientTargets as unknown as Json,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function completeProfileOnboarding(input: CompleteOnboardingInput) {
  if (!supabase) throw new DataError('Connect Supabase before saving your profile.', 'configuration');
  const { data, error } = await supabase.rpc('complete_profile_onboarding', {
    p_request_id: input.requestId,
    p_timezone: input.timezone,
    p_base_daily_target_kcal: input.baseDailyTargetKcal,
    p_displayed_fields: input.displayedFields as unknown as Json,
    p_nutrient_targets: input.nutrientTargets as unknown as Json,
  });
  if (error) throw toDataError(error);
  return data;
}

export async function createCustomNutrient(userId: string, fieldId: string, name: string, unit: string, displayOrder: number) {
  if (!supabase) throw new DataError('Connect Supabase before adding a nutrient.', 'configuration');
  const { data, error } = await supabase.from('nutrient_fields').insert({
    user_id: userId,
    field_id: fieldId,
    name: name.trim(),
    unit: unit.trim(),
    standard_key: null,
    display_order: displayOrder,
  }).select('*').single();
  if (error) {
    // The insert may have committed even when its response was lost. A retry
    // uses the same field ID, so reconcile that exact account-owned row.
    const { data: saved } = await supabase.from('nutrient_fields').select('*')
      .eq('user_id', userId).eq('field_id', fieldId).maybeSingle();
    if (savedNutrientMatches({ fieldId, name, unit }, saved)) return saved!;
    throw toDataError(error);
  }
  return data;
}

export async function updateNutrientField(
  userId: string,
  fieldId: string,
  changes: Pick<NutrientField, 'name' | 'is_displayed' | 'display_order'>,
) {
  if (!supabase) throw new DataError('Connect Supabase before updating nutrients.', 'configuration');
  const { data, error } = await supabase.from('nutrient_fields').update(changes)
    .eq('user_id', userId).eq('field_id', fieldId).is('archived_at', null).select('*').single();
  if (error) throw toDataError(error);
  return data;
}

export async function archiveCustomNutrient(userId: string, fieldId: string) {
  if (!supabase) throw new DataError('Connect Supabase before archiving a nutrient.', 'configuration');
  const { error } = await supabase.from('nutrient_fields').update({ archived_at: new Date().toISOString(), is_displayed: false })
    .eq('user_id', userId).eq('field_id', fieldId).is('archived_at', null);
  if (error) throw toDataError(error);
}

export async function reorderNutrientFields(fieldIds: string[]) {
  if (!supabase) throw new DataError('Connect Supabase before reordering nutrients.', 'configuration');
  const { error } = await supabase.rpc('reorder_nutrient_fields', {
    p_ordered_field_ids: fieldIds as unknown as Json,
  });
  if (error) throw toDataError(error);
}

export type SaveProfileTargetsInput = {
  requestId: string;
  expectedRevision: number;
  baseDailyTargetKcal: number;
  nutrientTargets: Record<string, number>;
  allocationStrategy: 'proportional' | 'equal' | null;
};

export async function saveProfileTargets(input: SaveProfileTargetsInput) {
  if (!supabase) throw new DataError('Connect Supabase before saving target changes.', 'configuration');
  const { data, error } = await supabase.rpc('save_profile_targets', {
    p_request_id: input.requestId,
    p_expected_revision: input.expectedRevision,
    p_base_daily_target_kcal: input.baseDailyTargetKcal,
    p_nutrient_targets: input.nutrientTargets as unknown as Json,
    p_allocation_strategy: input.allocationStrategy ?? undefined,
  });
  if (error) throw toDataError(error);
  return data;
}
