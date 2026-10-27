import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadFoodEntry } from '../../data/repositories/foodRepository';
import { loadRecentShuffleMealIds, loadRoutineShuffleSuggestion, saveRoutineShuffleSuggestion } from '../../data/repositories/dayRepository';
import { DataError } from '../../data/dataError';
import { loadMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import { queryKeys } from '../../data/queryKeys';
import type { WholeDayShuffleChange } from '../../data/repositories/dayRepository';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { plannedItemName, readEatenSnapshot, readPlannedChoice, summarizeDay, type DayItem } from '../../domain/daySummary.ts';
import { defaultShuffleReplacementAmount, previewWholeDayShuffle, rankShuffleCandidates, shufflePoolMessage, type ShuffleCandidate, type ShufflePoolCounts } from '../../domain/shuffle.ts';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';

type Section = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type Nutrition = { calories: number | null; nutrients: Record<string, number | null> };

export function ShuffleSlotDialog({ open, userId, localDate, item, items, targetKcal, nutrientTargets, fields, onClose, onUse, onChooseManually }: {
  open: boolean;
  userId: string;
  localDate: string;
  item: DayItem;
  items: DayItem[];
  targetKcal: number | null;
  nutrientTargets: Record<string, number>;
  fields: NutrientField[];
  onClose: () => void;
  onUse: (candidate: ShuffleCandidate, amount: number, suggestionRevision: number) => void;
  onChooseManually: () => void;
}) {
  const selectedIndex = 0;
  const queryClient = useQueryClient();
  const suggestionKey = queryKeys.shuffleSuggestion(userId, localDate, item.id);
  const dayFingerprint = items.map((entry) => entry.id + ':' + entry.revision + ':' + entry.state).join('|');
  const previewKey = [...queryKeys.mealLibrary(userId, ''), 'shuffle-preview', suggestionKey, item.revision, dayFingerprint, targetKcal, JSON.stringify(nutrientTargets)];
  const preview = useQuery({
    queryKey: previewKey,
    queryFn: () => buildPreview(userId, localDate, item, items, targetKcal, nutrientTargets, fields),
    enabled: open,
  });
  const persistSuggestion = useMutation({
    mutationFn: saveRoutineShuffleSuggestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: previewKey }),
    onError: (error) => {
      if (error instanceof DataError && error.kind === 'conflict') {
        void queryClient.invalidateQueries({ queryKey: previewKey });
        void queryClient.invalidateQueries({ queryKey: queryKeys.mealLibrary(userId, '') });
      }
    },
  });
  const ranked = useMemo(() => preview.data?.ranked ?? [], [preview.data?.ranked]);
  const savedSuggestion = preview.data?.persistedSuggestion ?? null;
  const savedIndex = savedSuggestion ? ranked.findIndex((entry) => entry.candidate.mealId === savedSuggestion.meal_id
    && entry.candidate.revision === savedSuggestion.meal_revision) : -1;
  const currentIndex = savedSuggestion ? savedIndex : selectedIndex;
  const current = currentIndex >= 0 ? ranked[currentIndex] ?? null : null;
  const poolMessage = preview.data ? shufflePoolMessage(sectionName(item.section), preview.data.pool) : null;
  const unknownCandidateNutrients = current ? fields.filter((field) => Object.hasOwn(nutrientTargets, field.field_id)
    && current.candidate.nutrients[field.field_id] == null) : [];
  const amount = item.selected_amount ?? readPlannedChoice(item.planned_payload)?.amount ?? 1;
  const persistInitial = persistSuggestion.mutate;
  useEffect(() => {
    if (!open || preview.isPending || preview.isError || !preview.data || savedSuggestion || !ranked[0]
      || persistSuggestion.isPending || persistSuggestion.isSuccess || persistSuggestion.isError) return;
    persistInitial({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedItemRevision: item.revision,
      expectedSuggestionRevision: 0, mealId: ranked[0].candidate.mealId, expectedMealRevision: ranked[0].candidate.revision });
  }, [open, preview.isPending, preview.isError, preview.data, savedSuggestion, ranked, persistSuggestion.isPending,
    persistSuggestion.isSuccess, persistSuggestion.isError, persistInitial, localDate, item.id, item.revision]);
  const retryablePersistence = persistSuggestion.error instanceof DataError && persistSuggestion.error.retryable;
  const conflictPersistence = persistSuggestion.error instanceof DataError && persistSuggestion.error.kind === 'conflict';
  const canReroll = Boolean(savedSuggestion && ranked.length > 1 && !persistSuggestion.isPending);

  function reroll() {
    if (!savedSuggestion || persistSuggestion.isPending) return;
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % ranked.length;
    const next = ranked[nextIndex];
    if (!next) return;
    persistSuggestion.reset();
    persistSuggestion.mutate({ requestId: crypto.randomUUID(), localDate, itemId: item.id,
      expectedItemRevision: item.revision, expectedSuggestionRevision: savedSuggestion.suggestion_revision,
      mealId: next.candidate.mealId, expectedMealRevision: next.candidate.revision });
  }

  return <Dialog open={open} title="Shuffle this slot" onClose={onClose}>
    <div className="choice-review shuffle-preview">
      <p className="field-hint">Preview only: your original plan stays unchanged until you use a suggestion. Using it replaces this dated Shuffle slot with a planned meal; it does not mark anything eaten.</p>
      {preview.isPending && <LoadingSkeleton label="Finding a saved meal for this slot" />}
      {preview.isError && <StatusMessage tone="error">We couldn’t build a Shuffle preview. Your original plan is unchanged; close and retry.</StatusMessage>}
      {!preview.isPending && !preview.isError && !savedSuggestion && ranked.length > 0 && !persistSuggestion.isError && <StatusMessage tone="info">Saving this choice to the dated Shuffle occurrence so a refresh keeps the same suggestion…</StatusMessage>}
      {savedSuggestion && savedIndex < 0 && <StatusMessage tone="info">The saved suggestion “{savedSuggestion.meal_name}” is no longer current. Reroll to save a fresh eligible choice before using it.</StatusMessage>}
      {persistSuggestion.isError && <StatusMessage tone="error">{conflictPersistence ? 'This occurrence or suggestion changed in another session. Its saved choice is refreshing; review it before continuing.' : retryablePersistence ? 'We couldn’t confirm the saved suggestion. Retry the same request to safely check whether it was saved.' : 'We couldn’t save this suggestion. Close and reopen the preview to try again.'}</StatusMessage>}
      {!preview.isPending && !preview.isError && targetKcal === null && <StatusMessage tone="info">Set a daily calorie target for an approximate-fit suggestion, or choose a saved meal manually.</StatusMessage>}
      {!preview.isPending && !preview.isError && preview.data?.incomplete && <StatusMessage tone="info">Some other planned nutrition is unavailable or unknown. Fit is approximate using known values.</StatusMessage>}
      {!preview.isPending && !preview.isError && poolMessage && <StatusMessage tone="info">{poolMessage}</StatusMessage>}
      {!preview.isPending && !preview.isError && targetKcal !== null && ranked.length === 0 && !poolMessage && <StatusMessage tone="info">No eligible meal could be scored for this slot. Refresh Library or choose manually.</StatusMessage>}
      {current && <>
        <div className="shuffle-candidate-heading"><div><p className="eyebrow">SUGGESTED SAVED MEAL</p><h3>{current.candidate.name}</h3></div><span>{amount} servings</span></div>
        <dl className="food-portion-values"><div><dt>Calories</dt><dd>{number(current.projectedCaloriesKcal)} kcal</dd></div>
          {fields.filter((field) => Object.hasOwn(nutrientTargets, field.field_id)).map((field) => {
            const value = current.candidate.nutrients[field.field_id];
            return <div key={field.field_id}><dt>{field.name}</dt><dd>{value == null ? 'Unknown ' + field.unit : number(value * amount) + ' ' + field.unit}</dd></div>;
          })}
        </dl>
        <p className="field-hint">Closest calorie fit for this slot{current.proteinShortfall === null ? '' : '; estimated protein shortfall after this choice: ' + number(current.proteinShortfall) + ' g'}{current.usedRecently ? ' · used in the prior seven local days (soft ranking penalty)' : ''}{current.repeatsToday ? ' · repetition avoidance is relaxed because no fresh eligible meal remains' : ''}.</p>
        {unknownCandidateNutrients.length > 0 && <StatusMessage tone="info">Unknown {unknownCandidateNutrients.map((field) => field.name).join(', ')} values stay unknown; they are not treated as zero or as a fit bonus.</StatusMessage>}
      </>}
      <div className="dialog-actions shuffle-preview-actions">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" type="button" disabled={!canReroll} onClick={reroll}>{persistSuggestion.isPending ? 'Saving…' : 'Reroll'}</Button>
        {retryablePersistence && <Button variant="secondary" type="button" disabled={persistSuggestion.isPending} onClick={() => persistSuggestion.variables && persistSuggestion.mutate(persistSuggestion.variables)}>Retry saved choice</Button>}
        <Button variant="secondary" type="button" onClick={onChooseManually}>Choose manually</Button>
        <Button type="button" disabled={!current || !savedSuggestion || savedIndex < 0 || preview.isPending || persistSuggestion.isPending || persistSuggestion.isError} onClick={() => current && savedSuggestion && onUse(current.candidate, amount, savedSuggestion.suggestion_revision)}>Use this meal</Button>
      </div>
      {ranked.length === 1 && savedIndex >= 0 && <p className="field-hint">No other eligible meal is available to reroll.</p>}
      {ranked.length > 1 && savedIndex >= 0 && <p className="field-hint">Reroll advances to another eligible meal in ranked order.</p>}
    </div>
  </Dialog>;
}

