import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadFoodEntry, loadFoodLibrary, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { loadMealEntry, loadMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import { loadRecentChoices } from '../../data/repositories/dayRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { OneOffFoodForm } from './OneOffFoodForm';
import { OneOffMealForm } from './OneOffMealForm';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Field, NumericField } from '../../ui/components/Field';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';

type Selection = { kind: 'food'; value: FoodWithNutrients } | { kind: 'meal'; value: SavedMeal };
export type PreparedChoice = { kind: Selection['kind'] | 'one_off_food' | 'one_off_meal'; id: string; name: string; amount: number; unit: string; section: 'breakfast' | 'lunch' | 'dinner' | 'snack'; requestId?: string; snapshot?: Record<string, unknown>; plannedItemId?: string; expectedItemRevision?: number };
const displayNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function AddChoiceDialog({
  open, userId, fields, futureDate, onClose, onPrepared, initialSection = 'breakfast', dialogTitle, submitLabel, actionMode, onActionModeChange,
}: {
  open: boolean;
  userId: string;
  fields: NutrientField[];
  futureDate: boolean;
  initialSection?: PreparedChoice['section'];
  dialogTitle?: string;
  submitLabel?: string;
  actionMode?: 'log' | 'plan';
  onActionModeChange?: (action: 'log' | 'plan') => void;
  onClose: () => void;
  onPrepared: (choice: PreparedChoice) => void;
}) {
  const [kind, setKind] = useState<'food' | 'meal' | 'oneoff'>('food');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [section, setSection] = useState<PreparedChoice['section']>(initialSection);
  const [oneOffMode, setOneOffMode] = useState<'food' | 'meal'>('food');
  const [oneOffDirty, setOneOffDirty] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ type: 'kind'; next: 'food' | 'meal' | 'oneoff' } | { type: 'oneoff'; next: 'food' | 'meal' } | null>(null);
  const tabId = useId();
  const activeWrites = useIsMutating();
  const [recentLoadingId, setRecentLoadingId] = useState('');
  const [recentError, setRecentError] = useState('');
  const [recentOrigin, setRecentOrigin] = useState<{ amount: number; unit: string } | null>(null);
  const recentChoices = useQuery({
    queryKey: queryKeys.recentChoices(userId),
    queryFn: () => loadRecentChoices(userId),
    enabled: open && kind !== 'oneoff',
  });
  const foods = useQuery({
    queryKey: [...queryKeys.foodSearch(userId, search.trim(), 'recent'), 'choice-picker'],
    queryFn: () => loadFoodLibrary(userId, search.trim(), 0, 30, 'recent'),
    enabled: open && kind === 'food',
  });
  const meals = useQuery({
    queryKey: queryKeys.mealLibrary(userId, search.trim()),
    queryFn: () => loadMeals(userId, search.trim()),
    enabled: open && kind === 'meal',
  });

  const nutrition = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'food') {
      const food = selection.value.food;
      return { kind: 'food' as const, result: calculateFoodPortion({
        basisAmount: food.basis_amount,
        basisUnit: food.basis_unit,
        gramsPerServing: food.grams_per_serving,
        caloriesKcal: food.calories_kcal,
        nutrients: Object.fromEntries(fields.map((field) => [field.field_id, selection.value.nutrients[field.field_id] ?? null])),
      }, Number(amount), unit) };
    }
    return { kind: 'meal' as const, result: calculateMealNutrition(selection.value.components.map((component) => ({
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
    })), fields.map((field) => field.field_id), Number(amount)) };
  }, [selection, fields, amount, unit]);

  function chooseFood(value: FoodWithNutrients) {
    setRecentOrigin(null);
    setSelection({ kind: 'food', value });
    setAmount(String(value.food.default_portion_amount));
    setUnit(value.food.default_portion_unit);
  }
  function chooseMeal(value: SavedMeal) {
    setRecentOrigin(null);
    setSelection({ kind: 'meal', value });
    setAmount('1');
    setUnit('serving');
  }
  async function chooseRecent(choice: NonNullable<typeof recentChoices.data>[number]) {
    setRecentLoadingId(choice.id);
    setRecentError('');
    try {
      if (choice.kind === 'food') {
        const entry = await loadFoodEntry(userId, choice.id);
        if (!entry) throw new Error('This saved food is no longer active.');
        setSelection({ kind: 'food', value: entry });
        setAmount(String(choice.amount));
        setUnit(choice.unit);
      } else {
        const entry = await loadMealEntry(userId, choice.id);
        if (!entry) throw new Error('This saved meal is no longer active.');
        setSelection({ kind: 'meal', value: entry });
        setAmount(String(choice.amount));
        setUnit(choice.unit);
      }
      setRecentOrigin({ amount: choice.amount, unit: choice.unit });
    } catch {
      setRecentError('That recent choice is no longer available. Choose it again from Library or use another item.');
    } finally {
      setRecentLoadingId('');
    }
  }
  function switchKind(next: 'food' | 'meal' | 'oneoff') {
    setKind(next);
    setSelection(null);
    setRecentOrigin(null);
    setSearch('');
    setOneOffDirty(false);
    if (next === 'oneoff') setOneOffMode('food');
  }
  function requestKind(next: 'food' | 'meal' | 'oneoff') {
    if (next === kind) return;
    if (selection || oneOffDirty || activeWrites > 0) { setPendingSwitch({ type: 'kind', next }); return; }
    switchKind(next);
  }
  function requestOneOffMode(next: 'food' | 'meal') {
    if (next === oneOffMode) return;
    if (oneOffDirty || activeWrites > 0) { setPendingSwitch({ type: 'oneoff', next }); return; }
    setOneOffMode(next);
  }
  function handleKindKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const kinds = ['food', 'meal', 'oneoff'] as const;
    const index = kinds.indexOf(kind);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 2
      : event.key === 'ArrowRight' ? (index + 1) % kinds.length
      : event.key === 'ArrowLeft' ? (index + kinds.length - 1) % kinds.length : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = kinds[nextIndex]!;
    requestKind(next);
    if (!selection && !oneOffDirty && activeWrites === 0) document.getElementById(`${tabId}-${next}`)?.focus();
  }
  function handleOneOffKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'Home' ? 'food' : event.key === 'End' ? 'meal'
      : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? oneOffMode === 'food' ? 'meal' : 'food' : null;
    if (!next) return;
    event.preventDefault();
    requestOneOffMode(next);
    if (!oneOffDirty && activeWrites === 0) document.getElementById(`${tabId}-oneoff-${next}`)?.focus();
  }
  function confirmSwitch() {
    if (!pendingSwitch || activeWrites > 0) return;
    const focusId = pendingSwitch.type === 'kind' ? `${tabId}-${pendingSwitch.next}` : `${tabId}-oneoff-${pendingSwitch.next}`;
    if (pendingSwitch.type === 'kind') switchKind(pendingSwitch.next);
    else { setOneOffMode(pendingSwitch.next); setOneOffDirty(false); }
    setPendingSwitch(null);
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  const selectedName = selection?.kind === 'food' ? selection.value.food.name : selection?.value.meal.name;
  const canUse = Boolean(selection && nutrition?.result.ok
    && !(selection.kind === 'meal' && selection.value.components.some((component) => component.food?.archived_at))
    && (futureDate || (nutrition.kind === 'food'
    ? nutrition.result.canLog
    : nutrition.result.nutrition.canLog)));
  const foodResult = nutrition?.kind === 'food' ? nutrition.result : null;
  const mealResult = nutrition?.kind === 'meal' ? nutrition.result : null;
  const recentForKind = recentChoices.data?.filter((choice) => choice.kind === kind) ?? [];
  const recentIds = new Set(recentForKind.map((choice) => choice.id));

  return <><Dialog open={open} title={dialogTitle ?? (futureDate ? 'Add to your plan' : 'Choose what to log')} closeDisabled={activeWrites > 0} onClose={onClose}>
    {actionMode && onActionModeChange && <div className="choice-action-picker" role="group" aria-label="Add meal as"><label><input type="radio" name={`${tabId}-action`} checked={actionMode === 'log'} onChange={() => onActionModeChange('log')} />Log as eaten</label><label><input type="radio" name={`${tabId}-action`} checked={actionMode === 'plan'} onChange={() => onActionModeChange('plan')} />Plan for later</label></div>}
    <Field id="choice-section" label="Meal section"><select className="text-field" id="choice-section" value={section} onChange={(event) => setSection(event.target.value as PreparedChoice['section'])}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snacks</option></select></Field>
    <div className="choice-tabs" role="tablist" aria-label="Saved item type">
      <button id={`${tabId}-food`} type="button" role="tab" aria-controls={`${tabId}-panel`} aria-selected={kind === 'food'} tabIndex={kind === 'food' ? 0 : -1} onClick={() => requestKind('food')} onKeyDown={handleKindKeyDown}>Foods</button>
      <button id={`${tabId}-meal`} type="button" role="tab" aria-controls={`${tabId}-panel`} aria-selected={kind === 'meal'} tabIndex={kind === 'meal' ? 0 : -1} onClick={() => requestKind('meal')} onKeyDown={handleKindKeyDown}>Meals</button>
      <button id={`${tabId}-oneoff`} type="button" role="tab" aria-controls={`${tabId}-panel`} aria-selected={kind === 'oneoff'} tabIndex={kind === 'oneoff' ? 0 : -1} onClick={() => requestKind('oneoff')} onKeyDown={handleKindKeyDown}>One-off</button>
    </div>
    <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${kind}`} tabIndex={0}>
    {kind !== 'oneoff' && <label className="library-search choice-search"><span className="visually-hidden">Search saved {kind === 'food' ? 'foods by name or brand' : 'meals'}</span><input type="search" placeholder={kind === 'food' ? 'Recent additions · search foods and brands' : 'Search saved meals'} value={search} onChange={(event) => { setSearch(event.target.value); setSelection(null); }} /></label>}
    {!selection && kind !== 'oneoff' && (kind === 'food' ? foods.isPending : meals.isPending) && <LoadingSkeleton label={`Loading saved ${kind}s`} />}
    {!selection && kind !== 'oneoff' && (kind === 'food' ? foods.isError : meals.isError) && <StatusMessage tone="error">We couldn’t load saved choices. Your Library is unchanged; close and try again.</StatusMessage>}
    {!selection && recentError && <StatusMessage tone="error">{recentError}</StatusMessage>}
    {!selection && kind !== 'oneoff' && recentChoices.isError && <StatusMessage tone="error">Recently logged choices could not be loaded. You can still search your Library.</StatusMessage>}
    {!selection && !search.trim() && recentForKind.length > 0 && <><p className="eyebrow choice-list-label">RECENTLY LOGGED</p><ul className="choice-results" aria-label="Recently logged choices">{recentForKind.map((choice) => <li key={`${choice.kind}:${choice.id}`}><button type="button" disabled={recentLoadingId === choice.id} onClick={() => void chooseRecent(choice)}><span><strong>{choice.name}</strong><small>Last logged: {choice.amount} {choice.unit}</small></span><span>{recentLoadingId === choice.id ? 'Loading…' : 'Use current values'}</span></button></li>)}</ul></>}
    {!selection && kind === 'food' && foods.data && <ul className="choice-results" aria-label="Saved foods">{foods.data.entries.filter((entry) => search.trim() || !recentIds.has(entry.food.id)).map((entry) => <li key={entry.food.id}><button type="button" onClick={() => chooseFood(entry)}><span><strong>{entry.food.name}</strong>{entry.food.brand && <small>{entry.food.brand}</small>}</span><span>{entry.food.calories_kcal == null ? 'Calories unknown' : `${displayNumber(entry.food.calories_kcal)} kcal`}</span></button></li>)}</ul>}
    {!selection && kind === 'meal' && meals.data && <ul className="choice-results" aria-label="Saved meals">{meals.data.filter((entry) => search.trim() || !recentIds.has(entry.meal.id)).map((entry) => <li key={entry.meal.id}><button type="button" onClick={() => chooseMeal(entry)}><span><strong>{entry.meal.name}</strong><small>{entry.meal.sections.join(' · ') || 'No section tags'}</small></span><span>{entry.components.length} {entry.components.length === 1 ? 'food' : 'foods'}<small>1 recipe serving</small></span></button></li>)}</ul>}
    {!selection && kind === 'food' && foods.data?.entries.length === 0 && <p className="field-hint">No saved foods match. Add it to your Library first or use a one-off entry.</p>}
    {!selection && kind === 'meal' && meals.data?.length === 0 && <p className="field-hint">No saved meals match. Create one in Library or use a one-off entry.</p>}
    {!selection && kind === 'oneoff' && <>
      <div className="choice-tabs choice-subtabs" role="tablist" aria-label="One-off entry type"><button id={`${tabId}-oneoff-food`} type="button" role="tab" aria-controls={`${tabId}-oneoff-panel`} aria-selected={oneOffMode === 'food'} tabIndex={oneOffMode === 'food' ? 0 : -1} onClick={() => requestOneOffMode('food')} onKeyDown={handleOneOffKeyDown}>Food</button><button id={`${tabId}-oneoff-meal`} type="button" role="tab" aria-controls={`${tabId}-oneoff-panel`} aria-selected={oneOffMode === 'meal'} tabIndex={oneOffMode === 'meal' ? 0 : -1} onClick={() => requestOneOffMode('meal')} onKeyDown={handleOneOffKeyDown}>Multi-food meal</button></div>
      <div id={`${tabId}-oneoff-panel`} role="tabpanel" aria-labelledby={`${tabId}-oneoff-${oneOffMode}`} tabIndex={0}>{oneOffMode === 'food' ? <OneOffFoodForm userId={userId} fields={fields} futureDate={futureDate} section={section} onPrepared={onPrepared} onDirtyChange={setOneOffDirty} /> : <OneOffMealForm userId={userId} fields={fields} futureDate={futureDate} section={section} onPrepared={onPrepared} onDirtyChange={setOneOffDirty} />}</div>
    </>}
    {selection && <div className="choice-review">
      <div className="choice-review-heading"><div><p className="eyebrow">PORTION REVIEW</p><h3>{selectedName}</h3></div><button type="button" className="text-button" onClick={() => { setSelection(null); setRecentOrigin(null); }}>Choose another</button></div>
      {recentOrigin && <StatusMessage tone="info">This uses the current Library nutrition with the last-logged portion ({recentOrigin.amount} {recentOrigin.unit}). Historical eaten values stay in their original snapshot.</StatusMessage>}
      <div className="choice-portion-fields">
        <NumericField id="choice-amount" label={selection.kind === 'meal' ? 'Recipe servings' : 'Amount'} min={0.0001} max={99_999_999} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} />
        {selection.kind === 'food' && <Field id="choice-unit" label="Unit"><input className="text-field" id="choice-unit" value={unit} maxLength={24} onChange={(event) => setUnit(event.target.value)} /></Field>}
      </div>
      {nutrition && !nutrition.result.ok && <StatusMessage tone="error">{nutrition.kind === 'food' ? nutrition.result.reason === 'unknown_serving_weight' ? 'This portion needs a known grams-per-serving value.' : nutrition.result.reason === 'incompatible_unit' ? 'This unit cannot be converted to the food basis. Choose a compatible unit.' : 'Enter a valid positive portion.' : nutrition.result.error === 'unknown_serving_weight' ? `A recipe component needs a known grams-per-serving value.` : nutrition.result.error === 'incompatible_unit' ? 'A recipe component has incompatible units.' : nutrition.result.error === 'food_unavailable' ? 'This meal contains a food that is no longer available.' : 'Review the recipe components and portion.'}</StatusMessage>}
      {foodResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{foodResult.caloriesKcal === null ? 'Unknown · cannot log' : `${displayNumber(foodResult.caloriesKcal)} kcal`}</dd></div>{fields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{foodResult.nutrients[field.field_id] === null ? `Unknown ${field.unit}` : `${displayNumber(foodResult.nutrients[field.field_id]!)} ${field.unit}`}</dd></div>)}</dl>}
      {mealResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{mealResult.nutrition.calories.value === null ? 'Unknown' : `${displayNumber(mealResult.nutrition.calories.value)} kcal${mealResult.nutrition.calories.complete ? '' : ' · partial'}`}</dd></div>{fields.map((field) => { const metric = mealResult.nutrition.nutrients[field.field_id]!; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value === null ? `Unknown ${field.unit}` : `${displayNumber(metric.value)} ${field.unit}${metric.complete ? '' : ' · partial'}`}</dd></div>; })}</dl>}
      {nutrition?.result.ok && !futureDate && !canUse && <p className="field-hint">Calories must be known before this item can be logged.</p>}
      {selection.kind === 'meal' && selection.value.components.some((component) => component.food?.archived_at) && <StatusMessage tone="error">This meal contains an archived food. Replace that component in Library before using the meal.</StatusMessage>}
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="button" disabled={!canUse} onClick={() => {
        if (!selection) return;
        onPrepared({ kind: selection.kind, id: selection.kind === 'food' ? selection.value.food.id : selection.value.meal.id, name: selectedName!, amount: Number(amount), unit: selection.kind === 'food' ? unit : 'serving', section });
      }}>{submitLabel ?? (futureDate ? 'Use this portion' : 'Continue to log')}</Button></div>
    </div>}
    </div>
  </Dialog>
  <Dialog open={pendingSwitch !== null} title="Switch and discard this choice?" onClose={() => setPendingSwitch(null)}>
    <p>{activeWrites > 0 ? 'A save is still in progress. Wait for it to finish before switching.' : 'This choice has not been used yet. Switching will discard its current details.'}</p>
    <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setPendingSwitch(null)}>Keep editing</Button><Button type="button" disabled={activeWrites > 0} onClick={confirmSwitch}>Discard and switch</Button></div>
  </Dialog></>;
}
