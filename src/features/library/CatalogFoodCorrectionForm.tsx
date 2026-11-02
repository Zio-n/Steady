import { useState, type FormEvent } from 'react';
import { BookmarkPlus } from 'lucide-react';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { nutrientsForUserFields, type CatalogFoodSearchResult } from '../../data/repositories/catalogFoodRepository';
import { Button } from '../../ui/components/Button';
import { Field, NumericField } from '../../ui/components/Field';
import { CALORIE_MAX, CALORIE_STEP, isValidCalorie, isValidNutrient, isValidQuantity, NUTRIENT_MAX, NUTRIENT_STEP, QUANTITY_MAX, QUANTITY_MIN, QUANTITY_STEP } from '../../domain/numericLimits';

export type CatalogueFoodCorrection = {
  name: string;
  basisAmount: number;
  caloriesKcal: number | null;
  nutrients: Record<string, number>;
  isPersonallyAdjusted: boolean;
};

export function CatalogFoodCorrectionForm({ food, fields, saving, onCancel, onSave }: {
  food: CatalogFoodSearchResult;
  fields: NutrientField[];
  saving: boolean;
  onCancel: () => void;
  onSave: (correction: CatalogueFoodCorrection) => void;
}) {
  const initialNutrients = nutrientsForUserFields(food, fields);
  const [name, setName] = useState(food.name);
  const [basisAmount, setBasisAmount] = useState(String(food.basis_amount));
  const [calories, setCalories] = useState(food.calories_kcal == null ? '' : String(food.calories_kcal));
  const [nutrients, setNutrients] = useState(() => Object.fromEntries(
    fields.map((field) => [field.field_id, initialNutrients[field.field_id] == null ? '' : String(initialNutrients[field.field_id])]),
  ));

  function changeBasisAmount(raw: string) {
    const before = Number(basisAmount);
    const next = Number(raw);
    if (Number.isFinite(before) && before > 0 && Number.isFinite(next) && next > 0) {
      const ratio = next / before;
      const scale = (value: string, places: number) => value.trim() && Number.isFinite(Number(value)) ? String(Number((Number(value) * ratio).toFixed(places))) : value;
      setCalories((current) => scale(current, 4));
      setNutrients((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, scale(value, 6)])));
    }
    setBasisAmount(raw);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(basisAmount);
    const kcal = calories.trim() ? Number(calories) : null;
    const nutrientValues = Object.fromEntries(Object.entries(nutrients).flatMap(([id, raw]) => {
      if (!raw.trim()) return [];
      const value = Number(raw);
      return isValidNutrient(value) ? [[id, value]] : [];
    }));
    if (!name.trim() || name.trim().length > 160 || !isValidQuantity(amount)
      || kcal === null || !isValidCalorie(kcal)
      || Object.values(nutrients).some((raw) => raw.trim() && !isValidNutrient(raw))) return;
    const caloriesChanged = kcal !== food.calories_kcal;
    const nutrientsChanged = Object.entries(nutrients).some(([id, raw]) => {
      const original = initialNutrients[id];
      return raw.trim() ? Number(raw) !== original : original !== undefined;
    });
    onSave({ name: name.trim(), basisAmount: amount, caloriesKcal: kcal, nutrients: nutrientValues,
      isPersonallyAdjusted: name.trim() !== food.name || amount !== food.basis_amount || caloriesChanged || nutrientsChanged });
  }

  const invalidBasis = !isValidQuantity(basisAmount);
  const invalidKcal = calories.trim() === '' || !isValidCalorie(calories);
  const invalidNutrient = Object.values(nutrients).some((raw) => raw.trim() && !isValidNutrient(raw));

  return <form className="catalogue-correction" onSubmit={handleSubmit} noValidate>
    <div className="catalogue-correction-heading"><div><span className="eyebrow">FOOD DETAILS</span><h3>Edit food details</h3></div></div>
    <Field id="catalogue-copy-name" label="Food name"><input className="text-field" id="catalogue-copy-name" maxLength={160} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
    {food.brand && <p className="catalogue-correction-brand">Brand: {food.brand}</p>}
    <div className="catalogue-correction-basis">
      <NumericField id="catalogue-copy-basis" label="Nutrition basis" min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={basisAmount} onChange={(event) => changeBasisAmount(event.target.value)} />
      <Field id="catalogue-copy-unit" label="Unit"><input id="catalogue-copy-unit" className="text-field" value={food.basis_unit} readOnly /></Field>
    </div>
    <p className="field-hint">Changing the basis scales the displayed nutrient values to match. Calories are required to save a food you can log; fill in the source value if it is missing.</p>
    <div className="catalogue-correction-nutrients">
      <label htmlFor="catalogue-copy-calories">Calories <span>kcal per {basisAmount || '—'} {food.basis_unit}</span></label>
      <input id="catalogue-copy-calories" className="text-field" type="number" min="0" max={CALORIE_MAX} step={CALORIE_STEP} value={calories} onChange={(event) => setCalories(event.target.value)} placeholder="Enter calories" required />
      {fields.map((field) => <div className="catalogue-correction-nutrient" key={field.field_id}>
        <label htmlFor={`catalogue-copy-${field.field_id}`}>{field.name} <span>{field.unit} per {basisAmount || '—'} {food.basis_unit}</span></label>
        <input id={`catalogue-copy-${field.field_id}`} className="text-field" type="number" min="0" max={NUTRIENT_MAX} step={NUTRIENT_STEP} value={nutrients[field.field_id] ?? ''} onChange={(event) => setNutrients((current) => ({ ...current, [field.field_id]: event.target.value }))} placeholder="Unknown" />
      </div>)}
    </div>
    {(invalidBasis || invalidKcal || invalidNutrient || !name.trim()) && <p className="field-error" role="alert">Use a name, positive nutrition basis, and non-negative values. Calories are required; other unknown nutrients can stay blank.</p>}
    <div className="catalogue-correction-actions"><Button variant="secondary" type="button" onClick={onCancel} disabled={saving}>Back to results</Button><Button type="submit" disabled={saving || invalidBasis || invalidKcal || invalidNutrient || !name.trim()}>{saving ? 'Saving…' : <><BookmarkPlus size={16} aria-hidden="true" /> Save & add</>}</Button></div>
  </form>;
}
