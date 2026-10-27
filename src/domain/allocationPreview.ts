export type AllocationOption = {
  values: number[];
  valid: boolean;
  note?: string;
};

export type AllocationPreviews = {
  equal: AllocationOption;
  proportional: AllocationOption;
};

export type WeeklyRedistributionPreview = {
  values: number[];
  changedDays: number[];
  valid: boolean;
  note?: string;
};

/**
 * Preview a new seven-day budget using deterministic whole-kcal rounding.
 * Fractional residuals go to the largest remainder, Monday-first on ties.
 */
export function previewWeeklyAllocations(previous: number[], newDailyTarget: number): AllocationPreviews | null {
  if (previous.length !== 7 || !Number.isInteger(newDailyTarget) || newDailyTarget <= 0
    || previous.some((value) => !Number.isInteger(value) || value <= 0)) return null;

  const newBudget = newDailyTarget * 7;
  const oldBudget = previous.reduce((sum, value) => sum + value, 0);
  const scaled = previous.map((value) => (value * newBudget) / oldBudget);
  const values = scaled.map(Math.floor);
  let remainder = newBudget - values.reduce((sum, value) => sum + value, 0);
  const priority = scaled.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const candidate of priority) {
    if (remainder <= 0) break;
    values[candidate.index] += 1;
    remainder -= 1;
  }

  return {
    equal: { values: Array(7).fill(newDailyTarget), valid: true },
    proportional: values.some((value) => value <= 0)
      ? { values, valid: false, note: 'This rescale would make at least one day zero; choose equal split instead.' }
      : { values, valid: true },
  };
}

/**
 * Distribute the remaining weekly difference across explicitly selected days.
 * Remainder kcal go to the earliest selected weekdays, in ascending order.
 */
export function previewSelectedDayRedistribution(
  current: number[],
  weeklyBudget: number,
  selectedDayIndices: number[],
): WeeklyRedistributionPreview | null {
  if (current.length !== 7 || current.some((value) => !Number.isInteger(value) || value <= 0)
    || !Number.isInteger(weeklyBudget) || weeklyBudget <= 0
    || selectedDayIndices.length === 0
    || selectedDayIndices.some((index) => !Number.isInteger(index) || index < 0 || index > 6)
    || new Set(selectedDayIndices).size !== selectedDayIndices.length) return null;

  const difference = weeklyBudget - current.reduce((sum, value) => sum + value, 0);
  const days = [...selectedDayIndices].sort((left, right) => left - right);
  if (difference === 0) return { values: [...current], changedDays: [], valid: true };

  const magnitude = Math.abs(difference);
  const each = Math.floor(magnitude / days.length);
  let remainder = magnitude % days.length;
  const values = [...current];
  for (const day of days) {
    const share = each + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    values[day] += difference > 0 ? share : -share;
  }

  const changedDays = days.filter((day) => values[day] !== current[day]);
  if (values.some((value) => value <= 0)) {
    return {
      values,
      changedDays,
      valid: false,
      note: 'This spread would make at least one selected day less than 1 kcal. Choose more days or reduce the difference.',
    };
  }

  return { values, changedDays, valid: true };
}