export function WholeDayShuffleDialog({ open, userId, localDate, items, targetKcal, nutrientTargets, fields, acceptPending = false, acceptError = null, canRetry = false, onClose, onAccept, onRetry }: {
  open: boolean;
  userId: string;
  localDate: string;
  items: DayItem[];
  targetKcal: number | null;
  nutrientTargets: Record<string, number>;
  fields: NutrientField[];
  acceptPending?: boolean;
  acceptError?: string | null;
  canRetry?: boolean;
  onClose: () => void;
  onAccept: (changes: WholeDayShuffleChange[]) => void;
  onRetry?: () => void;
}) {
  const plannedItems = items.filter((item) => item.state === 'planned');
  const eatenItems = items.filter((item) => item.state === 'eaten');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => plannedItems.map((item) => item.id));
  const [showPreview, setShowPreview] = useState(false);
  const selectionKey = [...selectedIds].sort().join('|');
  const preview = useQuery({
    queryKey: [...queryKeys.mealLibrary(userId, ''), 'whole-day-shuffle-preview', localDate, selectionKey,
      items.map((item) => item.id + ':' + item.revision + ':' + item.state).join('|'), targetKcal, JSON.stringify(nutrientTargets)],
    queryFn: () => buildWholeDayPreview(userId, localDate, items, selectedIds, targetKcal, nutrientTargets, fields),
    enabled: open && showPreview && selectedIds.length > 0 && targetKcal !== null,
  });
  const selected = new Set(selectedIds);
  const originalById = new Map(plannedItems.map((item) => [item.id, item]));
  const missing = preview.data?.suggestions.filter((suggestion) => suggestion.ranked === null) ?? [];
  const missingMessages = preview.data ? [...new Set(missing.map((entry) => entry.slot.section))].map((section) =>
    shufflePoolMessage(sectionName(section), preview.data!.poolBySection[section] ?? { activeMeals: 0, sectionTagged: 0, scorable: 0 })
      ?? `No eligible alternative could be generated for ${sectionName(section)}. Choose manually or adjust the selected slots.`) : [];
  const unchanged = preview.data?.suggestions.filter((suggestion) => {
    const original = originalById.get(suggestion.slot.itemId);
    const originalChoice = original ? readPlannedChoice(original.planned_payload) : null;
    return suggestion.ranked !== null && originalChoice?.sourceKind === 'meal' && originalChoice.sourceId === suggestion.ranked.candidate.mealId;
  }) ?? [];
  const acceptedChanges = preview.data?.suggestions.flatMap((suggestion) => suggestion.ranked ? [{
    itemId: suggestion.slot.itemId,
    expectedItemRevision: originalById.get(suggestion.slot.itemId)?.revision ?? 0,
    mealId: suggestion.ranked.candidate.mealId,
    expectedMealRevision: suggestion.ranked.candidate.revision,
    amount: suggestion.slot.amount,
  }] : []) ?? [];
  const canAccept = Boolean(preview.data) && missing.length === 0 && unchanged.length === 0
    && acceptedChanges.length === selectedIds.length && !acceptPending;

  return <Dialog open={open} title="Shuffle the whole day" onClose={onClose}>
    {!showPreview ? <div className="choice-review shuffle-preview">
      <p className="field-hint">Choose which planned meals may be replaced in this preview. Eaten entries are protected and never selectable. Nothing changes until a later confirmation step.</p>
      {plannedItems.length === 0 && <StatusMessage tone="info">There are no planned meals to shuffle for this date.</StatusMessage>}
      {plannedItems.length > 0 && <fieldset className="whole-day-slot-list"><legend>Planned items</legend>{plannedItems.map((item) => <label className="whole-day-slot-option" key={item.id}>
        <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
        <span><strong>{shuffleOriginalName(item)}</strong><small>{sectionName(item.section)} · {item.selected_amount ?? readPlannedChoice(item.planned_payload)?.amount ?? 1} {item.selected_unit ?? readPlannedChoice(item.planned_payload)?.unit ?? 'servings'}</small></span>
        <em>Will be replaced</em>
      </label>)}</fieldset>}
      {eatenItems.length > 0 && <section className="whole-day-protected" aria-label="Protected eaten items"><h3>Eaten · protected</h3><ul>{eatenItems.map((item) => <li key={item.id}>{readEatenSnapshot(item.eaten_snapshot)?.name ?? 'Logged item'} <span>{sectionName(item.section)} · cannot be replaced</span></li>)}</ul></section>}
      {targetKcal === null && <StatusMessage tone="info">Set a daily calorie target to create an approximate-fit whole-day preview.</StatusMessage>}
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="button" disabled={!selectedIds.length || targetKcal === null} onClick={() => setShowPreview(true)}>Preview selected</Button></div>
    </div> : <div className="choice-review shuffle-preview">
      <p className="field-hint">No plan has been changed yet. Eaten entries remain untouched; each selected planned item below is paired with the saved meal that a single all-or-nothing acceptance would use.</p>
      {preview.isPending && <LoadingSkeleton label="Building whole-day suggestions" />}
      {preview.isError && <StatusMessage tone="error">We couldn’t build this preview. Your original plans are unchanged; go back and retry.</StatusMessage>}
      {preview.data?.incomplete && <StatusMessage tone="info">Some nutrition is unavailable or unknown. Projected values stay partial/unknown; unknown amounts are not treated as zero or rewarded in fit.</StatusMessage>}
      {preview.data && <>
        <div className="whole-day-projection"><strong>{number(preview.data.projectedCaloriesKcal)} kcal</strong><span>{preview.data.caloriesComplete ? 'projected day total' : 'projected known calories · partial'}</span>
          {fields.filter((field) => Object.hasOwn(nutrientTargets, field.field_id)).map((field) => {
            const value = preview.data!.projectedNutrients[field.field_id];
            const complete = preview.data!.completeNutrients[field.field_id] !== false;
            return <div key={field.field_id}><span>{field.name}</span><strong>{value == null ? 'Unknown' : number(value) + ' ' + field.unit}{!complete && value != null ? ' · partial' : ''}</strong></div>;
          })}
        </div>
        {missingMessages.map((message) => <StatusMessage key={message} tone="info">{message}</StatusMessage>)}
        {unchanged.length > 0 && <StatusMessage tone="info">{unchanged.length === 1 ? 'One selected plan has no different eligible meal.' : `${unchanged.length} selected plans have no different eligible meal.`} Go back and unselect {unchanged.length === 1 ? 'that slot' : 'those slots'} or add another saved meal; the whole batch must have a real replacement for every selected slot.</StatusMessage>}
        <ol className="whole-day-suggestion-list">{preview.data.suggestions.map((suggestion) => {
          const original = originalById.get(suggestion.slot.itemId);
          const choice = suggestion.ranked;
          const originalChoice = original ? readPlannedChoice(original.planned_payload) : null;
          const sameMeal = choice !== null && originalChoice?.sourceKind === 'meal' && originalChoice.sourceId === choice.candidate.mealId;
          return <li key={suggestion.slot.itemId}>
            <div><p className="eyebrow">{sectionName(suggestion.slot.section)} · {suggestion.slot.amount} serving{suggestion.slot.amount === 1 ? '' : 's'}</p>
              <strong>{original ? shuffleOriginalName(original) : 'Planned item'}</strong><span>{sameMeal ? ' stays as ' : ' will become '}</span><strong>{choice?.candidate.name ?? 'No match'}</strong>
              {choice && <small>{sameMeal ? 'No different eligible meal is available; this plan would stay unchanged. ' : ''}{number(choice.projectedCaloriesKcal)} kcal{choice.usedRecently ? ' · used in the prior seven local days (soft penalty)' : ''}{choice.repeatsToday ? ' · repetition avoidance relaxed because no fresh eligible meal remained' : ''}</small>}
            </div>
            <span className="whole-day-running-total">{number(suggestion.projectedCaloriesKcal)} kcal after this slot</span>
          </li>;
        })}</ol>
      </>}
      {acceptError && <StatusMessage tone="error">{acceptError}</StatusMessage>}
      {canRetry && <p className="field-hint">Retry uses the same request ID, so if the first attempt already committed, the server returns that exact result without applying the batch twice.</p>}
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setShowPreview(false)}>Back to slots</Button>
        {canRetry && <Button variant="secondary" type="button" disabled={acceptPending} onClick={onRetry}>{acceptPending ? 'Checking…' : 'Retry same request'}</Button>}
        <Button type="button" disabled={!canAccept || preview.isPending || preview.isError} onClick={() => canAccept && onAccept(acceptedChanges)}>{acceptPending ? 'Saving all…' : 'Accept all changes'}</Button>
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button></div>
    </div>}
  </Dialog>;
}

