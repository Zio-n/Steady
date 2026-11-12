import type { ComposerEntry } from '../../data/repositories/calendarRepository';
import { nutrientsForUserFields, type CatalogFoodSearchResult } from '../../data/repositories/catalogFoodRepository';
import type { FoodWithNutrients } from '../../data/repositories/foodRepository';
import type { NutrientField } from '../../data/repositories/profileRepository';
import type { DayItem, EatenItemSnapshot } from '../../domain/daySummary';
import { readEatenSnapshot, readItemLogging, readPlannedChoice } from '../../domain/daySummary';
import { convertFoodAmount, type PortionFood } from '../../domain/foodNutrition';
import { CALORIES, formatNutrition, portionOptions, readLoggingDetails, valueCertainty, type DraftFood, type LoggingDetails, type PortionOption } from '../../domain/mealComposer';
import { isValidQuantity } from '../../domain/numericLimits';

export type MealLabel = ComposerEntry['section'];
export type PreparedChoice = {
  kind: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  id: string;
  name: string;
  amount: number;
  unit: string;
  section: MealLabel;
  requestId?: string;
  snapshot?: Record<string, unknown>;
  measure?: { kind: 'weight' | 'volume'; value: number } | null;
  plannedItemId?: string;
  expectedItemRevision?: number;
};

function draft(name: string, brand: string | null, basis: PortionFood, amount: string, unit: string,
  details: LoggingDetails, portions: PortionOption[], remember = false): DraftFood {
  const hasPortion = isValidQuantity(amount) && portions.some((portion) => portion.unit === unit);
  return {
    key: '', name, brand, basis, portions, details, inputs: {}, remember,
    amount: hasPortion ? amount : String(basis.basisAmount),
    unit: hasPortion ? unit : basis.basisUnit,
  };
}

export function libraryDraft(entry: FoodWithNutrients, portion?: { amount: string; unit: string }): DraftFood {
  const { food, nutrients } = entry;
  const basis = {
    basisAmount: food.basis_amount, basisUnit: food.basis_unit, caloriesKcal: food.calories_kcal, nutrients,
    gramsPerServing: food.grams_per_serving, servingUnit: food.default_portion_unit,
  };
  const details = readLoggingDetails(food.logging_details) ?? { values: {} };
  const portions = details.portions ?? portionOptions(basis, food.default_portion_unit);
  return draft(food.name, food.brand, basis, portion?.amount ?? String(food.default_portion_amount),
    portion?.unit ?? food.default_portion_unit, { ...details, foodId: food.id }, portions);
}

export function catalogueDraft(food: CatalogFoodSearchResult, fields: NutrientField[], preference?: { amount: string; unit: string }): DraftFood {
  const nutrients = nutrientsForUserFields(food, fields);
  const basis = {
    basisAmount: food.basis_amount, basisUnit: food.basis_unit, caloriesKcal: food.calories_kcal,
    gramsPerServing: null, nutrients,
  };
  const portions = portionOptions(basis, food.basis_unit);
  for (const portion of food.portions ?? []) {
    const weight = portion.grams_per_unit ?? portion.millilitres_per_unit;
    const measurement = portion.grams_per_unit !== null ? 'g' : 'ml';
    if (weight === null || portions.some(({ unit }) => unit === portion.unit)) continue;
    const amount = convertFoodAmount(weight, measurement, basis.basisUnit, null);
    if (amount === null || amount <= 0) continue;
    portions.push({ unit: portion.unit, ratio: amount / basis.basisAmount,
      assumption: `≈${formatNutrition(weight)} ${measurement} per ${portion.unit}` });
  }
  const source = food.brand ? 'Catalogue product' : 'Generic food';
  const values = Object.fromEntries([CALORIES, ...Object.keys(nutrients)].map((key) => [
    key, { source, certainty: food.brand ? undefined : 'estimated' as const },
  ]));
  return draft(food.name, food.brand, basis, preference?.amount ?? String(food.default_portion?.amount ?? food.basis_amount),
    preference?.unit ?? food.default_portion?.unit ?? food.basis_unit, { catalogueFoodId: food.food_id, values }, portions);
}

