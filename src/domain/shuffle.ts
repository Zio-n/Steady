export type ShuffleCandidate = {
  mealId: string;
  name: string;
  active: boolean;
  sections: readonly string[];
  hasValidComponents: boolean;
  caloriesKcal: number | null;
  nutrients: Readonly<Record<string, number | null>>;
  portionMultiplier: number;
  revision: number;
};

export type ShuffleContext = {
  section: string;
  seed: string;
  remainingCaloriesKcal: number;
  remainingSlots: number;
  proteinFieldId?: string;
  remainingProtein?: number | null;
  remainingNutrients: Readonly<Record<string, number | null>>;
  recentMealIds: readonly string[];
  sameDayMealIds: readonly string[];
};

export type RankedShuffleCandidate = {
  candidate: ShuffleCandidate;
  projectedCaloriesKcal: number;
  calorieFit: number;
  proteinShortfall: number | null;
  nutrientOvershootPenalty: number;
  recentPenalty: number;
  repeatsToday: boolean;
  usedRecently: boolean;
};

export type WholeDayShuffleSlot = { itemId: string; section: string; amount: number; position: number };
export type WholeDayShuffleContext = {
  seed: string;
  targetCaloriesKcal: number;
  currentCaloriesKcal: number;
  currentCaloriesComplete: boolean;
  proteinFieldId?: string;
  targetNutrients: Readonly<Record<string, number>>;
  currentNutrients: Readonly<Record<string, number | null>>;
  completeNutrients: Readonly<Record<string, boolean>>;
  recentMealIds: readonly string[];
  sameDayMealIds: readonly string[];
};
export type WholeDayShuffleSuggestion = {
  slot: WholeDayShuffleSlot;
  ranked: RankedShuffleCandidate | null;
  projectedCaloriesKcal: number;
  projectedNutrients: Record<string, number | null>;
};
export type ShufflePoolCounts = { activeMeals: number; sectionTagged: number; scorable: number };

/** Explain why an otherwise empty Shuffle result has no usable saved meal. */
export function shufflePoolMessage(sectionName: string, pool: ShufflePoolCounts) {
  if (pool.activeMeals === 0) return 'Save an active meal in Library first. Shuffle needs a saved recipe with known calories.';
  if (pool.sectionTagged === 0) return `No active saved meal is tagged for ${sectionName}. Add that section tag in Library or choose manually.`;
  if (pool.scorable === 0) return `Your ${sectionName} meals need a valid recipe with known calories before Shuffle can suggest them. Review their ingredients and nutrition in Library.`;
  return null;
}

/** Preserve a saved-meal/routine serving choice; unrelated food units become the meal's one-serving default. */
export function defaultShuffleReplacementAmount(source: string, sourceKind: string | null, amount: number | null, unit: string | null) {
  const servingUnit = unit?.trim().toLowerCase() === 'serving' || unit?.trim().toLowerCase() === 'servings';
  return servingUnit && Number.isFinite(amount) && amount !== null && amount > 0
    && (source === 'routine' || sourceKind === 'meal') ? amount : 1;
}

const RECENT_LOOKBACK_LOCAL_DAYS = 7;
const NUTRIENT_OVERSHOOT_WEIGHT = 0.08;
const RECENT_REPETITION_PENALTY = 0.12;
const SAME_DAY_REPETITION_PENALTY = 0.25;

/**
 * Filter and deterministically rank saved meals for a single slot.
 * Calorie fit is primary; known protein shortfall breaks close ties. Nutrient
 * overshoot and recent use are soft penalties. Missing nutrient data is ignored.
 */
export function rankShuffleCandidates(candidates: readonly ShuffleCandidate[], context: ShuffleContext): RankedShuffleCandidate[] {
  if (!context.section.trim() || !context.seed || !Number.isFinite(context.remainingCaloriesKcal)
    || !Number.isInteger(context.remainingSlots) || context.remainingSlots < 1) return [];

  const eligible = candidates.filter((candidate) => candidate.active
    && candidate.hasValidComponents
    && candidate.sections.includes(context.section)
    && candidate.mealId.length > 0
    && Number.isInteger(candidate.revision) && candidate.revision > 0
    && Number.isFinite(candidate.portionMultiplier) && candidate.portionMultiplier > 0
    && candidate.caloriesKcal !== null && Number.isFinite(candidate.caloriesKcal) && candidate.caloriesKcal >= 0);
  const sameDayIds = new Set(context.sameDayMealIds);
  const distinctToday = eligible.filter((candidate) => !sameDayIds.has(candidate.mealId));
  const avoidsSameDayDuplicates = distinctToday.length > 0;
  const recentIds = new Set(context.recentMealIds);
  const targetCalories = Math.max(0, context.remainingCaloriesKcal) / context.remainingSlots;
  const calorieScale = Math.max(targetCalories, 250);

  const ranked = (avoidsSameDayDuplicates ? distinctToday : eligible).map((candidate): RankedShuffleCandidate => {
    const calories = candidate.caloriesKcal! * candidate.portionMultiplier;
    const nutrients = candidate.nutrients;
    let overshootPenalty = 0;
    for (const [fieldId, remaining] of Object.entries(context.remainingNutrients)) {
      if (fieldId === context.proteinFieldId || remaining === null || !Number.isFinite(remaining) || remaining < 0) continue;
      const amount = nutrients[fieldId];
      if (amount === null || amount === undefined || !Number.isFinite(amount) || amount < 0) continue;
      const scaledAmount = amount * candidate.portionMultiplier;
      const overshoot = Math.max(0, scaledAmount - remaining);
      if (overshoot > 0) overshootPenalty += Math.min(5, overshoot / Math.max(remaining, 1)) * NUTRIENT_OVERSHOOT_WEIGHT;
    }

    const proteinRemaining = context.remainingProtein;
    const proteinValue = context.proteinFieldId ? nutrients[context.proteinFieldId] : null;
    const proteinShortfall = proteinRemaining != null && Number.isFinite(proteinRemaining) && proteinRemaining >= 0
      && proteinValue != null && Number.isFinite(proteinValue) && proteinValue >= 0
      ? Math.max(0, proteinRemaining - proteinValue * candidate.portionMultiplier)
      : null;
    const repeatsToday = sameDayIds.has(candidate.mealId);
    const usedRecently = recentIds.has(candidate.mealId);
    return {
      candidate,
      projectedCaloriesKcal: calories,
      calorieFit: Math.abs(calories - targetCalories) / calorieScale + overshootPenalty
        + (usedRecently ? RECENT_REPETITION_PENALTY : 0)
        + (repeatsToday ? SAME_DAY_REPETITION_PENALTY : 0),
      proteinShortfall,
      nutrientOvershootPenalty: overshootPenalty,
      recentPenalty: (usedRecently ? RECENT_REPETITION_PENALTY : 0) + (repeatsToday ? SAME_DAY_REPETITION_PENALTY : 0),
      repeatsToday,
      usedRecently,
    };
  });

  return ranked.sort((left, right) => left.calorieFit - right.calorieFit
    || compareProteinShortfall(left.proteinShortfall, right.proteinShortfall)
    || seededOrder(context.seed, left.candidate.mealId) - seededOrder(context.seed, right.candidate.mealId)
    || left.candidate.mealId.localeCompare(right.candidate.mealId));
}

