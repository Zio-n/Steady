import assert from 'node:assert/strict';
import test from 'node:test';
import { readEatenSnapshot, readPlannedChoice, summarizeDay, type DayItem } from '../../src/domain/daySummary.ts';

function item(id: string, snapshot: unknown, state: 'eaten' | 'planned' = 'eaten'): DayItem {
  return {
    id, section: 'breakfast', state, source: 'food', selected_amount: 1, selected_unit: 'serving',
    planned_payload: {}, eaten_snapshot: snapshot as DayItem['eaten_snapshot'], eaten_at: state === 'eaten' ? '2026-10-02T10:00:00Z' : null, revision: 1,
  };
}

const snapshot = (name: string, calories: number | null, protein: number | null, complete = true) => ({
  schema_version: 1, name, source: 'food', selected_amount: 1, selected_unit: 'serving',
  calories: { value: calories, complete: calories !== null && complete, knownComponents: calories === null ? 0 : 1, totalComponents: 1 },
  nutrients: { protein: { name: 'Protein', unit: 'g', value: protein, complete: protein !== null, knownComponents: protein === null ? 0 : 1, totalComponents: 1 } },
});

test('empty days summarize as zero, while eaten unknowns remain unknown', () => {
  assert.deepEqual(summarizeDay([], ['protein']), {
    calories: { value: 0, complete: true, knownEntries: 0, totalEntries: 0 },
    nutrients: { protein: { value: 0, complete: true, knownEntries: 0, totalEntries: 0 } },
    eatenCount: 0, plannedCount: 0,
  });
  const result = summarizeDay([item('a', snapshot('Meal', null, null))], ['protein']);
  assert.equal(result.calories.value, null);
  assert.equal(result.nutrients.protein?.value, null);
  assert.equal(result.calories.complete, false);
});

test('planned items do not contribute; eaten totals preserve partials and explicit zero', () => {
  const result = summarizeDay([
    item('a', snapshot('A', 200, 0)),
    item('b', snapshot('B', null, null), 'eaten'),
    item('c', snapshot('Planned', 500, 20), 'planned'),
  ], ['protein']);
  assert.equal(result.calories.value, 200);
  assert.equal(result.calories.complete, false);
  assert.equal(result.nutrients.protein?.value, 0);
  assert.equal(result.nutrients.protein?.complete, false);
  assert.equal(result.eatenCount, 2);
  assert.equal(result.plannedCount, 1);
});

test('one-off logs preserve their source kind while older snapshots remain readable', () => {
  const oneOff = readEatenSnapshot({
    schema_version: 1, name: 'Quick bowl', source: 'one_off_meal', source_id: null,
    captured_at: '2026-10-02T12:00:00Z', selected_amount: 1, selected_unit: 'serving',
    calories: { value: 250, complete: true, knownComponents: 2, totalComponents: 2 }, nutrients: {},
  });
  assert.equal(oneOff?.source, 'one_off_meal');
  assert.equal(oneOff?.source_id, null);
  assert.equal(oneOff?.captured_at, '2026-10-02T12:00:00Z');
  assert.equal(readEatenSnapshot(snapshot('Older food', 100, null))?.source_id, null);
});

test('planned items retain an explicit source payload for a later Ate it action', () => {
  assert.deepEqual(readPlannedChoice({
    name: 'Quick bowl', source_kind: 'one_off_meal', source_id: null, amount: 1, unit: 'serving',
    manual_payload: { name: 'Quick bowl', components: [{ food_id: 'food-1', amount: 50, unit: 'g' }] },
  }), {
    sourceKind: 'one_off_meal', sourceId: null, amount: 1, unit: 'serving',
    manualPayload: { name: 'Quick bowl', components: [{ food_id: 'food-1', amount: 50, unit: 'g' }] },
  });
  assert.equal(readPlannedChoice({ name: 'Routine slot' }), null);
});
