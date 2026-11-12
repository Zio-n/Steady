import type { Json, Tables } from '../data/database.types';
import { CALORIES, readLoggingDetails, type LoggingDetails } from './mealComposer.ts';

export type CapturedMetric = {
  value: number | null;
  complete: boolean;
  knownComponents: number;
  totalComponents: number;
};
export type CapturedNutrient = CapturedMetric & { name: string; unit: string };
/** Versioned nutrition snapshot captured by calendar logging. */
export type EatenItemSnapshot = {
  schema_version: 1;
  name: string;
  brand?: string | null;
  display_measure?: { kind: 'weight' | 'volume'; value: number } | null;
  source: 'food' | 'meal' | 'routine' | 'one_off_food' | 'one_off_meal';
  source_id: string | null;
  captured_at: string | null;
  selected_amount: number;
  selected_unit: string;
  calories: CapturedMetric;
  nutrients: Record<string, CapturedNutrient>;
  components?: unknown[];
  logging?: LoggingDetails;
};
export type DayItem = Pick<Tables<'day_items'>, 'id' | 'section' | 'state' | 'source' | 'selected_amount' | 'selected_unit' | 'planned_payload' | 'eaten_snapshot' | 'eaten_at' | 'revision'> & {
  meal_group_id?: string | null;
  series_id?: string;
  series_revision?: number;
};
export type SummaryMetric = { value: number | null; complete: boolean; knownEntries: number; totalEntries: number; estimated?: boolean };

function object(value: Json | null): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function capturedMetric(value: Json | undefined): CapturedMetric | null {
  const candidate = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!candidate || typeof candidate.value !== 'number' && candidate.value !== null) return null;
  return {
    value: candidate.value,
    complete: candidate.complete === true,
    knownComponents: typeof candidate.knownComponents === 'number' ? candidate.knownComponents : 0,
    totalComponents: typeof candidate.totalComponents === 'number' ? candidate.totalComponents : 0,
  };
}

export function readEatenSnapshot(value: Json | null): EatenItemSnapshot | null {
  const data = object(value);
  if (!data || data.schema_version !== 1 || typeof data.name !== 'string'
    || data.source !== 'food' && data.source !== 'meal' && data.source !== 'routine'
      && data.source !== 'one_off_food' && data.source !== 'one_off_meal'
    || data.source_id !== undefined && data.source_id !== null && typeof data.source_id !== 'string'
    || typeof data.selected_amount !== 'number' || typeof data.selected_unit !== 'string') return null;
  const calories = capturedMetric(data.calories);
  const nutrientObject = object(data.nutrients ?? null);
  if (!calories || !nutrientObject) return null;
  const nutrients: Record<string, CapturedNutrient> = {};
  for (const [fieldId, raw] of Object.entries(nutrientObject)) {
    const metric = capturedMetric(raw);
    const row = object(raw ?? null);
    if (metric && row && typeof row.name === 'string' && typeof row.unit === 'string') nutrients[fieldId] = { ...metric, name: row.name, unit: row.unit };
  }
  return {
    schema_version: 1, name: data.name, brand: typeof data.brand === 'string' ? data.brand : null,
    display_measure: (() => { const measure = object(data.display_measure ?? null); return measure && (measure.kind === 'weight' || measure.kind === 'volume') && typeof measure.value === 'number' && Number.isFinite(measure.value) && measure.value > 0 ? { kind: measure.kind, value: measure.value } : null; })(),
    source: data.source, source_id: typeof data.source_id === 'string' ? data.source_id : null,
    captured_at: typeof data.captured_at === 'string' ? data.captured_at : null,
    selected_amount: data.selected_amount, selected_unit: data.selected_unit, calories, nutrients,
    components: Array.isArray(data.components) ? data.components : [],
    logging: readLoggingDetails(data.logging),
  };
}

function summarize(metrics: Array<CapturedMetric | null>, noEntriesValue = 0): SummaryMetric {
  if (metrics.length === 0) return { value: noEntriesValue, complete: true, knownEntries: 0, totalEntries: 0 };
  const known = metrics.filter((metric): metric is CapturedMetric => metric !== null && metric.value !== null);
  const sum = known.reduce((total, metric) => total + (metric.value ?? 0), 0);
  if (known.length > 0 && !Number.isFinite(sum)) return { value: null, complete: false, knownEntries: known.length, totalEntries: metrics.length };
  return {
    value: known.length > 0 ? sum : null,
    complete: known.length === metrics.length && known.every((metric) => metric.complete),
    knownEntries: known.length,
    totalEntries: metrics.length,
  };
}

