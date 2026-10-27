import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { Tables } from '../../data/database.types';
import type { NutrientField } from '../../data/repositories/profileRepository';
import type { FoodWithNutrients } from '../../data/repositories/foodRepository';
import { saveMeal, type SavedMeal } from '../../data/repositories/mealRepository';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { StatusMessage } from '../../ui/components/StatusMessage';

const sections = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks'],
] as const;
type Section = typeof sections[number][0];
type DraftComponent = { key: string; foodId: string; amount: string; unit: string };

function makeComponent(food?: Tables<'foods'>): DraftComponent {
  return { key: crypto.randomUUID(), foodId: food?.id ?? '', amount: String(food?.default_portion_amount ?? 1), unit: food?.default_portion_unit ?? 'serving' };
}

export function MealEditor({
  meal, foods, fields, requestKey, onSaved, onCancel,
}: {
  meal: SavedMeal | null;
  foods: FoodWithNutrients[];
  fields: NutrientField[];
  requestKey: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(meal?.meal.name ?? '');
  const [selectedSections, setSelectedSections] = useState<Section[]>(() => (meal?.meal.sections ?? []) as Section[]);
  const [components, setComponents] = useState<DraftComponent[]>(() => meal
    ? meal.components.map((component) => ({ key: component.component_id, foodId: component.food_id, amount: String(component.amount), unit: component.unit }))
    : [makeComponent()]);
  const [declaredWeight, setDeclaredWeight] = useState(meal?.meal.declared_total_weight_g == null ? '' : String(meal.meal.declared_total_weight_g));
  const [multiplier, setMultiplier] = useState('1');
  const [error, setError] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const mutation = useMutation({ mutationFn: saveMeal, onSuccess: onSaved, onError: () => setError('We couldn’t save this meal. The saved recipe is unchanged; refresh and review it before retrying.') });
  const multiplierValue = Number(multiplier);
  const nutrition = calculateMealNutrition(components.map((component) => {
    const selected = foods.find((entry) => entry.food.id === component.foodId);
    return {
      foodId: component.foodId,
      food: selected ? {
        basisAmount: selected.food.basis_amount,
        basisUnit: selected.food.basis_unit,
        gramsPerServing: selected.food.grams_per_serving,
        caloriesKcal: selected.food.calories_kcal,
        nutrients: Object.fromEntries(fields.map((field) => [field.field_id, selected.nutrients[field.field_id] ?? null])),
      } : null,
      amount: Number(component.amount),
      unit: component.unit,
    };
  }), fields.map((field) => field.field_id), multiplierValue);

  function updateComponent(index: number, update: Partial<DraftComponent>) {
    setComponents((current) => current.map((component, row) => row === index ? { ...component, ...update } : component));
    setError('');
  }
  function moveComponent(index: number, direction: -1 | 1) {
    setComponents((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function toggleSection(section: Section) {
    setSelectedSections((current) => current.includes(section) ? current.filter((value) => value !== section) : [...current, section]);
    setError('');
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const weight = declaredWeight.trim() ? Number(declaredWeight) : null;
    const parsedMultiplier = Number(multiplier);
    const parsed = components.map((component) => ({
      food_id: component.foodId,
      amount: Number(component.amount),
      unit: component.unit.trim(),
    }));
    if (!cleanName || cleanName.length > 160 || selectedSections.length === 0 || selectedSections.length > 4
      || !Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0 || parsedMultiplier >= 100_000_000
      || parsed.length < 1 || parsed.length > 100
      || parsed.some((component) => !component.food_id || !Number.isFinite(component.amount) || component.amount <= 0 || component.amount >= 100_000_000 || !component.unit || component.unit.length > 24)
      || (declaredWeight.trim() && (!Number.isFinite(weight) || weight! <= 0 || weight! >= 100_000_000))) {
      setError('Add a name, at least one meal section and one active food. Check the positive serving multiplier, amounts, units and optional recipe weight.');
      return;
    }
    if (!nutrition.ok) {
      setError(nutrition.error === 'component_missing'
        ? `Choose a saved food for component ${Number(nutrition.componentIndex) + 1}.`
        : nutrition.error === 'food_unavailable'
        ? `Replace component ${Number(nutrition.componentIndex) + 1}; its food is archived or unavailable.`
        : nutrition.error === 'unknown_serving_weight'
          ? `Component ${Number(nutrition.componentIndex) + 1} cannot convert servings and mass without a declared serving weight.`
          : nutrition.error === 'incompatible_unit'
            ? `Component ${Number(nutrition.componentIndex) + 1} uses units that cannot be converted for its food.`
            : nutrition.error === 'invalid_amount'
              ? `Check the positive amount and unit for component ${Number(nutrition.componentIndex) + 1}.`
              : 'This recipe needs at least one valid component and a positive serving multiplier.');
      return;
    }
    const payload = {
      mealId: meal?.meal.id,
      expectedRevision: meal?.meal.revision,
      name: cleanName,
      sections: selectedSections,
      components: parsed,
      declaredTotalWeightG: weight ?? undefined,
    };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    mutation.mutate({ ...payload, requestId: requestRef.current.id });
  }

  return (
    <section className="profile-section meal-editor" aria-labelledby={`${requestKey}-heading`}>
      <div className="profile-section-heading"><h2 id={`${requestKey}-heading`}>{meal ? 'Edit saved meal' : 'Create a saved meal'}</h2></div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <form className="profile-form" onSubmit={handleSubmit} noValidate>
        <Field id={`${requestKey}-name`} label="Meal name">
          <input className="text-field" id={`${requestKey}-name`} value={name} maxLength={160} onChange={(event) => { setName(event.target.value); setError(''); }} />
        </Field>
        <fieldset className="meal-sections">
          <legend>Meal sections</legend>
          <p className="field-hint">Choose where this meal can be used or suggested.</p>
          <div className="meal-section-options">{sections.map(([value, label]) => <label className="meal-section-option" key={value}><input type="checkbox" checked={selectedSections.includes(value)} onChange={() => toggleSection(value)} />{label}</label>)}</div>
        </fieldset>
        <div className="meal-component-heading"><div><h3>Recipe components</h3><p className="field-hint">Amounts describe one recipe serving. Foods must remain active to save.</p></div><Button variant="secondary" type="button" onClick={() => setComponents((current) => [...current, makeComponent()])}><Plus size={16} /> Add food</Button></div>
        <ol className="meal-component-list">
          {components.map((component, index) => {
            const archivedFood = meal?.components.find((entry) => entry.food_id === component.foodId)?.food;
            return <li className="meal-component-row" key={component.key}>
              <div className="meal-component-number">{index + 1}</div>
              <div className="meal-component-fields">
                <Field id={`${requestKey}-${component.key}-food`} label="Food">
                  <select className="text-field" id={`${requestKey}-${component.key}-food`} value={component.foodId} onChange={(event) => {
                    const food = foods.find((entry) => entry.food.id === event.target.value)?.food;
                    updateComponent(index, { foodId: event.target.value, ...(food ? { amount: String(food.default_portion_amount), unit: food.default_portion_unit } : {}) });
                  }}>
                    <option value="">Choose a saved food</option>
                    {archivedFood?.archived_at && <option value={archivedFood.id} disabled>{archivedFood.name} (archived — replace this food)</option>}
                    {foods.filter((entry) => !entry.food.archived_at).map(({ food }) => <option value={food.id} key={food.id}>{food.name}{food.brand ? ` · ${food.brand}` : ''}</option>)}
                  </select>
                </Field>
                <NumericField id={`${requestKey}-${component.key}-amount`} label="Amount" min={0.0001} max={99_999_999} step="any" value={component.amount} onChange={(event) => updateComponent(index, { amount: event.target.value })} />
                <Field id={`${requestKey}-${component.key}-unit`} label="Unit">
                  <input className="text-field" id={`${requestKey}-${component.key}-unit`} value={component.unit} maxLength={24} onChange={(event) => updateComponent(index, { unit: event.target.value })} />
                </Field>
              </div>
              <div className="meal-component-actions">
                <button className="icon-button" type="button" aria-label={`Move component ${index + 1} up`} disabled={index === 0} onClick={() => moveComponent(index, -1)}><ArrowUp size={17} /></button>
                <button className="icon-button" type="button" aria-label={`Move component ${index + 1} down`} disabled={index === components.length - 1} onClick={() => moveComponent(index, 1)}><ArrowDown size={17} /></button>
                <button className="icon-button" type="button" aria-label={`Remove component ${index + 1}`} disabled={components.length === 1} onClick={() => setComponents((current) => current.filter((_, row) => row !== index))}><X size={17} /></button>
              </div>
            </li>;
          })}
        </ol>
        <div className="meal-extra-fields">
          <NumericField id={`${requestKey}-declared-weight`} label="Whole-recipe weight in grams (optional)" min={0.0001} max={99_999_999} step="any" value={declaredWeight} onChange={(event) => setDeclaredWeight(event.target.value)} />
          <NumericField id={`${requestKey}-multiplier`} label="Preview serving multiplier" min={0.0001} max={99_999_999} step="any" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} hint="Scales component quantities for review; the saved recipe remains one serving." />
        </div>
        <section className="food-portion-preview meal-nutrition-preview" aria-live="polite" aria-labelledby={`${requestKey}-nutrition-heading`}>
          <div><p className="eyebrow">RECIPE TOTALS</p><h3 id={`${requestKey}-nutrition-heading`}>Per {multiplier || '—'}× serving</h3></div>
          {!nutrition.ok ? <p className="field-hint">{nutrition.error === 'empty_recipe' ? 'Add at least one component to calculate recipe totals.' : nutrition.error === 'component_missing' ? `Choose a food for component ${Number(nutrition.componentIndex) + 1}.` : nutrition.error === 'food_unavailable' ? `Component ${Number(nutrition.componentIndex) + 1} uses a food that is no longer active.` : nutrition.error === 'unknown_serving_weight' ? `Component ${Number(nutrition.componentIndex) + 1} needs a known grams-per-serving value for this conversion.` : nutrition.error === 'incompatible_unit' ? `Component ${Number(nutrition.componentIndex) + 1} has incompatible units. Use matching units or a serving with a known gram weight.` : nutrition.error === 'invalid_amount' ? `Component ${Number(nutrition.componentIndex) + 1} needs a positive valid amount.` : 'Enter a valid positive serving multiplier.'}</p> : <>
            <dl className="food-portion-values">
              <div><dt>Calories</dt><dd>{nutrition.nutrition.calories.value === null ? 'Unknown' : `${nutrition.nutrition.calories.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} kcal${nutrition.nutrition.calories.complete ? '' : ' · partial'}`}{!nutrition.nutrition.calories.complete && <small>{nutrition.nutrition.calories.knownComponents}/{nutrition.nutrition.calories.totalComponents} components known</small>}</dd></div>
              {fields.map((field) => {
                const metric = nutrition.nutrition.nutrients[field.field_id]!;
                return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value === null ? `Unknown ${field.unit}` : `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${field.unit}${metric.complete ? '' : ' · partial'}`}{!metric.complete && metric.value !== null && <small>{metric.knownComponents}/{metric.totalComponents} components known</small>}</dd></div>;
              })}
            </dl>
            {!nutrition.nutrition.canLog && <p className="field-hint">Calories are not fully known for this recipe, so it cannot be logged until every component’s calories are entered.</p>}
          </>}
          <p className="meal-multiplier-note">Component quantities are saved as one recipe serving; the multiplier scales this preview only.</p>
        </section>
        <div className="dialog-actions food-editor-actions"><Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving meal…' : meal ? 'Save meal' : 'Create meal'}</Button></div>
      </form>
    </section>
  );
}
