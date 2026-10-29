import { useId, useMemo, useState, type CSSProperties } from 'react';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadFoodEntry, loadFoodLibrary, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { loadMealEntry, loadMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import { loadRecentChoices } from '../../data/repositories/dayRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { choiceMatchScore } from '../../domain/choiceSearch.ts';
import { OneOffFoodForm } from './OneOffFoodForm';
import { OneOffMealForm } from './OneOffMealForm';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { NumericField } from '../../ui/components/Field';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { UnitPicker } from '../../ui/components/UnitPicker';

type Selection = { kind: 'food'; value: FoodWithNutrients } | { kind: 'meal'; value: SavedMeal };
type Result = Selection & { score: number };
export type MealLabel = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unlabelled';
export type PreparedChoice = { kind: Selection['kind'] | 'one_off_food' | 'one_off_meal'; id: string; name: string; amount: number; unit: string; section: MealLabel; requestId?: string; snapshot?: Record<string, unknown>; plannedItemId?: string; expectedItemRevision?: number };
const labels: Array<[Exclude<MealLabel, 'unlabelled'>, string]> = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
function mealNutrition(entry: SavedMeal, fields: NutrientField[], multiplier = 1) {
  return calculateMealNutrition(entry.components.map((component) => ({
    foodId: component.food_id,
    food: component.food ? {
      basisAmount: component.food.basis_amount, basisUnit: component.food.basis_unit,
      gramsPerServing: component.food.grams_per_serving, caloriesKcal: component.food.calories_kcal,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, component.nutrients[field.field_id] ?? null])),
    } : null,
    amount: component.amount, unit: component.unit,
  })), fields.map((field) => field.field_id), multiplier);
}

