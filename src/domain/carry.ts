export type CarryDifference = {
  differenceKcal: number;
  thresholdKcal: number;
  eligible: boolean;
};

export type CarryAction = 'none' | 'single_day' | 'spread';
export type CarryForecastDay = {
  localDate: string;
  status: 'open' | 'completed';
  targetKcal: number;
  actualKcal: number | null;
};
export type CarryPreview = {
  action: CarryAction;
  amountKcal: number;
  differenceKcal: number;
  remainingDifferenceKcal: number;
  allocations: Array<{ localDate: string; signedDeltaKcal: number; beforeTargetKcal: number; afterTargetKcal: number }>;
  forecastBeforeKcal: number;
  forecastAfterKcal: number;
  averageBeforeKcal: number;
  averageAfterKcal: number;
};

/** Uses unrounded eaten and frozen-target values; rounding belongs only in the UI. */
export function calculateCarryDifference(actualKcal: number, completedTargetKcal: number): CarryDifference | null {
  if (!Number.isFinite(actualKcal) || actualKcal < 0 || actualKcal >= 100_000_000
    || !Number.isFinite(completedTargetKcal) || completedTargetKcal <= 0 || completedTargetKcal >= 1_000_000) return null;
  const differenceKcal = actualKcal - completedTargetKcal;
  const thresholdKcal = Math.max(150, completedTargetKcal * 0.1);
  return { differenceKcal, thresholdKcal, eligible: Math.abs(differenceKcal) >= thresholdKcal };
}

/** Previews an explicit carry choice; it never writes or silently selects recipients. */
export function previewCarryDecision(input: {
  days: CarryForecastDay[];
  sourceDate: string;
  eligibleDestinationDates: string[];
  action: CarryAction;
  amountKcal: number;
  destinationDates: string[];
}): CarryPreview | null {
  const source = input.days.find((day) => day.localDate === input.sourceDate);
  if (!source || source.status !== 'completed' || source.actualKcal === null) return null;
  const difference = calculateCarryDifference(source.actualKcal, source.targetKcal);
  if (!difference?.eligible) return null;
  const dayByDate = new Map(input.days.map((day) => [day.localDate, day]));
  if (dayByDate.size !== input.days.length || input.days.some((day) => !Number.isFinite(day.targetKcal)
    || day.targetKcal <= 0 || day.status === 'completed' && (day.actualKcal === null || !Number.isFinite(day.actualKcal) || day.actualKcal < 0))) return null;
  const forecastBeforeKcal = input.days.reduce((sum, day) => sum + (day.status === 'completed' ? day.actualKcal! : day.targetKcal), 0);
  if (!Number.isFinite(forecastBeforeKcal)) return null;
  const forecastDayCount = input.days.length;
  if (forecastDayCount !== 7) return null;

  if (input.action === 'none') {
    if (input.destinationDates.length !== 0) return null;
    return {
      action: input.action, amountKcal: 0, differenceKcal: difference.differenceKcal,
      remainingDifferenceKcal: difference.differenceKcal, allocations: [], forecastBeforeKcal,
      forecastAfterKcal: forecastBeforeKcal, averageBeforeKcal: forecastBeforeKcal / 7,
      averageAfterKcal: forecastBeforeKcal / 7,
    };
  }

  const destinations = [...input.destinationDates].sort((left, right) => left.localeCompare(right));
  const destinationSet = new Set(destinations);
  if (destinations.length === 0 || destinationSet.size !== destinations.length
    || input.action === 'single_day' && destinations.length !== 1
    || input.action === 'spread' && destinations.length < 2
    || destinations.some((date) => !input.eligibleDestinationDates.includes(date)
      || date <= input.sourceDate || dayByDate.get(date)?.status !== 'open')) return null;
  const amountCents = input.amountKcal * 100;
  if (!Number.isFinite(input.amountKcal) || input.amountKcal <= 0 || input.amountKcal > Math.abs(difference.differenceKcal)
    || Math.abs(Math.round(amountCents) - amountCents) > 1e-7) return null;
  const totalCents = Math.round(amountCents);
  const baseCents = Math.floor(totalCents / destinations.length);
  const residualCents = totalCents % destinations.length;
  const sign = difference.differenceKcal < 0 ? 1 : -1;
  const allocations = destinations.map((localDate, index) => {
    const day = dayByDate.get(localDate)!;
    const cents = baseCents + (index < residualCents ? 1 : 0);
    const signedDeltaKcal = sign * cents / 100;
    return {
      localDate, signedDeltaKcal, beforeTargetKcal: day.targetKcal,
      afterTargetKcal: day.targetKcal + signedDeltaKcal,
    };
  });
  if (allocations.some((allocation) => allocation.afterTargetKcal < 1 || allocation.afterTargetKcal >= 1_000_000)) return null;
  const signedTotal = allocations.reduce((sum, allocation) => sum + allocation.signedDeltaKcal, 0);
  const forecastAfterKcal = forecastBeforeKcal + signedTotal;
  if (!Number.isFinite(forecastAfterKcal)) return null;
  const remainingAmount = Math.max(0, Math.abs(difference.differenceKcal) - totalCents / 100);
  return {
    action: input.action, amountKcal: totalCents / 100, differenceKcal: difference.differenceKcal,
    remainingDifferenceKcal: remainingAmount === 0 ? 0 : Math.sign(difference.differenceKcal) * remainingAmount,
    allocations, forecastBeforeKcal, forecastAfterKcal,
    averageBeforeKcal: forecastBeforeKcal / 7, averageAfterKcal: forecastAfterKcal / 7,
  };
}