/** Pick sequentially against updated day totals; selection order is section, position, then stable slot ID. */
export function previewWholeDayShuffle(
  slots: readonly WholeDayShuffleSlot[],
  candidates: readonly ShuffleCandidate[],
  context: WholeDayShuffleContext,
): { suggestions: WholeDayShuffleSuggestion[]; projectedCaloriesKcal: number; caloriesComplete: boolean; projectedNutrients: Record<string, number | null>; completeNutrients: Record<string, boolean> } {
  const sectionOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
  const orderedSlots = [...slots].sort((left, right) => sectionOrder.indexOf(left.section) - sectionOrder.indexOf(right.section)
    || left.position - right.position || left.itemId.localeCompare(right.itemId));
  let projectedCaloriesKcal = context.currentCaloriesKcal;
  let caloriesComplete = context.currentCaloriesComplete;
  const projectedNutrients = { ...context.currentNutrients };
  const completeNutrients = { ...context.completeNutrients };
  const sameDayMealIds = new Set(context.sameDayMealIds);
  const suggestions: WholeDayShuffleSuggestion[] = [];

  for (const [index, slot] of orderedSlots.entries()) {
    const remainingNutrients = Object.fromEntries(Object.entries(context.targetNutrients).map(([fieldId, target]) => [
      fieldId,
      completeNutrients[fieldId] && projectedNutrients[fieldId] !== null && projectedNutrients[fieldId] !== undefined
        ? Math.max(0, target - projectedNutrients[fieldId]!)
        : null,
    ]));
    const ranked = rankShuffleCandidates(candidates.map((candidate) => ({ ...candidate, portionMultiplier: slot.amount })), {
      section: slot.section,
      seed: context.seed + ':' + slot.itemId + ':0',
      remainingCaloriesKcal: context.targetCaloriesKcal - projectedCaloriesKcal,
      remainingSlots: Math.max(orderedSlots.length - index, 1),
      proteinFieldId: context.proteinFieldId,
      remainingProtein: context.proteinFieldId ? remainingNutrients[context.proteinFieldId] ?? null : null,
      remainingNutrients,
      recentMealIds: context.recentMealIds,
      sameDayMealIds: [...sameDayMealIds],
    });
    const chosen = ranked[0] ?? null;
    if (chosen) {
      projectedCaloriesKcal += chosen.projectedCaloriesKcal;
      sameDayMealIds.add(chosen.candidate.mealId);
      for (const fieldId of Object.keys(context.targetNutrients)) {
        const value = chosen.candidate.nutrients[fieldId];
        if (value === null || value === undefined || !Number.isFinite(value)) completeNutrients[fieldId] = false;
        else projectedNutrients[fieldId] = (projectedNutrients[fieldId] ?? 0) + value * slot.amount;
      }
    } else {
      caloriesComplete = false;
    }
    suggestions.push({ slot, ranked: chosen, projectedCaloriesKcal, projectedNutrients: { ...projectedNutrients } });
  }

  return { suggestions, projectedCaloriesKcal, caloriesComplete, projectedNutrients, completeNutrients };
}

export const shuffleDefaults = {
  recentLookbackLocalDays: RECENT_LOOKBACK_LOCAL_DAYS,
  nutrientOvershootWeight: NUTRIENT_OVERSHOOT_WEIGHT,
  recentRepetitionPenalty: RECENT_REPETITION_PENALTY,
  sameDayRepetitionPenalty: SAME_DAY_REPETITION_PENALTY,
} as const;

function compareProteinShortfall(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function seededOrder(seed: string, mealId: string) {
  let hash = 2166136261;
  for (const character of `${seed}:${mealId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
