export type PortionFood = {
  basisAmount: number;
  basisUnit: string;
  gramsPerServing: number | null;
  caloriesKcal: number | null;
  nutrients: Record<string, number | null>;
};

export type PortionCalculation = {
  ok: true;
  multiplier: number;
  caloriesKcal: number | null;
  nutrients: Record<string, number | null>;
  canLog: boolean;
} | {
  ok: false;
  reason: 'invalid_amount' | 'invalid_basis' | 'incompatible_unit' | 'unknown_serving_weight';
};

type Unit = { key: string; dimension: 'mass' | 'volume' | 'serving' | 'custom'; toBase: number };

const unitAliases: Record<string, Unit> = {
  g: { key: 'g', dimension: 'mass', toBase: 1 },
  gram: { key: 'g', dimension: 'mass', toBase: 1 },
  grams: { key: 'g', dimension: 'mass', toBase: 1 },
  kg: { key: 'kg', dimension: 'mass', toBase: 1000 },
  kilogram: { key: 'kg', dimension: 'mass', toBase: 1000 },
  kilograms: { key: 'kg', dimension: 'mass', toBase: 1000 },
  mg: { key: 'mg', dimension: 'mass', toBase: 0.001 },
  milligram: { key: 'mg', dimension: 'mass', toBase: 0.001 },
  milligrams: { key: 'mg', dimension: 'mass', toBase: 0.001 },
  mcg: { key: 'mcg', dimension: 'mass', toBase: 0.000001 },
  'μg': { key: 'mcg', dimension: 'mass', toBase: 0.000001 },
  'µg': { key: 'mcg', dimension: 'mass', toBase: 0.000001 },
  ug: { key: 'mcg', dimension: 'mass', toBase: 0.000001 },
  ml: { key: 'ml', dimension: 'volume', toBase: 1 },
  milliliter: { key: 'ml', dimension: 'volume', toBase: 1 },
  milliliters: { key: 'ml', dimension: 'volume', toBase: 1 },
  millilitre: { key: 'ml', dimension: 'volume', toBase: 1 },
  millilitres: { key: 'ml', dimension: 'volume', toBase: 1 },
  l: { key: 'l', dimension: 'volume', toBase: 1000 },
  liter: { key: 'l', dimension: 'volume', toBase: 1000 },
  liters: { key: 'l', dimension: 'volume', toBase: 1000 },
  litre: { key: 'l', dimension: 'volume', toBase: 1000 },
  litres: { key: 'l', dimension: 'volume', toBase: 1000 },
  serving: { key: 'serving', dimension: 'serving', toBase: 1 },
  servings: { key: 'serving', dimension: 'serving', toBase: 1 },
};

function unitFor(label: string): Unit {
  const normalized = label.trim().toLocaleLowerCase('en-US');
  return unitAliases[normalized] ?? { key: normalized, dimension: 'custom', toBase: 1 };
}

/** Convert only equivalent units or a serving/weight pair with a declared serving weight. */
export function convertFoodAmount(amount: number, fromUnit: string, toUnit: string, gramsPerServing: number | null): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const from = unitFor(fromUnit);
  const to = unitFor(toUnit);
  if (!from.key || !to.key) return null;
  if (from.key === to.key) return amount;
  if (from.dimension === to.dimension && (from.dimension === 'mass' || from.dimension === 'volume')) {
    return (amount * from.toBase) / to.toBase;
  }
  if ((from.dimension === 'serving' && to.dimension === 'mass')
    || (from.dimension === 'mass' && to.dimension === 'serving')) {
    if (gramsPerServing === null || !Number.isFinite(gramsPerServing) || gramsPerServing <= 0) return null;
    return from.dimension === 'serving'
      ? (amount * gramsPerServing) / to.toBase
      : (amount * from.toBase) / gramsPerServing;
  }
  return null;
}

/** Scale a food record from its nutrient basis to a selected quantity without treating unknown as zero. */
export function calculateFoodPortion(food: PortionFood, amount: number, unit: string): PortionCalculation {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
  if (!Number.isFinite(food.basisAmount) || food.basisAmount <= 0 || !food.basisUnit.trim()) {
    return { ok: false, reason: 'invalid_basis' };
  }
  const amountInBasisUnit = convertFoodAmount(amount, unit, food.basisUnit, food.gramsPerServing);
  if (amountInBasisUnit === null) {
    const from = unitFor(unit);
    const to = unitFor(food.basisUnit);
    const servingWeightNeeded = (from.dimension === 'serving' && to.dimension === 'mass')
      || (from.dimension === 'mass' && to.dimension === 'serving');
    return { ok: false, reason: servingWeightNeeded && food.gramsPerServing === null ? 'unknown_serving_weight' : 'incompatible_unit' };
  }
  const multiplier = amountInBasisUnit / food.basisAmount;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return { ok: false, reason: 'invalid_amount' };
  const scale = (value: number | null) => value === null ? null : value * multiplier;
  const nutrients = Object.fromEntries(Object.entries(food.nutrients).map(([fieldId, value]) => [fieldId, scale(value)]));
  return {
    ok: true,
    multiplier,
    caloriesKcal: scale(food.caloriesKcal),
    nutrients,
    canLog: food.caloriesKcal !== null,
  };
}
