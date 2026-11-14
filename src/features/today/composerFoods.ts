import type { ComposerEntry } from '../../data/repositories/calendarRepository';
import { nutrientsForUserFields, type CatalogFoodSearchResult } from '../../data/repositories/catalogFoodRepository';
import { loadFoodEntry, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { loadMealEntry, type RecentMeal, type SavedMeal } from '../../data/repositories/mealRepository';
import type { Json } from '../../data/database.types';
import { DataError } from '../../data/dataError';
import type { NutrientField } from '../../data/repositories/profileRepository';
import type { DayItem, EatenItemSnapshot } from '../../domain/daySummary';
import { readEatenSnapshot, readItemLogging, readPlannedChoice, readReplannedSnapshot } from '../../domain/daySummary';
import { calculateFoodPortion, convertFoodAmount, type PortionFood } from '../../domain/foodNutrition';
import { CALORIES, formatNutrition, portionOptions, readLoggingDetails, roundQuantity, valueCertainty, type DraftFood, type LoggingDetails, type PortionOption } from '../../domain/mealComposer';
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
  if (!isValidQuantity(amount)) return null;
  const component = snapshot.components?.[0] as Record<string, unknown> | undefined;
  const directFood = snapshot.source === 'food' || snapshot.source === 'one_off_food';
  if (directFood && !logging?.portions && component) {
    const food = capturedComponentDraft(component, amount, unit, snapshot.name, snapshot.brand ?? null, logging);
    if (food) return food;
  }
  const basis = {
    basisAmount: 1, basisUnit: unit, gramsPerServing: null, caloriesKcal: snapshot.calories.value === null ? null : snapshot.calories.value / amount,
    nutrients: Object.fromEntries(Object.entries(snapshot.nutrients).map(([key, metric]) => [key, metric.value === null ? null : metric.value / amount])),
  };
  return draft(snapshot.name, snapshot.brand ?? null, basis, String(amount), unit, logging ?? { values: {} },
    logging?.portions ?? portionOptions(basis, unit));
}

function capturedComponentDraft(component: Record<string, unknown>, amount: number, unit: string, name: string,
  brand: string | null, logging?: LoggingDetails) {
  const basisAmount = Number(component.basis_amount);
  const basisUnit = component.basis_unit;
  if (!(basisAmount > 0) || typeof basisUnit !== 'string' || !isValidQuantity(amount)) return null;
  const nutrients = component.nutrients_per_basis as Record<string, { value?: number | null }> | undefined;
  const basis: PortionFood = {
    basisAmount, basisUnit, gramsPerServing: typeof component.grams_per_serving === 'number' ? component.grams_per_serving : null,
    caloriesKcal: typeof component.calories_per_basis === 'number' ? component.calories_per_basis : null,
    nutrients: Object.fromEntries(Object.entries(nutrients ?? {}).map(([key, metric]) => [key, metric?.value ?? null])),
  };
  const portions = portionOptions(basis, unit);
  return portions.some((portion) => portion.unit === unit) ? draft(name, brand, basis, String(amount), unit, logging ?? { values: {} }, portions) : null;
}

export function savedPortionDraft(entry: FoodWithNutrients, amount: number, unit: string) {
  const food = libraryDraft(entry);
  const knownPortion = food.portions.find((portion) => portion.unit === unit);
  const conversion = calculateFoodPortion(food.basis, 1, unit);
  if (!isValidQuantity(amount) || (!knownPortion && !conversion.ok)) {
    throw new DataError('A saved food’s portion can no longer be used. Review it in the Library.', 'validation');
  }
  const portions = !knownPortion && conversion.ok ? [...food.portions, { unit, ratio: conversion.multiplier }] : food.portions;
  return { ...food, amount: String(amount), unit, portions };
}

function eatenDrafts(snapshot: EatenItemSnapshot, logging?: LoggingDetails): DraftFood[] {
  if (snapshot.source === 'meal' || snapshot.source === 'one_off_meal') {
    const components = (snapshot.components ?? []) as Array<Record<string, unknown>>;
    // Captured meal component amounts are per serving of the saved meal.
    const foods = components.map((component) => capturedComponentDraft(component,
      roundQuantity(Number(component.amount) * snapshot.selected_amount), String(component.unit),
      String(component.food_name ?? snapshot.name), null,
      { values: {}, foodId: typeof component.food_id === 'string' ? component.food_id : undefined }));
    if (foods.length && foods.every((food) => food !== null)) return foods.filter((food): food is DraftFood => food !== null);
  }
  const direct = snapshotDraft(snapshot, logging);
  return direct ? [direct] : [];
}

