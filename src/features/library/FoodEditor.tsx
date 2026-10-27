import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { saveFood, type FoodWithNutrients, type SaveFoodInput } from '../../data/repositories/foodRepository';
import { calculateFoodPortion } from '../../domain/foodNutrition';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { StatusMessage } from '../../ui/components/StatusMessage';

type Draft = {
  name: string;
  brand: string;
  basisAmount: string;
  basisUnit: string;
  gramsPerServing: string;
  defaultPortionAmount: string;
  defaultPortionUnit: string;
  caloriesKcal: string;
  nutrients: Record<string, string>;
};

function draftFromFood(food: FoodWithNutrients | null, fields: NutrientField[]): Draft {
  return {
    name: food?.food.name ?? '',
    brand: food?.food.brand ?? '',
    basisAmount: String(food?.food.basis_amount ?? 100),
    basisUnit: food?.food.basis_unit ?? 'g',
    gramsPerServing: food?.food.grams_per_serving == null ? '' : String(food.food.grams_per_serving),
    defaultPortionAmount: String(food?.food.default_portion_amount ?? 1),
    defaultPortionUnit: food?.food.default_portion_unit ?? 'serving',
    caloriesKcal: food?.food.calories_kcal == null ? '' : String(food.food.calories_kcal),
    nutrients: Object.fromEntries(fields.map((field) => [field.field_id,
      food?.nutrients[field.field_id] == null ? '' : String(food.nutrients[field.field_id]),
    ])),
  };
}

function parsePositive(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100_000_000 ? number : null;
}

function parseOptionalNonNegative(value: string) {
  if (!value.trim()) return { valid: true as const, value: null };
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 100_000_000
    ? { valid: true as const, value: number }
    : { valid: false as const, value: null };
}

