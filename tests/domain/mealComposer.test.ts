import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALORIES, changeDraftPortion, editPortionValue, mealMetric, portionValue,
  validDraftFood, valueCertainty, type DraftFood,
} from '../../src/domain/mealComposer.ts';

const bread: DraftFood = {
  key: 'bread', name: 'Bread', brand: null, amount: '2', unit: 'slice',
  basis: { basisAmount: 100, basisUnit: 'g', gramsPerServing: null, caloriesKcal: 200, nutrients: { protein: 10 } },
  portions: [{ unit: 'g', ratio: 0.01 }, { unit: 'slice', ratio: 0.4, assumption: '≈40 g per slice' }],
  details: { values: { [CALORIES]: { certainty: 'provided' }, protein: { certainty: 'estimated' } } },
  inputs: {}, remember: false,
};

test('a portion edit preserves the amount of nutrition and does not create a food variant', () => {
  const grams = changeDraftPortion(bread, '80', 'g');
  assert.equal(portionValue(grams, CALORIES), 160);
  assert.equal(grams.remember, false);
  const corrected = editPortionValue(grams, CALORIES, '180');
  assert.equal(corrected.remember, true);
  assert.equal(portionValue(changeDraftPortion(corrected, '40'), CALORIES), 90);
  assert.equal(corrected.details.values.protein?.certainty, 'estimated');
});

test('conversion from a user-supplied slice to grams preserves uncertainty about its weight', () => {
  const corrected = { ...bread, details: { values: { [CALORIES]: { certainty: 'provided' as const, source: 'Your entry', unit: 'slice' } } } };
  assert.equal(valueCertainty(corrected, CALORIES), 'provided');
  assert.equal(valueCertainty(changeDraftPortion(corrected, '80', 'g'), CALORIES), 'estimated');
});

test('an invalid amount blocks saving after a calorie correction and missing nutrients stay partial', () => {
  const invalid = editPortionValue(changeDraftPortion(bread, '0'), CALORIES, '150');
  assert.equal(validDraftFood(invalid), false);
  const corrected = changeDraftPortion(invalid, '2');
  assert.equal(portionValue(corrected, CALORIES), 150);
  assert.equal(validDraftFood(corrected), true);
  const missing = { ...bread, basis: { ...bread.basis, nutrients: {} } };
  assert.deepEqual(mealMetric([bread, missing], 'protein'), { value: 8, complete: false, estimated: true });
});
