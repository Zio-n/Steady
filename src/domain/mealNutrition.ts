import { calculateFoodPortion, type PortionFood } from './foodNutrition.ts';

export type MealComponentForCalculation = {
  foodId: string;
  food: PortionFood | null;
  amount: number;
  unit: string;
};

export type NutrientCoverage = { value: number | null; knownComponents: number; totalComponents: number; complete: boolean };
export type MealNutrition = {
  multiplier: number;
  componentCount: number;
  calories: NutrientCoverage;
  nutrients: Record<string, NutrientCoverage>;
  canLog: boolean;
};

export type MealNutritionError = 'empty_recipe' | 'invalid_multiplier' | 'food_unavailable'
  | 'component_missing' | 'invalid_amount' | 'invalid_basis' | 'incompatible_unit' | 'unknown_serving_weight' | 'numeric_overflow';
export type MealNutritionResult = { ok: true; nutrition: MealNutrition } | {
  ok: false;
  error: MealNutritionError;
  componentIndex?: number;
};

/** Sum one saved recipe without conflating unknown nutrient values with zero. */
export function calculateMealNutrition(
  components: MealComponentForCalculation[],
  fieldIds: string[],
  multiplier = 1,
): MealNutritionResult {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier >= 100_000_000) {
    return { ok: false, error: 'invalid_multiplier' };
  }
  if (components.length === 0) return { ok: false, error: 'empty_recipe' };

  const calorieValues: Array<number | null> = [];
  const nutrientValues = new Map(fieldIds.map((fieldId) => [fieldId, [] as Array<number | null>]));
  for (const [componentIndex, component] of components.entries()) {
    if (!component.foodId) return { ok: false, error: 'component_missing', componentIndex };
    if (!component.food) return { ok: false, error: 'food_unavailable', componentIndex };
    const portion = calculateFoodPortion(component.food, component.amount, component.unit);
    if (!portion.ok) return { ok: false, error: portion.reason, componentIndex };
    const calories = portion.caloriesKcal === null ? null : portion.caloriesKcal * multiplier;
    if (calories !== null && !Number.isFinite(calories)) return { ok: false, error: 'numeric_overflow', componentIndex };
    calorieValues.push(calories);
    for (const fieldId of fieldIds) {
      const value = portion.nutrients[fieldId] ?? null;
      const scaled = value === null ? null : value * multiplier;
      if (scaled !== null && !Number.isFinite(scaled)) return { ok: false, error: 'numeric_overflow', componentIndex };
      nutrientValues.get(fieldId)!.push(scaled);
    }
  }

  const coverage = (values: Array<number | null>): NutrientCoverage => {
    const known = values.filter((value): value is number => value !== null);
    const sum = known.reduce((total, value) => total + value, 0);
    return {
      value: known.length > 0 && Number.isFinite(sum) ? sum : null,
      knownComponents: known.length,
      totalComponents: values.length,
      complete: known.length === values.length,
    };
  };
  const calories = coverage(calorieValues);
  const nutrients = Object.fromEntries([...nutrientValues].map(([fieldId, values]) => [fieldId, coverage(values)]));
  if ([calories, ...Object.values(nutrients)].some((item) => item.value === null && item.knownComponents > 0)) {
    return { ok: false, error: 'numeric_overflow' };
  }
  return {
    ok: true,
    nutrition: {
      multiplier,
      componentCount: components.length,
      calories,
      nutrients,
      canLog: calories.complete && calories.value !== null,
    },
  };
}
