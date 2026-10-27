import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { saveFood } from '../../data/repositories/foodRepository';
import { queryKeys } from '../../data/queryKeys';
import { calculateFoodPortion } from '../../domain/foodNutrition.ts';
import { nextIdempotentRequest } from '../../domain/requestIdentity';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { StatusMessage } from '../../ui/components/StatusMessage';
import type { PreparedChoice } from './AddChoiceDialog';

export function OneOffFoodForm({ userId, fields, futureDate, section, onPrepared, onDirtyChange }: {
  userId: string;
  fields: NutrientField[];
  futureDate: boolean;
  section: PreparedChoice['section'];
  onPrepared: (choice: PreparedChoice) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [basisAmount, setBasisAmount] = useState('100');
  const [basisUnit, setBasisUnit] = useState('g');
  const [amount, setAmount] = useState('100');
  const [unit, setUnit] = useState('g');
  const [calories, setCalories] = useState('');
  const [nutrients, setNutrients] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const saveRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
  const saveMutation = useMutation({
    mutationFn: saveFood,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.foods(userId) }); },
    onError: () => setError('We couldn’t confirm this Library save. Check the Library after reconnecting; retrying unchanged details in this open tab uses the same request.'),
  });
  const isDirty = name !== '' || basisAmount !== '100' || basisUnit !== 'g' || amount !== '100' || unit !== 'g'
    || calories !== '' || Object.values(nutrients).some((value) => value !== '') || saveMutation.isPending;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);
  const numeric = (value: string) => value.trim() ? Number(value) : null;
  const foodCalories = numeric(calories);
  const nutrientValues = Object.fromEntries(fields.map((field) => [field.field_id, numeric(nutrients[field.field_id] ?? '')]));
  const preview = calculateFoodPortion({
    basisAmount: Number(basisAmount), basisUnit, gramsPerServing: null,
    caloriesKcal: foodCalories,
    nutrients: nutrientValues,
  }, Number(amount), unit);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || name.trim().length > 160 || !preview.ok
      || (foodCalories !== null && (!Number.isFinite(foodCalories) || foodCalories < 0 || foodCalories >= 100_000_000))
      || fields.some((field) => { const value = nutrientValues[field.field_id]; return value !== null && (!Number.isFinite(value) || value < 0 || value >= 100_000_000); })) {
      setError('Add a name and valid positive amount/unit. Calories and nutrients may be left unknown, but must be non-negative when entered.');
      return;
    }
    if (!futureDate && !preview.canLog) {
      setError('Calories need to be known before this item can be logged. You can still save it to Library.');
      return;
    }
    onPrepared({ kind: 'one_off_food', id: crypto.randomUUID(), name: name.trim(), amount: Number(amount), unit, section, snapshot: {
      basisAmount: Number(basisAmount), basisUnit, caloriesKcal: foodCalories,
      nutrients: nutrientValues,
    } });
  }

  function saveToLibrary() {
    if (!name.trim() || name.trim().length > 160 || !Number.isFinite(Number(basisAmount)) || Number(basisAmount) <= 0
      || !basisUnit.trim() || basisUnit.length > 24 || !Number.isFinite(Number(amount)) || Number(amount) <= 0
      || !unit.trim() || unit.length > 24 || foodCalories !== null && (!Number.isFinite(foodCalories) || foodCalories < 0)
      || fields.some((field) => { const value = nutrientValues[field.field_id]; return value !== null && (!Number.isFinite(value) || value < 0); })) {
      setError('Check the name, basis, portion and nutrition values before saving this food.');
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
    saveMutation.mutate({ ...input, requestId: saveRequestRef.current.requestId });
    setError('');
  }

  return <form className="one-off-entry" onSubmit={handleSubmit} noValidate>
    <p className="field-hint">Enter nutrition for a single portion. Saving to Library is a separate, explicit action.</p>
    {error && <StatusMessage tone="error">{error}</StatusMessage>}
    {saveMutation.isSuccess && <StatusMessage tone="success">Saved to Library. This has not been logged yet.</StatusMessage>}
    <Field id="oneoff-food-name" label="Food name"><input className="text-field" id="oneoff-food-name" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
    <div className="choice-portion-fields"><NumericField id="oneoff-basis-amount" label="Nutrition amount" min={0.0001} max={99_999_999} step="any" value={basisAmount} onChange={(event) => setBasisAmount(event.target.value)} /><Field id="oneoff-basis-unit" label="Basis unit"><input className="text-field" id="oneoff-basis-unit" value={basisUnit} maxLength={24} onChange={(event) => setBasisUnit(event.target.value)} /></Field></div>
    <div className="choice-portion-fields"><NumericField id="oneoff-portion-amount" label="Portion amount" min={0.0001} max={99_999_999} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} /><Field id="oneoff-portion-unit" label="Portion unit"><input className="text-field" id="oneoff-portion-unit" value={unit} maxLength={24} onChange={(event) => setUnit(event.target.value)} /></Field></div>
    <NumericField id="oneoff-calories" label="Calories (kcal)" min={0} max={99_999_999} step="any" value={calories} onChange={(event) => setCalories(event.target.value)} hint="Leave blank if unknown; unknown-calorie foods cannot be logged." />
    {fields.map((field) => <NumericField key={field.field_id} id={`oneoff-${field.field_id}`} label={`${field.name} (${field.unit})`} min={0} max={99_999_999} step="any" value={nutrients[field.field_id] ?? ''} onChange={(event) => setNutrients((current) => ({ ...current, [field.field_id]: event.target.value }))} />)}
    {preview.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{preview.caloriesKcal === null ? 'Unknown' : `${preview.caloriesKcal.toLocaleString(undefined, { maximumFractionDigits: 2 })} kcal`}</dd></div>{fields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{preview.nutrients[field.field_id] === null ? `Unknown ${field.unit}` : `${preview.nutrients[field.field_id]?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${field.unit}`}</dd></div>)}</dl>}
    <div className="one-off-actions"><Button variant="secondary" type="button" disabled={saveMutation.isPending} onClick={saveToLibrary}>{saveMutation.isPending ? 'Saving to Library…' : 'Save to Library'}</Button><Button type="submit" disabled={!preview.ok || saveMutation.isPending}>{futureDate ? 'Add to plan' : 'Continue to log'}</Button></div>
  </form>;
}