function sectionName(section: string) {
  return ({ breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' } as Record<string, string>)[section] ?? section;
}

async function loadShuffleDayContext(userId: string, localDate: string, items: DayItem[], excludedItemIds: ReadonlySet<string>, fields: NutrientField[]) {
  const [meals, recentMealIds] = await Promise.all([loadMeals(userId), loadRecentShuffleMealIds(userId, localDate)]);
  const mealById = new Map(meals.map((entry) => [entry.meal.id, entry]));
  const candidates = meals.map((entry) => candidateFromMeal(entry, fields)).filter((entry): entry is ShuffleCandidate => entry !== null);
  const summary = summarizeDay(items, fields.map((field) => field.field_id));
  const usedNutrients = Object.fromEntries(fields.map((field) => [field.field_id, summary.nutrients[field.field_id]?.value ?? 0]));
  const completeNutrients = Object.fromEntries(fields.map((field) => [field.field_id, summary.nutrients[field.field_id]?.complete ?? false]));
  let usedCalories = summary.calories.value ?? 0;
  let caloriesComplete = summary.calories.complete;
  let incomplete = !summary.calories.complete;
  const countedPlans = items.filter((entry) => entry.state === 'planned' && !excludedItemIds.has(entry.id));
  for (const planned of countedPlans) {
    const choice = readPlannedChoice(planned.planned_payload);
    if (!choice) {
      caloriesComplete = false;
      incomplete = true;
      for (const field of fields) completeNutrients[field.field_id] = false;
      continue;
    }
    const nutrition = await plannedNutrition(userId, choice, fields, mealById);
    if (!nutrition || nutrition.calories === null) { incomplete = true; caloriesComplete = false; }
    else usedCalories += nutrition.calories;
    for (const field of fields) {
      const value = nutrition?.nutrients[field.field_id] ?? null;
      if (value === null) { completeNutrients[field.field_id] = false; incomplete = true; }
      else usedNutrients[field.field_id] = (usedNutrients[field.field_id] ?? 0) + value;
    }
  }
  const proteinFieldId = fields.find((field) => field.standard_key === 'protein')?.field_id;
  const sameDayMealIds = items.filter((entry) => entry.state === 'eaten' || entry.state === 'planned' && !excludedItemIds.has(entry.id)).flatMap((entry) => {
    if (entry.state === 'eaten') {
      const snapshot = readEatenSnapshot(entry.eaten_snapshot);
      return snapshot?.source === 'meal' && snapshot.source_id ? [snapshot.source_id] : [];
    }
    const choice = entry.state === 'planned' ? readPlannedChoice(entry.planned_payload) : null;
    return choice?.sourceKind === 'meal' && choice.sourceId ? [choice.sourceId] : [];
  });
  return { meals, candidates, recentMealIds, usedCalories, caloriesComplete, incomplete, usedNutrients, completeNutrients, proteinFieldId, sameDayMealIds };
}

function poolCountsForSection(meals: Awaited<ReturnType<typeof loadMeals>>, candidates: ShuffleCandidate[], section: string): ShufflePoolCounts {
  return {
    activeMeals: meals.length,
    sectionTagged: meals.filter((entry) => entry.meal.sections.some((tag) => tag === section)).length,
    scorable: candidates.filter((candidate) => candidate.active && candidate.hasValidComponents
      && candidate.sections.includes(section) && candidate.caloriesKcal !== null && Number.isFinite(candidate.caloriesKcal)).length,
  };
}

async function buildPreview(userId: string, localDate: string, item: DayItem, items: DayItem[], targetKcal: number | null, nutrientTargets: Record<string, number>, fields: NutrientField[]) {
  const [day, persistedSuggestion] = await Promise.all([
    loadShuffleDayContext(userId, localDate, items, new Set([item.id]), fields),
    loadRoutineShuffleSuggestion(userId, localDate, item.id),
  ]);
  const amount = item.selected_amount ?? readPlannedChoice(item.planned_payload)?.amount ?? 1;
  const remainingNutrients = Object.fromEntries(Object.entries(nutrientTargets).map(([id, target]) => [
    id, day.completeNutrients[id] ? Math.max(0, target - (day.usedNutrients[id] ?? 0)) : null,
  ]));
  const ranked = targetKcal === null ? [] : rankShuffleCandidates(day.candidates.map((candidate) => ({ ...candidate, portionMultiplier: amount })), {
    section: item.section as Section, seed: userId + ':' + localDate + ':' + item.id + ':0',
    remainingCaloriesKcal: targetKcal - day.usedCalories, remainingSlots: 1,
    proteinFieldId: day.proteinFieldId,
    remainingProtein: day.proteinFieldId ? remainingNutrients[day.proteinFieldId] ?? null : null,
    remainingNutrients, recentMealIds: day.recentMealIds, sameDayMealIds: day.sameDayMealIds,
  });
  return { ranked, incomplete: day.incomplete, persistedSuggestion, pool: poolCountsForSection(day.meals, day.candidates, item.section) };
}

export async function buildWholeDayPreview(userId: string, localDate: string, items: DayItem[], selectedItemIds: readonly string[], targetKcal: number | null, nutrientTargets: Record<string, number>, fields: NutrientField[]) {
  if (targetKcal === null) return null;
  const selected = new Set(selectedItemIds);
  const plans = items.filter((entry) => entry.state === 'planned' && selected.has(entry.id));
  const day = await loadShuffleDayContext(userId, localDate, items, selected, fields);
  const sectionPositions: Record<string, number> = {};
  const slots = plans.map((item) => {
    const position = sectionPositions[item.section] ?? 0;
    sectionPositions[item.section] = position + 1;
    const choice = readPlannedChoice(item.planned_payload);
    return { itemId: item.id, section: item.section, amount: defaultShuffleReplacementAmount(item.source, choice?.sourceKind ?? null, item.selected_amount ?? choice?.amount ?? null, item.selected_unit ?? choice?.unit ?? null), position };
  });
  const preview = previewWholeDayShuffle(slots, day.candidates, {
    seed: userId + ':' + localDate + ':whole-day:0', targetCaloriesKcal: targetKcal,
    currentCaloriesKcal: day.usedCalories, currentCaloriesComplete: day.caloriesComplete,
    proteinFieldId: day.proteinFieldId, targetNutrients: nutrientTargets,
    currentNutrients: day.usedNutrients, completeNutrients: day.completeNutrients,
    recentMealIds: day.recentMealIds, sameDayMealIds: day.sameDayMealIds,
  });
  const poolBySection = Object.fromEntries([...new Set(slots.map((slot) => slot.section))]
    .map((section) => [section, poolCountsForSection(day.meals, day.candidates, section)]));
  const selectedNutrientsIncomplete = Object.keys(nutrientTargets).some((fieldId) => preview.completeNutrients[fieldId] === false);
  return { ...preview, incomplete: day.incomplete || selectedNutrientsIncomplete, poolBySection };
}

export function shuffleOriginalName(item: DayItem) {
  return plannedItemName(item.planned_payload) ?? 'Planned item';
}

function candidateFromMeal(entry: SavedMeal, fields: NutrientField[]): ShuffleCandidate | null {
  const result = calculateMealNutrition(entry.components.map((component) => ({
    foodId: component.food_id,
    food: component.food ? {
      basisAmount: component.food.basis_amount, basisUnit: component.food.basis_unit, gramsPerServing: component.food.grams_per_serving,
      caloriesKcal: component.food.calories_kcal,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, component.nutrients[field.field_id] ?? null])),
    } : null,
    amount: component.amount, unit: component.unit,
  })), fields.map((field) => field.field_id));
  if (!result.ok) return null;
  return {
    mealId: entry.meal.id, name: entry.meal.name, active: entry.meal.archived_at === null,
    sections: entry.meal.sections,
    hasValidComponents: entry.components.length > 0 && entry.components.every((component) => component.food && !component.food.archived_at) && result.nutrition.canLog,
    caloriesKcal: result.nutrition.calories.value,
    nutrients: Object.fromEntries(fields.map((field) => [field.field_id, result.nutrition.nutrients[field.field_id]?.value ?? null])),
    portionMultiplier: 1, revision: entry.meal.revision,
  };
}

