import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALORIE_MAX, NUTRIENT_MAX, QUANTITY_MAX, QUANTITY_MIN,
  isPreviewableQuantity, isValidCalorie, isValidNutrient, isValidQuantity,
} from '../../src/domain/numericLimits.ts';

test('quantity input accepts the inclusive stored bounds and rejects out-of-range or malformed values', () => {
  assert.equal(isValidQuantity(QUANTITY_MIN), true);
  assert.equal(isValidQuantity(QUANTITY_MAX), true);
  assert.equal(isValidQuantity(QUANTITY_MIN - 0.0001), false);
  assert.equal(isValidQuantity(QUANTITY_MAX + 0.0001), false);
  assert.equal(isValidQuantity(100_000_000), false);
  assert.equal(isValidQuantity(''), false);
  assert.equal(isValidQuantity('1.00001'), false);
  assert.equal(isValidQuantity('Infinity'), false);
  assert.equal(isValidQuantity('-1'), false);
});

test('preview bounds allow useful math at the storage boundary but reject unsafe input', () => {
  assert.equal(isPreviewableQuantity(100_000_000), true);
  assert.equal(isPreviewableQuantity('1e8'), true);
  assert.equal(isPreviewableQuantity(100_000_000.0001), false);
  assert.equal(isPreviewableQuantity(Number.MAX_VALUE), false);
  assert.equal(isPreviewableQuantity('1e1000'), false);
  assert.equal(isPreviewableQuantity('   '), false);
  assert.equal(isPreviewableQuantity('1; DROP TABLE foods'), false);
});

test('calorie and nutrient inputs enforce their non-negative database ranges', () => {
  assert.equal(isValidCalorie(0), true);
  assert.equal(isValidCalorie(CALORIE_MAX), true);
  assert.equal(isValidCalorie(CALORIE_MAX + 0.0001), false);
  assert.equal(isValidCalorie(-0.0001), false);
  assert.equal(isValidCalorie('NaN'), false);
  assert.equal(isValidNutrient(0), true);
  assert.equal(isValidNutrient(NUTRIENT_MAX), true);
  assert.equal(isValidNutrient(NUTRIENT_MAX + 0.000001), false);
  assert.equal(isValidNutrient(-0.000001), false);
  assert.equal(isValidNutrient('0.0000001'), false);
});