export function manualDraft(name: string) {
  return draft(name, null, { basisAmount: 1, basisUnit: 'serving', gramsPerServing: null, caloriesKcal: null, nutrients: {} },
    '1', 'serving', { values: {} }, [{ unit: 'serving', ratio: 1 }], true);
}

export function snapshotDraft(snapshot: EatenItemSnapshot, logging = snapshot.logging) {
  const amount = snapshot.selected_amount;
  const unit = snapshot.selected_unit;
  if (!isValidQuantity(amount) || snapshot.calories.value === null) return null;
  const basis = {
    basisAmount: 1, basisUnit: unit, gramsPerServing: null, caloriesKcal: snapshot.calories.value / amount,
    nutrients: Object.fromEntries(Object.entries(snapshot.nutrients).map(([key, metric]) => [key, metric.value === null ? null : metric.value / amount])),
  };
  return draft(snapshot.name, snapshot.brand ?? null, basis, String(amount), unit, logging ?? { values: {} },
    logging?.portions ?? portionOptions(basis, unit));
}

export function plannedDraft(item: DayItem) {
  const planned = readPlannedChoice(item.planned_payload);
  const payload = planned?.manualPayload;
  if (!planned || !payload || typeof payload.name !== 'string' || typeof payload.basisAmount !== 'number' || typeof payload.basisUnit !== 'string') return null;
  const logging = readItemLogging(item) ?? { values: {} };
  const nutrients = payload.nutrients && typeof payload.nutrients === 'object' && !Array.isArray(payload.nutrients)
    ? Object.fromEntries(Object.entries(payload.nutrients).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {};
  const basis = {
    basisAmount: payload.basisAmount, basisUnit: payload.basisUnit, gramsPerServing: null,
    caloriesKcal: typeof payload.caloriesKcal === 'number' ? payload.caloriesKcal : null, nutrients,
  };
  return draft(payload.name, typeof payload.brand === 'string' ? payload.brand : null, basis,
    String(planned.amount), planned.unit, logging, logging.portions ?? portionOptions(basis, planned.unit));
}

export function existingBlockDraft(item: DayItem) {
  if (item.state === 'planned') return plannedDraft(item);
  const snapshot = readEatenSnapshot(item.eaten_snapshot);
  return snapshot && snapshotDraft(snapshot, readItemLogging(item));
}

export function prepareFood(food: DraftFood, fields: NutrientField[], section: MealLabel): ComposerEntry {
  const selected = food.portions.find(({ unit }) => unit === food.unit)!;
  const keys = fields.map(({ field_id }) => field_id);
  const values = Object.fromEntries([CALORIES, ...keys].map((key) => [
    key, { ...food.details.values[key], certainty: valueCertainty(food, key) },
  ]));
  const nutrients = Object.fromEntries(keys.flatMap((key) => {
    const value = food.basis.nutrients[key];
    return typeof value === 'number' ? [[key, value]] : [];
  }));
  const name = food.name.trim();
  const logging: LoggingDetails = {
    ...food.details, values, assumption: selected.assumption,
    portions: food.portions.map((portion) => ({ ...portion, ratio: portion.ratio / selected.ratio })),
  };
  const entry: ComposerEntry = {
    amount: Number(food.amount), unit: food.unit, section, logging,
    payload: {
      name, brand: food.brand, basisAmount: 1, basisUnit: food.unit,
      caloriesKcal: food.basis.caloriesKcal === null ? null : food.basis.caloriesKcal * selected.ratio,
      nutrients: Object.fromEntries(Object.entries(nutrients).map(([key, value]) => [key, value * selected.ratio])),
    },
  };
  if (food.remember && food.details.kind !== 'calorie_block') {
    entry.variant = {
      name, brand: food.brand, basisAmount: food.basis.basisAmount, basisUnit: food.basis.basisUnit,
      caloriesKcal: food.basis.caloriesKcal, nutrients,
      logging: { ...food.details, portions: food.portions, assumption: undefined, position: undefined },
    };
  }
  return entry;
}