async function plannedNutrition(userId: string, choice: NonNullable<ReturnType<typeof readPlannedChoice>>, fields: NutrientField[], meals: Map<string, SavedMeal>): Promise<Nutrition | null> {
  const fieldIds = fields.map((field) => field.field_id);
  if (choice.sourceKind === 'meal') {
    const entry = choice.sourceId ? meals.get(choice.sourceId) : null;
    if (!entry || entry.components.some((component) => !component.food || component.food.archived_at)) return null;
    const result = calculateMealNutrition(entry.components.map((component) => ({
      foodId: component.food_id,
      food: component.food ? { basisAmount: component.food.basis_amount, basisUnit: component.food.basis_unit, gramsPerServing: component.food.grams_per_serving, caloriesKcal: component.food.calories_kcal,
        nutrients: Object.fromEntries(fields.map((field) => [field.field_id, component.nutrients[field.field_id] ?? null])) } : null,
      amount: component.amount, unit: component.unit,
    })), fieldIds, choice.amount);
    return result.ok ? { calories: result.nutrition.calories.value, nutrients: Object.fromEntries(fieldIds.map((id) => [id, result.nutrition.nutrients[id]?.value ?? null])) } : null;
  }
  if (choice.sourceKind === 'food') {
    const entry = choice.sourceId ? await loadFoodEntry(userId, choice.sourceId) : null;
    if (!entry) return null;
    const result = calculateFoodPortion({ basisAmount: entry.food.basis_amount, basisUnit: entry.food.basis_unit, gramsPerServing: entry.food.grams_per_serving,
      caloriesKcal: entry.food.calories_kcal, nutrients: Object.fromEntries(fields.map((field) => [field.field_id, entry.nutrients[field.field_id] ?? null])) }, choice.amount, choice.unit);
    return result.ok ? { calories: result.caloriesKcal, nutrients: result.nutrients } : null;
  }
  const manual = choice.manualPayload;
  if (!manual) return null;
  if (choice.sourceKind === 'one_off_food') {
    const raw = manual.nutrients && typeof manual.nutrients === 'object' ? manual.nutrients as Record<string, unknown> : {};
    const result = calculateFoodPortion({ basisAmount: typeof manual.basisAmount === 'number' ? manual.basisAmount : NaN,
      basisUnit: typeof manual.basisUnit === 'string' ? manual.basisUnit : '', gramsPerServing: null,
      caloriesKcal: typeof manual.caloriesKcal === 'number' ? manual.caloriesKcal : null,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, typeof raw[field.field_id] === 'number' ? raw[field.field_id] as number : null])) }, choice.amount, choice.unit);
    return result.ok ? { calories: result.caloriesKcal, nutrients: result.nutrients } : null;
  }
  const rawNutrition = manual.nutrition && typeof manual.nutrition === 'object' ? manual.nutrition as Record<string, unknown> : null;
  if (!rawNutrition) return null;
  const calories = rawNutrition.calories && typeof rawNutrition.calories === 'object' ? (rawNutrition.calories as Record<string, unknown>).value : null;
  const rawNutrients = rawNutrition.nutrients && typeof rawNutrition.nutrients === 'object' ? rawNutrition.nutrients as Record<string, unknown> : {};
  return { calories: typeof calories === 'number' ? calories : null, nutrients: Object.fromEntries(fields.map((field) => {
    const metric = rawNutrients[field.field_id] && typeof rawNutrients[field.field_id] === 'object' ? rawNutrients[field.field_id] as Record<string, unknown> : {};
    return [field.field_id, typeof metric.value === 'number' ? metric.value : null];
  })) };
}

function number(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
