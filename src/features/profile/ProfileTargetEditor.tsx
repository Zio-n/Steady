import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { queryKeys } from '../../data/queryKeys';
import { saveProfileTargets, type ProfileBundle } from '../../data/repositories/profileRepository';
import { addLocalDays, effectiveTarget, formatLocalDate, localDateInTimezone, nextLocalWeekStart } from '../../domain/dates';
import { previewWeeklyAllocations } from '../../domain/allocationPreview';
import { Button } from '../../ui/components/Button';
import { NumericField } from '../../ui/components/Field';
import { StatusMessage } from '../../ui/components/StatusMessage';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type AllocationStrategy = 'proportional' | 'equal';

function mapTargets(values: unknown, activeFieldIds: Set<string>) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  return Object.fromEntries(Object.entries(values)
    .filter(([fieldId, value]) => activeFieldIds.has(fieldId) && typeof value === 'number')
    .map(([fieldId, value]) => [fieldId, String(value)]));
}

function asTargetValues(values: Record<string, string>, activeFieldIds: Set<string>) {
  return Object.fromEntries(Object.entries(values)
    .filter(([fieldId, value]) => activeFieldIds.has(fieldId) && value.trim() !== '')
    .map(([fieldId, value]) => [fieldId, Number(value)]));
}

