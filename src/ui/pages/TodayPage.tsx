import { useState } from 'react';
import { CheckCircle2, CirclePlus, Pencil, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { acceptWholeDayShuffle, completeDay, correctCompletedDayItem, ensureDaySnapshot, loadDayView, logDayItem, planDayItem, removePlannedDayItem, replaceDayItem, replacePlannedDayItem, resizePlannedDayItem, reviseDayItem, type AcceptWholeDayShuffleInput, type CompleteDayInput, type CorrectCompletedDayItemInput, type PlanDayItemInput, type ReplaceDayItemInput, type ReplacePlannedDayItemInput, type WholeDayShuffleChange } from '../../data/repositories/dayRepository';
import { loadCarryDecisions } from '../../data/repositories/carryRepository';
import { ensureRoutineDay } from '../../data/repositories/mealRepository';
import { useProfile } from '../../features/profile/useProfile';
import { AddChoiceDialog, type PreparedChoice } from '../../features/today/AddChoiceDialog';
import { addLocalDays, effectiveTarget, formatLocalDate, localDateInTimezone } from '../../domain/dates';
import { plannedItemName, readPlannedChoice, summarizeDay, readEatenSnapshot, type DayItem } from '../../domain/daySummary.ts';
import { calculateCarryDifference } from '../../domain/carry';
import { DateStepper } from '../components/DateStepper';
import { Field, NumericField } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { RoutineMealReviewDialog } from '../../features/today/RoutineMealReviewDialog';
import { ShuffleSlotDialog, WholeDayShuffleDialog } from '../../features/today/ShuffleSlotDialog';
import { CarryDecisionPreview } from '../../features/today/CarryDecisionPreview';
import { Dialog } from '../components/Dialog';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

const sectionNames = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' } as const;
const money = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const isConflict = (error: unknown) => error instanceof DataError && error.kind === 'conflict';
const canSafelyRetry = (error: unknown) => error instanceof DataError && error.retryable;

function metricLabel(value: number | null, complete: boolean, unit: string, empty: boolean) {
  if (empty) return `0 ${unit}`;
  if (value === null) return 'Unknown';
  return `${money(value)} ${unit}${complete ? '' : ' · partial'}`;
}

export function TodayPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const userId = session?.user.id;
  const timezone = profile.data?.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDateInTimezone(new Date(), timezone);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [preparedChoice, setPreparedChoice] = useState<PreparedChoice | null>(null);
  const [savedNotice, setSavedNotice] = useState('');
  const [editingItem, setEditingItem] = useState<{ id: string; amount: string; unit: string } | null>(null);
  const [replacingItem, setReplacingItem] = useState<{ id: string; localDate: string; revision: number; section: PreparedChoice['section'] } | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<ReplaceDayItemInput | null>(null);
  const [pendingCompletedCorrection, setPendingCompletedCorrection] = useState<CorrectCompletedDayItemInput | null>(null);
  const [undoTicket, setUndoTicket] = useState<{ id: string; localDate: string; revision: number } | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanDayItemInput | null>(null);
  const [editingPlannedItem, setEditingPlannedItem] = useState<{ id: string; localDate: string; amount: string } | null>(null);
  const [pendingPortionOverride, setPendingPortionOverride] = useState<Parameters<typeof resizePlannedDayItem>[0] | null>(null);
  const [choosingInstead, setChoosingInstead] = useState<{ id: string; localDate: string; revision: number; section: PreparedChoice['section'] } | null>(null);
  const [pendingPlanReplacement, setPendingPlanReplacement] = useState<ReplacePlannedDayItemInput | null>(null);
  const [reviewingRoutineItem, setReviewingRoutineItem] = useState<DayItem | null>(null);
  const [shufflingItem, setShufflingItem] = useState<DayItem | null>(null);
  const [shufflingWholeDay, setShufflingWholeDay] = useState(false);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const activeDate = selectedDate ?? today;
  const isToday = activeDate === today;
  const targetVersion = effectiveTarget(profile.data?.targetVersions ?? [], activeDate);
  const target = targetVersion?.base_daily_target_kcal;
  const dayQuery = useQuery({
    queryKey: userId ? queryKeys.day(userId, activeDate) : ['day', 'signed-out', activeDate],
    queryFn: async () => {
      if (targetVersion) await ensureDaySnapshot(activeDate);
      await ensureRoutineDay(activeDate);
      return loadDayView(userId!, activeDate);
    },
    enabled: Boolean(userId && !profile.isPending),
  });
  const completedCarryQuery = useQuery({
    queryKey: userId && dayQuery.data?.day?.week_start ? queryKeys.carryDecisions(userId, dayQuery.data.day.week_start, activeDate) : ['carry-decisions', 'unavailable', activeDate],
    queryFn: () => loadCarryDecisions(userId!, activeDate),
    enabled: Boolean(userId && dayQuery.data?.day?.status === 'completed'),
  });
  const logMutation = useMutation({
    mutationFn: logDayItem,
    onError: (_error, input) => { if (input.plannedItemId) setReviewingRoutineItem(null); },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(userId!) }),
      ]);
      setPreparedChoice(null);
      if (input.plannedItemId) setReviewingRoutineItem(null);
      setSavedNotice(input.plannedItemId ? 'Marked as eaten. Your other plans remain uneaten.' : 'Logged and saved to this day.');
    },
  });
  const planMutation = useMutation({
    mutationFn: planDayItem,
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setPendingPlan(null);
      setSavedNotice('Added to your plan. It is not counted as eaten.');
    },
  });
  const removePlannedMutation = useMutation({
    mutationFn: removePlannedDayItem,
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setEditingPlannedItem(null);
      setSavedNotice('Removed from your plan.');
    },
  });
  const portionOverrideMutation = useMutation({
    mutationFn: resizePlannedDayItem,
    onError: (error) => { if (isConflict(error)) setEditingPlannedItem(null); },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setEditingPlannedItem(null);
      setPendingPortionOverride(null);
      setSavedNotice('Portion saved for this date. Your weekly routine stays unchanged.');
    },
  });
  const planReplacementMutation = useMutation({
    mutationFn: replacePlannedDayItem,
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setPendingPlanReplacement(null);
      setSavedNotice('Plan updated. It remains uneaten and is not counted.');
    },
  });
  const wholeDayShuffleMutation = useMutation({
    mutationFn: acceptWholeDayShuffle,
    onError: (error, input) => {
      if (isConflict(error)) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.mealLibrary(userId!, '') }),
        ]);
      }
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setShufflingWholeDay(false);
      setSavedNotice('All selected plans were updated together. They remain uneaten.');
    },
  });
  const correctionMutation = useMutation({
    mutationFn: (input: Parameters<typeof reviseDayItem>[0] | CorrectCompletedDayItemInput) => 'expectedDayRevision' in input
      ? correctCompletedDayItem(input)
      : reviseDayItem(input),
    onError: (error, input) => {
      if (isConflict(error) && 'expectedDayRevision' in input && userId) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, input.localDate) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.carryDecisions(userId, day?.week_start ?? '', input.localDate) }),
        ]);
      }
    },
    onSuccess: async (result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(userId!) }),
        ...(day?.week_start ? [queryClient.invalidateQueries({ queryKey: queryKeys.carryDecisions(userId!, day.week_start, input.localDate) })] : []),
      ]);
      const details = result !== null && typeof result === 'object' && !Array.isArray(result) ? result : null;
      if (input.action === 'remove') {
        const nested = details?.mutation !== null && typeof details?.mutation === 'object' && !Array.isArray(details?.mutation) ? details.mutation : details;
        setUndoTicket({ id: input.itemId, localDate: input.localDate, revision: typeof nested?.item_revision === 'number' ? nested.item_revision : input.expectedRevision + 1 });
        setSavedNotice(typeof details?.new_actual_kcal === 'number'
          ? `Correction saved. Actual is now ${money(details.new_actual_kcal)} kcal; the completed target stayed frozen. You can undo this change.`
          : 'Removed from this day. You can undo this change.');
      } else if (input.action === 'restore') {
        setUndoTicket(null);
        setSavedNotice(typeof details?.new_actual_kcal === 'number'
          ? `Correction saved. Actual is now ${money(details.new_actual_kcal)} kcal; the completed target stayed frozen.`
          : 'Restored to this day.');
      } else {
        setUndoTicket(null);
        setSavedNotice('Portion updated from the original nutrition snapshot.');
        if (typeof details?.new_actual_kcal === 'number') setSavedNotice(`Correction saved. Actual is now ${money(details.new_actual_kcal)} kcal; the completed target stayed frozen.`);
      }
      setEditingItem(null);
      setPendingCompletedCorrection(null);
      setPendingReplacement(null);
    },
  });
  const replacementMutation = useMutation({
    mutationFn: replaceDayItem,
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(userId!) }),
      ]);
      setPendingReplacement(null);
      setSavedNotice('Replaced with current nutrition values. The original entry remains in its history.');
    },
  });
  const completionMutation = useMutation({
    mutationFn: completeDay,
    onError: (error, input) => {
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.day(userId!, input.localDate) });
      setConfirmingCompletion(false);
      setSavedNotice('Day marked fully logged. Planned items remain uneaten and are not counted.');
    },
  });
  const items = dayQuery.data?.items ?? [];
  const displayedFields = profile.data?.nutrientFields.filter((field) => field.is_displayed) ?? [];
  const summary = summarizeDay(items, displayedFields.map((field) => field.field_id));
  const day = dayQuery.data?.day;
  const dayIsCompleted = day?.status === 'completed';
  const activeSourceTransfers = completedCarryQuery.data?.filter((decision) => decision.state === 'active' && decision.action !== 'none') ?? [];
  const reversedSourceTransfers = completedCarryQuery.data?.filter((decision) => decision.state === 'reversed' && decision.action !== 'none') ?? [];
  const completedCorrectionReady = dayIsCompleted && completedCarryQuery.isSuccess && !completedCarryQuery.isFetching && activeSourceTransfers.length === 0;
  const activeCarryTotal = dayIsCompleted ? 0 : dayQuery.data?.carryAdjustments.reduce((sum, carry) => sum + carry.signed_delta_kcal, 0) ?? 0;
  const effectiveTargetKcal = dayIsCompleted
    ? day.completed_target_kcal
    : day?.base_planned_target_kcal != null ? day.base_planned_target_kcal + activeCarryTotal : target;
  const calorieSummary = summary.calories;
  const displayedCalories = dayIsCompleted && day.completed_actual_kcal !== null
    ? { ...calorieSummary, value: day.completed_actual_kcal, complete: true }
    : calorieSummary;
  const completionDifference = dayIsCompleted && day.completed_actual_kcal !== null && day.completed_target_kcal !== null
    ? calculateCarryDifference(day.completed_actual_kcal, day.completed_target_kcal)
    : null;
  const completionDifferenceText = completionDifference
    ? completionDifference.differenceKcal === 0 ? 'Exactly on target'
      : `${money(Math.abs(completionDifference.differenceKcal))} kcal ${completionDifference.differenceKcal < 0 ? 'below' : 'above'} target`
    : null;
  const hasPendingDayWrite = logMutation.isPending || planMutation.isPending || removePlannedMutation.isPending
    || portionOverrideMutation.isPending || planReplacementMutation.isPending || wholeDayShuffleMutation.isPending
    || correctionMutation.isPending || replacementMutation.isPending || completionMutation.isPending;
  const hasUnfinishedDayEdit = isAdding || Boolean(preparedChoice || pendingPlan || editingPlannedItem || pendingPortionOverride
    || choosingInstead || pendingPlanReplacement || reviewingRoutineItem || shufflingItem || shufflingWholeDay
    || editingItem || pendingReplacement);
  const canCompleteDay = Boolean(userId && day && !dayIsCompleted && activeDate <= today && effectiveTargetKcal
    && calorieSummary.complete && !hasPendingDayWrite && !hasUnfinishedDayEdit && !dayQuery.isFetching);
  const remaining = effectiveTargetKcal != null && calorieSummary.value != null ? effectiveTargetKcal - calorieSummary.value : null;
  const progressWidth = effectiveTargetKcal && calorieSummary.value !== null
    ? `${Math.min(100, Math.max(0, calorieSummary.value / effectiveTargetKcal * 100))}%` : '0%';
  const nutrientTargets = targetVersion?.nutrient_targets;

  // A cold failed read is not an empty day. Do not render zero intake or
  // quiet empty meal sections when the saved record is unavailable.
  if (dayQuery.isError && !dayQuery.data) return (
    <div className="page-stack today-page">
      <UnsavedChangesPrompt isDirty={hasUnfinishedDayEdit || hasPendingDayWrite} />
      <div className="date-navigation">
        <div><p className="eyebrow">YOUR DAY, AT YOUR PACE</p><h1>{isToday ? 'Today' : formatLocalDate(activeDate, timezone, { weekday: 'long' })}</h1></div>
        <DateStepper label={formatLocalDate(activeDate, timezone, { day: 'numeric', month: 'short' })} todayLabel="Return to today" onPrevious={() => setSelectedDate(addLocalDays(activeDate, -1))} onToday={() => setSelectedDate(null)} onNext={() => setSelectedDate(addLocalDays(activeDate, 1))} />
      </div>
      <StatusMessage tone="error">We couldn’t load this day. Its saved totals and meals are unavailable until the connection returns.</StatusMessage>
      <button className="secondary-button" type="button" onClick={() => void dayQuery.refetch()}>Retry loading this day</button>
    </div>
  );

  return (
    <div className="page-stack today-page">
      <UnsavedChangesPrompt isDirty={hasUnfinishedDayEdit || hasPendingDayWrite} />
      <div className="date-navigation">
        <div>
          <p className="eyebrow">{isToday ? 'YOUR DAY, AT YOUR PACE' : formatLocalDate(activeDate, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{isToday ? 'Today' : formatLocalDate(activeDate, timezone, { weekday: 'long' })}</h1>
        </div>
        <DateStepper label={formatLocalDate(activeDate, timezone, { day: 'numeric', month: 'short' })} todayLabel="Return to today" onPrevious={() => setSelectedDate(addLocalDays(activeDate, -1))} onToday={() => setSelectedDate(null)} onNext={() => setSelectedDate(addLocalDays(activeDate, 1))} />
      </div>

      {profile.isError && <StatusMessage tone="error">We couldn’t load your profile targets. Your food records are safe.</StatusMessage>}
      {dayQuery.isError && <div className="page-stack"><StatusMessage tone="error">We couldn’t refresh this day. Values shown below were last loaded while connected.</StatusMessage><button className="secondary-button" type="button" onClick={() => void dayQuery.refetch()}>Retry refresh</button></div>}

      <section className="calorie-card" aria-label="Daily calorie summary">
        <div className="calorie-card-heading"><span>Calories</span><span className="target-unset">{effectiveTargetKcal == null ? 'Target not set' : `${money(effectiveTargetKcal)} kcal target${activeCarryTotal !== 0 ? ` · includes ${activeCarryTotal > 0 ? '+' : ''}${money(activeCarryTotal)} carry` : ''}`}</span></div>
        {dayQuery.isPending || profile.isPending ? <LoadingSkeleton label="Loading your daily calorie summary" /> : <>
          <div className="calorie-number">{displayedCalories.value === null ? 'Unknown' : money(displayedCalories.value)} <span>{dayIsCompleted ? 'kcal at completion' : `kcal eaten${!displayedCalories.complete && displayedCalories.value !== null ? ' · partial' : ''}`}</span></div>
          {effectiveTargetKcal == null ? <div className="calorie-track" aria-hidden="true"><span style={{ width: progressWidth }} /></div> : <div className="calorie-track" role="progressbar" aria-label="Calories eaten compared with target" aria-valuemin={0} aria-valuemax={effectiveTargetKcal} aria-valuenow={displayedCalories.value ?? 0} aria-valuetext={`${displayedCalories.value ?? 'unknown'} of ${effectiveTargetKcal} kilocalories${displayedCalories.complete ? '' : ', partial known amount'}`}><span style={{ width: progressWidth }} /></div>}
          <p className="calorie-caption">{dayIsCompleted ? 'This is the saved completion snapshot.' : effectiveTargetKcal == null ? 'Nothing is assumed. Set a target in Profile if you want one.' : remaining === null ? 'Some logged calories are unknown, so the remaining amount is partial.' : !calorieSummary.complete ? remaining >= 0 ? `At least ${money(remaining)} kcal remain based on known values` : `At least ${money(Math.abs(remaining))} kcal over target based on known values` : remaining >= 0 ? `${money(remaining)} kcal remaining` : `${money(Math.abs(remaining))} kcal over target`}{!calorieSummary.complete && calorieSummary.value !== null && !dayIsCompleted ? ` · ${calorieSummary.knownEntries}/${calorieSummary.totalEntries} logged items have known calories` : ''}</p>
        </>}
      </section>

      {activeDate <= today && day && <section className={`day-completion-card${dayIsCompleted ? ' is-completed' : ''}`} aria-label="Day completion">
        {dayIsCompleted ? <>
          <div className="day-completion-heading"><CheckCircle2 size={21} aria-hidden="true" /><div><h2>Day fully logged</h2><p>Completion snapshot saved; review or correct the log when needed.</p></div></div>
          <dl className="day-completion-snapshot"><div><dt>Eaten at completion</dt><dd>{day.completed_actual_kcal == null ? '—' : `${money(day.completed_actual_kcal)} kcal`}</dd></div><div><dt>Target snapshot</dt><dd>{day.completed_target_kcal == null ? '—' : `${money(day.completed_target_kcal)} kcal`}</dd></div>{completionDifference && <div><dt>Difference</dt><dd>{completionDifferenceText}</dd></div>}</dl>
          {completionDifference && <p className="day-completion-note">{completionDifference.eligible ? `This difference meets the carry review threshold of ${money(completionDifference.thresholdKcal)} kcal.` : `Below the ${money(completionDifference.thresholdKcal)} kcal carry threshold; no carry prompt is shown.`}</p>}
          {summary.plannedCount > 0 && <p className="day-completion-note">{summary.plannedCount} planned {summary.plannedCount === 1 ? 'item remains' : 'items remain'} uneaten and are not included in the saved total.</p>}
        </> : <>
          <div><p className="eyebrow">WHEN YOU’RE READY</p><h2>Finish this day</h2><p className="day-completion-note">This saves a snapshot of what you logged and your target. It will not turn any planned items into eaten items.</p></div>
          <button type="button" className="secondary-button" disabled={!canCompleteDay} onClick={() => { completionMutation.reset(); setConfirmingCompletion(true); }}>Mark fully logged</button>
          {!canCompleteDay && <p className="day-completion-hint">{!effectiveTargetKcal ? 'Set a calorie target before completing this day.' : !calorieSummary.complete ? 'Resolve any logged entries with unknown calories before completing this day.' : hasPendingDayWrite || dayQuery.isFetching ? 'Wait for the current save or refresh to finish.' : hasUnfinishedDayEdit ? 'Save or close the current edit before completing this day.' : 'Refresh this day before completing it.'}</p>}
        </>}
      </section>}

      {dayIsCompleted && <section className="day-completion-card" aria-label="Completed log corrections">
        <div><p className="eyebrow">CORRECTIONS</p><h2>Need to fix an eaten entry?</h2>
          {completedCarryQuery.isPending ? <p className="day-completion-note">Checking carry history before enabling corrections.</p>
            : completedCarryQuery.isError ? <p className="day-completion-note">Carry history could not be checked, so corrections stay locked. Refresh to try again.</p>
            : activeSourceTransfers.length > 0 ? <>
              <p className="day-completion-note">Reverse these active transfers first. Their open-recipient effects will be removed; completed recipients keep their snapshots and any dependent decisions are flagged for review.</p>
              <ul className="carry-history-list">{activeSourceTransfers.map((decision) => <li key={decision.id}>
                {decision.allocations.map((allocation) => `${formatLocalDate(allocation.destination_date, timezone, { weekday: 'short', day: 'numeric', month: 'short' })} (${allocation.signed_delta_kcal > 0 ? '+' : ''}${money(allocation.signed_delta_kcal)} kcal)`).join(', ')}
              </li>)}</ul>
              {completionDifference?.eligible && <a className="text-button" href="#carry-decision-heading">Review and reverse transfer</a>}
            </> : <p className="day-completion-note">Corrections are available. They update actual calories and the difference, while preserving the completed target snapshot.</p>}
        </div>
      </section>}

      {userId && dayIsCompleted && day.week_start && completionDifference?.eligible && day.completed_actual_kcal != null && day.completed_target_kcal != null && day.completed_log_revision != null && <CarryDecisionPreview
        key={`${userId}:${activeDate}:${day.completed_log_revision}`}
        userId={userId}
        sourceDate={activeDate}
        sourceRevision={day.revision}
        logRevision={day.completed_log_revision}
        today={today}
        weekStart={day.week_start}
        timezone={timezone}
        targetKcal={day.completed_target_kcal}
        differenceKcal={completionDifference.differenceKcal}
        thresholdKcal={completionDifference.thresholdKcal}
      />}

      <Dialog open={confirmingCompletion} title="Mark this day fully logged?" closeDisabled={completionMutation.isPending} onClose={() => setConfirmingCompletion(false)}>
        <div className="completion-confirmation">
          <p>This records <strong>{calorieSummary.value === null ? 'an unknown' : `${money(calorieSummary.value)} kcal`}</strong> eaten against your <strong>{effectiveTargetKcal == null ? 'unset' : `${money(effectiveTargetKcal)} kcal`}</strong> target.</p>
          {summary.plannedCount > 0 && <p>{summary.plannedCount} planned {summary.plannedCount === 1 ? 'item will' : 'items will'} stay uneaten and will not count toward that total.</p>}
          {summary.eatenCount === 0 && <StatusMessage tone="info">Nothing is currently logged as eaten. Confirm only if that is accurate.</StatusMessage>}
          <p className="field-hint">Completing the day locks its log in this phase. Carry choices and later corrections will be added separately.</p>
          {completionMutation.isError && <div className="page-stack"><StatusMessage tone="error">{isConflict(completionMutation.error) ? 'This day changed in another session. Refresh and review it before completing.' : 'We couldn’t confirm completion. The day may still be open; retry safely or refresh to check.'}</StatusMessage><button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh day</button></div>}
          <div className="dialog-actions"><button type="button" className="text-button" disabled={completionMutation.isPending} onClick={() => setConfirmingCompletion(false)}>Not yet</button><button type="button" className="secondary-button" disabled={completionMutation.isPending || !canCompleteDay || (completionMutation.isError && !canSafelyRetry(completionMutation.error))} onClick={() => {
            if (!day) return;
            if (completionMutation.isError && canSafelyRetry(completionMutation.error) && completionMutation.variables) {
              completionMutation.mutate(completionMutation.variables);
              return;
            }
            const input: CompleteDayInput = { requestId: crypto.randomUUID(), localDate: activeDate, expectedDayRevision: day.revision, expectedLogRevision: day.log_revision };
            completionMutation.mutate(input);
          }}>{completionMutation.isPending ? 'Saving…' : completionMutation.isError && canSafelyRetry(completionMutation.error) ? 'Retry completion safely' : 'Confirm day is fully logged'}</button></div>
        </div>
      </Dialog>

      <Dialog open={Boolean(pendingCompletedCorrection)} title="Review completed-day correction" closeDisabled={correctionMutation.isPending} onClose={() => setPendingCompletedCorrection(null)}>
        {pendingCompletedCorrection && <div className="completion-confirmation">
          <p>This will change the eaten log for <strong>{formatLocalDate(pendingCompletedCorrection.localDate, timezone, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</p>
          <dl className="day-completion-snapshot">
            <div><dt>Current actual</dt><dd>{day?.completed_actual_kcal == null ? '—' : `${money(day.completed_actual_kcal)} kcal`}</dd></div>
            <div><dt>Frozen target</dt><dd>{day?.completed_target_kcal == null ? '—' : `${money(day.completed_target_kcal)} kcal`}</dd></div>
            <div><dt>Current difference</dt><dd>{completionDifferenceText ?? '—'}</dd></div>
          </dl>
          <p className="field-hint">The database will recalculate actual calories from the corrected eaten snapshots, preserve the target and completion timestamp, and update the difference. Any prior “Do nothing” carry choice will be superseded so it can be reviewed again. No active transfer remains for this source day.</p>
          {reversedSourceTransfers.length > 0 && <div><p className="field-hint">Previously reversed transfers from this day:</p><ul className="carry-history-list">{reversedSourceTransfers.map((decision) => <li key={decision.id}>{decision.allocations.map((allocation) => `${formatLocalDate(allocation.destination_date, timezone, { weekday: 'short', day: 'numeric', month: 'short' })} (${allocation.signed_delta_kcal > 0 ? '+' : ''}${money(allocation.signed_delta_kcal)} kcal)`).join(', ')}</li>)}</ul></div>}
          {correctionMutation.isError && <div className="page-stack"><StatusMessage tone="error">{isConflict(correctionMutation.error) ? 'The day or a transfer changed. Refresh the day and carry history, then review the correction again.' : 'We couldn’t confirm this correction. Refresh the day to check whether it saved.'}</StatusMessage><button type="button" className="text-button" onClick={() => { void dayQuery.refetch(); void completedCarryQuery.refetch(); }}>Refresh day and carry history</button></div>}
          <div className="dialog-actions"><button type="button" className="text-button" disabled={correctionMutation.isPending} onClick={() => setPendingCompletedCorrection(null)}>Cancel</button><button type="button" className="secondary-button" disabled={correctionMutation.isPending || !completedCorrectionReady || !day || (correctionMutation.isError && !canSafelyRetry(correctionMutation.error))} onClick={() => {
            if (correctionMutation.isError && canSafelyRetry(correctionMutation.error) && correctionMutation.variables) {
              correctionMutation.mutate(correctionMutation.variables);
              return;
            }
            correctionMutation.mutate(pendingCompletedCorrection);
          }}>{correctionMutation.isPending ? 'Saving…' : correctionMutation.isError && canSafelyRetry(correctionMutation.error) ? 'Retry safely' : 'Confirm correction'}</button></div>
        </div>}
      </Dialog>

      {displayedFields.length > 0 && <section className="today-nutrients" aria-labelledby="nutrients-heading">
        <div className="section-heading"><div><p className="eyebrow">YOUR SELECTED NUTRIENTS</p><h2 id="nutrients-heading">Nutrients</h2></div></div>
        <dl className="today-nutrient-grid">{displayedFields.map((field) => {
          const metric = summary.nutrients[field.field_id]!;
          const rawTarget = nutrientTargets && typeof nutrientTargets === 'object' && !Array.isArray(nutrientTargets) ? nutrientTargets[field.field_id] : undefined;
          const nutrientTarget = typeof rawTarget === 'number' ? rawTarget : null;
          const targetText = nutrientTarget === null ? 'No target' : `${money(nutrientTarget)} ${field.unit} target`;
          return <div className="today-nutrient-card" key={field.field_id}><dt>{field.name}<span>{targetText}</span></dt><dd>{metricLabel(metric.value, metric.complete, field.unit, summary.eatenCount === 0)}{!metric.complete && metric.value !== null && <small>{metric.knownEntries}/{metric.totalEntries} logged items known</small>}</dd></div>;
        })}</dl>
      </section>}

      {displayedFields.length === 0 && <p className="today-no-nutrients">Choose nutrients to display in Profile; unknown values will stay clearly marked.</p>}

      <section className="today-meals" aria-labelledby="meals-title">
        <div className="section-heading"><div><p className="eyebrow">A SIMPLE PLACE TO START</p><h2 id="meals-title">Your meals</h2></div>{activeDate > today && items.some((item) => item.state === 'planned') && <button type="button" className="secondary-button" disabled={dayQuery.data?.day?.status === 'completed'} onClick={() => { wholeDayShuffleMutation.reset(); setShufflingWholeDay(true); }}><RefreshCw size={16} /> Shuffle whole day</button>}</div>
        {dayQuery.isPending ? <LoadingSkeleton label="Loading your meals" /> : <div className="today-sections">
          {Object.entries(sectionNames).map(([section, label]) => {
            const sectionItems = items.filter((item) => item.section === section);
            return <section className="today-meal-section" key={section} aria-labelledby={`today-section-${section}`}>
              <div className="today-section-heading"><h3 id={`today-section-${section}`}>{label}</h3><span>{sectionItems.length || '—'}</span></div>
              {sectionItems.length === 0 ? <p className="today-section-empty">Nothing here yet</p> : <ul className="today-item-list">{sectionItems.map((item) => {
                const eaten = item.state === 'eaten';
                const planned = item.state === 'planned';
                const snapshot = eaten ? readEatenSnapshot(item.eaten_snapshot) : null;
                const plan = planned ? readPlannedChoice(item.planned_payload) : null;
                const fixedRoutineMeal = item.source === 'routine' && plan?.sourceKind === 'meal'
                  && item.planned_payload !== null && typeof item.planned_payload === 'object'
                  && !Array.isArray(item.planned_payload) && item.planned_payload.mode === 'fixed';
                const shuffleRoutineSlot = item.source === 'routine' && item.planned_payload !== null
                  && typeof item.planned_payload === 'object' && !Array.isArray(item.planned_payload)
                  && item.planned_payload.mode === 'shuffle';
                const name = snapshot?.name ?? (eaten ? 'Logged item' : plannedItemName(item.planned_payload) ?? 'Planned item');
                const calories = snapshot?.calories;
                return <li className="today-item" key={item.id}>
                  <div className="today-item-main"><div><h4>{name}</h4><p>{item.selected_amount != null ? `${item.selected_amount} ${item.selected_unit ?? ''}` : ''}</p></div><span className={`today-item-state ${eaten ? 'is-eaten' : 'is-planned'}`}>{eaten ? 'Eaten' : 'Planned'}</span></div>
                  <p className="today-item-calories">{eaten ? metricLabel(calories?.value ?? null, calories?.complete ?? false, 'kcal', false) : 'Not counted · planned'}</p>
                  {eaten && <div className="today-item-actions"><button type="button" className="text-button" disabled={correctionMutation.isPending || replacementMutation.isPending || (dayIsCompleted && !completedCorrectionReady)} onClick={() => setEditingItem({ id: item.id, amount: String(item.selected_amount ?? snapshot?.selected_amount ?? 1), unit: item.selected_unit ?? snapshot?.selected_unit ?? 'serving' })}><Pencil size={15} /> Edit portion</button><button type="button" className="text-button" disabled={correctionMutation.isPending || replacementMutation.isPending || (dayIsCompleted && !completedCorrectionReady)} onClick={() => submitCorrection({ requestId: crypto.randomUUID(), localDate: activeDate, itemId: item.id, expectedRevision: item.revision, action: 'remove' })}><Trash2 size={15} /> Remove log</button><button type="button" className="text-button" disabled={correctionMutation.isPending || replacementMutation.isPending || (dayIsCompleted && !completedCorrectionReady)} onClick={() => { setSavedNotice(''); setReplacingItem({ id: item.id, localDate: activeDate, revision: item.revision, section: item.section }); }}><RefreshCw size={15} /> Replace item</button></div>}
                  {planned && <div className="today-item-actions">{plan && <button type="button" className="text-button" disabled={portionOverrideMutation.isPending || removePlannedMutation.isPending || planReplacementMutation.isPending || dayQuery.data?.day?.status === 'completed'} onClick={() => {
                    portionOverrideMutation.reset();
                    setPendingPortionOverride(null);
                    setEditingPlannedItem({ id: item.id, localDate: activeDate, amount: String(item.selected_amount ?? plan.amount) });
                  }}>Edit portion</button>}{activeDate <= today && plan && <button type="button" className="text-button" disabled={logMutation.isPending || portionOverrideMutation.isPending || removePlannedMutation.isPending || planReplacementMutation.isPending || dayQuery.data?.day?.status === 'completed'} onClick={() => {
                    setSavedNotice('');
                    logMutation.reset();
                    if (fixedRoutineMeal) setReviewingRoutineItem(item);
                    else submitPlannedItem(item.id,item.revision,item.section,item.planned_payload);
                  }}>Ate it</button>}{activeDate > today && shuffleRoutineSlot && <button type="button" className="text-button" disabled={planReplacementMutation.isPending || dayQuery.data?.day?.status === 'completed'} onClick={() => { setSavedNotice(''); setShufflingItem(item); }}>Shuffle suggestion</button>}{activeDate > today && <button type="button" className="text-button" disabled={planReplacementMutation.isPending || portionOverrideMutation.isPending || removePlannedMutation.isPending || dayQuery.data?.day?.status === 'completed'} onClick={() => { setSavedNotice(''); setChoosingInstead({ id: item.id, localDate: activeDate, revision: item.revision, section: item.section }); }}>Choose instead</button>}<button type="button" className="text-button" disabled={removePlannedMutation.isPending || portionOverrideMutation.isPending || planReplacementMutation.isPending || dayQuery.data?.day?.status === 'completed'} onClick={() => { removePlannedMutation.reset(); removePlannedMutation.mutate({ requestId: crypto.randomUUID(), localDate: activeDate, itemId: item.id, expectedRevision: item.revision }); }}>Remove plan</button></div>}
                  {planned && editingPlannedItem?.id === item.id && editingPlannedItem.localDate === activeDate && <div className="today-edit-portion">
                    <NumericField id={`planned-${item.id}-amount`} label={`Planned amount (${item.selected_unit ?? plan?.unit ?? 'serving'})`} min={0.0001} max={99_999_999} step="any" value={editingPlannedItem.amount} onChange={(event) => setEditingPlannedItem({ ...editingPlannedItem, amount: event.target.value })} />
                    <p className="field-hint">This is a one-date override. It won’t change your weekly routine.</p>
                    <div className="dialog-actions"><button type="button" className="text-button" disabled={portionOverrideMutation.isPending} onClick={() => setEditingPlannedItem(null)}>Cancel</button><button type="button" className="secondary-button" disabled={portionOverrideMutation.isPending || !Number.isFinite(Number(editingPlannedItem.amount)) || Number(editingPlannedItem.amount) <= 0} onClick={() => submitPlannedPortion(item.id,item.revision,editingPlannedItem.localDate,Number(editingPlannedItem.amount))}>{portionOverrideMutation.isPending ? 'Saving…' : 'Save portion'}</button></div>
                  </div>}
                  {editingItem?.id === item.id && <div className="today-edit-portion"><NumericField id={`edit-${item.id}-amount`} label="Recorded amount" min={0.0001} max={99_999_999} step="any" value={editingItem.amount} onChange={(event) => setEditingItem({ ...editingItem, amount: event.target.value })} /><Field id={`edit-${item.id}-unit`} label="Unit"><input className="text-field" id={`edit-${item.id}-unit`} value={editingItem.unit} maxLength={24} onChange={(event) => setEditingItem({ ...editingItem, unit: event.target.value })} /></Field><div className="dialog-actions"><button type="button" className="text-button" onClick={() => setEditingItem(null)}>Cancel</button><button type="button" className="secondary-button" disabled={correctionMutation.isPending || !Number.isFinite(Number(editingItem.amount)) || Number(editingItem.amount) <= 0 || !editingItem.unit.trim()} onClick={() => submitCorrection({ requestId: crypto.randomUUID(), localDate: activeDate, itemId: item.id, expectedRevision: item.revision, action: 'resize', amount: Number(editingItem.amount), unit: editingItem.unit.trim() })}>{correctionMutation.isPending ? 'Saving…' : dayIsCompleted ? 'Review correction' : 'Save portion'}</button></div></div>}
                </li>;
              })}</ul>}
            </section>;
          })}
        </div>}
      </section>

      {savedNotice && <StatusMessage tone="success">{savedNotice}</StatusMessage>}
      {correctionMutation.isError && <div className="page-stack"><StatusMessage tone="error">We couldn’t confirm this correction. Refresh this day and review the current entry before trying again.</StatusMessage><button type="button" className="secondary-button" onClick={() => void dayQuery.refetch()}>Refresh day</button></div>}
      {planMutation.isError && pendingPlan && <div className="page-stack"><StatusMessage tone="error">{isConflict(planMutation.error) ? 'Your selection changed in the Library. Refresh and review it before planning.' : 'We couldn’t confirm this plan. Refresh the date to check whether it saved.'}</StatusMessage>{canSafelyRetry(planMutation.error) && <button type="button" className="secondary-button" disabled={planMutation.isPending} onClick={() => planMutation.mutate(pendingPlan)}>Retry plan safely</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div>}
      {removePlannedMutation.isError && removePlannedMutation.variables && <div className="page-stack"><StatusMessage tone="error">{isConflict(removePlannedMutation.error) ? 'This plan changed in another session. Refresh this date before removing it again.' : 'We couldn’t confirm removal. Refresh this date to check its current state.'}</StatusMessage>{canSafelyRetry(removePlannedMutation.error) && <button type="button" className="secondary-button" onClick={() => removePlannedMutation.mutate(removePlannedMutation.variables)}>Retry removal safely</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div>}
      {portionOverrideMutation.isError && pendingPortionOverride && <div className="page-stack"><StatusMessage tone="error">{isConflict(portionOverrideMutation.error) ? 'This plan changed in another session. Refresh the date and review its current portion before editing again.' : 'We couldn’t confirm the portion change. Refresh the date to check whether it saved.'}</StatusMessage>{canSafelyRetry(portionOverrideMutation.error) && <button type="button" className="secondary-button" disabled={portionOverrideMutation.isPending} onClick={() => portionOverrideMutation.mutate(pendingPortionOverride)}>Retry portion change safely</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div>}
      {planReplacementMutation.isError && pendingPlanReplacement && <div className="page-stack"><StatusMessage tone="error">{isConflict(planReplacementMutation.error) ? 'This plan changed in another session. Refresh this date before choosing again.' : 'We couldn’t confirm this plan change. Refresh the date to check its current state.'}</StatusMessage>{canSafelyRetry(planReplacementMutation.error) && <button type="button" className="secondary-button" disabled={planReplacementMutation.isPending} onClick={() => planReplacementMutation.mutate(pendingPlanReplacement)}>Retry plan change safely</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div>}
      {replacementMutation.isError && pendingReplacement && <div className="page-stack"><StatusMessage tone="error">{isConflict(replacementMutation.error) ? 'This entry changed in another session. Refresh the day before replacing it again.' : 'We couldn’t confirm this replacement. Refresh the day to check whether it saved.'}</StatusMessage>{canSafelyRetry(replacementMutation.error) && <button type="button" className="secondary-button" disabled={replacementMutation.isPending} onClick={() => replacementMutation.mutate(pendingReplacement)}>Retry replacement safely</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh day</button></div>}
      {undoTicket && undoTicket.localDate === activeDate && <button type="button" className="undo-log-button" disabled={correctionMutation.isPending || (dayIsCompleted && !completedCorrectionReady)} onClick={() => submitCorrection({ requestId: crypto.randomUUID(), localDate: undoTicket.localDate, itemId: undoTicket.id, expectedRevision: undoTicket.revision, action: 'restore' })}><RotateCcw size={16} /> Undo removal</button>}
      {preparedChoice && activeDate <= today && logMutation.isError && <div className="page-stack"><StatusMessage tone="error">{isConflict(logMutation.error) ? 'This item changed in another session. Refresh the day and review it before logging again.' : 'We couldn’t confirm this log. Your choice is still here; retrying uses the same request safely.'}</StatusMessage>{canSafelyRetry(logMutation.error) && <button type="button" className="secondary-button" disabled={logMutation.isPending} onClick={() => submitChoice(preparedChoice)}>Retry logging</button>}<button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh day</button></div>}
      <div className="add-row"><button type="button" className="primary-button" aria-describedby="today-add-note" disabled={planMutation.isPending || logMutation.isPending} onClick={() => { setPreparedChoice(null); setPendingPlan(null); setSavedNotice(''); logMutation.reset(); planMutation.reset(); setIsAdding(true); }}><CirclePlus size={18} /> {activeDate > today ? 'Plan a meal' : 'Log a meal'}</button><span id="today-add-note" className="today-add-note">Review the saved choice and portion before continuing.</span></div>
      {userId && isAdding && <AddChoiceDialog open userId={userId} fields={displayedFields} futureDate={activeDate > today} onClose={() => setIsAdding(false)} onPrepared={(choice) => {
        setIsAdding(false);
        setSavedNotice('');
        if (activeDate > today) { submitPlan(choice); return; }
        submitChoice({ ...choice, requestId: crypto.randomUUID() });
      }} />}
      {userId && reviewingRoutineItem && <RoutineMealReviewDialog
        open
        userId={userId}
        item={reviewingRoutineItem}
        fields={displayedFields}
        pending={logMutation.isPending}
        onClose={() => setReviewingRoutineItem(null)}
        onConfirm={() => submitPlannedItem(reviewingRoutineItem.id,reviewingRoutineItem.revision,reviewingRoutineItem.section,reviewingRoutineItem.planned_payload)}
      />}
      {userId && shufflingItem && <ShuffleSlotDialog
        key={shufflingItem.id}
        open
        userId={userId}
        localDate={activeDate}
        item={shufflingItem}
        items={items}
        targetKcal={effectiveTargetKcal ?? null}
        nutrientTargets={targetVersion?.nutrient_targets && typeof targetVersion.nutrient_targets === 'object' && !Array.isArray(targetVersion.nutrient_targets)
          ? Object.fromEntries(Object.entries(targetVersion.nutrient_targets).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}}
        fields={profile.data?.nutrientFields ?? []}
        onClose={() => setShufflingItem(null)}
        onChooseManually={() => {
          const choice = shufflingItem;
          setShufflingItem(null);
          setChoosingInstead({ id: choice.id, localDate: activeDate, revision: choice.revision, section: choice.section });
        }}
        onUse={(candidate, amount, suggestionRevision) => {
          const input: ReplacePlannedDayItemInput = {
            requestId: crypto.randomUUID(), localDate: activeDate, itemId: shufflingItem.id,
            expectedRevision: shufflingItem.revision, expectedSuggestionRevision: suggestionRevision, section: shufflingItem.section, sourceKind: 'meal',
            sourceId: candidate.mealId, amount, unit: 'serving', expectedSourceRevision: candidate.revision,
          };
          setPendingPlanReplacement(input);
          setShufflingItem(null);
          setSavedNotice('');
          planReplacementMutation.reset();
          planReplacementMutation.mutate(input);
        }}
      />}
      {userId && shufflingWholeDay && <WholeDayShuffleDialog
        open
        userId={userId}
        localDate={activeDate}
        items={items}
        targetKcal={effectiveTargetKcal ?? null}
        nutrientTargets={targetVersion?.nutrient_targets && typeof targetVersion.nutrient_targets === 'object' && !Array.isArray(targetVersion.nutrient_targets)
          ? Object.fromEntries(Object.entries(targetVersion.nutrient_targets).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : {}}
        fields={profile.data?.nutrientFields ?? []}
        acceptPending={wholeDayShuffleMutation.isPending}
        acceptError={wholeDayShuffleMutation.error ? isConflict(wholeDayShuffleMutation.error)
          ? 'At least one selected plan or suggested meal changed. The date and meal library are refreshing; review the regenerated preview before accepting again.'
          : 'We couldn’t confirm the batch. Your choices remain here; retrying uses the same request safely.' : null}
        canRetry={Boolean(wholeDayShuffleMutation.error && canSafelyRetry(wholeDayShuffleMutation.error))}
        onClose={() => setShufflingWholeDay(false)}
        onRetry={() => { const pending = wholeDayShuffleMutation.variables; if (pending) wholeDayShuffleMutation.mutate(pending); }}
        onAccept={(changes: WholeDayShuffleChange[]) => {
          const input: AcceptWholeDayShuffleInput = { requestId: crypto.randomUUID(), localDate: activeDate, changes };
          wholeDayShuffleMutation.reset();
          wholeDayShuffleMutation.mutate(input);
        }}
      />}
      {userId && replacingItem && <AddChoiceDialog key={replacingItem.id} open userId={userId} fields={displayedFields} futureDate={false} initialSection={replacingItem.section} dialogTitle="Replace logged item" submitLabel="Replace with this" onClose={() => setReplacingItem(null)} onPrepared={(choice) => {
        const requestId = crypto.randomUUID();
        const input: ReplaceDayItemInput = {
          requestId,
          localDate: replacingItem.localDate,
          itemId: replacingItem.id,
          expectedRevision: replacingItem.revision,
          section: choice.section,
          sourceKind: choice.kind,
          sourceId: choice.kind === 'food' || choice.kind === 'meal' ? choice.id : null,
          amount: choice.amount,
          unit: choice.unit,
          manualPayload: choice.snapshot ? { ...choice.snapshot, name: choice.name } : undefined,
        };
        setPendingReplacement(input);
        setReplacingItem(null);
        setSavedNotice('');
        replacementMutation.reset();
        if (dayIsCompleted) {
          if (!day || !completedCorrectionReady) return;
          requestCompletedCorrection({
            requestId: input.requestId, localDate: input.localDate, itemId: input.itemId,
            expectedRevision: input.expectedRevision, action: 'replace', section: input.section, sourceKind: input.sourceKind,
            sourceId: input.sourceId, amount: input.amount, unit: input.unit, manualPayload: input.manualPayload,
          });
        } else replacementMutation.mutate(input);
      }} />}
      {userId && choosingInstead && <AddChoiceDialog key={choosingInstead.id} open userId={userId} fields={displayedFields} futureDate initialSection={choosingInstead.section} dialogTitle="Choose another plan" submitLabel="Update plan" onClose={() => setChoosingInstead(null)} onPrepared={(choice) => {
        const input: ReplacePlannedDayItemInput = {
          requestId: crypto.randomUUID(), localDate: choosingInstead.localDate, itemId: choosingInstead.id,
          expectedRevision: choosingInstead.revision, section: choice.section, sourceKind: choice.kind,
          sourceId: choice.kind === 'food' || choice.kind === 'meal' ? choice.id : null,
          amount: choice.amount, unit: choice.unit,
          manualPayload: choice.snapshot ? { ...choice.snapshot, name: choice.name } : undefined,
        };
        setPendingPlanReplacement(input);
        setChoosingInstead(null);
        setSavedNotice('');
        planReplacementMutation.reset();
        planReplacementMutation.mutate(input);
      }} />}
    </div>
  );

  function submitChoice(choice: PreparedChoice) {
    if (!userId || activeDate > today) return;
    const requestId = choice.requestId ?? crypto.randomUUID();
    setPreparedChoice({ ...choice, requestId });
    logMutation.mutate({
      requestId,
      localDate: activeDate,
      section: choice.section,
      sourceKind: choice.kind,
      sourceId: choice.kind === 'food' || choice.kind === 'meal' ? choice.id : null,
      amount: choice.amount,
      unit: choice.unit,
      manualPayload: choice.snapshot ? { ...choice.snapshot, name: choice.name } : undefined,
      plannedItemId: choice.plannedItemId,
      expectedItemRevision: choice.expectedItemRevision,
    });
  }

  function submitPlan(choice: PreparedChoice) {
    if (!userId || activeDate <= today) return;
    const input: PlanDayItemInput = {
      requestId: choice.requestId ?? crypto.randomUUID(),
      localDate: activeDate,
      section: choice.section,
      sourceKind: choice.kind,
      sourceId: choice.kind === 'food' || choice.kind === 'meal' ? choice.id : null,
      amount: choice.amount,
      unit: choice.unit,
      manualPayload: choice.snapshot ? { ...choice.snapshot, name: choice.name } : undefined,
    };
    setPendingPlan(input);
    setSavedNotice('');
    planMutation.reset();
    planMutation.mutate(input);
  }

  function submitPlannedItem(itemId: string, revision: number, section: PreparedChoice['section'], payload: Parameters<typeof readPlannedChoice>[0]) {
    const choice = readPlannedChoice(payload);
    if (!choice || activeDate > today) return;
    submitChoice({
      kind: choice.sourceKind,
      id: choice.sourceId ?? itemId,
      name: plannedItemName(payload) ?? 'Planned item',
      amount: choice.amount,
      unit: choice.unit,
      section,
      snapshot: choice.manualPayload,
      plannedItemId: itemId,
      expectedItemRevision: revision,
      requestId: crypto.randomUUID(),
    });
  }

  function submitPlannedPortion(itemId: string, revision: number, localDate: string, amount: number) {
    if (!userId || localDate !== activeDate || !Number.isFinite(amount) || amount <= 0) return;
    const input = { requestId: crypto.randomUUID(), localDate, itemId, expectedRevision: revision, amount };
    setSavedNotice('');
    setPendingPortionOverride(input);
    portionOverrideMutation.reset();
    portionOverrideMutation.mutate(input);
  }

  function requestCompletedCorrection(input: Omit<CorrectCompletedDayItemInput, 'expectedDayRevision' | 'expectedLogRevision'>) {
    if (!day || !completedCorrectionReady) return;
    correctionMutation.reset();
    setPendingCompletedCorrection({ ...input, expectedDayRevision: day.revision, expectedLogRevision: day.log_revision });
  }

  function submitCorrection(input: Parameters<typeof reviseDayItem>[0]) {
    if (dayIsCompleted) {
      requestCompletedCorrection({
        requestId: input.requestId, localDate: input.localDate, itemId: input.itemId,
        expectedRevision: input.expectedRevision, action: input.action, amount: input.amount, unit: input.unit,
      });
      return;
    }
    correctionMutation.reset();
    setSavedNotice('');
    correctionMutation.mutate(input);
  }
}