export function AddChoiceDialog({ open, userId, fields, futureDate, onClose, onPrepared, onSavedOnly, initialSection = 'unlabelled', dialogTitle, submitLabel, actionMode, onActionModeChange, dateLabel, anchor }: {
  open: boolean; userId: string; fields: NutrientField[]; futureDate: boolean;
  initialSection?: MealLabel; dialogTitle?: string; submitLabel?: string;
  actionMode?: 'log' | 'plan'; onActionModeChange?: (action: 'log' | 'plan') => void;
  dateLabel?: string; anchor?: { left: number; top: number; width: number } | null;
  onClose: () => void; onPrepared: (choice: PreparedChoice) => void;
  onSavedOnly?: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [newMode, setNewMode] = useState<'item' | 'ingredients' | null>(null);
  const [newDirty, setNewDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmIngredientSwitch, setConfirmIngredientSwitch] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [section, setSection] = useState<MealLabel>(initialSection);
  const [labelOpen, setLabelOpen] = useState(initialSection !== 'unlabelled');
  const [recentLoadingId, setRecentLoadingId] = useState('');
  const [recentError, setRecentError] = useState('');
  const [recentOrigin, setRecentOrigin] = useState<{ amount: number; unit: string } | null>(null);
  const activeWrites = useIsMutating();
  const controlId = useId();
  const recents = useQuery({ queryKey: queryKeys.recentChoices(userId), queryFn: () => loadRecentChoices(userId), enabled: open, staleTime: 60_000 });
  const foods = useQuery({
    queryKey: [...queryKeys.foods(userId), 'log-picker-all'],
    queryFn: async () => {
      const entries: FoodWithNutrients[] = [];
      let offset = 0; let hasMore = true;
      while (hasMore) {
        const page = await loadFoodLibrary(userId, '', offset, 100, 'recent');
        entries.push(...page.entries); offset += page.entries.length; hasMore = page.hasMore;
      }
      return entries;
    },
    enabled: open, staleTime: 60_000,
  });
  const meals = useQuery({ queryKey: queryKeys.mealLibrary(userId, ''), queryFn: () => loadMeals(userId), enabled: open, staleTime: 60_000 });
  const results = useMemo(() => {
    if (!search.trim()) return [] as Result[];
    const foodMatches: Result[] = (foods.data ?? []).map((value) => ({ kind: 'food', value, score: choiceMatchScore(value.food.name, value.food.brand, search) }));
    const mealMatches: Result[] = (meals.data ?? []).map((value) => ({ kind: 'meal', value, score: choiceMatchScore(value.meal.name, null, search) }));
    return [...foodMatches, ...mealMatches].filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || (a.kind === 'food' ? a.value.food.name : a.value.meal.name).localeCompare(b.kind === 'food' ? b.value.food.name : b.value.meal.name)).slice(0, 50);
  }, [foods.data, meals.data, search]);
  const recentlyAdded = useMemo(() => {
    const recentKeys = new Set((recents.data ?? []).map((choice) => `${choice.kind}:${choice.id}`));
    return [
      ...(foods.data ?? []).filter((entry) => !recentKeys.has(`food:${entry.food.id}`)).map((value) => ({ kind: 'food' as const, value })),
      ...(meals.data ?? []).filter((entry) => !recentKeys.has(`meal:${entry.meal.id}`)).map((value) => ({ kind: 'meal' as const, value })),
    ].sort((a, b) => (b.kind === 'food' ? b.value.food.created_at : b.value.meal.created_at)
      .localeCompare(a.kind === 'food' ? a.value.food.created_at : a.value.meal.created_at)).slice(0, 8);
  }, [foods.data, meals.data, recents.data]);
  const nutrition = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'meal') return { kind: 'meal' as const, result: mealNutrition(selection.value, fields, Number(amount)) };
    const food = selection.value.food;
    return { kind: 'food' as const, result: calculateFoodPortion({
      basisAmount: food.basis_amount, basisUnit: food.basis_unit, gramsPerServing: food.grams_per_serving,
      caloriesKcal: food.calories_kcal,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, selection.value.nutrients[field.field_id] ?? null])),
    }, Number(amount), unit) };
  }, [selection, fields, amount, unit]);
  const proteinField = fields.find((field) => field.standard_key === 'protein');
  const reviewFields = fields.filter((field) => field.is_displayed);
  const canUse = Boolean(selection && nutrition?.result.ok
    && !(selection.kind === 'meal' && selection.value.components.some((component) => component.food?.archived_at))
    && (futureDate || (nutrition.kind === 'food' ? nutrition.result.canLog : nutrition.result.nutrition.canLog)));
  const height = Math.min(400, window.innerHeight * .72);
  const composerStyle = anchor ? {
    '--composer-left': Math.max(12, anchor.left) + 'px',
    '--composer-width': Math.min(anchor.width, window.innerWidth - Math.max(12, anchor.left) - 12) + 'px',
    '--composer-top': (anchor.top + height <= window.innerHeight - 12 ? anchor.top : Math.max(12, (window.innerHeight - height) / 2)) + 'px',
  } as CSSProperties : undefined;
  function choose(result: Selection) {
    setSelection(result); setNewMode(null); setRecentOrigin(null);
    if (result.kind === 'food') { setAmount(String(result.value.food.default_portion_amount)); setUnit(result.value.food.default_portion_unit); }
    else { setAmount('1'); setUnit('serving'); }
  }
  async function chooseRecent(choice: NonNullable<typeof recents.data>[number]) {
    setRecentLoadingId(choice.id); setRecentError('');
    try {
      if (choice.kind === 'food') {
        const value = await loadFoodEntry(userId, choice.id);
        if (!value) throw new Error('Unavailable');
        choose({ kind: 'food', value });
      } else {
        const value = await loadMealEntry(userId, choice.id);
        if (!value) throw new Error('Unavailable');
        choose({ kind: 'meal', value });
      }
      setAmount(String(choice.amount)); setUnit(choice.unit);
      setRecentOrigin({ amount: choice.amount, unit: choice.unit });
    } catch { setRecentError('This recent choice is no longer available. Search for another meal.'); }
    finally { setRecentLoadingId(''); }
  }
  function returnToSearch() {
    if (newDirty || activeWrites > 0) { setConfirmDiscard(true); return; }
    setNewMode(null); setSelection(null);
  }
  function resultRow(result: Selection, key: string) {
    const name = result.kind === 'food' ? result.value.food.name : result.value.meal.name;
    const preview = result.kind === 'meal' ? mealNutrition(result.value, fields) : null;
    const calories = result.kind === 'food' ? result.value.food.calories_kcal : preview?.ok ? preview.nutrition.calories.value : null;
    const protein = result.kind === 'food' ? proteinField ? result.value.nutrients[proteinField.field_id] : null
      : preview?.ok && proteinField ? preview.nutrition.nutrients[proteinField.field_id]?.value : null;
    const basis = result.kind === 'food' ? [result.value.food.brand, 'per ' + number(result.value.food.basis_amount) + ' ' + result.value.food.basis_unit].filter(Boolean).join(' · ') : result.value.components.length + ' foods · per serving';
    return <li key={key}><button type="button" onClick={() => choose(result)}><span><strong>{name}</strong><small>{basis}</small></span><span className="choice-result-facts"><strong>{calories == null ? '— kcal' : number(calories) + ' kcal'}</strong>{proteinField && <small>{protein == null ? '— protein' : number(protein) + ' ' + proteinField.unit + ' protein'}</small>}</span></button></li>;
  }
  const loading = foods.isPending || meals.isPending || recents.isPending;
  const hasSearch = Boolean(search.trim());
  const selectedName = selection?.kind === 'food' ? selection.value.food.name : selection?.value.meal.name;
  const foodResult = nutrition?.kind === 'food' ? nutrition.result : null;
  const mealResult = nutrition?.kind === 'meal' ? nutrition.result : null;
  const labelControl = <div className="meal-composer-label"><div className="meal-composer-label-heading"><strong>Meal label</strong><small>Optional</small></div><button className="meal-label-trigger" type="button" aria-expanded={labelOpen} aria-controls={controlId + '-label-options'} onClick={() => setLabelOpen((value) => !value)}>{section === 'unlabelled' ? '+ Add label' : labels.find(([value]) => value === section)?.[1]}</button>{labelOpen && <div id={controlId + '-label-options'} className="meal-composer-label-options" role="group" aria-label="Choose a meal label">{([['unlabelled', 'No label'], ...labels] as Array<[MealLabel, string]>).map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} onClick={() => { setSection(value); setLabelOpen(false); }}>{label}</button>)}</div>}</div>;
  return <><Dialog open={open} title={dialogTitle ?? 'Add a meal'} closeDisabled={activeWrites > 0} onClose={onClose} className={dateLabel ? 'meal-log-composer' : ''} style={composerStyle}>
    {actionMode && onActionModeChange && <div className="choice-action-picker" role="group" aria-label="Entry state"><label><input type="radio" name={controlId + '-action'} checked={actionMode === 'log'} onChange={() => onActionModeChange('log')} />Eaten</label><label><input type="radio" name={controlId + '-action'} checked={actionMode === 'plan'} onChange={() => onActionModeChange('plan')} />Planned</label></div>}
    {!selection && !newMode && <div className="meal-composer-search-state">
      <label className="library-search choice-search"><Search size={19} aria-hidden="true" /><span className="visually-hidden">Search your Library</span><input autoFocus type="search" placeholder="Search your Library" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {recentError && <StatusMessage tone="error">{recentError}</StatusMessage>}
      {(foods.isError || meals.isError) && <StatusMessage tone="error">Some saved items could not be loaded. Close and try again.</StatusMessage>}
      {loading && <LoadingSkeleton label="Loading saved items" />}
      {!hasSearch && !loading && <>
        {(recentlyAdded.length > 0 || (recents.data?.length ?? 0) > 0) && <><p className="eyebrow choice-list-label">RECENT</p><ul className="choice-results" aria-label="Recent items">{recentlyAdded.map((entry) => resultRow(entry, entry.kind + '-' + (entry.kind === 'food' ? entry.value.food.id : entry.value.meal.id)))}{recents.data?.map((choice) => <li key={choice.kind + '-' + choice.id}><button type="button" disabled={recentLoadingId === choice.id} onClick={() => void chooseRecent(choice)}><span><strong>{choice.name}</strong><small>Last used {number(choice.amount)} {choice.unit}</small></span><span className="choice-result-facts"><small>{recentLoadingId === choice.id ? 'Loading…' : 'Use again'}</small></span></button></li>)}</ul></>}
        {(recents.data?.length ?? 0) === 0 && recentlyAdded.length === 0 && <p className="field-hint">Your Library is empty. Add your first food below.</p>}
      </>}
      {hasSearch && !loading && <><p className="eyebrow choice-list-label">{results.length ? 'MATCHES' : 'NO MATCHES'}</p>{results.length ? <ul className="choice-results" aria-label="Matching items">{results.map((result) => resultRow(result, result.kind + '-' + (result.kind === 'food' ? result.value.food.id : result.value.meal.id)))}</ul> : <p className="field-hint">Try a shorter name or a brand. If this is missing from your Library, add it below.</p>}</>}
      {!loading && (hasSearch ? results.length === 0 : recentlyAdded.length === 0 && (recents.data?.length ?? 0) === 0) && <div className="meal-composer-new-actions"><span>Can’t find it?</span><button type="button" onClick={() => setNewMode('item')}>Add new food</button></div>}
    </div>}
    {newMode && <div className="meal-composer-new"><button className="text-button" type="button" onClick={returnToSearch}>← Back to search</button><h3>{newMode === 'ingredients' ? 'New meal' : 'New food'}</h3>{newMode === 'ingredients'
      ? <OneOffMealForm userId={userId} fields={fields} futureDate={futureDate} section={section} initialName={newItemName} onPrepared={onPrepared} onSavedOnly={(name) => { onClose(); onSavedOnly?.(name); }} onDirtyChange={setNewDirty} extraFields={labelControl} />
      : <OneOffFoodForm userId={userId} fields={fields} futureDate={futureDate} section={section} onPrepared={onPrepared} onSavedOnly={(name) => { onClose(); onSavedOnly?.(name); }} onDirtyChange={setNewDirty} onAddIngredients={foods.data?.length ? (name, hasNutritionEdits) => { setNewItemName(name); if (hasNutritionEdits) setConfirmIngredientSwitch(true); else { setNewDirty(false); setNewMode('ingredients'); } } : undefined} extraFields={labelControl} />}</div>}
    {selection && <div className="choice-review">
      <div className="choice-review-heading"><div><p className="eyebrow">REVIEW PORTION</p><h3>{selectedName}</h3></div><button type="button" className="text-button" onClick={returnToSearch}>Change</button></div>
      {recentOrigin && <StatusMessage tone="info">Using current nutrition with the last used portion ({recentOrigin.amount} {recentOrigin.unit}).</StatusMessage>}
      <div className="choice-portion-fields"><NumericField id="choice-amount" label={selection.kind === 'meal' ? 'Servings' : 'Amount'} min={0.0001} max={99_999_999} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} />{selection.kind === 'food' && <UnitPicker id="choice-unit" value={unit} onChange={setUnit} />}</div>
      {nutrition && !nutrition.result.ok && <StatusMessage tone="error">Review the amount and unit. This portion cannot be calculated from the saved food.</StatusMessage>}
      {foodResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{foodResult.caloriesKcal == null ? 'Unknown' : number(foodResult.caloriesKcal) + ' kcal'}</dd></div>{reviewFields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{foodResult.nutrients[field.field_id] == null ? 'Unknown' : number(foodResult.nutrients[field.field_id]!) + ' ' + field.unit}</dd></div>)}</dl>}
      {mealResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{mealResult.nutrition.calories.value == null ? 'Unknown' : number(mealResult.nutrition.calories.value) + ' kcal' + (mealResult.nutrition.calories.complete ? '' : ' · partial')}</dd></div>{reviewFields.map((field) => { const metric = mealResult.nutrition.nutrients[field.field_id]!; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value == null ? 'Unknown' : number(metric.value) + ' ' + field.unit + (metric.complete ? '' : ' · partial')}</dd></div>; })}</dl>}
      {!futureDate && nutrition?.result.ok && !canUse && <p className="field-hint">Calories must be known to log this entry.</p>}
      {labelControl}
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="button" disabled={!canUse} onClick={() => onPrepared({ kind: selection.kind, id: selection.kind === 'food' ? selection.value.food.id : selection.value.meal.id, name: selectedName!, amount: Number(amount), unit: selection.kind === 'food' ? unit : 'serving', section })}>{submitLabel ?? (futureDate ? 'Add to plan' : 'Log as eaten')}</Button></div>
    </div>}
  </Dialog>
  <Dialog open={confirmIngredientSwitch} title="Add ingredients instead?" onClose={() => setConfirmIngredientSwitch(false)}><p>The nutrition values entered here will be replaced by totals from the ingredients. The name will be kept.</p><div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setConfirmIngredientSwitch(false)}>Keep editing</Button><Button type="button" onClick={() => { setConfirmIngredientSwitch(false); setNewDirty(false); setNewMode('ingredients'); }}>Add ingredients</Button></div></Dialog>
  <Dialog open={confirmDiscard} title={`Discard this new ${newMode === 'ingredients' ? 'meal' : 'food'}?`} closeDisabled={activeWrites > 0} onClose={() => setConfirmDiscard(false)}><p>Your draft has not been saved.</p><div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button type="button" disabled={activeWrites > 0} onClick={() => { setNewMode(null); setSelection(null); setNewDirty(false); setConfirmDiscard(false); }}>Discard</Button></div></Dialog></>;
}
