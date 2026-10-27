import assert from 'node:assert/strict';
import test from 'node:test';
import { previewSelectedDayRedistribution, previewWeeklyAllocations } from '../../src/domain/allocationPreview.ts';

test('proportional allocation uses largest remainders and Monday-first ties', () => {
  const preview = previewWeeklyAllocations([1001, 1500, 1750, 1900, 2100, 2500, 3250], 2001);

  assert.deepEqual(preview?.proportional.values, [1001, 1501, 1751, 1901, 2101, 2501, 3251]);
  assert.equal(preview?.proportional.values.reduce((sum, value) => sum + value, 0), 14_007);
  assert.deepEqual(preview?.equal.values, Array(7).fill(2001));
});

test('proportional allocation is rejected when whole-kcal rounding creates a zero day', () => {
  const preview = previewWeeklyAllocations([1, 1, 1, 1, 1, 1, 100], 1);

  assert.equal(preview?.proportional.valid, false);
  assert.match(preview?.proportional.note ?? '', /zero/);
  assert.equal(preview?.equal.valid, true);
});

test('incomplete or invalid recurring patterns cannot be previewed', () => {
  assert.equal(previewWeeklyAllocations([100, 200], 150), null);
  assert.equal(previewWeeklyAllocations([100, 0, 200, 300, 400, 500, 600], 300), null);
});

test('redistribution adds a residual kcal Monday-first across selected days', () => {
  const preview = previewSelectedDayRedistribution([2102, 2100, 2100, 2100, 2100, 2100, 2100], 14_700, [5, 2, 1]);

  assert.deepEqual(preview?.values, [2102, 2099, 2099, 2100, 2100, 2100, 2100]);
  assert.deepEqual(preview?.changedDays, [1, 2]);
  assert.equal(preview?.valid, true);
  assert.equal(preview?.values.reduce((sum, value) => sum + value, 0), 14_700);
});

test('redistribution subtracts an overage evenly and keeps the exact budget', () => {
  const preview = previewSelectedDayRedistribution([2103, 2100, 2100, 2100, 2100, 2100, 2100], 14_700, [1, 2, 3]);

  assert.deepEqual(preview?.values, [2103, 2099, 2099, 2099, 2100, 2100, 2100]);
  assert.equal(preview?.values.reduce((sum, value) => sum + value, 0), 14_700);
});

test('redistribution explains when selected days cannot absorb an overage', () => {
  const preview = previewSelectedDayRedistribution([10, 1, 1, 1, 1, 1, 1], 10, [1, 2]);

  assert.equal(preview?.valid, false);
  assert.match(preview?.note ?? '', /less than 1 kcal/);
});

test('redistribution requires valid inputs and at least one selected day', () => {
  assert.equal(previewSelectedDayRedistribution(Array(7).fill(100), 700, []), null);
  assert.equal(previewSelectedDayRedistribution([100, 0, 100, 100, 100, 100, 100], 700, [1]), null);
  assert.equal(previewSelectedDayRedistribution(Array(7).fill(100), 700, [1, 1]), null);
});