export function summarizeDay(items: DayItem[], displayedFieldIds: string[]) {
  const eaten = items.filter((item) => item.state === 'eaten');
  const snapshots = eaten.map((item) => readEatenSnapshot(item.eaten_snapshot));
  const details = eaten.map((item, index) => snapshots[index]?.logging ?? readLoggingDetails(object(item.planned_payload)?.logging));
  const withEstimate = (metric: SummaryMetric, field: string) => details.some((detail) => detail?.values[field]?.certainty === 'estimated')
    ? { ...metric, estimated: true } : metric;
  const calories = withEstimate(summarize(snapshots.map((snapshot) => snapshot?.calories ?? null)), CALORIES);
  const nutrients = Object.fromEntries(displayedFieldIds.map((fieldId) => [
    fieldId,
    withEstimate(summarize(snapshots.map((snapshot) => snapshot?.nutrients[fieldId] ?? null)), fieldId),
  ]));
  const countMeals = (entries: DayItem[]) => new Set(entries.map((item) => item.meal_group_id ?? item.id)).size;
  return { calories, nutrients, eatenCount: countMeals(eaten), plannedCount: countMeals(items.filter((item) => item.state === 'planned')) };
}

export function readItemLogging(item: Pick<DayItem, 'eaten_snapshot' | 'planned_payload'>): LoggingDetails | undefined {
  return readLoggingDetails(object(item.eaten_snapshot)?.logging ?? object(item.planned_payload)?.logging);
}

export function readPlannedNutrition(item: DayItem) {
  const planned = readPlannedChoice(item.planned_payload);
  const payload = planned?.manualPayload;
  if (!planned || planned.sourceKind !== 'one_off_food' || !payload || payload.basisUnit !== planned.unit
    || typeof payload.basisAmount !== 'number' || payload.basisAmount <= 0) return null;
  const ratio = planned.amount / payload.basisAmount;
  const nutrients = payload.nutrients && typeof payload.nutrients === 'object' ? payload.nutrients : {};
  return {
    calories: typeof payload.caloriesKcal === 'number' ? payload.caloriesKcal * ratio : null,
    nutrients: Object.fromEntries(Object.entries(nutrients).map(([key, value]) => [key, typeof value === 'number' ? value * ratio : null])),
  };
}

export function plannedItemName(payload: Json): string | null {
  const data = object(payload);
  if (!data) return null;
  for (const key of ['name', 'meal_name', 'food_name']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key];
  }
  return null;
}

export function readPlannedMeasure(payload: Json): { kind: 'weight' | 'volume'; value: number } | null {
  const measure = object(object(payload)?.display_measure ?? null);
  return measure && (measure.kind === 'weight' || measure.kind === 'volume')
    && typeof measure.value === 'number' && Number.isFinite(measure.value) && measure.value > 0
    ? { kind: measure.kind, value: measure.value } : null;
}

export type PlannedChoice = {
  sourceKind: 'food' | 'meal' | 'one_off_food' | 'one_off_meal';
  sourceId: string | null;
  amount: number;
  unit: string;
  manualPayload?: Record<string, unknown>;
};

export function readPlannedChoice(payload: Json): PlannedChoice | null {
  const data = object(payload);
  if (!data) return null;
  const sourceKind = data.source_kind;
  if (sourceKind !== 'food' && sourceKind !== 'meal' && sourceKind !== 'one_off_food' && sourceKind !== 'one_off_meal') return null;
  if (data.source_id !== null && typeof data.source_id !== 'string') return null;
  if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0 || typeof data.unit !== 'string') return null;
  const rawManualPayload = data.manual_payload;
  if (rawManualPayload !== null && rawManualPayload !== undefined && (typeof rawManualPayload !== 'object' || Array.isArray(rawManualPayload))) return null;
  return {
    sourceKind,
    sourceId: typeof data.source_id === 'string' ? data.source_id : null,
    amount: data.amount,
    unit: data.unit,
    ...(rawManualPayload && typeof rawManualPayload === 'object' ? { manualPayload: rawManualPayload as Record<string, unknown> } : {}),
  };
}
