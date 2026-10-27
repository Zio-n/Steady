import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { loadCarryDecisions, reverseCarryDecision, saveCarryDecision, type SavedCarryDecision } from '../../data/repositories/carryRepository';
import { loadWeeklyPlan } from '../../data/repositories/weeklyPlanRepository';
import { addLocalDays, formatLocalDate } from '../../domain/dates';
import { previewCarryDecision, type CarryAction, type CarryForecastDay } from '../../domain/carry';
import { NumericField } from '../../ui/components/Field';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { Dialog } from '../../ui/components/Dialog';

const kcal = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const isConflict = (error: unknown) => error instanceof DataError && error.kind === 'conflict';
const retryable = (error: unknown) => error instanceof DataError && error.retryable;

function SavedDecisionPanel({
  decisions, timezone, onReverse,
}: {
  decisions: SavedCarryDecision[];
  timezone: string;
  onReverse: (decision: SavedCarryDecision) => void;
}) {
  return <div className="carry-projection" aria-live="polite">
    <StatusMessage tone="success">Carry decision history for this completed day.</StatusMessage>
    <ol className="carry-history-list">{[...decisions].reverse().map((decision) => {
      const unallocated = decision.state === 'reversed' || decision.action === 'none'
        ? Math.abs(decision.difference_kcal) : Math.max(0, Math.abs(decision.difference_kcal) - decision.amount_kcal);
      return <li key={decision.id}>
        <div className="carry-history-heading"><strong>{decision.state === 'active' ? 'Active decision' : decision.state === 'reversed' ? 'Reversed decision' : 'Replaced decision'}</strong><span>{formatLocalDate(decision.source_date, timezone, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
        <dl>
          <div><dt>Recorded difference</dt><dd>{decision.difference_kcal > 0 ? '+' : ''}{kcal(decision.difference_kcal)} kcal</dd></div>
          <div><dt>Choice</dt><dd>{decision.action === 'none' ? 'Do nothing' : `${decision.action === 'single_day' ? 'One day' : 'Spread'} · ${kcal(decision.amount_kcal)} kcal`}</dd></div>
          <div><dt>Unallocated</dt><dd>{kcal(unallocated)} kcal</dd></div>
        </dl>
        {decision.allocations.length > 0 && <ul>{decision.allocations.map((allocation) => <li key={allocation.destination_date}>
          {formatLocalDate(allocation.destination_date, timezone, { weekday: 'long', day: 'numeric', month: 'short' })}: {allocation.signed_delta_kcal > 0 ? '+' : ''}{kcal(allocation.signed_delta_kcal)} kcal
        </li>)}</ul>}
        {decision.needs_review && <StatusMessage tone="info">A downstream carry was based on this completed target. Review that decision before relying on its forecast.</StatusMessage>}
        {decision.state === 'reversed' && <p className="carry-projection-note">The transfer is reversed; completed recipient snapshots remain unchanged and the full difference is unresolved.</p>}
        {decision.state === 'active' && decision.action !== 'none' && <button type="button" className="secondary-button" onClick={() => onReverse(decision)}>Review and reverse transfer</button>}
      </li>;
    })}</ol>
    <p className="carry-projection-note">The source day remains locked. Reversing changes only still-open recipient targets; completed targets remain frozen.</p>
  </div>;
}

export function CarryDecisionPreview({
  userId, sourceDate, sourceRevision, logRevision, today, weekStart, timezone, targetKcal, differenceKcal, thresholdKcal,
}: {
  userId: string;
  sourceDate: string;
  sourceRevision: number;
  logRevision: number;
  today: string;
  weekStart: string;
  timezone: string;
  targetKcal: number;
  differenceKcal: number;
  thresholdKcal: number;
}) {
  const [action, setAction] = useState<CarryAction | null>(null);
  const [amount, setAmount] = useState('');
  const [recipientDates, setRecipientDates] = useState<string[]>([]);
  const [decisionToReverse, setDecisionToReverse] = useState<SavedCarryDecision | null>(null);
  const [confirmingReverse, setConfirmingReverse] = useState(false);
  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: queryKeys.weeklyPlan(userId, weekStart),
    queryFn: () => loadWeeklyPlan(userId, weekStart),
  });
  const decisionQueryKey = queryKeys.carryDecisions(userId, weekStart, sourceDate);
  const historyQueryKey = (date: string) => queryKeys.carryDecisions(userId, weekStart, date);
  const savedDecisions = useQuery({
    queryKey: decisionQueryKey,
    queryFn: () => loadCarryDecisions(userId, sourceDate),
  });
  const reverseMutation = useMutation({
    mutationFn: reverseCarryDecision,
    onError: (_error, input) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: decisionQueryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.weeklyPlan(userId, weekStart) }),
        ...input.expectedRevisions.map((entry) => queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, entry.destinationDate) })),
        ...input.expectedRevisions.map((entry) => queryClient.invalidateQueries({ queryKey: historyQueryKey(entry.destinationDate) })),
      ]);
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: decisionQueryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.weeklyPlan(userId, weekStart) }),
        ...input.expectedRevisions.map((entry) => queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, entry.destinationDate) })),
        ...input.expectedRevisions.map((entry) => queryClient.invalidateQueries({ queryKey: historyQueryKey(entry.destinationDate) })),
      ]);
      setConfirmingReverse(false);
      setDecisionToReverse(null);
    },
  });
  const saveMutation = useMutation({
    mutationFn: saveCarryDecision,
    onError: (error, input) => {
      if (isConflict(error)) void Promise.all([
        queryClient.invalidateQueries({ queryKey: decisionQueryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.weeklyPlan(userId, input.weekStart) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, input.sourceDate) }),
      ]);
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: decisionQueryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.weeklyPlan(userId, input.weekStart) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, input.sourceDate) }),
        ...input.allocations.map((allocation) => queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, allocation.destinationDate) })),
      ]);
    },
  });
  const activeDecision = savedDecisions.data?.find((decision) => decision.state === 'active');
  const reverseInput = decisionToReverse && plan.data ? {
    requestId: '',
    decisionId: decisionToReverse.id,
    expectedWeekRevision: plan.data.week.revision,
    expectedRevisions: decisionToReverse.allocations.map((allocation) => ({
      destinationDate: allocation.destination_date,
      expectedRevision: plan.data!.days.find((day) => day.local_date === allocation.destination_date)?.revision ?? 0,
    })),
  } : null;
  const maxCents = Math.floor(Math.abs(differenceKcal) * 100 + 1e-8);
  const maxAmount = maxCents / 100;
  const days = plan.data ? Array.from({ length: 7 }, (_, index): CarryForecastDay => {
    const localDate = addLocalDays(weekStart, index);
    const savedDay = plan.data!.days.find((entry) => entry.local_date === localDate);
    const allocation = plan.data!.allocations[index]!;
    const baseTarget = plan.data!.week.allocation_kind === 'one_off'
      ? allocation.override_target_kcal ?? allocation.base_target_kcal : allocation.base_target_kcal;
    const existingCarry = plan.data!.carryAdjustments.filter((entry) => entry.destination_date === localDate)
      .reduce((sum, entry) => sum + entry.signed_delta_kcal, 0);
    return {
      localDate,
      status: savedDay?.status === 'completed' ? 'completed' : 'open',
      targetKcal: savedDay?.status === 'completed' ? savedDay.completed_target_kcal ?? baseTarget : baseTarget + existingCarry,
      actualKcal: savedDay?.status === 'completed' ? savedDay.completed_actual_kcal : null,
    };
  }) : [];
  const eligibleDestinationDates = days.filter((day) => day.status === 'open' && day.localDate > sourceDate && day.localDate >= today)
    .map((day) => day.localDate);
  const unfinishedPastCount = days.filter((day) => day.status === 'open' && day.localDate < today).length;
  const preview = action && days.length === 7 ? previewCarryDecision({
    days,
    sourceDate,
    eligibleDestinationDates,
    action,
    amountKcal: action === 'none' ? 0 : Number(amount),
    destinationDates: action === 'none' ? [] : recipientDates,
  }) : null;
  const amountValid = action === 'none' || Number.isFinite(Number(amount)) && Number(amount) >= 0.01 && Number(amount) <= maxAmount
    && Math.abs(Math.round(Number(amount) * 100) - Number(amount) * 100) < 1e-7;
  const saveInput = action && preview && plan.data ? {
    requestId: '',
    sourceDate,
    expectedSourceRevision: sourceRevision,
    expectedLogRevision: logRevision,
    weekStart,
    expectedWeekRevision: plan.data.week.revision,
    action,
    amountKcal: preview.amountKcal,
    allocations: preview.allocations.map((allocation) => ({
      destinationDate: allocation.localDate,
      signedDeltaKcal: allocation.signedDeltaKcal,
      expectedRevision: plan.data!.days.find((day) => day.local_date === allocation.localDate)?.revision ?? 1,
    })),
  } : null;
  const retryInProgress = saveMutation.isError && retryable(saveMutation.error);

  return (
    <>
    <section className="carry-decision-panel" aria-labelledby="carry-decision-heading">
      <div><p className="eyebrow">A DIFFERENCE WORTH REVIEWING</p><h2 id="carry-decision-heading">Review carry options</h2>
        <p className="carry-difference-line">{kcal(Math.abs(differenceKcal))} kcal {differenceKcal < 0 ? 'below' : 'above'} the {kcal(targetKcal)} kcal target · {kcal(thresholdKcal)} kcal threshold</p>
      </div>
      {plan.isPending && <LoadingSkeleton label="Loading this week’s available targets" />}
      {plan.isError && <div className="page-stack"><StatusMessage tone="error">We couldn’t load eligible dates. No carry preview has been applied.</StatusMessage><button type="button" className="secondary-button" onClick={() => void plan.refetch()}>Try again</button></div>}
      {plan.data && savedDecisions.isPending && <LoadingSkeleton label="Checking carry decision history" />}
      {plan.data && savedDecisions.isError && <div className="page-stack"><StatusMessage tone="error">We couldn’t check whether a carry choice was already saved. No new choice can be submitted until this check succeeds.</StatusMessage><button type="button" className="secondary-button" onClick={() => void savedDecisions.refetch()}>Check again</button></div>}
      {plan.data && savedDecisions.data && savedDecisions.data.length > 0 && <SavedDecisionPanel decisions={savedDecisions.data} timezone={timezone} onReverse={(decision) => {
        reverseMutation.reset();
        setDecisionToReverse(decision);
        setConfirmingReverse(true);
      }} />}
      {plan.data && !plan.isError && savedDecisions.data && !savedDecisions.isError && !activeDecision && <>
        <fieldset className="carry-choice-list">
          <legend>How would you like to handle this difference?</legend>
          <label><input type="radio" name={`carry-action-${sourceDate}`} checked={action === 'single_day'} disabled={eligibleDestinationDates.length === 0 || saveMutation.isPending || retryInProgress} onChange={() => chooseAction('single_day')} /><span><strong>Carry to one future day</strong><small>Add to or reduce one open target this week.</small></span></label>
          <label><input type="radio" name={`carry-action-${sourceDate}`} checked={action === 'spread'} disabled={eligibleDestinationDates.length === 0 || saveMutation.isPending || retryInProgress} onChange={() => chooseAction('spread')} /><span><strong>Spread across selected days</strong><small>Choose each open destination yourself.</small></span></label>
          <label><input type="radio" name={`carry-action-${sourceDate}`} checked={action === 'none'} disabled={saveMutation.isPending || retryInProgress} onChange={() => chooseAction('none')} /><span><strong>Do nothing</strong><small>Leave future targets unchanged and keep the difference visible.</small></span></label>
        </fieldset>
        {eligibleDestinationDates.length === 0 && <StatusMessage tone="info">No future open day remains in this Monday–Sunday week. A carry cannot move into another week.</StatusMessage>}
        {unfinishedPastCount > 0 && <StatusMessage tone="info">The weekly forecast uses saved targets for {unfinishedPastCount} unfinished past {unfinishedPastCount === 1 ? 'day' : 'days'}; it does not estimate unlogged intake for them.</StatusMessage>}
        {action && action !== 'none' && <>
          <NumericField id={`carry-amount-${sourceDate}`} label="Amount to carry (kcal)" min={0.01} max={maxAmount} step="0.01" value={amount} disabled={saveMutation.isPending || retryInProgress} onChange={(event) => { saveMutation.reset(); setAmount(event.target.value); setRecipientDates([]); }} hint={`Up to ${kcal(maxAmount)} kcal is available. The amount stays within the recorded difference.`} />
          <fieldset className="carry-recipient-list">
            <legend>{action === 'single_day' ? 'Choose one future day' : 'Choose two or more future days'}</legend>
            {eligibleDestinationDates.map((date) => {
              const selected = recipientDates.includes(date);
              const entry = days.find((day) => day.localDate === date)!;
              return <label key={date}>
                <input type={action === 'single_day' ? 'radio' : 'checkbox'} name={`carry-recipient-${sourceDate}`} checked={selected} disabled={saveMutation.isPending || retryInProgress}
                  onChange={() => { saveMutation.reset(); setRecipientDates(action === 'single_day' ? [date] : selected ? recipientDates.filter((value) => value !== date) : [...recipientDates, date]); }} />
                <span><strong>{formatLocalDate(date, timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</strong><small>Target before carry: {kcal(entry.targetKcal)} kcal</small></span>
              </label>;
            })}
          </fieldset>
          {action === 'spread' && recipientDates.length < 2 && <p className="field-hint">Select at least two days to preview a spread.</p>}
          {!amountValid && <StatusMessage tone="error">Enter an amount from 0.01 kcal up to the available difference, in 0.01 kcal increments.</StatusMessage>}
        </>}
        {!action && <p className="field-hint">Choose an option to preview it. No choice is selected for you.</p>}
        {action && !preview && amountValid && (action === 'none' || recipientDates.length >= (action === 'spread' ? 2 : 1)) && <StatusMessage tone="error">That preview would make a target invalid or uses a date that is no longer open. Review the amount and recipients.</StatusMessage>}
        {action && preview && <div className="carry-projection" aria-live="polite">
          <dl><div><dt>Weekly forecast before</dt><dd>{kcal(preview.forecastBeforeKcal)} kcal</dd></div><div><dt>Weekly forecast after</dt><dd>{kcal(preview.forecastAfterKcal)} kcal</dd></div><div><dt>Average before → after</dt><dd>{kcal(preview.averageBeforeKcal)} → {kcal(preview.averageAfterKcal)} kcal/day</dd></div></dl>
          {preview.allocations.length > 0 && <ul>{preview.allocations.map((allocation) => <li key={allocation.localDate}>{formatLocalDate(allocation.localDate, timezone, { weekday: 'long', day: 'numeric', month: 'short' })}: {kcal(allocation.beforeTargetKcal)} → <strong>{kcal(allocation.afterTargetKcal)} kcal</strong> ({allocation.signedDeltaKcal > 0 ? '+' : ''}{kcal(allocation.signedDeltaKcal)} kcal)</li>)}</ul>}
          {action === 'none' ? <p className="carry-projection-note">No target changes. The full {kcal(Math.abs(differenceKcal))} kcal difference stays visible.</p>
            : <p className="carry-projection-note">{Math.abs(preview.remainingDifferenceKcal) > 0 ? `${kcal(Math.abs(preview.remainingDifferenceKcal))} kcal remains unallocated.` : 'The full difference is previewed.'} Preview only; nothing has been saved.</p>}
        </div>}
        {saveMutation.isError && <div className="page-stack"><StatusMessage tone="error">{isConflict(saveMutation.error) ? 'This week or one of its days changed. Refresh the preview, then review the updated state before choosing again.' : retryInProgress ? 'The save may have reached Steady. Retry the same request to check safely; its request ID will not change.' : 'We couldn’t confirm the carry choice. Refresh the preview before trying another option.'}</StatusMessage>{retryInProgress && saveMutation.variables && <button type="button" className="secondary-button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(saveMutation.variables!)}>Retry the same choice safely</button>}{isConflict(saveMutation.error) && <button type="button" className="secondary-button" onClick={() => void refreshConflictedPreview()}>Refresh preview and choose again</button>}</div>}
        {saveMutation.isSuccess && <StatusMessage tone="success">Choice saved. The future target and weekly forecast are refreshing.</StatusMessage>}
        {saveInput && preview && <div className="carry-decision-actions"><button type="button" className="primary-button" disabled={plan.isError || savedDecisions.isError || saveMutation.isPending || !amountValid || saveMutation.isError || savedDecisions.isFetching}
          onClick={() => saveMutation.mutate({ ...saveInput, requestId: crypto.randomUUID() })}>
          {saveMutation.isPending ? 'Saving choice…' : saveMutation.isSuccess ? 'Choice saved' : action === 'none' ? 'Save do nothing'
            : action === 'single_day' ? `Save ${preview.allocations[0]!.signedDeltaKcal > 0 ? '+' : ''}${kcal(preview.allocations[0]!.signedDeltaKcal)} kcal to ${formatLocalDate(preview.allocations[0]!.localDate, timezone, { weekday: 'long' })}`
              : `Save ${preview.allocations.length}-day spread (${preview.allocations.reduce((sum, allocation) => sum + allocation.signedDeltaKcal, 0) > 0 ? '+' : ''}${kcal(preview.allocations.reduce((sum, allocation) => sum + allocation.signedDeltaKcal, 0))} kcal)`}</button>
          <p className="field-hint">This action saves the signed adjustment shown above. You can review the ledger afterward.</p></div>}
      </>}
    </section>
    <Dialog open={confirmingReverse} title="Reverse this carry transfer?" closeDisabled={reverseMutation.isPending} onClose={() => { setConfirmingReverse(false); setDecisionToReverse(null); }}>
      <div className="completion-confirmation">
        <p>Open recipient targets will lose this signed adjustment. Completed recipient targets and intake snapshots will remain unchanged.</p>
        <p>If a completed recipient created its own carry decision, that downstream decision will be marked as needing review. Its adjustment will not be silently cascaded.</p>
        {decisionToReverse && <ul>{decisionToReverse.allocations.map((allocation) => <li key={allocation.destination_date}>{formatLocalDate(allocation.destination_date, timezone, { weekday: 'long', day: 'numeric', month: 'short' })}: {allocation.signed_delta_kcal > 0 ? '+' : ''}{kcal(allocation.signed_delta_kcal)} kcal</li>)}</ul>}
        {reverseMutation.isError && <div className="page-stack"><StatusMessage tone="error">{isConflict(reverseMutation.error) ? 'A recipient or this week changed. Refresh the carry history and review the impact again.' : retryable(reverseMutation.error) ? 'The reversal may have reached Steady. Retry the same request safely to check.' : 'We couldn’t confirm the reversal. Refresh the history before trying again.'}</StatusMessage>
          {reverseMutation.isError && retryable(reverseMutation.error) && reverseMutation.variables && <button type="button" className="secondary-button" disabled={reverseMutation.isPending} onClick={() => reverseMutation.mutate(reverseMutation.variables!)}>Retry reversal safely</button>}
          {reverseMutation.isError && isConflict(reverseMutation.error) && <button type="button" className="secondary-button" onClick={() => void refreshReversalPreview()}>Refresh history and impact</button>}</div>}
        <div className="dialog-actions"><button type="button" className="text-button" disabled={reverseMutation.isPending} onClick={() => { setConfirmingReverse(false); setDecisionToReverse(null); }}>Keep transfer</button><button type="button" className="secondary-button" disabled={reverseMutation.isPending || !reverseInput || reverseInput.expectedRevisions.some((entry) => entry.expectedRevision < 1) || reverseMutation.isError} onClick={() => {
          if (!reverseInput) return;
          reverseMutation.mutate({ ...reverseInput, requestId: crypto.randomUUID() });
        }}>{reverseMutation.isPending ? 'Reversing…' : 'Confirm reversal'}</button></div>
      </div>
    </Dialog>
    </>
  );

  function chooseAction(nextAction: CarryAction) {
    saveMutation.reset();
    setAction(nextAction);
    setAmount(nextAction === 'none' ? '0' : maxAmount.toFixed(2));
    setRecipientDates([]);
  }

  async function refreshConflictedPreview() {
    const [planResult, decisionResult] = await Promise.all([plan.refetch(), savedDecisions.refetch()]);
    if (!planResult.isError && !decisionResult.isError) {
      saveMutation.reset();
      setAction(null);
      setAmount('');
      setRecipientDates([]);
    }
  }

  async function refreshReversalPreview() {
    const [planResult, decisionResult] = await Promise.all([plan.refetch(), savedDecisions.refetch()]);
    if (decisionToReverse && decisionResult.data?.some((decision) => decision.id === decisionToReverse.id && decision.state !== 'active')) {
      setConfirmingReverse(false);
      setDecisionToReverse(null);
    }
    if (!planResult.isError && !decisionResult.isError) reverseMutation.reset();
  }
}
