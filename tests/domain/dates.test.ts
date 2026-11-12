import assert from 'node:assert/strict';
import test from 'node:test';
import { addLocalDays, formatLocalDate, isValidLocalDate, startOfLocalWeek } from '../../src/domain/dates.ts';

test('calendar weeks start Monday', () => {
  assert.equal(startOfLocalWeek('2026-10-02'), '2026-09-28');
});

test('local calendar-day arithmetic crosses month and year boundaries', () => {
  assert.equal(addLocalDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addLocalDays('2026-12-31', 1), '2027-01-01');
});

test('calendar date validation rejects impossible dates and accepts leap days', () => {
  assert.equal(isValidLocalDate('2024-02-29'), true);
  assert.equal(isValidLocalDate('2026-02-31'), false);
  assert.equal(isValidLocalDate('2026-13-01'), false);
  assert.equal(isValidLocalDate('not-a-date'), false);
});

test('calendar labels preserve the selected date in extreme account timezones', () => {
  assert.equal(formatLocalDate('2026-11-02', 'Pacific/Kiritimati', { weekday: 'long', day: 'numeric', month: 'long' }), 'Monday 2 November');
  assert.equal(formatLocalDate('2026-11-02', 'America/Adak', { weekday: 'long', day: 'numeric', month: 'long' }), 'Monday 2 November');
});
