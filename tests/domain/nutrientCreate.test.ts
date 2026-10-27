import assert from 'node:assert/strict';
import test from 'node:test';
import { nextNutrientCreateRequest, savedNutrientMatches } from '../../src/domain/nutrientCreate.ts';

test('unchanged custom-nutrient retries reuse one ID, while changed drafts get a new ID', () => {
  let sequence = 0;
  const makeId = () => `00000000-0000-0000-0000-00000000000${++sequence}`;
  const first = nextNutrientCreateRequest(null, ' Water ', ' ml ', makeId);
  const retry = nextNutrientCreateRequest(first, 'Water', 'ml', makeId);
  assert.equal(retry, first);
  assert.equal(sequence, 1);
  assert.match(first.fieldId, /^custom_[a-z0-9_-]{32}$/);
  const changed = nextNutrientCreateRequest(retry, 'Water', 'oz', makeId);
  assert.notEqual(changed.fieldId, first.fieldId);
  assert.equal(sequence, 2);
});

test('a lost create response is reconciled only to the exact active custom field', () => {
  const expected = { fieldId: 'custom_abc', name: 'Water', unit: 'ml' };
  const saved = { field_id: expected.fieldId, name: expected.name, unit: expected.unit, standard_key: null, archived_at: null };
  assert.equal(savedNutrientMatches(expected, saved), true);
  assert.equal(savedNutrientMatches(expected, { ...saved, field_id: 'custom_other' }), false);
  assert.equal(savedNutrientMatches(expected, { ...saved, unit: 'g' }), false);
  assert.equal(savedNutrientMatches(expected, { ...saved, archived_at: '2026-10-03T00:00:00Z' }), false);
  assert.equal(savedNutrientMatches(expected, null), false);
});
