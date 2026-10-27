import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCarryDifference, previewCarryDecision, type CarryForecastDay } from '../../src/domain/carry.ts';

const monday = '2026-10-05';
function forecast(compltedSourceActual: number | null = 1_600): CarryForecastDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const localDate = new Date(`${monday}T12:00:00.000Z`);
    localDate.setUTCDate(localDate.getUTCDate() + index);
    const date = localDate.toISOString().slice(0, 10);
    return index === 0
      ? { localDate: date, status: 'completed', targetKcal: 2_000, actualKcal: compltedSourceActual }
      : { localDate: date, status: 'open', targetKcal: 2_000, actualKcal: null };
  });
}
const eligible = ['2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'];

test('carry threshold uses the greater of 150 kcal or ten percent of the completed target', () => {
  assert.equal(calculateCarryDifference(2_000, 2_000)?.thresholdKcal, 200);
  assert.equal(calculateCarryDifference(1_200, 1_200)?.thresholdKcal, 150);
  assert.equal(calculateCarryDifference(2_100, 2_100)?.thresholdKcal, 210);
});

test('below-threshold shortfalls and overages are both ineligible', () => {
  assert.equal(calculateCarryDifference(1_800.01, 2_000)?.eligible, false);
  assert.equal(calculateCarryDifference(2_199.99, 2_000)?.eligible, false);
  assert.equal(calculateCarryDifference(1_050.01, 1_200)?.eligible, false);
});

test('threshold equality is eligible without rounding the input difference', () => {
  assert.equal(calculateCarryDifference(1_800, 2_000)?.eligible, true);
  assert.equal(calculateCarryDifference(2_200, 2_000)?.eligible, true);
  assert.equal(calculateCarryDifference(1_050, 1_200)?.eligible, true);
});

test('difference is actual minus target and preserves its sign', () => {
  assert.deepEqual(calculateCarryDifference(1_600, 2_000), { differenceKcal: -400, thresholdKcal: 200, eligible: true });
  assert.deepEqual(calculateCarryDifference(2_400, 2_000), { differenceKcal: 400, thresholdKcal: 200, eligible: true });
});

test('explicit zero intake remains a real shortfall rather than missing data', () => {
  assert.deepEqual(calculateCarryDifference(0, 2_000), { differenceKcal: -2_000, thresholdKcal: 200, eligible: true });
});

test('invalid or out-of-range completion snapshots cannot produce carry eligibility', () => {
  assert.equal(calculateCarryDifference(Number.NaN, 2_000), null);
  assert.equal(calculateCarryDifference(10, 0), null);
  assert.equal(calculateCarryDifference(-1, 2_000), null);
  assert.equal(calculateCarryDifference(100_000_000, 2_000), null);
  assert.equal(calculateCarryDifference(10, 1_000_000), null);
});

test('no-carry preview keeps the original forecast and leaves the entire difference visible', () => {
  const preview = previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: [], action: 'none', amountKcal: 0, destinationDates: [] });

  assert.equal(preview?.forecastBeforeKcal, 13_600);
  assert.equal(preview?.forecastAfterKcal, 13_600);
  assert.equal(preview?.remainingDifferenceKcal, -400);
  assert.deepEqual(preview?.allocations, []);
});

test('single-day carry previews exact before/after target and weekly forecast', () => {
  const preview = previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 400, destinationDates: [eligible[0]!] });

  assert.deepEqual(preview?.allocations, [{ localDate: eligible[0], signedDeltaKcal: 400, beforeTargetKcal: 2_000, afterTargetKcal: 2_400 }]);
  assert.equal(preview?.forecastBeforeKcal, 13_600);
  assert.equal(preview?.forecastAfterKcal, 14_000);
  assert.equal(preview?.averageAfterKcal, 2_000);
  assert.equal(preview?.remainingDifferenceKcal, 0);
});

test('partial carry preserves the unallocated signed difference', () => {
  const preview = previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 150, destinationDates: [eligible[0]!] });

  assert.equal(preview?.forecastAfterKcal, 13_750);
  assert.equal(preview?.remainingDifferenceKcal, -250);
});

test('no remaining same-week destinations permits only the explicit no-carry choice', () => {
  const noCarry = previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: [], action: 'none', amountKcal: 0, destinationDates: [] });
  assert.equal(noCarry?.remainingDifferenceKcal, -400);
  assert.deepEqual(noCarry?.allocations, []);
  assert.equal(previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: [], action: 'single_day', amountKcal: 100, destinationDates: [eligible[0]!] }), null);
});

test('spread carry distributes cents deterministically in ascending date order', () => {
  const preview = previewCarryDecision({ days: forecast(), sourceDate: monday, eligibleDestinationDates: eligible, action: 'spread', amountKcal: 10.01, destinationDates: [eligible[2]!, eligible[0]!, eligible[1]!] });

  assert.deepEqual(preview?.allocations.map((allocation) => [allocation.localDate, allocation.signedDeltaKcal]), [
    [eligible[0], 3.34], [eligible[1], 3.34], [eligible[2], 3.33],
  ]);
  assert.equal(preview?.allocations.reduce((sum, allocation) => sum + allocation.signedDeltaKcal, 0), 10.01);
});

test('over-target spread uses negative deltas and preserves exact forecast arithmetic', () => {
  const preview = previewCarryDecision({ days: forecast(2_400), sourceDate: monday, eligibleDestinationDates: eligible, action: 'spread', amountKcal: 400, destinationDates: eligible.slice(0, 4) });

  assert.deepEqual(preview?.allocations.map((allocation) => allocation.signedDeltaKcal), [-100, -100, -100, -100]);
  assert.equal(preview?.forecastBeforeKcal, 14_400);
  assert.equal(preview?.forecastAfterKcal, 14_000);
});

test('carry preview rejects an ineligible source, stale/non-open date, invalid amount, or invalid target outcome', () => {
  const days = forecast();
  assert.equal(previewCarryDecision({ days: forecast(1_850), sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 10, destinationDates: [eligible[0]!] }), null);
  assert.equal(previewCarryDecision({ days, sourceDate: '2026-10-06', eligibleDestinationDates: eligible, action: 'none', amountKcal: 0, destinationDates: [] }), null);
  assert.equal(previewCarryDecision({ days, sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 10, destinationDates: [monday] }), null);
  assert.equal(previewCarryDecision({ days, sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 0.001, destinationDates: [eligible[0]!] }), null);
  assert.equal(previewCarryDecision({ days, sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 2_001, destinationDates: [eligible[0]!] }), null);
  assert.equal(previewCarryDecision({ days, sourceDate: monday, eligibleDestinationDates: eligible, action: 'spread', amountKcal: 10, destinationDates: [] }), null);
  const nearMinimum = days.map((day) => day.localDate === eligible[0] ? { ...day, targetKcal: 5 } : day);
  assert.equal(previewCarryDecision({ days: nearMinimum.map((day) => day.localDate === monday ? { ...day, actualKcal: 2_400 } : day), sourceDate: monday, eligibleDestinationDates: eligible, action: 'single_day', amountKcal: 10, destinationDates: [eligible[0]!] }), null);
});
