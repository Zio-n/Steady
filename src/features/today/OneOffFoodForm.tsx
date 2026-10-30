import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, ChevronDown, Plus, Search, X } from 'lucide-react';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { saveFood } from '../../data/repositories/foodRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { nextIdempotentRequest } from '../../domain/requestIdentity';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { UnitPicker } from '../../ui/components/UnitPicker';
import { StatusMessage } from '../../ui/components/StatusMessage';
import type { PreparedChoice } from './AddChoiceDialog';

export function OneOffFoodForm({ userId, fields, futureDate, section, onPrepared, onSavedOnly, onDirtyChange, onAddIngredients, extraFields, purpose = 'day' }: {
  userId: string;
  fields: NutrientField[];
  futureDate: boolean;
  section: PreparedChoice['section'];
  onPrepared: (choice: PreparedChoice) => void;
  onSavedOnly: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onAddIngredients?: (name: string, hasNutritionEdits: boolean) => void;
  extraFields?: ReactNode;
  purpose?: 'day' | 'builder';
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [basisAmount, setBasisAmount] = useState('100');
  const [basisUnit, setBasisUnit] = useState('g');
  const [amount, setAmount] = useState('100');
  const [unit, setUnit] = useState('g');
  const [calories, setCalories] = useState('');
  const [nutrients, setNutrients] = useState<Record<string, string>>({});
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(() => fields.filter((field) => field.standard_key === 'protein').map((field) => field.field_id));
  const [nutrientOpen, setNutrientOpen] = useState(false);
  const [nutrientSearch, setNutrientSearch] = useState('');
  const [error, setError] = useState('');
  const saveRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
  const saveMutation = useMutation({
    mutationFn: saveFood,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.foods(userId) }); },
  });
  const isDirty = name !== '' || basisAmount !== '100' || basisUnit !== 'g' || amount !== '100' || unit !== 'g'
    || calories !== '' || Object.values(nutrients).some((value) => value !== '') || saveMutation.isPending;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);
  const numeric = (value: string) => value.trim() ? Number(value) : null;
  const foodCalories = numeric(calories);
  const selectedFields = fields.filter((field) => selectedFieldIds.includes(field.field_id));
  const availableFields = fields.filter((field) => !selectedFieldIds.includes(field.field_id));
  const filteredAvailableFields = availableFields.filter((field) => field.name.toLocaleLowerCase().includes(nutrientSearch.trim().toLocaleLowerCase()));
  const nutrientValues = Object.fromEntries(selectedFields.map((field) => [field.field_id, numeric(nutrients[field.field_id] ?? '')]));
  const preview = calculateFoodPortion({
    basisAmount: Number(basisAmount), basisUnit, gramsPerServing: null,
    caloriesKcal: foodCalories,
    nutrients: nutrientValues,
  }, Number(amount), unit);

  async function persist(mode: 'save' | 'add') {
    if (!name.trim() || name.trim().length > 160 || !preview.ok
      || !basisUnit.trim() || basisUnit.length > 24 || !unit.trim() || unit.length > 24
      || (foodCalories !== null && (!Number.isFinite(foodCalories) || foodCalories < 0 || foodCalories >= 100_000_000))
      || selectedFields.some((field) => { const value = nutrientValues[field.field_id]; return value !== null && (!Number.isFinite(value) || value < 0 || value >= 100_000_000); })) {
      setError('Add a name and valid positive amount/unit. Calories and nutrients may be left unknown, but must be non-negative when entered.');
      return;
    }
    if (mode === 'add' && purpose === 'day' && !futureDate && !preview.canLog) {
      setError('Calories need to be known before this food can be logged.');
      return;
    }
    const knownNutrients = Object.fromEntries(Object.entries(nutrientValues).filter((entry): entry is [string, number] => entry[1] !== null));
    const input = {
      id: null, expectedRevision: null, name: name.trim(), brand: null,
      basisAmount: Number(basisAmount), basisUnit: basisUnit.trim(), gramsPerServing: null,
      defaultPortionAmount: Number(amount), defaultPortionUnit: unit.trim(), caloriesKcal: foodCalories,
      nutrients: knownNutrients,
    };
    saveRequestRef.current = nextIdempotentRequest(saveRequestRef.current, input, () => crypto.randomUUID());
    setError('');
    try {
      const result = await saveMutation.mutateAsync({ ...input, requestId: saveRequestRef.current.requestId });
      const savedId = result && typeof result === 'object' && !Array.isArray(result) ? result.id : null;
      if (typeof savedId !== 'string') throw new Error('Missing saved item ID');
      if (mode === 'save') onSavedOnly(name.trim());
      else onPrepared({ kind: 'food', id: savedId, name: name.trim(), amount: Number(amount), unit: unit.trim(), section });
    } catch {
      setError('We couldn’t confirm this save. Check your Library before retrying; an unchanged retry uses the same request.');
    }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist('add');
  }

  return <form className="one-off-entry" onSubmit={handleSubmit} noValidate>
    <p className="field-hint">Add a food using its nutrition label or your own estimate.</p>
    {onAddIngredients && <button className="text-button" type="button" onClick={() => onAddIngredients(name, basisAmount !== '100' || basisUnit !== 'g' || amount !== '100' || unit !== 'g' || calories !== '' || Object.values(nutrients).some((value) => value !== ''))}>Build from ingredients instead</button>}
    {error && <StatusMessage tone="error">{error}</StatusMessage>}
    <Field id="oneoff-food-name" label="Food name"><input className="text-field" id="oneoff-food-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
    <div className="food-entry-group food-entry-nutrition"><div className="food-entry-group-heading"><strong>Nutrition</strong><span>Use the label or your own estimate. Add only the values you know.</span></div>
      <div className="food-entry-basis"><div className="food-entry-group-heading"><strong>Nutrition is for</strong><span>The quantity shown on the label, usually 100 g.</span></div><div className="choice-portion-fields"><NumericField id="oneoff-basis-amount" label="Amount" min={0.0001} max={99_999_999} step="any" value={basisAmount} onChange={(event) => setBasisAmount(event.target.value)} /><UnitPicker id="oneoff-basis-unit" value={basisUnit} onChange={(next) => { if (unit === basisUnit) setUnit(next); setBasisUnit(next); }} /></div></div>
      <div className="food-nutrient-list"><p className="food-nutrient-caption">Values per {basisAmount || '—'} {basisUnit || 'unit'}</p>
        <div className="food-nutrient-row"><label htmlFor="oneoff-calories">Calories</label><div className="food-nutrient-value"><input id="oneoff-calories" type="number" className="text-field" min={0} max={99_999_999} step="any" value={calories} onChange={(event) => setCalories(event.target.value)} /><span>kcal</span></div><span aria-hidden="true" /></div>
        {selectedFields.map((field) => <div className="food-nutrient-row" key={field.field_id}><label htmlFor={`oneoff-${field.field_id}`}>{field.name}</label><div className="food-nutrient-value"><input id={`oneoff-${field.field_id}`} type="number" className="text-field" min={0} max={99_999_999} step="any" value={nutrients[field.field_id] ?? ''} onChange={(event) => setNutrients((current) => ({ ...current, [field.field_id]: event.target.value }))} /><span>{field.unit}</span></div><button className="food-nutrient-remove" type="button" aria-label={`Remove ${field.name}`} onClick={() => { setSelectedFieldIds((current) => current.filter((id) => id !== field.field_id)); setNutrients((current) => { const next = { ...current }; delete next[field.field_id]; return next; }); }}><X size={17} /></button></div>)}
        {purpose === 'day' && <p className="field-hint">Calories are needed to log this food as eaten.</p>}
      </div>
      {availableFields.length > 0 && <div className="food-nutrient-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setNutrientOpen(false); }}><button className="food-nutrient-add" type="button" aria-expanded={nutrientOpen} aria-controls="oneoff-nutrient-options" onClick={() => { setNutrientSearch(''); setNutrientOpen((current) => !current); }}><Plus size={16} /> Add nutrient <ChevronDown size={15} /></button>{nutrientOpen && <div id="oneoff-nutrient-options" className="food-nutrient-options"><label className="food-nutrient-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">Search nutrients</span><input autoFocus type="search" placeholder="Find a nutrient" value={nutrientSearch} onChange={(event) => setNutrientSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNutrientOpen(false); }} /></label><div className="food-nutrient-options-list">{filteredAvailableFields.map((field) => <button key={field.field_id} type="button" onClick={() => { setSelectedFieldIds((current) => [...current, field.field_id]); setNutrientOpen(false); setNutrientSearch(''); }}>{field.name}<span>{field.unit}</span></button>)}{filteredAvailableFields.length === 0 && <p>No matching nutrients</p>}</div></div>}</div>}
    </div>
    <div className="food-entry-group"><div className="food-entry-group-heading"><strong>Amount to add</strong><span>{purpose === 'builder' ? 'How much of this food goes in the meal.' : 'How much you ate or plan to eat.'}</span></div><div className="choice-portion-fields"><NumericField id="oneoff-portion-amount" label="Amount" min={0.0001} max={99_999_999} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /><UnitPicker id="oneoff-portion-unit" value={unit} onChange={setUnit} /></div>{!preview.ok && <p className="field-error" role="alert">{preview.reason === 'incompatible_unit' || preview.reason === 'unknown_serving_weight' ? 'Use a unit that matches the nutrition quantity above.' : 'Enter positive amounts for the nutrition quantity and amount to add.'}</p>}
    </div>
    {preview.ok && <dl className="food-portion-values"><div><dt>Calories for this amount</dt><dd>{preview.caloriesKcal === null ? 'Unknown' : `${preview.caloriesKcal.toLocaleString(undefined, { maximumFractionDigits: 2 })} kcal`}</dd></div>{selectedFields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{preview.nutrients[field.field_id] === null ? `Unknown ${field.unit}` : `${preview.nutrients[field.field_id]?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${field.unit}`}</dd></div>)}</dl>}
    {extraFields}
    <div className="one-off-actions"><Button type="submit" disabled={!preview.ok || saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : purpose === 'builder' ? 'Add to meal' : futureDate ? 'Add to plan' : 'Log as eaten'}</Button><Button className="one-off-save-library" variant="secondary" type="button" aria-label="Save to Library only" title="Save to Library only" disabled={!preview.ok || saveMutation.isPending} onClick={() => void persist('save')}><BookmarkPlus size={20} strokeWidth={1.8} aria-hidden="true" /></Button></div>
  </form>;
}
