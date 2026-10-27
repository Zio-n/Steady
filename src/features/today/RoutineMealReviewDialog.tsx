import { useQuery } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadMealEntry } from '../../data/repositories/mealRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { plannedItemName, readPlannedChoice, type DayItem } from '../../domain/daySummary.ts';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';

const numberLabel = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function RoutineMealReviewDialog({ open, userId, item, fields, pending, onClose, onConfirm }: {
  open: boolean;
  userId: string;
  item: DayItem;
  fields: NutrientField[];
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const choice = readPlannedChoice(item.planned_payload);
  const mealId = choice?.sourceKind === 'meal' ? choice.sourceId : null;
  const mealQuery = useQuery({
    queryKey: [...queryKeys.mealLibrary(userId, ''), 'routine-review', mealId],
    queryFn: () => loadMealEntry(userId, mealId!),
    enabled: open && Boolean(mealId),
  });
  const amount = item.selected_amount ?? choice?.amount ?? 1;
  const unit = item.selected_unit ?? choice?.unit ?? 'serving';
  const nutrition = mealQuery.data && choice?.sourceKind === 'meal'
    ? calculateMealNutrition(mealQuery.data.components.map((component) => ({
      foodId: component.food_id,
      food: component.food ? {
        basisAmount: component.food.basis_amount,
        basisUnit: component.food.basis_unit,
        gramsPerServing: component.food.grams_per_serving,
        caloriesKcal: component.food.calories_kcal,
        nutrients: Object.fromEntries(fields.map((field) => [field.field_id, component.nutrients[field.field_id] ?? null])),
      } : null,
      amount: component.amount,
      unit: component.unit,
    })), fields.map((field) => field.field_id), amount)
    : null;
  const unavailableComponent = mealQuery.data?.components.some((component) => component.food?.archived_at) ?? false;
  const canLog = Boolean(nutrition?.ok && nutrition.nutrition.canLog && !unavailableComponent && unit.toLowerCase() === 'serving');
  const name = mealQuery.data?.meal.name ?? plannedItemName(item.planned_payload) ?? 'Saved meal';

  return <Dialog open={open} title="Review planned meal" onClose={onClose}>
    <div className="choice-review routine-meal-review">
      <div>
        <p className="eyebrow">PORTION REVIEW</p>
        <h3>{name}</h3>
        <p className="field-hint">{numberLabel(amount)} {unit}</p>
      </div>
      <StatusMessage tone="info">Nutrition is shown from the current saved recipe. When you confirm Ate it, this day keeps an independent snapshot; other planned items stay uneaten.</StatusMessage>
      {mealQuery.isPending && <LoadingSkeleton label="Loading the saved meal for review" />}
      {mealQuery.isError && <StatusMessage tone="error">We couldn’t load this saved meal. Nothing has been logged; close and refresh the day before trying again.</StatusMessage>}
      {!mealQuery.isPending && !mealQuery.isError && !mealQuery.data && <StatusMessage tone="error">This saved meal is no longer available, so nothing was logged. Close this review to remove the dated plan and add a replacement; future plans can use Choose instead. <a href="/library?view=meals">Open Meals in Library</a>.</StatusMessage>}
      {unavailableComponent && <StatusMessage tone="error">This recipe contains an archived food and cannot be logged until it is repaired in Library. <a href="/library?view=meals">Open Meals in Library</a>, replace the archived ingredient, and return to review this plan.</StatusMessage>}
      {nutrition && !nutrition.ok && <StatusMessage tone="error">{nutrition.error === 'unknown_serving_weight' ? 'A recipe component needs a known grams-per-serving value.' : nutrition.error === 'incompatible_unit' ? 'A recipe component has an incompatible unit.' : nutrition.error === 'food_unavailable' ? 'A recipe food is no longer available.' : 'This saved recipe cannot be calculated. Nothing has been logged.'}</StatusMessage>}
      {nutrition?.ok && <dl className="food-portion-values">
        <div><dt>Calories</dt><dd>{nutrition.nutrition.calories.value === null ? 'Unknown · cannot log' : `${numberLabel(nutrition.nutrition.calories.value)} kcal${nutrition.nutrition.calories.complete ? '' : ' · partial'}`}</dd></div>
        {fields.map((field) => {
          const metric = nutrition.nutrition.nutrients[field.field_id]!;
          return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value === null ? `Unknown ${field.unit}` : `${numberLabel(metric.value)} ${field.unit}${metric.complete ? '' : ' · partial'}`}</dd></div>;
        })}
      </dl>}
      {nutrition?.ok && !nutrition.nutrition.canLog && <p className="field-hint">Calories must be known for every recipe component before it can be logged.</p>}
      <div className="dialog-actions"><Button variant="secondary" type="button" disabled={pending} onClick={onClose}>Cancel</Button><Button type="button" disabled={!canLog || pending || mealQuery.isPending} onClick={onConfirm}>{pending ? 'Saving…' : 'Ate it'}</Button></div>
    </div>
  </Dialog>;
}