function stableJson(value: Record<string, number>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

export function ProfileTargetEditor({ profile, onDirtyChange }: { profile: ProfileBundle; onDirtyChange: (dirty: boolean) => void }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const timezone = profile.profile.timezone;
  const localToday = localDateInTimezone(new Date(), timezone);
  const nutrientEffectiveDate = addLocalDays(localToday, 1);
  const calorieEffectiveMonday = nextLocalWeekStart(localToday);
  const activeFieldIds = new Set(profile.nutrientFields.map((field) => field.field_id));
  const targetAtNutrientDate = effectiveTarget(profile.targetVersions, nutrientEffectiveDate);
  const targetAtCalorieDate = effectiveTarget(profile.targetVersions, calorieEffectiveMonday);
  const plannedBaseTarget = targetAtCalorieDate?.base_daily_target_kcal ?? profile.profile.base_daily_target_kcal ?? 0;
  const currentNutrientTargets = mapTargets(targetAtNutrientDate?.nutrient_targets, activeFieldIds);
  const [baseTarget, setBaseTarget] = useState(() => String(plannedBaseTarget || ''));
  const [nutrientTargets, setNutrientTargets] = useState<Record<string, string>>(() => currentNutrientTargets);
  const [allocationStrategy, setAllocationStrategy] = useState<AllocationStrategy | null>(null);
  const [formError, setFormError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const requestRef = useRef<{ signature: string; id: string } | null>(null);

  const activePattern = [...profile.weeklyPatterns]
    .filter((pattern) => pattern.version.effective_week_start <= calorieEffectiveMonday)
    .sort((left, right) => right.version.effective_week_start.localeCompare(left.version.effective_week_start))[0];
  const previousAllocation = activePattern?.days.map((day) => day.target_kcal) ?? [];
  const nextBaseNumber = Number(baseTarget);
  const isValidBase = baseTarget.trim() !== '' && Number.isInteger(nextBaseNumber) && nextBaseNumber > 0 && nextBaseNumber < 1_000_000;
  const baseChanged = isValidBase && nextBaseNumber !== plannedBaseTarget;
  const allocationPreviews = baseChanged ? previewWeeklyAllocations(previousAllocation, nextBaseNumber) : null;
  const normalizedTargets = asTargetValues(nutrientTargets, activeFieldIds);
  const targetsChanged = stableJson(normalizedTargets) !== stableJson(asTargetValues(currentNutrientTargets, activeFieldIds));
  const hasChanges = baseChanged || targetsChanged;

  const saveMutation = useMutation({
    mutationFn: saveProfileTargets,
    onSuccess: async () => {
      setFormError('');
      setSavedNotice(`Saved. Nutrient targets start ${formatLocalDate(nutrientEffectiveDate, timezone, { day: 'numeric', month: 'long' })}; a changed calorie target starts ${formatLocalDate(calorieEffectiveMonday, timezone, { day: 'numeric', month: 'long' })}.`);
      if (userId) await queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) });
    },
    onError: () => setFormError('We couldn’t save those target changes. Your current targets are unchanged; refresh and try again.'),
  });
  const isDirty = baseTarget !== String(plannedBaseTarget || '') || JSON.stringify(nutrientTargets) !== JSON.stringify(currentNutrientTargets) || saveMutation.isPending;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSavedNotice('');
    if (!isValidBase) {
      setFormError('Daily calorie target must be a positive whole number.');
      return;
    }
    if (Object.entries(normalizedTargets).some(([, value]) => !Number.isFinite(value) || value < 0 || value >= 100_000_000)) {
      setFormError('Nutrient targets must be finite, non-negative values. Leave an optional target blank to remove it.');
      return;
    }
    if (baseChanged && !allocationStrategy) {
      setFormError('Review the allocation choices and select how the new weekly target should be distributed.');
      return;
    }
    if (baseChanged && allocationStrategy === 'proportional' && !allocationPreviews?.proportional.valid) {
      setFormError('Proportional rescaling would create a zero day. Choose equal split or another calorie target.');
      return;
    }
    if (!hasChanges || !userId) return;

    const input = {
      expectedRevision: profile.profile.revision,
      baseDailyTargetKcal: nextBaseNumber,
      nutrientTargets: normalizedTargets,
      allocationStrategy: baseChanged ? allocationStrategy : null,
    };
    const signature = JSON.stringify(input);
    if (requestRef.current?.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    saveMutation.mutate({ ...input, requestId: requestRef.current.id });
  }

  function renderAllocationOption(strategy: AllocationStrategy, title: string, description: string, option: { values: number[]; valid: boolean; note?: string } | undefined) {
    if (!option) return null;
    return (
      <label className={`allocation-choice${!option.valid ? ' allocation-choice-disabled' : ''}`}>
        <input type="radio" name="allocation-strategy" value={strategy} checked={allocationStrategy === strategy} disabled={!option.valid} onChange={() => { setAllocationStrategy(strategy); setFormError(''); }} />
        <span className="allocation-choice-copy"><strong>{title}</strong><span>{description}</span>{option.note && <span className="field-error">{option.note}</span>}</span>
        <span className="allocation-preview-days">
          {option.values.map((value, index) => <span key={weekdays[index]}><small>{weekdays[index].slice(0, 3)}</small><strong>{value.toLocaleString()}</strong></span>)}
          <strong className="allocation-preview-total">{option.values.reduce((sum, value) => sum + value, 0).toLocaleString()} kcal / week</strong>
        </span>
      </label>
    );
  }

  return (
    <section className="profile-section target-editor" aria-labelledby="target-editor-heading">
      <div className="profile-section-heading"><h2 id="target-editor-heading">Targets and effective dates</h2></div>
      <p className="field-hint">Edits are dated, so completed and past records keep the targets they were created with.</p>
      {formError && <StatusMessage tone="error">{formError}</StatusMessage>}
      {savedNotice && <StatusMessage tone="success">{savedNotice}</StatusMessage>}
      <form className="profile-form" onSubmit={handleSave} noValidate>
        <NumericField id="edit-calorie-target" label="Daily calorie target" hint={`For the week beginning ${formatLocalDate(calorieEffectiveMonday, timezone, { day: 'numeric', month: 'long', year: 'numeric' })}. It will not rebalance the current week.`} min={1} max={999999} step={1} inputMode="numeric" value={baseTarget} onChange={(event) => { setBaseTarget(event.target.value); setAllocationStrategy(null); setSavedNotice(''); }} />

        {baseChanged && (
          <div className="allocation-preview" aria-labelledby="allocation-preview-heading">
            <div><p className="eyebrow">WEEKLY ALLOCATION PREVIEW</p><h3 id="allocation-preview-heading">Choose a distribution for {formatLocalDate(calorieEffectiveMonday, timezone, { day: 'numeric', month: 'long' })}</h3></div>
            <p className="field-hint">Both options total { (nextBaseNumber * 7).toLocaleString() } kcal. Nothing changes until you save.</p>
            {allocationPreviews && renderAllocationOption('proportional','Proportional rescale','Keep the current shape of your week.',allocationPreviews.proportional)}
            {allocationPreviews && renderAllocationOption('equal','Equal split','Use the new daily target on all seven days.',allocationPreviews.equal)}
            {!allocationPreviews && <StatusMessage tone="error">The current recurring week is incomplete or has invalid daily amounts; refresh before changing the base target.</StatusMessage>}
          </div>
        )}

        <div className="target-field-list">
          <div><h3>Optional nutrient targets</h3><p className="field-hint">Changes start {formatLocalDate(nutrientEffectiveDate, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}. Leave a field blank to remove its target; zero is kept as a real value.</p></div>
          {profile.nutrientFields.map((field) => (
            <NumericField key={field.field_id} id={`edit-target-${field.field_id}`} label={`${field.name} (${field.unit})`} min={0} max={99999999} step="any" inputMode="decimal" placeholder="No target" value={nutrientTargets[field.field_id] ?? ''} onChange={(event) => { setNutrientTargets((current) => ({ ...current, [field.field_id]: event.target.value })); setSavedNotice(''); }} />
          ))}
        </div>
        <Button type="submit" disabled={!hasChanges || !isValidBase || (baseChanged && !allocationStrategy) || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving target changes…' : 'Save target changes'}
        </Button>
      </form>
    </section>
  );
}