export function recentMealDrafts(meal: RecentMeal): DraftFood[] {
  const groups = meal.items.map((item) => {
    const snapshot = readEatenSnapshot(item.eaten_snapshot);
    return snapshot ? eatenDrafts(snapshot, readItemLogging(item)) : [];
  });
  return groups.every((foods) => foods.length > 0) ? groups.flat() : [];
}

export function recentMealName(foods: DraftFood[]) {
  const shortNames = foods.slice(0, 2).map(({ name }) => name.split(',')[0]!.trim() || name);
  const suffix = foods.length > 2 ? ` +${foods.length - 2}` : '';
  return shortNames.map((name) => name.length > 70 ? name.slice(0, 69) + '…' : name).join(' + ') + suffix || 'Recent meal';
}

export function savedSnapshotDrafts(value: Json): DraftFood[] {
  if (!Array.isArray(value)) return [];
  const foods = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { payload, amount, unit } = entry;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof amount !== 'number' || typeof unit !== 'string' || typeof payload.name !== 'string'
      || typeof payload.basisAmount !== 'number' || typeof payload.basisUnit !== 'string') return null;
    const basis = {
      basisAmount: payload.basisAmount, basisUnit: payload.basisUnit, gramsPerServing: null,
      caloriesKcal: typeof payload.caloriesKcal === 'number' ? payload.caloriesKcal : null,
      nutrients: payload.nutrients && typeof payload.nutrients === 'object' && !Array.isArray(payload.nutrients)
        ? Object.fromEntries(Object.entries(payload.nutrients).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {},
    };
    const logging = readLoggingDetails(entry.logging) ?? { values: {} };
    return draft(payload.name, typeof payload.brand === 'string' ? payload.brand : null, basis, String(amount), unit,
      logging, logging.portions ?? portionOptions(basis, unit));
  });
  return foods.every((food) => food !== null) ? foods : [];
}

export function savedMealDrafts(meal: SavedMeal, multiplier = 1): DraftFood[] {
  if (meal.meal.snapshot_foods !== null) {
    const foods = savedSnapshotDrafts(meal.meal.snapshot_foods);
    if (foods.length) return foods.map((food) => ({ ...food, amount: String(roundQuantity(Number(food.amount) * multiplier)) }));
  } else if (meal.components.length && meal.components.every((component) => component.food && !component.food.archived_at)) {
    return meal.components.map((component) => savedPortionDraft(
      { food: component.food!, nutrients: component.nutrients }, roundQuantity(component.amount * multiplier), component.unit,
    ));
  }
  throw new DataError('Some foods in this saved meal are unavailable. Check it in Library.', 'validation');
}

export async function loadDiaryItemDrafts(userId: string, item: DayItem): Promise<DraftFood[]> {
  const snapshot = readReplannedSnapshot(item) ?? readEatenSnapshot(item.eaten_snapshot);
  if (snapshot) {
    const foods = eatenDrafts(snapshot, readItemLogging(item));
    if (foods.length) return foods;
  }
  const direct = plannedDraft(item);
  if (direct) return [direct];

  const planned = readPlannedChoice(item.planned_payload);
  if (planned?.sourceKind === 'food' && planned.sourceId) {
    const entry = await loadFoodEntry(userId, planned.sourceId);
    if (entry) return [savedPortionDraft(entry, planned.amount, planned.unit)];
  }
  if (planned?.sourceKind === 'meal' && planned.sourceId) {
    const entry = await loadMealEntry(userId, planned.sourceId);
    if (entry) return savedMealDrafts(entry, planned.amount);
  }
  if (planned?.sourceKind === 'one_off_meal' && Array.isArray(planned.manualPayload?.components)) {
    const components = planned.manualPayload.components as Array<{ food_id: string; amount: number; unit: string }>;
    const entries = await Promise.all(components.map((component) => loadFoodEntry(userId, component.food_id)));
    if (entries.length && entries.every((entry) => entry !== null)) {
      return components.map((component, index) => savedPortionDraft(entries[index]!, roundQuantity(component.amount * planned.amount), component.unit));
    }
  }
  throw new DataError('The saved food details for this meal are unavailable.', 'validation');
}

export function plannedDraft(item: DayItem) {
  const frozen = readReplannedSnapshot(item);
  if (frozen) return snapshotDraft(frozen, readItemLogging(item));
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
