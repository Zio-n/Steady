import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFoodPortion, convertFoodAmount } from '../../src/domain/foodNutrition.ts';

const oats = {
  basisAmount: 100,
  basisUnit: 'g',
  gramsPerServing: 40,
  caloriesKcal: 380,
  nutrients: { protein: 13.2, carbohydrate: null, salt: 0 },
};

test('mass and volume conversions stay within their own dimensions', () => {
  assert.equal(convertFoodAmount(1.5, 'kg', 'g', null), 1500);
  assert.equal(convertFoodAmount(250, 'ml', 'l', null), 0.25);
  assert.equal(convertFoodAmount(1, 'g', 'ml', 40), null);
});

test('serving and gram conversions require declared grams per serving', () => {
  assert.equal(convertFoodAmount(2, 'servings', 'g', 40), 80);
  assert.equal(convertFoodAmount(80, 'g', 'serving', 40), 2);
  assert.equal(convertFoodAmount(1, 'serving', 'g', null), null);
});

test('portion calculation scales known values but preserves unknown and zero', () => {
  const portion = calculateFoodPortion(oats, 1, 'serving');

  assert.equal(portion.ok, true);
  if (!portion.ok) return;
  assert.equal(portion.multiplier, 0.4);
  assert.equal(portion.caloriesKcal, 152);
  assert.equal(portion.nutrients.protein, 5.28);
  assert.equal(portion.nutrients.carbohydrate, null);
  assert.equal(portion.nutrients.salt, 0);
  assert.equal(portion.canLog, true);
});

test('unknown calories remain visible but prevent logging; unknown serving weight blocks conversion', () => {
  const unknownCalories = calculateFoodPortion({ ...oats, caloriesKcal: null }, 40, 'g');
  const unknownWeight = calculateFoodPortion({ ...oats, gramsPerServing: null }, 1, 'serving');

  assert.equal(unknownCalories.ok && unknownCalories.caloriesKcal, null);
  assert.equal(unknownCalories.ok && unknownCalories.canLog, false);
  assert.deepEqual(unknownWeight, { ok: false, reason: 'unknown_serving_weight' });
});

test('invalid amounts and incompatible custom units are rejected', () => {
  assert.deepEqual(calculateFoodPortion(oats, 0, 'g'), { ok: false, reason: 'invalid_amount' });
  assert.deepEqual(calculateFoodPortion(oats, 1, 'slice'), { ok: false, reason: 'incompatible_unit' });
});

test('custom units convert only to the same named unit, and microgram aliases normalize', () => {
  assert.equal(convertFoodAmount(2, 'slice', 'slice', null), 2);
  assert.equal(convertFoodAmount(2500, 'µg', 'mg', null), 2.5);
  assert.equal(convertFoodAmount(2, 'slice', 'piece', null), null);
});

test('large finite food amounts remain finite and explicit zero stays zero', () => {
  const portion = calculateFoodPortion({
    basisAmount: 0.0001,
    basisUnit: 'g',
    gramsPerServing: null,
    caloriesKcal: 0,
    nutrients: { hydration: 0 },
  }, 99_999_999, 'g');

  assert.equal(portion.ok, true);
  if (!portion.ok) return;
  assert.ok(Number.isFinite(portion.multiplier));
  assert.equal(portion.caloriesKcal, 0);
  assert.equal(portion.nutrients.hydration, 0);
});
