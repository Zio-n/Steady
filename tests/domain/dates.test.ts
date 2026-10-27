import assert from 'node:assert/strict';
import test from 'node:test';
import { addLocalDays, nextLocalWeekStart, startOfLocalWeek } from '../../src/domain/dates.ts';

test('weeks start Monday and the next week is strictly after today', () => {
  assert.equal(startOfLocalWeek('2026-10-02'), '2026-09-28');
  assert.equal(nextLocalWeekStart('2026-10-02'), '2026-10-05');
  assert.equal(nextLocalWeekStart('2026-10-04'), '2026-10-05');
  assert.equal(nextLocalWeekStart('2026-10-05'), '2026-10-12');
});

test('local calendar-day arithmetic crosses month and year boundaries', () => {
  assert.equal(addLocalDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addLocalDays('2026-12-31', 1), '2027-01-01');
});
