import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { loadMeals, loadRoutineVersion, saveRoutineVersion, type RoutineSlotDraft } from '../../data/repositories/mealRepository';
import { loadWeeklyPlan, saveWeeklyAllocation } from '../../data/repositories/weeklyPlanRepository';
import { useProfile } from '../../features/profile/useProfile';
import { previewSelectedDayRedistribution } from '../../domain/allocationPreview';
import { addLocalDays, formatLocalDate, localDateInTimezone, startOfLocalWeek } from '../../domain/dates';
import { EmptyState } from '../components/EmptyState';
import { NumericField } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const sections = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snacks' },
] as const;
type Slot = RoutineSlotDraft;
type SaveInput = { requestId: string; effectiveFrom: string; expectedRevision: number | null; slots: Slot[] };
type WeeklySaveInput = { requestId: string; weekStart: string; expectedRevision: number; targets: number[]; allocationKind: 'recurring' | 'one_off' };
type WeeklyDraft = {
  sourceKey: string;
  values: string[];
  lastEditedIndex: number;
  selectedDayIndices: number[];
  previewValues: number[] | null;
  previewNote: string | null;
  allocationKind: 'recurring' | 'one_off';
  resetPreview: boolean;
};

function isConflict(error: unknown) {
  return error instanceof DataError && error.kind === 'conflict';
}

function retryable(error: unknown) {
  return error instanceof DataError && error.retryable;
}

