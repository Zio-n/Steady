import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMealNutrition } from '../../src/domain/mealNutrition.ts';

const oats = { basisAmount: 100, basisUnit: 'g', gramsPerServing: null, caloriesKcal: 380, nutrients: { protein: 13.2, fibre: 10, salt: 0 } };
const yogurt = { basisAmount: 100, basisUnit: 'g', gramsPerServing: null, caloriesKcal: 60, nutrients: { protein: 5, fibre: null, salt: null } };

test('meal totals sum scaled component nutrition and apply the serving multiplier', () => {
  const result = calculateMealNutrition([
    { foodId: 'oats', food: oats, amount: 50, unit: 'g' },
    { foodId: 'yogurt', food: yogurt, amount: 150, unit: 'g' },
  ], ['protein', 'fibre', 'salt'], 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.nutrition.calories.value, 560);
  assert.equal(result.nutrition.calories.complete, true);
  assert.deepEqual(result.nutrition.nutrients.protein, { value: 28.2, knownComponents: 2, totalComponents: 2, complete: true });
  assert.deepEqual(result.nutrition.nutrients.fibre, { value: 10, knownComponents: 1, totalComponents: 2, complete: false });
  assert.deepEqual(result.nutrition.nutrients.salt, { value: 0, knownComponents: 1, totalComponents: 2, complete: false });
});

test('all unknown values stay unknown; an incomplete calorie total cannot be logged', () => {
  const result = calculateMealNutrition([
    { foodId: 'unknown', food: { ...yogurt, caloriesKcal: null, nutrients: {} }, amount: 100, unit: 'g' },
  ], ['protein']);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.nutrition.calories.value, null);
  assert.equal(result.nutrition.calories.complete, false);
  assert.equal(result.nutrition.nutrients.protein.value, null);
  assert.equal(result.nutrition.canLog, false);
});

test('empty, incompatible, unavailable and invalid components are rejected', () => {
  assert.deepEqual(calculateMealNutrition([], []), { ok: false, error: 'empty_recipe' });
  assert.deepEqual(calculateMealNutrition([{ foodId: '', food: null, amount: 1, unit: 'g' }], []), { ok: false, error: 'component_missing', componentIndex: 0 });
  assert.deepEqual(calculateMealNutrition([{ foodId: 'missing', food: null, amount: 1, unit: 'g' }], []), { ok: false, error: 'food_unavailable', componentIndex: 0 });
  assert.deepEqual(calculateMealNutrition([{ foodId: 'oats', food: oats, amount: 1, unit: 'ml' }], []), { ok: false, error: 'incompatible_unit', componentIndex: 0 });
  assert.deepEqual(calculateMealNutrition([{ foodId: 'oats', food: oats, amount: 0, unit: 'g' }], []), { ok: false, error: 'invalid_amount', componentIndex: 0 });
  assert.deepEqual(calculateMealNutrition([{ foodId: 'oats', food: oats, amount: 1, unit: 'serving' }], []), { ok: false, error: 'unknown_serving_weight', componentIndex: 0 });
  assert.deepEqual(calculateMealNutrition([{ foodId: 'oats', food: oats, amount: 1, unit: 'g' }], [], 0), { ok: false, error: 'invalid_multiplier' });
});

test('finite component values whose sum overflows are rejected instead of shown as unknown', () => {
  const huge = { ...oats, basisAmount: 1, caloriesKcal: 9e307, nutrients: {} };
  const result = calculateMealNutrition([
    { foodId: 'one', food: huge, amount: 1, unit: 'g' },
    { foodId: 'two', food: huge, amount: 1, unit: 'g' },
  ], []);
  assert.deepEqual(result, { ok: false, error: 'numeric_overflow' });
});