export function FoodEditor({
  food,
  fields,
  requestKey,
  onSaved,
  onCancel,
}: {
  food: FoodWithNutrients | null;
  fields: NutrientField[];
  requestKey: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFromFood(food, fields));
  const [error, setError] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);
  const saveMutation = useMutation({ mutationFn: saveFood, onSuccess: onSaved, onError: () => setError('We couldn’t save that food. Your library is unchanged; refresh and try again.') });
  const previewBasis = parsePositive(draft.basisAmount);
  const previewGramsPerServing = draft.gramsPerServing.trim() ? parsePositive(draft.gramsPerServing) : null;
  const previewCalories = parseOptionalNonNegative(draft.caloriesKcal);
  const previewNutrients = Object.fromEntries(fields.map((field) => {
    const parsed = parseOptionalNonNegative(draft.nutrients[field.field_id] ?? '');
    return [field.field_id, parsed.valid ? parsed.value : null];
  }));
  const portionPreview = previewBasis && parsePositive(draft.defaultPortionAmount) && draft.basisUnit.trim()
    ? calculateFoodPortion({
      basisAmount: previewBasis,
      basisUnit: draft.basisUnit,
      gramsPerServing: previewGramsPerServing,
      caloriesKcal: previewCalories.valid ? previewCalories.value : null,
      nutrients: previewNutrients,
    }, Number(draft.defaultPortionAmount), draft.defaultPortionUnit)
    : null;

  function setField<K extends keyof Omit<Draft, 'nutrients'>>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const brand = draft.brand.trim();
    const basisAmount = parsePositive(draft.basisAmount);
    const defaultPortionAmount = parsePositive(draft.defaultPortionAmount);
    const gramsPerServing = draft.gramsPerServing.trim() ? parsePositive(draft.gramsPerServing) : null;
    const calories = parseOptionalNonNegative(draft.caloriesKcal);
    if (!name || name.length > 160 || brand.length > 120 || !basisAmount || !defaultPortionAmount
      || !draft.basisUnit.trim() || draft.basisUnit.trim().length > 24
      || !draft.defaultPortionUnit.trim() || draft.defaultPortionUnit.trim().length > 24
      || (draft.gramsPerServing.trim() !== '' && gramsPerServing === null) || !calories.valid) {
      setError('Check the name, units and amounts. Required amounts must be positive; calories may be zero or left unknown.');
      return;
    }
    const nutrients: Record<string, number> = {};
    for (const field of fields) {
      const raw = draft.nutrients[field.field_id] ?? '';
      const value = parseOptionalNonNegative(raw);
      if (!value.valid) {
        setError(`${field.name} must be a non-negative value, or blank if unknown.`);
        return;
      }
      if (value.value !== null) nutrients[field.field_id] = value.value;
    }

    const payload: Omit<SaveFoodInput, 'requestId'> = {
      id: food?.food.id ?? null,
      expectedRevision: food?.food.revision ?? null,
      name,
      brand: brand || null,
      basisAmount,
      basisUnit: draft.basisUnit.trim(),
      gramsPerServing,
      defaultPortionAmount,
      defaultPortionUnit: draft.defaultPortionUnit.trim(),
      caloriesKcal: calories.value,
      nutrients,
    };
    const signature = JSON.stringify(payload);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    saveMutation.mutate({ ...payload, requestId: requestRef.current.id });
  }

  return (
    <section className="profile-section food-editor" aria-labelledby="food-editor-heading">
      <div className="profile-section-heading"><h2 id="food-editor-heading">{food ? 'Edit food' : 'Add a food'}</h2></div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <form className="profile-form" onSubmit={handleSubmit} noValidate>
        <div className="food-basic-fields">
          <Field id={`${requestKey}-name`} label="Food name">
            <input className="text-field" id={`${requestKey}-name`} value={draft.name} maxLength={160} autoComplete="off" onChange={(event) => setField('name', event.target.value)} />
          </Field>
          <Field id={`${requestKey}-brand`} label="Brand (optional)">
            <input className="text-field" id={`${requestKey}-brand`} value={draft.brand} maxLength={120} autoComplete="off" onChange={(event) => setField('brand', event.target.value)} />
          </Field>
        </div>

        <div className="food-amount-fields">
          <NumericField id={`${requestKey}-basis-amount`} label="Nutrient basis amount" min={0.0001} max={99999999} step="any" value={draft.basisAmount} onChange={(event) => setField('basisAmount', event.target.value)} />
          <Field id={`${requestKey}-basis-unit`} label="Basis unit">
            <input className="text-field" id={`${requestKey}-basis-unit`} value={draft.basisUnit} maxLength={24} onChange={(event) => setField('basisUnit', event.target.value)} />
          </Field>
          <NumericField id={`${requestKey}-default-amount`} label="Default portion amount" min={0.0001} max={99999999} step="any" value={draft.defaultPortionAmount} onChange={(event) => setField('defaultPortionAmount', event.target.value)} />
          <Field id={`${requestKey}-default-unit`} label="Default portion unit">
            <input className="text-field" id={`${requestKey}-default-unit`} value={draft.defaultPortionUnit} maxLength={24} onChange={(event) => setField('defaultPortionUnit', event.target.value)} />
          </Field>
          <NumericField id={`${requestKey}-grams-per-serving`} label="Grams per serving (optional)" min={0.0001} max={99999999} step="any" value={draft.gramsPerServing} onChange={(event) => setField('gramsPerServing', event.target.value)} />
        </div>
        <p className="field-hint">Values below describe the nutrient basis amount. Grams per serving is only used when the serving weight is known.</p>

        <div className="food-nutrient-fields">
          <h3>Nutrients per {draft.basisAmount || 'basis amount'} {draft.basisUnit.trim() || 'unit'}</h3>
          <NumericField id={`${requestKey}-calories`} label="Calories (kcal)" min={0} max={99999999} step="any" value={draft.caloriesKcal} onChange={(event) => setField('caloriesKcal', event.target.value)} />
          {!draft.caloriesKcal.trim() && <p className="field-hint">Leave blank if unknown. This food cannot be logged until its calories are known.</p>}
          {fields.map((field) => (
            <NumericField key={field.field_id} id={`${requestKey}-nutrient-${field.field_id}`} label={`${field.name} (${field.unit})`} min={0} max={99999999} step="any" value={draft.nutrients[field.field_id] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, nutrients: { ...current.nutrients, [field.field_id]: event.target.value } }))} />
          ))}
          {fields.length === 0 && <p className="field-hint">Add optional nutrient definitions in Profile to record them for foods.</p>}
        </div>
        <section className="food-portion-preview" aria-live="polite" aria-labelledby={`${requestKey}-preview-heading`}>
          <div><p className="eyebrow">PORTION CHECK</p><h3 id={`${requestKey}-preview-heading`}>Default portion: {draft.defaultPortionAmount || '—'} {draft.defaultPortionUnit || 'unit'}</h3></div>
          {!portionPreview && <p className="field-hint">Enter a valid positive amount, basis amount and unit to preview this portion.</p>}
          {portionPreview && !portionPreview.ok && <p className="field-hint">{portionPreview.reason === 'unknown_serving_weight' ? 'Cannot convert a serving to grams until grams per serving is known.' : portionPreview.reason === 'incompatible_unit' ? 'These units are not directly convertible. Use matching units or a serving with a known gram weight.' : 'Enter a valid positive amount to preview this portion.'}</p>}
          {portionPreview?.ok && (
            <dl className="food-portion-values">
              <div><dt>Calories</dt><dd>{portionPreview.caloriesKcal === null ? 'Unknown · cannot log yet' : `${portionPreview.caloriesKcal.toLocaleString(undefined, { maximumFractionDigits: 3 })} kcal`}</dd></div>
              {fields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{portionPreview.nutrients[field.field_id] === null ? `Unknown ${field.unit}` : `${portionPreview.nutrients[field.field_id]?.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${field.unit}`}</dd></div>)}
            </dl>
          )}
        </section>
        <div className="dialog-actions food-editor-actions">
          <Button variant="secondary" type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving food…' : food ? 'Save food' : 'Add food'}</Button>
        </div>
      </form>
    </section>
  );
}