export function RoutinePage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const profile = useProfile();
  const queryClient = useQueryClient();
  const timezone = profile.data?.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDateInTimezone(new Date(), timezone);
  const currentWeekStart = startOfLocalWeek(today);
  const [weekStartOverride, setWeekStartOverride] = useState<string | null>(null);
  const weekStart = weekStartOverride ?? currentWeekStart;
  const effectiveFrom = addLocalDays(today, 1);
  const [draft, setDraft] = useState<{ sourceKey: string; slots: Slot[] } | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [pendingSave, setPendingSave] = useState<SaveInput | null>(null);
  const [weeklyNotice, setWeeklyNotice] = useState('');
  const [pendingWeeklySave, setPendingWeeklySave] = useState<WeeklySaveInput | null>(null);

  const routine = useQuery({
    queryKey: userId ? queryKeys.routine(userId, effectiveFrom) : ['routine', 'signed-out', effectiveFrom],
    queryFn: () => loadRoutineVersion(userId!, effectiveFrom),
    enabled: Boolean(userId),
  });
  const mealsQuery = useQuery({
    queryKey: userId ? queryKeys.mealLibrary(userId, '') : ['meal-library', 'signed-out'],
    queryFn: () => loadMeals(userId!),
    enabled: Boolean(userId),
  });
  const weeklyPlanQuery = useQuery({
    queryKey: userId ? queryKeys.weeklyPlan(userId, weekStart) : ['weekly-plan', 'signed-out'],
    queryFn: () => loadWeeklyPlan(userId!, weekStart),
    enabled: Boolean(userId),
  });
  const mutation = useMutation({
    mutationFn: saveRoutineVersion,
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.routine(userId!, input.effectiveFrom) });
      setDraft(null);
      setPendingSave(null);
      setNotice('Routine saved. It will take effect tomorrow.');
    },
  });
  const weeklyMutation = useMutation({
    mutationFn: saveWeeklyAllocation,
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.weeklyPlan(userId!, input.weekStart) }),
        queryClient.invalidateQueries({ queryKey: ['account', userId, 'day'] }),
      ]);
      setWeeklyDraft(null);
      setPendingWeeklySave(null);
      setWeeklyNotice('Weekly allocation saved. Open-day targets have been updated.');
    },
  });

  const routineSourceKey = `${effectiveFrom}:${routine.data?.version?.id ?? 'new'}:${routine.data?.version?.revision ?? 0}`;
  const slots = draft?.sourceKey === routineSourceKey ? draft.slots : routine.data?.slots ?? [];
  const hasSavedRoutine = Boolean(routine.data?.version);
  const weeklyPlan = weeklyPlanQuery.data;
  const weeklyBaseTargets = weeklyPlan?.allocations.map((row) => row.base_target_kcal) ?? [];
  const activeWeeklyTargets = weeklyPlan?.allocations.map((row) => weeklyPlan.week.allocation_kind === 'one_off'
    ? row.override_target_kcal ?? row.base_target_kcal : row.base_target_kcal) ?? [];
  const weeklySourceKey = weeklyPlan ? `${weekStart}:${weeklyPlan.week.revision}:${weeklyPlan.week.allocation_kind}:${weeklyBaseTargets.join(',')}:${activeWeeklyTargets.join(',')}:${weeklyPlan.days.map((day) => `${day.local_date}-${day.status}-${day.revision}`).join(',')}:${weeklyPlan.carryAdjustments.map((carry) => `${carry.destination_date}-${carry.source_date}-${carry.signed_delta_kcal}-${carry.needs_review}`).join(',')}` : '';
  const weeklyValues = weeklyDraft?.sourceKey === weeklySourceKey ? weeklyDraft.values : activeWeeklyTargets.map(String);
  const activeWeeklyDraft = weeklyDraft?.sourceKey === weeklySourceKey ? weeklyDraft : null;
  const allocationKind = activeWeeklyDraft?.allocationKind ?? weeklyPlan?.week.allocation_kind ?? 'recurring';
  const parsedWeeklyValues = weeklyValues.map((value) => value.trim() === '' ? null : Number(value));
  const validWeeklyValues = parsedWeeklyValues.length === 7 && parsedWeeklyValues.every((value) => value !== null && Number.isInteger(value) && value > 0 && value < 1_000_000);
  const weeklyTotal = validWeeklyValues ? parsedWeeklyValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const weeklyBudget = weeklyPlan?.week.budget_kcal ?? 0;
  const weeklyDifference = weeklyTotal === null ? null : weeklyBudget - weeklyTotal;
  const weeklyIsBalanced = weeklyDifference !== null && Math.round(weeklyDifference * 100) === 0;
  const weeklyHasChanges = Boolean(weeklyPlan) && validWeeklyValues && (parsedWeeklyValues.some((value, index) => value !== activeWeeklyTargets[index])
    || allocationKind !== weeklyPlan?.week.allocation_kind);
  const isPastWeek = weekStart < currentWeekStart;
  const carryProtectedDates = new Set(weeklyPlan?.carryAdjustments.map((adjustment) => adjustment.destination_date) ?? []);
  const editableWeeklyDays = weeklyPlan ? weeklyPlan.days.flatMap((day, index) => isPastWeek || day.status === 'completed'
    || carryProtectedDates.has(day.local_date) ? [] : [index]) : [];
  const redistribution = activeWeeklyDraft?.previewValues
    ? previewSelectedDayRedistribution(activeWeeklyDraft.values.map(Number), weeklyBudget, activeWeeklyDraft.selectedDayIndices)
    : null;

  const availableMeals = useMemo(() => (mealsQuery.data ?? []).filter((entry) =>
    entry.components.length > 0 && entry.components.every((component) => component.food && !component.food.archived_at)), [mealsQuery.data]);
  const invalidSlots = slots.filter((slot) => {
    if (slot.mode === 'shuffle') return slot.meal_id !== null;
    const meal = availableMeals.find((entry) => entry.meal.id === slot.meal_id);
    return !meal || !meal.meal.sections.includes(slot.section);
  });

  return (
    <section className="page-stack routine-page">
      <UnsavedChangesPrompt isDirty={Boolean(draft?.sourceKey === routineSourceKey || activeWeeklyDraft || mutation.isPending || weeklyMutation.isPending)} />
      <div className="routine-page-heading"><div><p className="eyebrow">A RHYTHM THAT WORKS FOR YOU</p><h1>Routine</h1><p className="routine-intro">Build a gentle weekly outline with saved meals or Shuffle. Leave any day or section open.</p></div></div>
      <StatusMessage tone="info">Changes saved here take effect from {formatLocalDate(effectiveFrom, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}. Today's plans stay as they are.</StatusMessage>

      {weeklyPlanQuery.isPending ? <LoadingSkeleton label="Loading weekly allocation" /> : weeklyPlanQuery.isError ? <div className="page-stack"><StatusMessage tone="error">We couldn’t load this week’s allocation. No weekly targets were changed.</StatusMessage><button type="button" className="secondary-button" onClick={() => void weeklyPlanQuery.refetch()}>Try again</button></div> : weeklyPlan && <section className="allocation-week-panel" aria-labelledby="allocation-week-heading">
        <div className="allocation-week-heading-row">
          <div><p className="eyebrow">CALORIE ALLOCATION</p><h2 id="allocation-week-heading">Plan your week</h2><p className="field-hint">{formatLocalDate(weekStart, timezone, { day: 'numeric', month: 'long' })} – {formatLocalDate(addLocalDays(weekStart, 6), timezone, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
          <div className="allocation-week-navigation"><button className="icon-button" type="button" aria-label="Previous week" onClick={() => changeWeek(addLocalDays(weekStart, -7))}><ChevronLeft size={18} /></button><button className="secondary-button" type="button" onClick={() => changeWeek(currentWeekStart)}>This week</button><button className="icon-button" type="button" aria-label="Next week" onClick={() => changeWeek(addLocalDays(weekStart, 7))}><ChevronRight size={18} /></button></div>
        </div>
        <div className="allocation-week-summary" aria-label="Weekly allocation totals">
          <div><span>Weekly budget</span><strong>{formatKcal(weeklyBudget)} kcal</strong></div>
          <div><span>Planned total</span><strong>{weeklyTotal === null ? '—' : `${formatKcal(weeklyTotal)} kcal`}</strong></div>
          <div><span>Daily average</span><strong>{weeklyTotal === null ? '—' : `${formatKcal(weeklyTotal / 7)} kcal`}</strong></div>
          <div><span>Unallocated</span><strong>{weeklyDifference === null ? '—' : `${weeklyDifference > 0 ? '+' : ''}${formatKcal(weeklyDifference)} kcal`}</strong></div>
        </div>
        {weeklyPlan.carryAdjustments.length > 0 && <StatusMessage tone="info">Accepted carry adjustments are shown separately below and are not absorbed into these base weekly amounts.</StatusMessage>}
        <p className="field-hint">Edit positive whole-kcal amounts. Completed days and past weeks are read-only. Changes remain a local preview until you explicitly save them.</p>
        {isPastWeek && <StatusMessage tone="info">This week has ended, so its saved allocation is read-only.</StatusMessage>}
        <div className="allocation-week-mode">
          <div><span className="eyebrow">WEEK TYPE</span><strong>{activeWeeklyDraft?.resetPreview ? 'Reset to recurring preview' : allocationKind === 'one_off' ? 'One-off allocation' : 'Recurring allocation snapshot'}</strong><p className="field-hint">{activeWeeklyDraft?.resetPreview ? 'Saving restores this week’s stored recurring amounts. Other weeks and the recurring schedule are unchanged.' : allocationKind === 'one_off' ? 'These changes apply only to this selected week; the recurring pattern stays unchanged.' : 'This week starts from its saved recurring amounts. Choosing a one-off lets you change only this week.'}</p></div>
          {weeklyPlan.week.allocation_kind === 'recurring' && allocationKind === 'recurring' && <button type="button" className="secondary-button" disabled={isPastWeek || weeklyMutation.isPending} onClick={startOneOffPreview}>Make this week different</button>}
          {weeklyPlan.week.allocation_kind === 'recurring' && allocationKind === 'one_off' && <button type="button" className="text-button" disabled={weeklyMutation.isPending} onClick={cancelAllocationModeDraft}>Cancel one-off preview</button>}
          {weeklyPlan.week.allocation_kind === 'one_off' && !activeWeeklyDraft?.resetPreview && <button type="button" className="secondary-button" disabled={isPastWeek || weeklyMutation.isPending} onClick={previewRecurringReset}>Preview reset to recurring</button>}
          {weeklyPlan.week.allocation_kind === 'one_off' && activeWeeklyDraft?.resetPreview && <button type="button" className="text-button" disabled={weeklyMutation.isPending} onClick={cancelAllocationModeDraft}>Cancel reset preview</button>}
        </div>
        {activeWeeklyDraft?.resetPreview && <div className="allocation-reset-preview" aria-live="polite">
          <p className="field-hint">Before → after · recurring amounts for this week</p>
          <ul>{weeklyBaseTargets.every((target, index) => target === activeWeeklyTargets[index])
            ? <li>No daily amounts differ; saving changes only this week’s mode back to recurring.</li>
            : weeklyBaseTargets.flatMap((target, index) => target === activeWeeklyTargets[index] ? [] : [<li key={index}>{weekdays[index]}: {formatKcal(activeWeeklyTargets[index]!)} → <strong>{formatKcal(target)} kcal</strong></li>])}</ul>
        </div>}
        <div className="allocation-week-days">{weekdays.map((weekday, index) => {
          const date = addLocalDays(weekStart, index);
          const day = weeklyPlan.days.find((entry) => entry.local_date === date);
          const dayCarries = weeklyPlan.carryAdjustments.filter((adjustment) => adjustment.destination_date === date);
          const completed = day?.status === 'completed';
          const carryProtected = dayCarries.length > 0;
          const locked = isPastWeek || completed || carryProtected || activeWeeklyDraft?.resetPreview === true || weeklyMutation.isPending;
          const value = weeklyValues[index] ?? '';
          const parsed = value.trim() === '' ? null : Number(value);
          const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 1_000_000);
          return <div className={`allocation-week-day${locked ? ' allocation-week-day-locked' : ''}`} key={date}>
            <NumericField id={`weekly-allocation-${date}`} label={weekday} hint={formatLocalDate(date, timezone, { day: 'numeric', month: 'short' })} min={1} max={999_999} step={1} value={value} disabled={locked} error={invalid ? 'Use a positive whole-kcal amount.' : undefined} onChange={(event) => changeWeeklyAllocation(index, event.target.value)} />
            {completed && <span className="allocation-day-lock">Completed · locked</span>}
            {carryProtected && <div className="allocation-carry-notes" aria-label={`${weekday} accepted carry adjustments`}>
              {dayCarries.map((adjustment) => <span key={`${adjustment.source_date}:${adjustment.signed_delta_kcal}`}>
                Accepted carry {adjustment.signed_delta_kcal > 0 ? '+' : ''}{formatKcal(adjustment.signed_delta_kcal)} kcal from {formatLocalDate(adjustment.source_date, timezone, { day: 'numeric', month: 'short' })}{adjustment.needs_review ? ' · needs review' : ''}
              </span>)}
              <span className="allocation-day-lock">Base target protected until the carry adjustment is reviewed.</span>
            </div>}
          </div>;
        })}</div>
        {activeWeeklyDraft && !isPastWeek && activeWeeklyDraft.lastEditedIndex >= 0 && weeklyDifference !== null && weeklyDifference !== 0 && <div className="allocation-redistribution" aria-labelledby="redistribution-heading">
          <div><h3 id="redistribution-heading">Spread the weekly difference</h3><p className="field-hint">Choose editable days to share {formatKcal(Math.abs(weeklyDifference))} kcal. Your manually edited amount stays unchanged.</p></div>
          <fieldset className="allocation-redistribution-days"><legend>Days that may change</legend>{editableWeeklyDays.filter((index) => index !== activeWeeklyDraft.lastEditedIndex).map((index) => {
            const date = addLocalDays(weekStart, index);
            const checked = activeWeeklyDraft.selectedDayIndices.includes(index);
            return <label key={date} className="allocation-redistribution-day"><input type="checkbox" checked={checked} onChange={() => toggleRedistributionDay(index)} /><span>{weekdays[index]} <small>{formatLocalDate(date, timezone, { day: 'numeric', month: 'short' })}</small></span></label>;
          })}</fieldset>
          <div className="allocation-redistribution-actions"><button type="button" className="secondary-button" disabled={activeWeeklyDraft.selectedDayIndices.length === 0} onClick={previewRedistribution}>Preview spread</button></div>
          {activeWeeklyDraft.previewNote && <StatusMessage tone="error">{activeWeeklyDraft.previewNote}</StatusMessage>}
          {activeWeeklyDraft.previewValues && redistribution?.valid && <div className="allocation-redistribution-preview" aria-live="polite">
            <p className="field-hint">Preview · {formatKcal(weeklyBudget)} kcal total</p>
            <ul>{redistribution.changedDays.map((index) => <li key={index}>{weekdays[index]}: {formatKcal(Number(activeWeeklyDraft.values[index]))} → <strong>{formatKcal(activeWeeklyDraft.previewValues![index]!)} kcal</strong></li>)}</ul>
            <button type="button" className="primary-button" onClick={applyRedistribution}>Apply spread</button>
          </div>}
        </div>}
        {weeklyDifference === null ? <StatusMessage tone="info">Enter a positive whole-kcal amount for each day to see the weekly balance.</StatusMessage> : weeklyIsBalanced ? <StatusMessage tone="success">This allocation matches the weekly budget exactly.</StatusMessage> : <StatusMessage tone="info">{formatKcal(Math.abs(weeklyDifference))} kcal {weeklyDifference > 0 ? 'remain unallocated' : 'over the weekly budget'}.</StatusMessage>}
        {weeklyNotice && <StatusMessage tone="success">{weeklyNotice}</StatusMessage>}
        {weeklyMutation.isError && pendingWeeklySave && <div className="page-stack">
          <StatusMessage tone="error">{isConflict(weeklyMutation.error) ? 'This allocation changed elsewhere or has a protected day adjustment. Refresh and review it before saving again.' : 'We couldn’t confirm this allocation save. Refresh to check its state; a retry will reuse the same request.'}</StatusMessage>
          {retryable(weeklyMutation.error) && <button className="secondary-button" type="button" disabled={weeklyMutation.isPending} onClick={() => weeklyMutation.mutate(pendingWeeklySave)}>Retry allocation save safely</button>}
          <button className="text-button" type="button" onClick={() => void weeklyPlanQuery.refetch()}>Refresh weekly allocation</button>
        </div>}
        <button className="primary-button" type="button" disabled={weeklyMutation.isPending || !weeklyHasChanges || !weeklyIsBalanced || isPastWeek} onClick={saveWeekly}>
          <Save size={17} /> {weeklyMutation.isPending ? 'Saving allocation…' : activeWeeklyDraft?.resetPreview ? 'Reset to recurring pattern' : allocationKind === 'one_off' ? 'Save one-off week' : 'Save recurring allocation'}
        </button>
      </section>}

      {profile.isError && <StatusMessage tone="error">We couldn’t load your timezone. Your routine is unchanged.</StatusMessage>}
      {routine.isError && <div className="page-stack"><StatusMessage tone="error">We couldn’t load the routine for tomorrow. Your saved schedule is safe.</StatusMessage><button type="button" className="secondary-button" onClick={() => void routine.refetch()}>Try again</button></div>}
      {mealsQuery.isError && <div className="page-stack"><StatusMessage tone="error">Saved meals could not be loaded, so this routine cannot be edited yet.</StatusMessage><button type="button" className="secondary-button" onClick={() => void mealsQuery.refetch()}>Try again</button></div>}
      {availableMeals.length === 0 && slots.some((slot) => slot.meal_id && !availableMeals.some((entry) => entry.meal.id === slot.meal_id)) && <StatusMessage tone="error">A fixed meal or one of its ingredients is unavailable. Replace the slot with an active saved meal, remove the slot, or inspect saved recipes in <a href="/library?view=meals">Meals in Library</a>.</StatusMessage>}
      {(routine.isPending || mealsQuery.isPending || profile.isPending) ? <LoadingSkeleton label="Loading your weekly routine" /> : availableMeals.length === 0 && slots.length === 0 && !hasSavedRoutine ? (
        <EmptyState icon={<CalendarDays size={24} />} title="Your weekly outline can wait"><p>Save a meal in Library first, then return here to add fixed meals or Shuffle slots.</p><a className="secondary-button" href="/library">Open Library</a></EmptyState>
      ) : <div className="routine-week-list">{weekdays.map((weekday, weekdayIndex) => (
        <article className="routine-day-card" key={weekday}>
          <div className="routine-day-heading"><span className="routine-day-index">{String(weekdayIndex + 1).padStart(2, '0')}</span><h2>{weekday}</h2></div>
          {sections.map((section) => {
            const group = slots.filter((slot) => slot.weekday === weekdayIndex + 1 && slot.section === section.id).sort((a, b) => a.position - b.position);
            return <div className="routine-slot-group" key={section.id}>
              <div className="routine-slot-group-heading"><h3>{section.label}</h3><button className="routine-add-slot" type="button" disabled={availableMeals.length === 0} onClick={() => addSlot(weekdayIndex + 1, section.id)}><Plus size={15} /> Add slot</button></div>
              {group.length === 0 ? <p className="routine-empty-slot">No {section.label.toLowerCase()} planned</p> : group.map((slot, index) => {
                const choices = availableMeals.filter((entry) => entry.meal.sections.includes(section.id));
                const selectedUnavailable = slot.meal_id && !choices.some((entry) => entry.meal.id === slot.meal_id);
                return <div className="routine-slot-row" key={slot.slot_id}>
                  <label className="routine-control"><span>Type</span><select className="text-field" aria-label={`${weekday} ${section.label} slot type`} value={slot.mode} onChange={(event) => updateSlot(slot.slot_id, { mode: event.target.value as Slot['mode'], meal_id: null })}><option value="fixed">Fixed meal</option><option value="shuffle">Shuffle</option></select></label>
                  {slot.mode === 'fixed' ? <label className="routine-control routine-meal-select"><span>Saved meal</span><select className="text-field" aria-label={`${weekday} ${section.label} saved meal`} value={slot.meal_id ?? ''} onChange={(event) => updateSlot(slot.slot_id, { meal_id: event.target.value || null })}><option value="">Choose a meal</option>{selectedUnavailable && <option value={slot.meal_id!}>Unavailable — choose another</option>}{choices.map((entry) => <option value={entry.meal.id} key={entry.meal.id}>{entry.meal.name}</option>)}</select></label> : <div className="routine-shuffle-label"><Shuffle size={17} /><span>Shuffle chooses a saved {section.label.toLowerCase()}</span></div>}
                  <NumericField id={`routine-${slot.slot_id}-multiplier`} label="Servings" min={0.0001} max={999_999} step="any" value={String(slot.default_multiplier)} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0 && value < 1_000_000) updateSlot(slot.slot_id, { default_multiplier: value }); }} />
                  <div className="routine-slot-actions"><button type="button" className="icon-button" aria-label={`Move ${section.label.toLowerCase()} slot up`} disabled={index === 0} onClick={() => moveSlot(slot, -1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" aria-label={`Move ${section.label.toLowerCase()} slot down`} disabled={index === group.length - 1} onClick={() => moveSlot(slot, 1)}><ArrowDown size={16} /></button><button type="button" className="icon-button routine-remove-slot" aria-label={`Remove ${section.label.toLowerCase()} slot`} onClick={() => changeSlots((current) => current.filter((entry) => entry.slot_id !== slot.slot_id))}><Trash2 size={16} /></button></div>
                  {selectedUnavailable && <p className="routine-unavailable-message">This fixed choice can no longer be used. Pick another meal above, or remove this slot. If the recipe is still in your Library, edit it to replace unavailable ingredients: <a href="/library?view=meals">open Meals in Library</a>.</p>}
                </div>;
              })}
            </div>;
          })}
        </article>
      ))}</div>}

      {(availableMeals.length > 0 || slots.length > 0 || hasSavedRoutine) && <div className="routine-save-area">
        {slots.length > 0 && invalidSlots.length > 0 && <p className="field-hint">Choose an active saved meal tagged for the section shown before saving.</p>}
        {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
        {mutation.isError && pendingSave && <div className="page-stack"><StatusMessage tone="error">{isConflict(mutation.error) ? 'This routine changed in another session. Refresh before saving another edit.' : 'We couldn’t confirm this routine save. Refresh to check its state; retrying will reuse the same request.'}</StatusMessage>{retryable(mutation.error) && <button className="secondary-button" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(pendingSave)}>Retry routine save safely</button>}<button className="text-button" type="button" onClick={() => void routine.refetch()}>Refresh routine</button></div>}
        <button className="primary-button" type="button" disabled={mutation.isPending || invalidSlots.length > 0 || routine.isError} onClick={save}><Save size={17} /> {mutation.isPending ? 'Saving routine…' : 'Save routine'}</button>
      </div>}
    </section>
  );

  function changeWeek(nextWeekStart: string) {
    setWeekStartOverride(nextWeekStart);
    setWeeklyDraft(null);
  }

  function changeWeeklyAllocation(dayIndex: number, value: string) {
    const previous = weeklyDraft?.sourceKey === weeklySourceKey ? weeklyDraft : null;
    const eligible = editableWeeklyDays.filter((index) => index !== dayIndex);
    setWeeklyDraft({
      sourceKey: weeklySourceKey,
      values: weeklyValues.map((currentValue, index) => index === dayIndex ? value : currentValue),
      lastEditedIndex: dayIndex,
      selectedDayIndices: previous ? previous.selectedDayIndices.filter((index) => eligible.includes(index)) : eligible,
      previewValues: null,
      previewNote: null,
      allocationKind: previous?.allocationKind ?? weeklyPlan?.week.allocation_kind ?? 'recurring',
      resetPreview: false,
    });
  }

  function startOneOffPreview() {
    if (!weeklyPlan || isPastWeek || weeklyPlan.week.allocation_kind !== 'recurring') return;
    setWeeklyNotice('');
    setWeeklyDraft({
      sourceKey: weeklySourceKey,
      values: [...weeklyValues],
      lastEditedIndex: activeWeeklyDraft?.lastEditedIndex ?? -1,
      selectedDayIndices: activeWeeklyDraft?.selectedDayIndices ?? [],
      previewValues: null,
      previewNote: null,
      allocationKind: 'one_off',
      resetPreview: false,
    });
  }

  function previewRecurringReset() {
    if (!weeklyPlan || isPastWeek || weeklyPlan.week.allocation_kind !== 'one_off') return;
    setWeeklyNotice('');
    setWeeklyDraft({
      sourceKey: weeklySourceKey,
      values: weeklyBaseTargets.map(String),
      lastEditedIndex: -1,
      selectedDayIndices: [],
      previewValues: null,
      previewNote: null,
      allocationKind: 'recurring',
      resetPreview: true,
    });
  }

  function cancelAllocationModeDraft() {
    setWeeklyDraft(null);
    setWeeklyNotice('');
  }

  function toggleRedistributionDay(dayIndex: number) {
    if (!activeWeeklyDraft) return;
    const selected = activeWeeklyDraft.selectedDayIndices.includes(dayIndex)
      ? activeWeeklyDraft.selectedDayIndices.filter((index) => index !== dayIndex)
      : [...activeWeeklyDraft.selectedDayIndices, dayIndex];
    setWeeklyDraft({ ...activeWeeklyDraft, selectedDayIndices: selected, previewValues: null, previewNote: null });
  }

  function previewRedistribution() {
    if (!activeWeeklyDraft) return;
    const parsed = activeWeeklyDraft.values.map((value) => value.trim() === '' ? NaN : Number(value));
    const result = previewSelectedDayRedistribution(parsed, weeklyBudget, activeWeeklyDraft.selectedDayIndices);
    if (!result) {
      setWeeklyDraft({ ...activeWeeklyDraft, previewValues: null, previewNote: 'Enter valid positive whole-kcal amounts and choose at least one editable day.' });
      return;
    }
    setWeeklyDraft({ ...activeWeeklyDraft, previewValues: result.values, previewNote: result.valid ? null : result.note ?? 'This spread is not valid.' });
  }

  function applyRedistribution() {
    if (!activeWeeklyDraft || !redistribution?.valid || !activeWeeklyDraft.previewValues) return;
    setWeeklyDraft({ ...activeWeeklyDraft, values: activeWeeklyDraft.previewValues.map(String), previewValues: null, previewNote: null });
  }

  function saveWeekly() {
    if (!userId || !weeklyPlan || !validWeeklyValues || !weeklyIsBalanced || !weeklyHasChanges || isPastWeek) return;
    const input: WeeklySaveInput = {
      requestId: crypto.randomUUID(),
      weekStart,
      expectedRevision: weeklyPlan.week.revision,
      targets: parsedWeeklyValues as number[],
      allocationKind,
    };
    setPendingWeeklySave(input);
    setWeeklyNotice('');
    weeklyMutation.reset();
    weeklyMutation.mutate(input);
  }

  function addSlot(weekday: number, section: Slot['section']) {
    setNotice('');
    const position = slots.filter((slot) => slot.weekday === weekday && slot.section === section).length;
    changeSlots((current) => [...current, { slot_id: crypto.randomUUID(), weekday, section, mode: 'fixed', meal_id: null, default_multiplier: 1, position }]);
  }

  function updateSlot(slotId: string, changes: Partial<Slot>) {
    setNotice('');
    changeSlots((current) => current.map((slot) => slot.slot_id === slotId ? { ...slot, ...changes } : slot));
  }

  function moveSlot(target: Slot, direction: -1 | 1) {
    const siblings = slots.filter((slot) => slot.weekday === target.weekday && slot.section === target.section).sort((a, b) => a.position - b.position);
    const index = siblings.findIndex((slot) => slot.slot_id === target.slot_id);
    const other = siblings[index + direction];
    if (!other) return;
    const reordered = [...siblings];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction]!, reordered[index]!];
    changeSlots((current) => current.map((slot) => {
      if (slot.weekday !== target.weekday || slot.section !== target.section) return slot;
      const nextIndex = reordered.findIndex((entry) => entry.slot_id === slot.slot_id);
      return { ...slot, position: nextIndex };
    }));
  }

  function save() {
    if (!userId || !routine.data || invalidSlots.length > 0) return;
    const orderedSlots = [...slots].sort((a, b) => a.weekday - b.weekday || sections.findIndex((section) => section.id === a.section) - sections.findIndex((section) => section.id === b.section) || a.position - b.position);
    const input: SaveInput = {
      requestId: crypto.randomUUID(),
      effectiveFrom,
      expectedRevision: routine.data.version?.revision ?? null,
      slots: normalizePositions(orderedSlots),
    };
    setPendingSave(input);
    setNotice('');
    mutation.reset();
    mutation.mutate(input);
  }

  function changeSlots(update: (current: Slot[]) => Slot[]) {
    setDraft((current) => ({
      sourceKey: routineSourceKey,
      slots: update(current?.sourceKey === routineSourceKey ? current.slots : routine.data?.slots ?? []),
    }));
  }
}

function normalizePositions(slots: Slot[]): Slot[] {
  const positions = new Map<string, number>();
  return slots.map((slot) => {
    const group = `${slot.weekday}:${slot.section}`;
    const position = positions.get(group) ?? 0;
    positions.set(group, position + 1);
    return { ...slot, position };
  });
}

function formatKcal(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
