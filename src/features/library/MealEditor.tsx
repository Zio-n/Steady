import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Search, Trash2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import type { FoodWithNutrients } from '../../data/repositories/foodRepository';
import { saveMeal, type SavedMeal } from '../../data/repositories/mealRepository';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { choiceMatchScore } from '../../domain/choiceSearch.ts';
import { OneOffFoodForm } from '../today/OneOffFoodForm';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Field, NumericField } from '../../ui/components/Field';
import { UnitPicker } from '../../ui/components/UnitPicker';
import { StatusMessage } from '../../ui/components/StatusMessage';

type DraftComponent = { key: string; foodId: string; amount: string; unit: string };
const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function MealEditor({ meal, foods, fields, userId, requestKey, onSaved, onCancel, onDirtyChange }: {
  meal: SavedMeal | null;
  foods: FoodWithNutrients[];
  fields: NutrientField[];
  userId: string;
  requestKey: string;
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(meal?.meal.name ?? '');
  const [components, setComponents] = useState<DraftComponent[]>(() => meal?.components.map((row) => ({ key: row.component_id, foodId: row.food_id, amount: String(row.amount), unit: row.unit })) ?? []);
  const [declaredWeight, setDeclaredWeight] = useState(meal?.meal.declared_total_weight_g == null ? '' : String(meal.meal.declared_total_weight_g));
  const [search, setSearch] = useState('');
  const [addingFood, setAddingFood] = useState(false);
  const [newFoodDirty, setNewFoodDirty] = useState(false);
  const [discardFoodOpen, setDiscardFoodOpen] = useState(false);
  const [error, setError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const mutation = useMutation({ mutationFn: saveMeal, onSuccess: onSaved, onError: () => setError('We couldn’t confirm this save. Check your Library before retrying.') });
  useEffect(() => { onDirtyChange(isDirty || newFoodDirty || mutation.isPending); }, [isDirty, newFoodDirty, mutation.isPending, onDirtyChange]);
  const foodById = useMemo(() => new Map(foods.map((entry) => [entry.food.id, entry])), [foods]);
  const matchingFoods = useMemo(() => search.trim()
    ? foods.map((entry) => ({ entry, score: choiceMatchScore(entry.food.name, entry.food.brand, search) })).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score || a.entry.food.name.localeCompare(b.entry.food.name)).slice(0, 30).map((item) => item.entry)
    : foods.slice().sort((a, b) => b.food.created_at.localeCompare(a.food.created_at)).slice(0, 12), [foods, search]);
  const nutrition = calculateMealNutrition(components.map((component) => {
    const entry = foodById.get(component.foodId);
    return { foodId: component.foodId, food: entry ? { basisAmount: entry.food.basis_amount, basisUnit: entry.food.basis_unit, gramsPerServing: entry.food.grams_per_serving, caloriesKcal: entry.food.calories_kcal, nutrients: Object.fromEntries(fields.map((field) => [field.field_id, entry.nutrients[field.field_id] ?? null])) } : null, amount: Number(component.amount), unit: component.unit };
  }), fields.map((field) => field.field_id));
  const calories = nutrition.ok ? nutrition.nutrition.calories : null;

  function addFood(entry: FoodWithNutrients, amount = String(entry.food.default_portion_amount), unit = entry.food.default_portion_unit) {
    setComponents((current) => [...current, { key: crypto.randomUUID(), foodId: entry.food.id, amount, unit }]);
    setIsDirty(true);
    setError('');
  }
  function changeComponent(key: string, changes: Partial<DraftComponent>) {
    setComponents((current) => current.map((component) => component.key === key ? { ...component, ...changes } : component));
    setIsDirty(true);
    setError('');
  }
  function moveComponent(index: number, direction: -1 | 1) {
    setComponents((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setIsDirty(true);
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const weight = declaredWeight.trim() ? Number(declaredWeight) : undefined;
    const parsed = components.map((component) => ({ food_id: component.foodId, amount: Number(component.amount), unit: component.unit.trim() }));
    if (!cleanName || cleanName.length > 160) { setError('Give this meal a name to save it.'); return; }
    if (parsed.length < 1 || parsed.length > 100) { setError('Add at least one food to the meal.'); return; }
    if (parsed.some((component) => !component.food_id || !Number.isFinite(component.amount) || component.amount <= 0 || component.amount >= 100_000_000 || !component.unit || component.unit.length > 24) || (weight !== undefined && (!Number.isFinite(weight) || weight <= 0 || weight >= 100_000_000))) { setError('Check the amounts, units, and optional finished weight.'); return; }
    if (!nutrition.ok) {
      const item = nutrition.componentIndex == null ? 'A food' : `Food ${nutrition.componentIndex + 1}`;
      setError(nutrition.error === 'food_unavailable' ? `${item} is unavailable. Remove and add it again.` : nutrition.error === 'unknown_serving_weight' || nutrition.error === 'incompatible_unit' ? `${item} needs a unit that matches its nutrition quantity.` : `${item} needs a valid amount and unit.`);
      return;
    }
    const payload = { mealId: meal?.meal.id, expectedRevision: meal?.meal.revision, name: cleanName, sections: meal?.meal.sections?.length ? meal.meal.sections : ['unlabelled'], components: parsed, declaredTotalWeightG: weight };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    mutation.mutate({ ...payload, requestId: requestRef.current.id });
  }

  return <section className="meal-builder-page" aria-labelledby={`${requestKey}-heading`}>
    <div className="meal-builder-header"><button className="meal-builder-back" type="button" onClick={onCancel}><ArrowLeft size={19} /> Back</button><div><p className="eyebrow">YOUR KITCHEN</p><h1 id={`${requestKey}-heading`}>{meal ? 'Edit meal' : 'Build a meal'}</h1><p>Try a combination, see the nutrition, then keep it in your Library.</p></div></div>
    {error && <div className="meal-builder-alert"><StatusMessage tone="error">{error}</StatusMessage></div>}
    <div className="meal-builder-grid">
      <section className="meal-builder-source" aria-labelledby="builder-foods-title">
        <div className="meal-builder-panel-head"><div><h2 id="builder-foods-title">Find foods</h2><p>Choose ingredients from your Library.</p></div></div>
        {addingFood ? <div className="meal-builder-new-food"><button type="button" className="meal-builder-back" onClick={() => { if (newFoodDirty) setDiscardFoodOpen(true); else setAddingFood(false); }}><ArrowLeft size={18} /> Back to foods</button><h3>Add a food</h3><OneOffFoodForm key="builder-new-food" userId={userId} fields={fields} futureDate section="unlabelled" purpose="builder" onDirtyChange={setNewFoodDirty} onSavedOnly={() => { setAddingFood(false); setNewFoodDirty(false); }} onPrepared={(choice) => { setComponents((current) => [...current, { key: crypto.randomUUID(), foodId: choice.id, amount: String(choice.amount), unit: choice.unit }]); setIsDirty(true); setAddingFood(false); setNewFoodDirty(false); setSearch(''); }} /></div> : <>
          <label className="library-search meal-builder-search"><Search size={19} aria-hidden="true" /><span className="visually-hidden">Search foods</span><input type="search" value={search} placeholder="Search foods and brands" onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="meal-builder-results-head"><span>{search.trim() ? 'Matches' : 'Recently added'}</span><span>{matchingFoods.length ? `${matchingFoods.length} shown` : ''}</span></div>
          {matchingFoods.length ? <ul className="meal-builder-food-results">{matchingFoods.map((entry) => {
            const protein = fields.find((field) => field.standard_key === 'protein');
            const proteinValue = protein && entry.nutrients[protein.field_id];
            return <li key={entry.food.id}><button type="button" onClick={() => addFood(entry)} aria-label={`Add ${entry.food.name} to meal`}><span className="meal-builder-result-name"><strong>{entry.food.name}</strong>{entry.food.brand && <small>{entry.food.brand}</small>}</span><span className="meal-builder-result-facts"><span>{entry.food.calories_kcal == null ? 'Calories unknown' : `${format(entry.food.calories_kcal)} kcal`}{proteinValue != null ? ` · ${format(proteinValue)} g protein` : ''}</span><small>per {format(entry.food.basis_amount)} {entry.food.basis_unit}</small></span><Plus size={18} aria-hidden="true" /></button></li>;
          })}</ul> : <div className="meal-builder-no-results"><strong>{search.trim() ? 'No matching foods' : 'Your Library is empty'}</strong><p>{search.trim() ? 'Try a shorter name or add this food.' : 'Add the first food to start building your meal.'}</p></div>}
          <button type="button" className="meal-builder-add-food" onClick={() => setAddingFood(true)}><Plus size={18} /> Add a food</button>
        </>}
      </section>
      <form className="meal-builder-draft" onSubmit={handleSubmit} noValidate>
        <div className="meal-builder-panel-head"><div><h2>Your meal</h2><p>Adjust amounts until it feels right.</p></div><span className="meal-builder-private">Private · Library</span></div>
        <Field id={`${requestKey}-name`} label="Meal name"><input id={`${requestKey}-name`} className="text-field" maxLength={160} value={name} placeholder="e.g. Yoghurt with berries" onChange={(event) => { setName(event.target.value); setIsDirty(true); setError(''); }} /></Field>
        {components.length ? <ol className="meal-builder-components">{components.map((component, index) => {
          const entry = foodById.get(component.foodId);
          const portion = entry ? calculateFoodPortion({ basisAmount: entry.food.basis_amount, basisUnit: entry.food.basis_unit, gramsPerServing: entry.food.grams_per_serving, caloriesKcal: entry.food.calories_kcal, nutrients: {} }, Number(component.amount), component.unit) : null;
          return <li className="meal-builder-component" key={component.key}><div className="meal-builder-component-top"><span className="meal-builder-component-index">{index + 1}</span><div><strong>{entry?.food.name ?? meal?.components.find((row) => row.food_id === component.foodId)?.food?.name ?? 'Unavailable food'}</strong><small>{portion?.ok ? portion.caloriesKcal == null ? 'Calories unknown' : `${format(portion.caloriesKcal)} kcal` : 'Check amount or unit'}</small></div><button type="button" className="meal-builder-remove" aria-label={`Remove ${entry?.food.name ?? `food ${index + 1}`}`} onClick={() => { setComponents((current) => current.filter((row) => row.key !== component.key)); setIsDirty(true); }}><Trash2 size={17} /></button></div><div className="meal-builder-component-controls"><NumericField id={`${requestKey}-${component.key}-amount`} label="Amount" min={0.0001} max={99_999_999} step="any" value={component.amount} onChange={(event) => changeComponent(component.key, { amount: event.target.value })} /><UnitPicker id={`${requestKey}-${component.key}-unit`} value={component.unit} onChange={(unit) => changeComponent(component.key, { unit })} /><div className="meal-builder-order"><button type="button" aria-label={`Move ${entry?.food.name ?? 'food'} up`} disabled={index === 0} onClick={() => moveComponent(index, -1)}><ArrowUp size={17} /></button><button type="button" aria-label={`Move ${entry?.food.name ?? 'food'} down`} disabled={index === components.length - 1} onClick={() => moveComponent(index, 1)}><ArrowDown size={17} /></button></div></div></li>;
        })}</ol> : <div className="meal-builder-draft-empty"><Plus size={25} aria-hidden="true" /><strong>Start with a food</strong><p>Choose one from the Library or add your own. You can build and tweak the meal here.</p></div>}
        <section className="meal-builder-nutrition" aria-live="polite" aria-labelledby="builder-nutrition-title"><div className="meal-builder-nutrition-head"><div><span className="eyebrow">LIVE BREAKDOWN</span><h3 id="builder-nutrition-title">Nutrition for this meal</h3></div><strong>{calories?.value == null ? '—' : format(calories.value)} <small>kcal</small></strong></div>{nutrition.ok ? <><dl className="meal-builder-metrics">{fields.filter((field) => field.standard_key === 'protein' || field.standard_key === 'carbohydrate' || field.standard_key === 'fat' || field.standard_key === 'fibre').map((field) => { const metric = nutrition.nutrition.nutrients[field.field_id]; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric?.value == null ? '—' : `${format(metric.value)} ${field.unit}`}{metric && !metric.complete && metric.value != null ? <small>partial</small> : null}</dd></div>; })}</dl><details className="meal-builder-more-nutrients"><summary>All nutrients</summary><dl>{fields.filter((field) => !['protein', 'carbohydrate', 'fat', 'fibre'].includes(field.standard_key ?? '')).map((field) => { const metric = nutrition.nutrition.nutrients[field.field_id]; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric?.value == null ? 'Unknown' : `${format(metric.value)} ${field.unit}${metric.complete ? '' : ' · partial'}`}</dd></div>; })}</dl></details>{!calories?.complete && <p className="meal-builder-partial">Some foods have unknown calories. Totals show only the values available.</p>}</> : <p className="meal-builder-partial">{components.length ? 'Check food amounts and units to see the total.' : 'Add a food to see the nutrition.'}</p>}</section>
        <details className="meal-builder-details"><summary>More details</summary><NumericField id={`${requestKey}-weight`} label="Finished weight in grams" hint="Optional. Use this if you know the weight of the whole prepared meal." min={0.0001} max={99_999_999} step="any" value={declaredWeight} onChange={(event) => { setDeclaredWeight(event.target.value); setIsDirty(true); }} /></details>
        {!addingFood && <div className="meal-builder-save-bar"><span>{calories?.value == null ? 'Nutrition updates as you build' : `${format(calories.value)} kcal for this meal`}</span><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : meal ? 'Save changes' : 'Save to Library'}</Button></div>}
      </form>
    </div>
    <Dialog open={discardFoodOpen} title="Discard this food?" onClose={() => setDiscardFoodOpen(false)}><p>The food you started adding hasn’t been saved.</p><div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setDiscardFoodOpen(false)}>Keep editing</Button><Button type="button" onClick={() => { setDiscardFoodOpen(false); setAddingFood(false); setNewFoodDirty(false); }}>Discard food</Button></div></Dialog>
  </section>;
}
