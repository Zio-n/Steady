import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Calendar, CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Plus, Settings } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { useProfile } from '../../features/profile/useProfile';
import { AddChoiceDialog, SeriesScopeSelect } from '../../features/today/AddChoiceDialog';
import { loadDiaryItemDrafts, plannedDraft, prepareFood } from '../../features/today/composerFoods';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { rememberAddedFoodPortions } from '../../data/repositories/foodPortionPreferenceRepository';
import { changeCalendarMealRemoval, logCalendarItem, logCalendarItems, readCalendarDay, readCalendarRange, saveCalendarComposer, setCalendarMealState, type CalendarChoice, type CalendarDay, type ComposerSave, type SeriesScope } from '../../data/repositories/calendarRepository';
import { addLocalDays, addLocalMonths, formatLocalDate, isValidLocalDate, localDateInTimezone, startOfLocalWeek } from '../../domain/dates';
import { plannedItemName, readEatenSnapshot, readPlannedChoice, readPlannedMeasure, readPlannedNutrition, readReplannedSnapshot, readItemLogging, summarizeDay, type DayItem } from '../../domain/daySummary';
import { CALORIES } from '../../domain/mealComposer';
import { Dialog } from '../components/Dialog';
import { CalendarMealCard, type CalendarMealMetric } from '../components/CalendarMealCard';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';

const sections = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks'],
] as const;
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
function nutritionText(value: number | null, unit = '', estimated = false) {
  return value === null ? '—' : `${estimated ? '≈' : ''}${number(value)}${unit ? ` ${unit}` : ''}`;
}
function IncompleteIndicator({ nutrient }: { nutrient: string }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const explanation = `Some foods lack ${nutrient.toLowerCase()} data.`;
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open]);
  return <span ref={root} className={`calendar-incomplete-indicator${open ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`}
    onPointerEnter={() => setDismissed(false)}>
    <button type="button" className="calendar-incomplete-trigger" aria-label={`Incomplete ${nutrient.toLowerCase()} data`} aria-describedby={id}
      onClick={() => { setDismissed(open); setOpen(!open); }}
      onBlur={() => { setOpen(false); setDismissed(false); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setDismissed(true); setOpen(false); } }}>
      <CircleDashed size={14} strokeWidth={2} aria-hidden="true" />
    </button>
    <span id={id} className="calendar-incomplete-tip" role="tooltip">{explanation}</span>
  </span>;
}
const validDate = (value: string | null) => value !== null && isValidLocalDate(value);
function groupDayItems(items: DayItem[]) {
  const groups: Array<{ id: string; items: DayItem[] }> = [];
  const positions = new Map<string, number>();
  for (const item of items) {
    const id = item.meal_group_id ? `meal:${item.meal_group_id}` : `item:${item.id}`;
    const position = positions.get(id);
    if (position === undefined) { positions.set(id, groups.length); groups.push({ id, items: [item] }); }
    else groups[position]!.items.push(item);
  }
  for (const group of groups) {
    group.items.sort((left, right) => (readItemLogging(left)?.position ?? Number.MAX_SAFE_INTEGER)
      - (readItemLogging(right)?.position ?? Number.MAX_SAFE_INTEGER));
  }
  return groups;
}
type CalendarView = 'day' | 'week' | 'month';
const calendarViews = [
  { value: 'day', label: 'Day', icon: CalendarDays },
  { value: 'week', label: 'Week', icon: CalendarRange },
  { value: 'month', label: 'Month', icon: Calendar },
] as const;

