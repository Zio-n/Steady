import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadFoodLibrary } from '../../data/repositories/foodRepository';
import { saveMeal } from '../../data/repositories/mealRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { nextIdempotentRequest } from '../../domain/requestIdentity';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import type { PreparedChoice } from './AddChoiceDialog';

const sections = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type Row = { key: string; foodId: string; amount: string; unit: string };
const newRow = (): Row => ({ key: crypto.randomUUID(), foodId: '', amount: '1', unit: 'serving' });

export function OneOffMealForm({ userId, fields, futureDate, section: daySection, onPrepared, onDirtyChange }: {
  userId: string;
  fields: NutrientField[];
  futureDate: boolean;
  section: PreparedChoice['section'];
  onPrepared: (choice: PreparedChoice) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [portion, setPortion] = useState('1');
  const [section, setSection] = useState<(typeof sections)[number] | ''>('');
  const [components, setComponents] = useState<Row[]>([newRow()]);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const saveRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
  const foods = useQuery({
    queryKey: [...queryKeys.foods(userId), 'one-off-meal-foods'],
    queryFn: async () => {
      const result = [] as Awaited<ReturnType<typeof loadFoodLibrary>>['entries'];
      let offset = 0;
      let more = true;
      while (more) {
        const page = await loadFoodLibrary(userId, '', offset, 100, 'name');
        result.push(...page.entries);
        offset += page.entries.length;
        more = page.hasMore;
      }
      return result;
    },
  });
  const saveMutation = useMutation({
    mutationFn: saveMeal,
    onSuccess: async () => {
      setSavedNotice('Saved to Library. This has not been logged yet.');
      await queryClient.invalidateQueries({ queryKey: ['account', userId, 'meal-library'] });
    },
    onError: () => setError('We couldn’t confirm this Library save. Check the Library after reconnecting; retrying unchanged details in this open tab uses the same request.'),
  });
  const firstComponent = components[0];
  const isDirty = name !== '' || portion !== '1' || section !== '' || components.length !== 1
    || firstComponent?.foodId !== '' || firstComponent?.amount !== '1' || firstComponent?.unit !== 'serving' || saveMutation.isPending;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);
  const rows = foods.data ?? [];
  const preview = calculateMealNutrition(components.map((component) => {
    const entry = rows.find((food) => food.food.id === component.foodId);
    return {
      foodId: component.foodId,
      food: entry ? {
        basisAmount: entry.food.basis_amount,
        basisUnit: entry.food.basis_unit,
        gramsPerServing: entry.food.grams_per_serving,
        caloriesKcal: entry.food.calories_kcal,
        nutrients: Object.fromEntries(fields.map((field) => [field.field_id, entry.nutrients[field.field_id] ?? null])),
      } : null,
      amount: Number(component.amount),
      unit: component.unit,
    };
  }), fields.map((field) => field.field_id), Number(portion));

  function updateRow(index: number, changes: Partial<Row>) {
    setComponents((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
    setError('');
  }
  function canSubmit() {
    return name.trim().length > 0 && name.trim().length <= 160 && preview.ok
      && (futureDate || preview.nutrition.canLog)
      && components.every((component) => rows.some((entry) => entry.food.id === component.foodId));
  }
  function prepare() {
    if (!canSubmit() || !preview.ok) {
      setError(!futureDate && preview.ok && !preview.nutrition.canLog
        ? 'Every component needs known calories before the meal can be logged.'
        : 'Add a meal name and valid active food components with compatible positive amounts.');
      return;
    }
    onPrepared({
      kind: 'one_off_meal', id: crypto.randomUUID(), name: name.trim(), amount: Number(portion), unit: 'serving', section: daySection,
      snapshot: { components: components.map((component) => ({ food_id: component.foodId, amount: Number(component.amount), unit: component.unit })), nutrition: preview.nutrition },
    });
  }
  function saveToLibrary() {
    if (!canSubmit() || !preview.ok || !section) {
      setError(!section ? 'Choose a meal section before saving this recipe to Library.' : 'Review the recipe name and components before saving.');
      return;
    }
    const input = {
      name: name.trim(), sections: [section],
      components: components.map((component) => ({ food_id: component.foodId, amount: Number(component.amount), unit: component.unit })),
    };
    saveRequestRef.current = nextIdempotentRequest(saveRequestRef.current, input, () => crypto.randomUUID());
    saveMutation.mutate({ ...input, requestId: saveRequestRef.current.requestId });
    setError('');
  }

  return <div className="one-off-entry">
    <p className="field-hint">Build this meal from saved foods. Repeated foods stay as separate recipe components.</p>
    {foods.isPending && <LoadingSkeleton label="Loading foods for a one-off meal" />}
    {foods.isError && <StatusMessage tone="error">We couldn’t load saved foods. Your Library is unchanged; retry after reconnecting.</StatusMessage>}
    {error && <StatusMessage tone="error">{error}</StatusMessage>}
    {savedNotice && <StatusMessage tone="success">{savedNotice}</StatusMessage>}
    <Field id="oneoff-meal-name" label="Meal name"><input className="text-field" id="oneoff-meal-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
    <div className="meal-component-heading"><div><h3>Foods in this meal</h3><p className="field-hint">Each component is independently scaled; nothing is silently merged.</p></div><Button variant="secondary" type="button" onClick={() => setComponents((current) => [...current, newRow()])}><Plus size={16} /> Add food</Button></div>
    <ol className="meal-component-list">{components.map((component, index) => <li className="meal-component-row" key={component.key}>
      <div className="meal-component-number">{index + 1}</div><div className="meal-component-fields">
        <Field id={`oneoff-meal-${component.key}-food`} label="Food"><select className="text-field" id={`oneoff-meal-${component.key}-food`} value={component.foodId} onChange={(event) => { const food = rows.find((entry) => entry.food.id === event.target.value)?.food; updateRow(index, { foodId: event.target.value, ...(food ? { amount: String(food.default_portion_amount), unit: food.default_portion_unit } : {}) }); }}><option value="">Choose a saved food</option>{rows.map((entry) => <option key={entry.food.id} value={entry.food.id}>{entry.food.name}{entry.food.brand ? ` · ${entry.food.brand}` : ''}</option>)}</select></Field>
        <NumericField id={`oneoff-meal-${component.key}-amount`} label="Amount" min={0.0001} max={99_999_999} step="any" value={component.amount} onChange={(event) => updateRow(index, { amount: event.target.value })} />
        <Field id={`oneoff-meal-${component.key}-unit`} label="Unit"><input className="text-field" id={`oneoff-meal-${component.key}-unit`} value={component.unit} maxLength={24} onChange={(event) => updateRow(index, { unit: event.target.value })} /></Field>
      </div><div className="meal-component-actions"><button className="icon-button" type="button" aria-label={`Move component ${index + 1} up`} disabled={index === 0} onClick={() => setComponents((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}><ArrowUp size={17} /></button><button className="icon-button" type="button" aria-label={`Move component ${index + 1} down`} disabled={index === components.length - 1} onClick={() => setComponents((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; return next; })}><ArrowDown size={17} /></button><button className="icon-button" type="button" aria-label={`Remove component ${index + 1}`} disabled={components.length === 1} onClick={() => setComponents((current) => current.filter((_, row) => row !== index))}><X size={17} /></button></div>
    </li>)}</ol>
    <NumericField id="oneoff-meal-portion" label="Meal servings" min={0.0001} max={99_999_999} step="any" value={portion} onChange={(event) => setPortion(event.target.value)} />
    {preview.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{preview.nutrition.calories.value === null ? 'Unknown' : `${preview.nutrition.calories.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} kcal${preview.nutrition.calories.complete ? '' : ' · partial'}`}</dd></div>{fields.map((field) => { const metric = preview.nutrition.nutrients[field.field_id]!; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value === null ? `Unknown ${field.unit}` : `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${field.unit}${metric.complete ? '' : ' · partial'}`}</dd></div>; })}</dl>}
    {!preview.ok && <p className="field-hint">{preview.error === 'incompatible_unit' ? `Component ${Number(preview.componentIndex) + 1} has incompatible units.` : preview.error === 'unknown_serving_weight' ? `Component ${Number(preview.componentIndex) + 1} needs a known serving weight.` : 'Choose a food and valid positive amount for each component.'}</p>}
    <div className="one-off-save-row"><Field id="oneoff-meal-section" label="Save to Library section (optional)"><select className="text-field" id="oneoff-meal-section" value={section} onChange={(event) => setSection(event.target.value as typeof section)}><option value="">Do not save to Library</option>{sections.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></Field><Button variant="secondary" type="button" disabled={saveMutation.isPending || !section} onClick={saveToLibrary}>{saveMutation.isPending ? 'Saving…' : 'Save to Library'}</Button></div>
    <div className="one-off-actions"><Button type="button" disabled={!canSubmit() || saveMutation.isPending} onClick={prepare}>{futureDate ? 'Add to plan' : 'Continue to log'}</Button></div>
  </div>;
}
