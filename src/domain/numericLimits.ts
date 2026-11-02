/** Matches the database's numeric(12,4) bounds for quantities, portions, and weights. */
export const QUANTITY_MIN = 0.0001;
export const QUANTITY_MAX = 99_999_999.9999;
/** Keep a boundary preview available for the exact next value beyond database storage. */
export const QUANTITY_PREVIEW_MAX = 100_000_000;
export const QUANTITY_STEP = 0.0001;
export const CALORIE_MAX = 99_999_999.9999;
export const CALORIE_STEP = 0.0001;

/** Nutrient values use numeric(14,6) and must remain non-negative. */
export const NUTRIENT_MIN = 0;
export const NUTRIENT_MAX = 99_999_999.999999;
export const NUTRIENT_STEP = 0.000001;

export function isValidQuantity(value: string | number): boolean {
  if (typeof value === 'string' && !value.trim()) return false;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < QUANTITY_MIN || parsed > QUANTITY_MAX) return false;
  return Math.abs(parsed * 10_000 - Math.round(parsed * 10_000)) < 1e-7;
}
export function isPreviewableQuantity(value: string | number): boolean {
  if (typeof value === 'string' && !value.trim()) return false;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= QUANTITY_MIN && parsed <= QUANTITY_PREVIEW_MAX;
}

export function isValidCalorie(value: string | number): boolean {
  if (typeof value === 'string' && !value.trim()) return false;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > CALORIE_MAX) return false;
  return Math.abs(parsed * 10_000 - Math.round(parsed * 10_000)) < 1e-7;
}

export function isValidNutrient(value: string | number): boolean {
  if (typeof value === 'string' && !value.trim()) return false;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < NUTRIENT_MIN || parsed > NUTRIENT_MAX) return false;
  return Math.abs(parsed * 1_000_000 - Math.round(parsed * 1_000_000)) < 1e-5;
}
