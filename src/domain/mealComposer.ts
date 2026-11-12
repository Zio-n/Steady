import { calculateFoodPortion, type PortionFood } from './foodNutrition.ts';
import { isValidCalorie, isValidNutrient, isValidQuantity } from './numericLimits.ts';

export type ValueCertainty = 'estimated' | 'provided';
export type ValueDetail = { certainty?: ValueCertainty; source?: string; unit?: string };
export type PortionOption = { unit: string; ratio: number; assumption?: string };
export type LoggingDetails = {
  kind?: 'calorie_block';
  foodId?: string;
  catalogueFoodId?: string;
  values: Record<string, ValueDetail>;
  assumption?: string;
  portions?: PortionOption[];
  position?: number;
};
export type DraftFood = {
  key: string;
  name: string;
  brand: string | null;
  amount: string;
  unit: string;
  basis: PortionFood;
  portions: PortionOption[];
  details: LoggingDetails;
  inputs: Record<string, string>;
  remember: boolean;
};

export const CALORIES = 'caloriesKcal';
export const formatNutrition = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
export const roundQuantity = (value: number) => Number(value.toFixed(4));

export function portionOptions(basis: PortionFood, defaultUnit: string): PortionOption[] {
  return [...new Set([defaultUnit, basis.basisUnit, 'g', 'kg', 'ml', 'l', 'serving'])].flatMap((unit) => {
    const result = calculateFoodPortion(basis, 1, unit);
    return result.ok ? [{ unit, ratio: result.multiplier }] : [];
  });
}

export function readLoggingDetails(raw: unknown): LoggingDetails | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const data = raw as Record<string, unknown>;
  const values: LoggingDetails['values'] = {};
  if (data.values && typeof data.values === 'object' && !Array.isArray(data.values)) {
    for (const [key, entry] of Object.entries(data.values)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const { certainty, source, unit } = entry as Record<string, unknown>;
      values[key] = {
        certainty: certainty === 'estimated' || certainty === 'provided' ? certainty : undefined,
        source: typeof source === 'string' ? source : undefined,
        unit: typeof unit === 'string' ? unit : undefined,
      };
    }
  }
  const portions = Array.isArray(data.portions) ? data.portions.flatMap((entry: unknown): PortionOption[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { unit, ratio, assumption } = entry as Record<string, unknown>;
    if (typeof unit !== 'string' || !unit.trim() || typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return [];
    return [{ unit, ratio, assumption: typeof assumption === 'string' ? assumption : undefined }];
  }) : undefined;
  return {
    kind: data.kind === 'calorie_block' ? data.kind : undefined,
    foodId: typeof data.foodId === 'string' ? data.foodId : undefined,
    catalogueFoodId: typeof data.catalogueFoodId === 'string' ? data.catalogueFoodId : undefined,
    values,
    assumption: typeof data.assumption === 'string' ? data.assumption : undefined,
    portions,
    position: typeof data.position === 'number' ? data.position : undefined,
  };
}

export function foodMultiplier(food: DraftFood): number | null {
  const ratio = food.portions.find(({ unit }) => unit === food.unit)?.ratio;
  return ratio && isValidQuantity(food.amount) ? ratio * Number(food.amount) : null;
}

export function basisValue(food: DraftFood, field: string): number | null {
  return field === CALORIES ? food.basis.caloriesKcal : food.basis.nutrients[field] ?? null;
}

export function portionValue(food: DraftFood, field: string): number | null {
  const value = basisValue(food, field);
  const multiplier = foodMultiplier(food);
  return value === null || multiplier === null ? null : value * multiplier;
}

export function valueCertainty(food: DraftFood, field: string): ValueCertainty | undefined {
  if (portionValue(food, field) === null) return undefined;
  const detail = food.details.values[field];
  const assumed = food.portions.some((option) => option.assumption && (option.unit === food.unit || option.unit === detail?.unit));
  if (assumed && detail?.unit !== food.unit) return 'estimated';
  return detail?.certainty;
}

export function editPortionValue(food: DraftFood, field: string, raw: string): DraftFood {
  const inputs = { ...food.inputs, [field]: raw };
  const multiplier = foodMultiplier(food);
  if (multiplier === null || !validFoodInput(field, raw)) return { ...food, inputs };
  const value = raw.trim() === '' ? null : Number(raw) / multiplier;
  if (value === basisValue(food, field)) return { ...food, inputs };
  const basis = field === CALORIES
    ? { ...food.basis, caloriesKcal: value }
    : { ...food.basis, nutrients: { ...food.basis.nutrients, [field]: value } };
  return {
    ...food, inputs, basis, remember: true,
    details: { ...food.details, values: { ...food.details.values, [field]: { source: 'Your entry', certainty: 'estimated', unit: food.unit } } },
  };
}

export function validFoodInput(field: string, value: string) {
  return value.trim() === '' || (field === CALORIES ? isValidCalorie(value) : isValidNutrient(value));
}

export function validDraftFood(food: DraftFood) {
  if (!food.name.trim() || food.name.trim().length > 160 || foodMultiplier(food) === null) return false;
  if (Object.entries(food.inputs).some(([field, raw]) => !validFoodInput(field, raw))) return false;
  const ratio = food.portions.find(({ unit }) => unit === food.unit)!.ratio;
  return [food.basis.caloriesKcal, ...Object.values(food.basis.nutrients)].every((value) => value === null
    || (Number.isFinite(value) && value >= 0 && value < 100_000_000 && value * ratio < 100_000_000));
}

export function mealMetric(foods: DraftFood[], field: string) {
  const known = foods.flatMap((food) => {
    const value = portionValue(food, field);
    return value === null ? [] : [value];
  });
  return {
    value: known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null,
    complete: known.length === foods.length,
    estimated: foods.some((food) => valueCertainty(food, field) === 'estimated'),
  };
}

export function changeDraftPortion(food: DraftFood, amount: string, unit = food.unit): DraftFood {
  const next = { ...food, amount, unit, inputs: { ...food.inputs } };
  for (const [field, raw] of Object.entries(food.inputs)) {
    // A value entered while the amount was invalid becomes applicable once the amount is fixed.
    if (foodMultiplier(food) === null && validFoodInput(field, raw)) {
      delete next.inputs[field];
      Object.assign(next, editPortionValue(next, field, raw));
    } else if (validFoodInput(field, raw)) {
      delete next.inputs[field];
    }
  }
  return next;
}