export function CalendarPage() {
  const headerHost = useOutletContext<HTMLDivElement | null>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const profile = useProfile();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const timezone = profile.data?.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDateInTimezone(new Date(), timezone);
  const requestedDate = searchParams.get('date');
  const localDate = validDate(requestedDate) ? requestedDate! : today;
  const requestedView = searchParams.get('view');
  const view: CalendarView = requestedView === 'week' || requestedView === 'month' ? requestedView : 'day';
  const monthFirst = `${localDate.slice(0, 7)}-01`;
  const monthLast = addLocalDays(addLocalMonths(monthFirst, 1), -1);
  const rangeFrom = view === 'week' ? startOfLocalWeek(localDate) : startOfLocalWeek(monthFirst);
  const rangeTo = view === 'week' ? addLocalDays(rangeFrom, 6) : addLocalDays(startOfLocalWeek(monthLast), 6);
  const [composerDraft, setComposer] = useState<{
    anchorTile: HTMLButtonElement | null; block?: DayItem; editingItems?: DayItem[]; startEaten?: boolean; attachFoods?: boolean;
  } | null>(null);
  const recentKey = searchParams.get('recent');
  const savedMealId = searchParams.get('meal');
  const savedFoodId = searchParams.get('food');
  const reuse = view !== 'day' ? undefined : recentKey && /^[0-9a-f]{32}$/.test(recentKey) ? { recentKey }
    : savedMealId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(savedMealId) ? { mealId: savedMealId }
      : savedFoodId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(savedFoodId) ? { foodId: savedFoodId } : undefined;
  const composer = composerDraft ?? (view === 'day' && (reuse || searchParams.get('start') === 'meal') ? { anchorTile: null } : null);
  const composerTrigger = useRef<HTMLButtonElement | null>(null);
  const [draftTile, setDraftTile] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (draftTile && window.matchMedia('(min-width: 761px)').matches) {
      draftTile.scrollIntoView({ block: 'nearest' });
    }
  }, [draftTile]);
  const [removingSeries, setRemovingSeries] = useState<DayItem | null>(null);
  const [seriesScope, setSeriesScope] = useState<SeriesScope>('one');
  const [removal, setRemoval] = useState<{ requestId: string; localDate: string } | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; date: string } | null>(null);
  const [showAllNutrients, setShowAllNutrients] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(localDate.slice(0, 7));
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const monthTrigger = useRef<HTMLButtonElement>(null);
  const activeGroupId = expandedGroupId?.startsWith(`${localDate}:`) && view === 'day' ? expandedGroupId : null;

  function showFeedback(text: string, date: string) {
    setFeedback({ text, date });
  }

  function chooseDate(date: string) {
    setComposer(null);
    setMonthPickerOpen(false);
    setExpandedGroupId(null);
    setFeedback(null);
    setSearchParams({ ...(date === today ? {} : { date }), ...(view === 'day' ? {} : { view }) });
  }

  function chooseView(nextView: CalendarView) {
    setComposer(null); setMonthPickerOpen(false); setViewMenuOpen(false); setExpandedGroupId(null); setFeedback(null);
    setSearchParams({ ...(localDate === today ? {} : { date: localDate }), ...(nextView === 'day' ? {} : { view: nextView }) });
  }

  function selectDay(date: string) {
    setComposer(null); setMonthPickerOpen(false); setExpandedGroupId(null); setFeedback(null);
    setSearchParams({ ...(date === today ? {} : { date }) });
  }

  function movePeriod(delta: number) {
    chooseDate(view === 'month' ? addLocalMonths(localDate, delta) : addLocalDays(localDate, view === 'week' ? delta * 7 : delta));
  }

  function openAdd(event: MouseEvent<HTMLButtonElement>) {
    composerTrigger.current = event.currentTarget;
    setExpandedGroupId(null);
    setFeedback(null);
    setComposer({ anchorTile: null });
  }

  function closeComposer() {
    setComposer(null);
    if (searchParams.has('start') || searchParams.has('recent') || searchParams.has('meal') || searchParams.has('food')) {
      const next = new URLSearchParams(searchParams);
      next.delete('start');
      next.delete('recent');
      next.delete('meal');
      next.delete('food');
      setSearchParams(next, { replace: true });
    }
    requestAnimationFrame(() => composerTrigger.current?.focus({ preventScroll: true }));
  }

  function editOccurrence(items: DayItem[], anchorTile: HTMLButtonElement, block?: DayItem, attachFoods = false, startEaten = false) {
    composerTrigger.current = anchorTile;
    setExpandedGroupId(null);
    setFeedback(null);
    setComposer({ anchorTile, block, editingItems: items, attachFoods, startEaten });
  }

  const dayQuery = useQuery({
    queryKey: userId ? queryKeys.day(userId, localDate) : ['calendar-day', 'signed-out', localDate],
    queryFn: () => readCalendarDay(localDate),
    enabled: Boolean(userId && profile.isSuccess && view === 'day'),
  });
  const rangeQuery = useQuery({
    queryKey: userId ? queryKeys.calendarRange(userId, rangeFrom, rangeTo) : ['calendar-range', 'signed-out', rangeFrom, rangeTo],
    queryFn: () => readCalendarRange(rangeFrom, rangeTo),
    enabled: Boolean(userId && profile.isSuccess && view !== 'day'),
  });
  const pickerFirst = `${pickerMonth}-01`;
  const pickerLast = addLocalDays(addLocalMonths(pickerFirst, 1), -1);
  const pickerFrom = startOfLocalWeek(pickerFirst);
  const pickerTo = addLocalDays(startOfLocalWeek(pickerLast), 6);
  const pickerQuery = useQuery({
    queryKey: userId ? queryKeys.calendarRange(userId, pickerFrom, pickerTo) : ['calendar-picker', 'signed-out', pickerFrom, pickerTo],
    queryFn: () => readCalendarRange(pickerFrom, pickerTo),
    enabled: Boolean(userId && profile.isSuccess && monthPickerOpen),
  });

  useEffect(() => {
    if (!monthPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMonthPickerOpen(false); monthTrigger.current?.focus(); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [monthPickerOpen]);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setViewMenuOpen(false); viewTriggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [viewMenuOpen]);
  const refresh = async (date: string, allDates = false) => {
    if (!userId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: allDates ? ['account', userId, 'day'] : queryKeys.day(userId, date) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recentMeals(userId) }),
      queryClient.invalidateQueries({ queryKey: ['account', userId, 'calendar-range'] }),
    ]);
  };
  const logMutation = useMutation({
    mutationFn: ({ choices, groupId }: { choices: CalendarChoice[]; groupId?: string | null }) =>
      choices.length === 1 && !groupId ? logCalendarItem(choices[0]!) : logCalendarItems(choices, groupId ?? undefined),
    onSuccess: async (_result, { choices }) => {
      setExpandedGroupId(null);
      if (userId) {
        try {
          await rememberAddedFoodPortions(userId, choices);
          await queryClient.invalidateQueries({ queryKey: queryKeys.foodPortionPreferences(userId) });
        } catch {
          // The diary write succeeded independently of the portion preference.
        }
      }
      await refresh(choices[0]!.localDate);
      showFeedback('Meal logged.', choices[0]!.localDate);
    },
  });
  const mealStateMutation = useMutation({
    mutationFn: setCalendarMealState,
    onSuccess: async (_result, input) => {
      setExpandedGroupId(null);
      await refresh(input.localDate);
      showFeedback(input.state === 'planned' ? 'Meal moved to Planned.' : 'Meal logged.', input.localDate);
    },
  });
  const seriesMutation = useMutation({
    mutationFn: saveCalendarComposer,
    onSuccess: async (_result, input) => {
      setRemovingSeries(null);
      setExpandedGroupId(null);
      await refresh(input.localDate, true);
      showFeedback(input.state === 'removed' ? 'Repeating plan updated.' : 'Meal logged.', input.localDate);
    },
  });

  const removalMutation = useMutation({
    mutationFn: changeCalendarMealRemoval,
    onSuccess: async (_result, input) => {
      setExpandedGroupId(null);
      if ('items' in input) setRemoval({ requestId: input.requestId, localDate: input.localDate });
      else setRemoval(null);
      await refresh(input.localDate);
      showFeedback('items' in input ? 'Meal removed.' : 'Meal restored.', input.localDate);
    },
  });

  function changeMealState(items: DayItem[], state: ComposerSave['state']) {
    mealStateMutation.mutate({
      requestId: crypto.randomUUID(), localDate, state,
      items: items.map(({ id, revision }) => ({ id, revision })),
    });
  }

  function markMealEaten(items: DayItem[], anchor: HTMLButtonElement) {
    if (items.every((item) => readReplannedSnapshot(item))) {
      changeMealState(items, 'eaten');
      return;
    }
    const occurrence = items[0];
    if (occurrence?.series_id && occurrence.series_revision) {
      const drafts = items.map(plannedDraft);
      if (drafts.some((food) => !food || food.basis.caloriesKcal === null)) {
        editOccurrence(items, anchor, undefined, false, true);
        return;
      }
      seriesMutation.mutate({
        requestId: crypto.randomUUID(), localDate, state: 'eaten',
        items: drafts.map((food) => prepareFood(food!, profile.data?.nutrientFields ?? [], occurrence.section)),
        seriesEdit: { id: occurrence.series_id, revision: occurrence.series_revision, scope: 'one' },
      });
      return;
    }
    const plannedItems = items.filter((item) => item.state === 'planned');
    if (plannedItems.some((item) => readReplannedSnapshot(item) ||
      (readItemLogging(item) && readPlannedNutrition(item)?.calories == null))) {
      editOccurrence(items, anchor, undefined, false, true);
      return;
    }
    const choices = plannedItems.flatMap((item): CalendarChoice[] => {
      const planned = readPlannedChoice(item.planned_payload);
      if (!planned) return [];
      return [{ requestId: crypto.randomUUID(), localDate, sourceKind: planned.sourceKind, sourceId: planned.sourceId,
        amount: planned.amount, unit: planned.unit, section: item.section, manualPayload: planned.manualPayload,
        plannedItemId: item.id, expectedItemRevision: item.revision, measure: readPlannedMeasure(item.planned_payload) }];
    });
    if (choices.length !== plannedItems.length) {
      editOccurrence(items, anchor, undefined, false, true);
      return;
    }
    if (choices.length > 0) logMutation.mutate({ choices, groupId: occurrence?.meal_group_id });
  }

  const duplicateMutation = useMutation({
    mutationFn: async ({ items, requestId, date }: { items: DayItem[]; requestId: string; date: string }) => {
      const state = items.every((item) => item.state === 'eaten') ? 'eaten' : 'planned';
      const foods = (await Promise.all(items.map((item) => loadDiaryItemDrafts(userId!, item)))).flat();
      await saveCalendarComposer({ requestId, localDate: date, state,
        items: foods.map((food) => prepareFood({ ...food, remember: false }, profile.data?.nutrientFields ?? [], items[0]!.section)) });
      return state;
    },
    onSuccess: async (state, { date }) => {
      setExpandedGroupId(null);
      await refresh(date);
      showFeedback(state === 'planned' ? 'Meal copied as planned.' : 'Meal duplicated.', date);
    },
  });

  const data = view === 'day' ? dayQuery.data : undefined;
  const rangeDays = view === 'day' ? [] : rangeQuery.data ?? [];
  const labelledGroups = sections.map(([section, label]) => ({ section, label, items: data?.items.filter((item) => item.section === section) ?? [] }))
    .filter((group) => group.items.length > 0);
  const unlabelledItems = data?.items.filter((item) => item.section === 'unlabelled') ?? [];
  const mealGroups: Array<{ section: string; label: string | null; items: DayItem[] }> = [
    ...labelledGroups,
    ...(unlabelledItems.length > 0 ? [{ section: 'unlabelled', label: labelledGroups.length > 0 ? 'Other meals' : null, items: unlabelledItems }] : []),
  ];
  const fields = profile.data?.nutrientFields.filter((field) => field.is_displayed) ?? [];
  const summary = summarizeDay(data?.items ?? [], fields.map((field) => field.field_id));
  const target = data?.target.caloriesKcal ?? null;
  const calories = summary.calories;
  const remaining = target !== null && calories.value !== null && calories.complete ? target - calories.value : null;
  const isToday = localDate === today;
  const busy = logMutation.isPending || seriesMutation.isPending || mealStateMutation.isPending || removalMutation.isPending || duplicateMutation.isPending;
  const undo = data && data.day?.status !== 'completed' && removal?.localDate === localDate && view === 'day' ? removal : null;
  const currentFeedback = feedback?.date === localDate && view === 'day' ? feedback : null;
  const canRetryRemoval = !(removalMutation.error instanceof DataError) || removalMutation.error.retryable;
  const rangeTitle = view === 'month'
    ? formatLocalDate(localDate, timezone, { month: 'long', year: 'numeric' })
    : `${formatLocalDate(rangeFrom, timezone, { day: 'numeric', month: 'short' })} – ${formatLocalDate(rangeTo, timezone, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const title = view === 'day'
    ? `${formatLocalDate(localDate, timezone, { month: 'long' })} ${formatLocalDate(localDate, timezone, { day: 'numeric' })}, ${formatLocalDate(localDate, timezone, { year: 'numeric' })}`
    : rangeTitle;
  const compactTitle = view === 'day' ? formatLocalDate(localDate, timezone, { day: 'numeric', month: 'short' })
    : view === 'month' ? formatLocalDate(localDate, timezone, { month: 'short', year: 'numeric' })
      : `${formatLocalDate(rangeFrom, timezone, rangeFrom.slice(0, 7) === rangeTo.slice(0, 7) ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${formatLocalDate(rangeTo, timezone, { day: 'numeric', month: 'short' })}`;
  return <>{headerHost && createPortal(<div className="calendar-toolbar">
      <div className="calendar-toolbar-navigation" aria-label="Calendar date navigation">
        <button className="calendar-today-button" type="button" onClick={() => chooseDate(today)}>Today</button>
        <button className="calendar-period-button" type="button" aria-label={`Previous ${view}`} onClick={() => movePeriod(-1)}><ChevronLeft size={20} /></button>
        <button className="calendar-period-button" type="button" aria-label={`Next ${view}`} onClick={() => movePeriod(1)}><ChevronRight size={20} /></button>
      </div>
      <div className="calendar-date-picker-control"><button ref={monthTrigger} className="calendar-month-toggle" type="button" aria-label={`Choose date, ${title}`} aria-controls="calendar-month-picker" aria-expanded={monthPickerOpen} onClick={() => {
        setViewMenuOpen(false);
        setPickerMonth(localDate.slice(0, 7));
        setMonthPickerOpen((open) => !open);
      }}><span className="calendar-date-label-full">{title}</span><span className="calendar-date-label-compact">{compactTitle}</span><ChevronDown aria-hidden="true" size={19} className={monthPickerOpen ? 'is-open' : ''} /></button>
      {monthPickerOpen && <section className="calendar-month-popover" id="calendar-month-picker" aria-label="Choose a calendar date">
        <div className="calendar-month-popover-head"><strong>{formatLocalDate(pickerFirst, timezone, { month: 'long', year: 'numeric' })}</strong><div><button className="calendar-picker-today" type="button" onClick={() => { chooseDate(today); monthTrigger.current?.focus(); }}>Today</button><button type="button" aria-label="Previous month" onClick={() => setPickerMonth(addLocalMonths(pickerFirst, -1).slice(0, 7))}><ChevronLeft size={20} /></button><button type="button" aria-label="Next month" onClick={() => setPickerMonth(addLocalMonths(pickerFirst, 1).slice(0, 7))}><ChevronRight size={20} /></button></div></div>
        <div className="calendar-month-weekdays" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={index}>{day}</span>)}</div>
        {pickerQuery.isPending && <p className="calendar-picker-status">Loading dates…</p>}
        {pickerQuery.isError && <div className="calendar-picker-status"><p>Dates could not be loaded.</p><button type="button" onClick={() => void pickerQuery.refetch()}>Try again</button></div>}
        {pickerQuery.data && <div className="calendar-month-dates">{pickerQuery.data.map((day) => {
          const daySummary = summarizeDay(day.items, []);
          const eatenCalories = daySummary.calories.value;
          const pastOrToday = day.localDate <= today;
          const calorieLabel = pastOrToday && daySummary.eatenCount > 0 && eatenCalories !== null
            ? `${daySummary.calories.estimated ? '≈' : ''}${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(eatenCalories)}` : null;
          const planLabel = !calorieLabel && daySummary.plannedCount > 0 ? `${daySummary.plannedCount} planned` : null;
          const outside = day.localDate.slice(0, 7) !== pickerMonth;
          return <button key={day.localDate} className={`calendar-month-date${outside ? ' is-outside' : ''}${day.localDate === localDate ? ' is-selected' : ''}${day.localDate === today ? ' is-today' : ''}`} type="button" aria-current={day.localDate === today ? 'date' : undefined} aria-label={`${formatLocalDate(day.localDate, timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${calorieLabel ? `, ${calorieLabel} kcal eaten` : planLabel ? `, ${planLabel}` : ''}`} onClick={() => { selectDay(day.localDate); monthTrigger.current?.focus(); }}><span>{formatLocalDate(day.localDate, timezone, { day: 'numeric' })}</span>{(calorieLabel || planLabel) && <small>{calorieLabel || planLabel}</small>}</button>;
        })}</div>}
      </section>}</div>
      {monthPickerOpen && <button className="calendar-picker-scrim" type="button" tabIndex={-1} aria-label="Close calendar picker" onClick={() => setMonthPickerOpen(false)} />}
      <Link className="calendar-settings-link" to="/settings" aria-label="Calendar settings"><Settings size={19} strokeWidth={1.8} /></Link>
      <div className="calendar-view-picker" ref={viewMenuRef}>
        <button ref={viewTriggerRef} className="calendar-view-trigger" type="button" aria-label={`Calendar view: ${calendarViews.find((item) => item.value === view)?.label}`} aria-expanded={viewMenuOpen} aria-controls="calendar-view-options" onClick={() => { setMonthPickerOpen(false); setViewMenuOpen((open) => !open); }}>
          {calendarViews.map(({ value, icon: Icon }) => value === view && <Icon key={value} size={18} strokeWidth={1.8} aria-hidden="true" />)}
          <span>{calendarViews.find((item) => item.value === view)?.label}</span>
          <ChevronDown className={viewMenuOpen ? 'is-open' : ''} size={17} aria-hidden="true" />
        </button>
        {viewMenuOpen && <div className="calendar-view-options" id="calendar-view-options" role="group" aria-label="Calendar view choices">
          {calendarViews.map(({ value, label, icon: Icon }) => <button key={value} className={`calendar-view-option${view === value ? ' is-active' : ''}`} type="button" aria-current={view === value ? 'true' : undefined} onClick={() => { chooseView(value); viewTriggerRef.current?.focus(); }}><Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>{view === value && <Check className="calendar-view-check" size={16} strokeWidth={2} aria-hidden="true" />}</button>)}
        </div>}
      </div>
    </div>, headerHost)}
    <div className="page-stack calendar-page" onTouchStart={(event) => {
      if (view !== 'day' || composer || activeGroupId || monthPickerOpen || !window.matchMedia('(max-width: 760px)').matches || event.touches.length !== 1) return;
      swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchEnd={(event) => {
      if (view !== 'day' || !swipeStart.current || event.changedTouches.length !== 1) return;
      const x = event.changedTouches[0].clientX - swipeStart.current.x;
      const y = event.changedTouches[0].clientY - swipeStart.current.y;
      swipeStart.current = null;
      if (Math.abs(x) > 55 && Math.abs(x) > Math.abs(y) * 1.4) chooseDate(addLocalDays(localDate, x < 0 ? 1 : -1));
    }} onTouchCancel={() => { swipeStart.current = null; }}>

    {profile.isError && <StatusMessage tone="error">We couldn’t load your profile. Refresh to see your saved timezone and targets.</StatusMessage>}
    {view === 'day' && !profile.isError && dayQuery.isPending && <LoadingSkeleton label="Loading this calendar date" />}
    {view === 'day' && dayQuery.isError && <div className="page-stack"><StatusMessage tone="error">This date could not be loaded. Its entries and totals are unavailable.</StatusMessage><button className="secondary-button" type="button" onClick={() => void dayQuery.refetch()}>Try again</button></div>}
    {view !== 'day' && !profile.isError && rangeQuery.isPending && <LoadingSkeleton label={`Loading calendar ${view}`} />}
    {view !== 'day' && rangeQuery.isError && <div className="page-stack"><StatusMessage tone="error">This calendar range could not be loaded.</StatusMessage><button className="secondary-button" type="button" onClick={() => void rangeQuery.refetch()}>Try again</button></div>}
    {view !== 'day' && rangeQuery.data && <CalendarRangeView days={rangeDays} timezone={timezone} selectedDate={localDate} today={today} monthView={view === 'month'} onChoose={selectDay} />}

    {data && <>
      <section className="calendar-day-panel" aria-label="Meals and nutrition for this date">
      <div className="calendar-day-overview">
        <div className="calendar-day-identity">
          <button className="calendar-day-create" type="button" disabled={busy || data.day?.status === 'completed'} aria-label="Add a meal" onClick={(event) => openAdd(event)}><Plus size={36} strokeWidth={1.8} /></button>
          <div className={`calendar-day-date${isToday ? ' is-today' : ''}`}><span>{formatLocalDate(localDate, timezone, { weekday: 'short' })}</span><strong aria-current={isToday ? 'date' : undefined}>{formatLocalDate(localDate, timezone, { day: 'numeric' })}</strong></div>
        </div>
        <div className="calendar-day-metrics">
          {fields.length > 0 && <section className={`calendar-nutrients${showAllNutrients ? ' is-expanded' : ' is-collapsed'}`} aria-label="Nutrients"><dl id="calendar-nutrient-metrics">{fields.map((field) => { const metric = summary.nutrients[field.field_id]!; const label = field.standard_key === 'carbohydrate' ? 'Carbs' : field.name; return <div key={field.field_id}><dt>{label}{metric.value !== null && !metric.complete && <IncompleteIndicator nutrient={label} />}</dt><dd>{nutritionText(metric.value, field.unit, metric.estimated)}</dd></div>; })}</dl>{fields.length > 2 && <button className="calendar-nutrients-toggle" type="button" aria-controls="calendar-nutrient-metrics" aria-expanded={showAllNutrients} aria-label={showAllNutrients ? 'Show fewer nutrients' : `Show ${fields.length - 2} more nutrients`} onClick={() => setShowAllNutrients((current) => !current)}>{showAllNutrients ? 'Less' : `+${fields.length - 2}`}</button>}</section>}
          <section className="calendar-calories" aria-label="Daily calorie summary">
            <span className="calendar-metric-label">Calories eaten{calories.value !== null && !calories.complete && <IncompleteIndicator nutrient="calorie" />}</span>
            <div className="calendar-calorie-value"><strong>{nutritionText(calories.value, '', calories.estimated)}</strong><span>{target === null ? 'kcal' : `of ${number(target)} kcal`}</span></div>
            {target === null ? <p className="calendar-target-empty">Target not set</p> : remaining !== null && <p>{nutritionText(Math.abs(remaining), '', calories.estimated)} {remaining >= 0 ? 'remaining' : 'over'}</p>}
            {target !== null && target > 0 && calories.value !== null && calories.complete && <div className="calorie-track" role="progressbar" aria-label="Calories eaten compared with target" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(calories.value, target)} aria-valuetext={`${calories.estimated ? 'About ' : ''}${number(calories.value)} of ${number(target)} kcal`}><span style={{ width: `${Math.min(100, calories.value / target * 100)}%` }} /></div>}
          </section>
        </div>
      </div>
      <div className="calendar-day-main">

      {data.day?.status === 'completed' && <StatusMessage tone="info">This completed day is read-only.</StatusMessage>}
      <section className="today-meals" aria-label="Meals">
        {mealGroups.length === 0 ? (localDate > today && <div className="calendar-day-empty">
          <h2>No meals planned</h2>
        </div>) :
        <div className="today-sections">{mealGroups.map(({ section, label, items }) => <section className="today-meal-section" key={section} aria-labelledby={label ? `calendar-${section}` : undefined} aria-label={label ? undefined : 'Meals'}>
          {label && <h3 className="calendar-meal-section-heading" id={`calendar-${section}`}>{label}</h3>}
          <ul className="today-item-list">{groupDayItems(items).map((group) => {
            const groupFields = fields.slice(0, 3);
            const groupSummary = summarizeDay(group.items, groupFields.map((field) => field.field_id));
            const allEaten = group.items.every((item) => item.state === 'eaten');
            const allPlanned = group.items.every((item) => item.state === 'planned');
            const status = allEaten ? 'Eaten' : allPlanned ? 'Planned' : 'Partly eaten';
            const recurring = group.items[0]?.series_id ? group.items[0] : undefined;
            const calorieBlock = group.items.length === 1 && readItemLogging(group.items[0]!)?.kind === 'calorie_block' ? group.items[0] : undefined;
            const plannedTotals = group.items.map(readPlannedNutrition);
            const plannedSnapshots = group.items.map(readReplannedSnapshot);
            const sumPlanned = (field?: string) => {
              const values = plannedTotals.map((item) => field ? item?.nutrients[field] ?? null : item?.calories ?? null);
              const known = values.filter((value): value is number => value !== null);
              const incompleteSnapshot = plannedSnapshots.some((snapshot) => (field ? snapshot?.nutrients[field] : snapshot?.calories)?.complete === false);
              return { value: known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null, complete: known.length === values.length && !incompleteSnapshot,
                estimated: group.items.some((item) => readItemLogging(item)?.values[field ?? CALORIES]?.certainty === 'estimated') };
            };
            const mealFoods = group.items.map((item, itemIndex) => {
              const snapshot = plannedSnapshots[itemIndex] ?? readEatenSnapshot(item.eaten_snapshot);
              const planned = readPlannedChoice(item.planned_payload);
              const plannedNutrition = plannedTotals[itemIndex];
              const logging = readItemLogging(item);
              const itemComponents = snapshot?.components as unknown as Array<Record<string, unknown>> | undefined;
              const ingredients = itemComponents && itemComponents.length > 1 ? itemComponents.map((component, index) => {
                const componentCalories = component.calories && typeof component.calories === 'object' ? (component.calories as { value?: number | null }).value : null;
                const nutrientValues = component.nutrients && typeof component.nutrients === 'object' ? component.nutrients as Record<string, { value?: number | null }> : {};
                return { key: `${item.id}-${index}`, name: String(component.food_name ?? 'Food'), portion: `${number(Number(component.amount ?? 1))} ${String(component.unit ?? 'serving')}`,
                  calories: nutritionText(componentCalories ?? null), metrics: groupFields.map((field) => ({
                    label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name,
                    value: nutritionText(nutrientValues[field.field_id]?.value ?? null, field.unit),
                  })) };
              }) : undefined;
              return {
                key: item.id,
                name: snapshot?.name ?? plannedItemName(item.planned_payload) ?? 'Food',
                brand: snapshot?.brand ?? (typeof planned?.manualPayload?.brand === 'string' ? planned.manualPayload.brand : null),
                portion: `${number(snapshot?.selected_amount ?? planned?.amount ?? item.selected_amount ?? 1)} ${snapshot?.selected_unit ?? planned?.unit ?? item.selected_unit ?? 'serving'}`,
                calories: nutritionText(snapshot?.calories.value ?? plannedNutrition?.calories ?? null, '', logging?.values[CALORIES]?.certainty === 'estimated'),
                metrics: groupFields.map((field) => ({
                  label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name,
                  value: nutritionText(snapshot?.nutrients[field.field_id]?.value ?? plannedNutrition?.nutrients[field.field_id] ?? null,
                    field.unit, logging?.values[field.field_id]?.certainty === 'estimated'),
                  incomplete: snapshot?.nutrients[field.field_id]?.value != null && !snapshot.nutrients[field.field_id]!.complete,
                })), ingredients,
              };
            });
            const total = allPlanned ? sumPlanned() : groupSummary.calories;
            const metrics: CalendarMealMetric[] = calorieBlock ? [] : groupFields.map((field) => {
              const metric = allPlanned ? sumPlanned(field.field_id) : groupSummary.nutrients[field.field_id]!;
              return { label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name,
                value: nutritionText(metric.value, field.unit, metric.estimated), incomplete: metric.value !== null && !metric.complete };
            });
            const measures = group.items.map((item) => item.revision > 1 ? null : item.state === 'eaten'
              ? readEatenSnapshot(item.eaten_snapshot)?.display_measure ?? null
              : readPlannedMeasure(item.planned_payload));
            if (measures.every((measure) => measure !== null)) {
              for (const [kind, label, unit] of [['weight', 'Weight', 'g'], ['volume', 'Volume', 'ml']] as const) {
                const value = measures.reduce((sum, measure) => sum + (measure?.kind === kind ? measure.value : 0), 0);
                if (value > 0) metrics.push({ label, value: `${number(value)} ${unit}` });
              }
            }
            return <li key={group.id} className="calendar-saved-meal">
              <CalendarMealCard
                state={status}
                label={section === 'unlabelled' ? null : label}
                recurring={Boolean(recurring)}
                calories={nutritionText(total.value, '', total.estimated)}
                caloriesIncomplete={total.value !== null && !total.complete}
                foods={mealFoods}
                metrics={metrics}
                expanded={activeGroupId === `${localDate}:${group.id}`}
                onToggle={() => setExpandedGroupId((current) => current === `${localDate}:${group.id}` ? null : `${localDate}:${group.id}`)}
                onDelete={data.day?.status !== 'completed' ? () => {
                  if (recurring) { seriesMutation.reset(); setSeriesScope('one'); setRemovingSeries(recurring); }
                  else {
                    setFeedback(null);
                    removalMutation.mutate({ requestId: crypto.randomUUID(), localDate,
                      items: group.items.map(({ id, revision }) => ({ id, revision })) });
                  }
                } : undefined}
                onDuplicate={data.day?.status !== 'completed' ? () => {
                  setFeedback(null);
                  duplicateMutation.mutate({ requestId: crypto.randomUUID(), date: localDate, items: group.items });
                } : undefined}
                onEdit={data.day?.status !== 'completed' ? (tile) => editOccurrence(group.items, tile, calorieBlock) : undefined}
                onAttachFoods={calorieBlock && data.day?.status !== 'completed' ? (tile) => editOccurrence(group.items, tile, calorieBlock, true) : undefined}
                markEatenLabel={calorieBlock ? readItemLogging(calorieBlock)?.values[CALORIES]?.certainty === 'estimated' ? 'Log estimate' : 'Log calories' : undefined}
                onMarkEaten={group.items.some((item) => item.state === 'planned') && localDate <= today && data.day?.status !== 'completed' ? (tile) => markMealEaten(group.items, tile) : undefined}
                onMarkNotEaten={allEaten && data.day?.status !== 'completed' ? () => changeMealState(group.items, 'planned') : undefined}
                busy={busy}
              />
            </li>;
          })}</ul>
        </section>)}</div>}
        {composer && !composer.anchorTile && <div ref={setDraftTile} className="calendar-meal-tile is-draft" aria-hidden="true">
          <span className="calendar-meal-tile-top"><strong>New meal</strong></span>
        </div>}
      </section>
      </div>
      <div className="calendar-feedback" aria-label="Calendar feedback">
      {mealStateMutation.isError && mealStateMutation.variables?.localDate === localDate && <div className="calendar-actions">
        <StatusMessage tone="error">{mealStateMutation.error.message}</StatusMessage>
        <button className="text-button" type="button" disabled={busy} onClick={() => mealStateMutation.mutate(mealStateMutation.variables!)}>Retry same request</button>
      </div>}
      {currentFeedback && (!undo || currentFeedback.text !== 'Meal removed.') && <StatusMessage tone="success">{currentFeedback.text}</StatusMessage>}
      {seriesMutation.isError && seriesMutation.variables?.state === 'eaten' && seriesMutation.variables.localDate === localDate && <div className="calendar-actions"><StatusMessage tone="error">{seriesMutation.error.message}</StatusMessage>
        {seriesMutation.variables && <button className="text-button" type="button" disabled={busy} onClick={() => seriesMutation.mutate(seriesMutation.variables!)}>Retry same request</button>}</div>}
      {logMutation.isError && logMutation.variables?.choices[0]?.localDate === localDate && <div className="calendar-actions">
        <StatusMessage tone="error">{logMutation.error.message}</StatusMessage>
        <button className="text-button" type="button" disabled={busy} onClick={() => logMutation.mutate(logMutation.variables!)}>Retry same request</button>
      </div>}
      {removalMutation.isError && removalMutation.variables?.localDate === localDate && <div className="calendar-actions">
        <StatusMessage tone="error">{removalMutation.error.message}</StatusMessage>
        {canRetryRemoval && <button className="text-button" type="button" disabled={busy} onClick={() => removalMutation.mutate(removalMutation.variables!)}>Retry</button>}
        {!canRetryRemoval && <button className="text-button" type="button" onClick={() => { removalMutation.reset(); void refresh(localDate); }}>Refresh date</button>}
      </div>}
      {duplicateMutation.isError && duplicateMutation.variables?.date === localDate && <div className="calendar-actions">
        <StatusMessage tone="error">{duplicateMutation.error.message}</StatusMessage>
        <button className="text-button" type="button" onClick={() => { duplicateMutation.reset(); void refresh(localDate); }}>Refresh date</button>
      </div>}
      {undo && <div className="calendar-undo">
        <span role="status">Meal removed.</span>
        <button type="button" className="text-button" disabled={busy} onClick={() => removalMutation.mutate({
          requestId: crypto.randomUUID(), localDate, removalRequestId: undo.requestId,
        })}>Undo</button>
      </div>}
      </div>
      </section>
    </>}

    <Dialog open={Boolean(removingSeries)} title="Remove repeating meal?" closeDisabled={seriesMutation.isPending} onClose={() => setRemovingSeries(null)}>
      <SeriesScopeSelect value={seriesScope} onChange={setSeriesScope} disabled={seriesMutation.isPending || seriesMutation.isError} />
      {seriesMutation.isError && <StatusMessage tone="error">{seriesMutation.error.message}</StatusMessage>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={seriesMutation.isPending} onClick={() => setRemovingSeries(null)}>Cancel</button>
        <button type="button" className="primary-button" disabled={seriesMutation.isPending || !removingSeries?.series_id} onClick={() => {
          if (!removingSeries?.series_id || !removingSeries.series_revision) return;
          if (seriesMutation.isError && seriesMutation.variables) { seriesMutation.mutate(seriesMutation.variables); return; }
          seriesMutation.mutate({ requestId: crypto.randomUUID(), localDate, state: 'removed', items: [],
            seriesEdit: { id: removingSeries.series_id, revision: removingSeries.series_revision, scope: seriesScope } });
        }}>{seriesMutation.isError ? 'Retry removal' : 'Remove'}</button>
      </div>
    </Dialog>

    {userId && composer && profile.data && <AddChoiceDialog userId={userId} fields={profile.data.nutrientFields} editingItems={composer.editingItems} startEaten={composer.startEaten} reuse={composerDraft ? undefined : reuse}
      initialDate={localDate} today={today} timezone={timezone} anchor={composer.anchorTile ?? draftTile} block={composer.block} attachFoods={composer.attachFoods}
      onClose={closeComposer} onSaved={(input: ComposerSave) => {
        closeComposer();
        if (input.localDate !== localDate) chooseDate(input.localDate);
        showFeedback(composer.editingItems && !composer.startEaten ? 'Meal updated.' : input.state === 'eaten' ? 'Meal logged.' : input.recurrence ? 'Repeating plan saved.' : 'Meal planned.', input.localDate);
        void refresh(input.localDate, Boolean(input.recurrence || input.seriesEdit));
        void queryClient.invalidateQueries({ queryKey: queryKeys.foods(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.foodPortionPreferences(userId) });
      }} />}

    </div></>;
}

function CalendarRangeView({ days, timezone, selectedDate, today, monthView, onChoose }: {
  days: CalendarDay[]; timezone: string; selectedDate: string; today: string; monthView: boolean; onChoose: (date: string) => void;
}) {
  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return <section className={`calendar-range${monthView ? ' is-month' : ' is-week'}`} aria-label={monthView ? 'Month calendar' : 'Week calendar'}>
    <div className="calendar-weekdays" aria-hidden="true">{weekdayNames.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="calendar-day-grid">{days.map((day) => {
      const summary = summarizeDay(day.items, []);
      const calories = summary.calories.value;
      const target = day.target.caloriesKcal;
      const hasActivity = summary.eatenCount > 0 || summary.plannedCount > 0;
      const groupedItems = groupDayItems(day.items);
      const mixedCount = groupedItems.filter(({ items }) => items.some(({ state }) => state === 'eaten') && items.some(({ state }) => state === 'planned')).length;
      const eatenCount = summary.eatenCount - mixedCount;
      const plannedCount = summary.plannedCount - mixedCount;
      const activity = [
        eatenCount > 0 ? `${eatenCount} eaten` : '',
        plannedCount > 0 ? `${plannedCount} planned` : '',
        mixedCount > 0 ? `${mixedCount} partly eaten` : '',
      ].filter(Boolean).join(' · ');
      const calorieDescription = summary.eatenCount === 0 ? '' : calories === null ? ', calories unknown'
        : `, ${summary.calories.estimated ? 'about ' : ''}${number(calories)} calories eaten${summary.calories.complete ? '' : ', incomplete'}`;
      const isSelected = day.localDate === selectedDate;
      const isToday = day.localDate === today;
      const isOutsideMonth = monthView && day.localDate.slice(0, 7) !== selectedDate.slice(0, 7);
      const visibleItems = groupedItems.slice(0, monthView ? 2 : 4);
      const dateLabel = formatLocalDate(day.localDate, timezone, { weekday: 'long', day: 'numeric', month: 'long' });
      return <button key={day.localDate} type="button" className={`calendar-date-card${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isOutsideMonth ? ' is-outside-month' : ''}`}
        aria-current={isToday ? 'date' : undefined}
        aria-label={`${dateLabel}${isToday ? ', today' : ''}, ${activity || (day.localDate > today ? 'no meals planned' : 'no meals logged')}${calorieDescription}${target === null ? '' : `, ${number(target)} calorie target`}`}
        onClick={() => onChoose(day.localDate)}>
        <span className="calendar-date-head"><span className="calendar-weekday-label">{formatLocalDate(day.localDate, timezone, { weekday: 'short' })}</span><span className="calendar-date-number">{formatLocalDate(day.localDate, timezone, { day: 'numeric' })}</span></span>
        {(!monthView || hasActivity) && <span className="calendar-date-summary" aria-hidden="true">
          {summary.eatenCount > 0 && <span className="calendar-date-calories">{nutritionText(calories, '', summary.calories.estimated)} {calories !== null && !summary.calories.complete && <CircleDashed size={12} className="nutrition-incomplete-mark" />} <small>{target === null || monthView ? 'kcal' : `of ${number(target)} kcal`}</small></span>}
          {activity && <span className="calendar-date-activity">{activity}</span>}
          {!monthView && summary.eatenCount > 0 && summary.calories.complete && target !== null && target > 0 && calories !== null && <span className="calendar-date-progress"><span style={{ width: `${Math.min(100, calories / target * 100)}%` }} /></span>}
        </span>}
        <span className="calendar-date-items" aria-hidden="true">{visibleItems.map((group) => {
          const item = group.items[0]!;
          const name = item.state === 'eaten' ? readEatenSnapshot(item.eaten_snapshot)?.name ?? 'Logged meal' : plannedItemName(item.planned_payload) ?? 'Planned meal';
          const state = group.items.every(({ state }) => state === 'eaten') ? 'eaten' : group.items.every(({ state }) => state === 'planned') ? 'planned' : 'partial';
          return <span key={group.id} className={`calendar-item-chip is-${state}`}>{name}{group.items.length > 1 && ` +${group.items.length - 1}`}</span>;
        })}{groupedItems.length > visibleItems.length && <span className="calendar-more-items">+{groupedItems.length - visibleItems.length} more</span>}</span>
      </button>;
    })}</div>
  </section>;
}
