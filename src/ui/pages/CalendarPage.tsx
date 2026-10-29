import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Calendar, CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, NotebookPen, Plus, Settings } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { useProfile } from '../../features/profile/useProfile';
import { AddChoiceDialog, type PreparedChoice } from '../../features/today/AddChoiceDialog';
import { queryKeys } from '../../data/queryKeys';
import { removePlannedDayItem, resizePlannedDayItem, restorePlannedCalendarItem, reviseDayItem, type ReviseDayItemInput } from '../../data/repositories/dayRepository';
import { logCalendarItem, planCalendarItem, readCalendarDay, readCalendarRange, transferCalendarPlan, type CalendarChoice, type CalendarDay } from '../../data/repositories/calendarRepository';
import { addLocalDays, addLocalMonths, formatLocalDate, isValidLocalDate, localDateInTimezone, startOfLocalWeek } from '../../domain/dates';
import { plannedItemName, readEatenSnapshot, readPlannedChoice, summarizeDay, type DayItem } from '../../domain/daySummary';
import { Dialog } from '../components/Dialog';
import { Field, NumericField } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';

const sections = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks'],
] as const;
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const validDate = (value: string | null) => value !== null && isValidLocalDate(value);
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
  const [adding, setAdding] = useState<'log' | 'plan' | null>(() => searchParams.get('start') === 'meal' ? 'log' : null);
  const [composerAnchor, setComposerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{ action: 'log' | 'plan'; input: CalendarChoice } | null>(null);
  const [editingItem, setEditingItem] = useState<DayItem | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [restoreItem, setRestoreItem] = useState<{ item: DayItem; localDate: string; kind: 'eaten' | 'planned' } | null>(null);
  const [transferItem, setTransferItem] = useState<DayItem | null>(null);
  const [transferDate, setTransferDate] = useState(localDate);
  const [transferAction, setTransferAction] = useState<'copy' | 'move'>('copy');
  const [notice, setNotice] = useState('');
  const [showAllNutrients, setShowAllNutrients] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(localDate.slice(0, 7));
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (searchParams.get('start') !== 'meal') return;
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  function chooseDate(date: string) {
    setAdding(null);
    setMonthPickerOpen(false);
    setExpandedItemId(null);
    setPendingChoice(null);
    setNotice('');
    setSearchParams({ ...(date === today ? {} : { date }), ...(view === 'day' ? {} : { view }) });
  }

  function chooseView(nextView: CalendarView) {
    setAdding(null); setMonthPickerOpen(false); setViewMenuOpen(false); setNotice('');
    setSearchParams({ ...(localDate === today ? {} : { date: localDate }), ...(nextView === 'day' ? {} : { view: nextView }) });
  }

  function selectDay(date: string) {
    setAdding(null); setMonthPickerOpen(false); setNotice('');
    setSearchParams({ ...(date === today ? {} : { date }) });
  }

  function movePeriod(delta: number) {
    chooseDate(view === 'month' ? addLocalMonths(localDate, delta) : addLocalDays(localDate, view === 'week' ? delta * 7 : delta));
  }

  function openAdd(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const calendar = event.currentTarget.closest('.calendar-page')?.getBoundingClientRect();
    const margin = window.innerWidth > 900 ? 28 : 14;
    setComposerAnchor({ left: (calendar?.left ?? 0) + margin, top: rect.bottom + 14, width: Math.min(520, (calendar?.width ?? window.innerWidth) - margin * 2) });
    setAdding(localDate > today ? 'plan' : 'log');
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
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMonthPickerOpen(false); };
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
  const refresh = async (date: string) => {
    if (!userId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.day(userId, date) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(userId) }),
      queryClient.invalidateQueries({ queryKey: ['account', userId, 'calendar-range'] }),
    ]);
  };
  const reviseMutation = useMutation({
    mutationFn: (input: ReviseDayItemInput & { item?: DayItem }) => reviseDayItem(input),
    onSuccess: async (_result, input) => {
      await refresh(input.localDate);
      const removedItem = input.item ?? editingItem;
      if (input.action === 'remove' && removedItem) setRestoreItem({ item: { ...removedItem, state: 'removed', revision: removedItem.revision + 1 }, localDate: input.localDate, kind: 'eaten' });
      if (input.action === 'restore') setRestoreItem(null);
      setEditingItem(null);
      setNotice(input.action === 'remove' ? 'Meal removed. You can undo this change.' : input.action === 'restore' ? 'Meal restored.' : 'Meal portion updated.');
    },
  });
  const resizePlanMutation = useMutation({
    mutationFn: resizePlannedDayItem,
    onSuccess: async (_result, input) => { await refresh(input.localDate); setEditingItem(null); setNotice('Planned portion updated.'); },
  });
  const removePlanMutation = useMutation({
    mutationFn: (input: { requestId: string; localDate: string; itemId: string; expectedRevision: number; item: DayItem }) => removePlannedDayItem({
      requestId: input.requestId, localDate: input.localDate, itemId: input.itemId, expectedRevision: input.expectedRevision,
    }),
    onSuccess: async (_result, input) => {
      await refresh(input.localDate);
      setRestoreItem({ item: { ...input.item, state: 'removed', revision: input.item.revision + 1 }, localDate: input.localDate, kind: 'planned' });
      setNotice('Plan removed. You can undo this change.');
    },
  });
  const restorePlanMutation = useMutation({ mutationFn: restorePlannedCalendarItem, onSuccess: async (_result, input) => {
    await refresh(input.localDate); setRestoreItem(null); setNotice('Plan restored.');
  } });
  const transferMutation = useMutation({
    mutationFn: transferCalendarPlan,
    onSuccess: async (_result, input) => {
      await Promise.all([refresh(input.fromDate), refresh(input.toDate)]);
      setTransferItem(null);
      setNotice(input.action === 'move' ? 'Plan moved to the selected date.' : 'Plan copied to the selected date.');
    },
  });
  const planMutation = useMutation({
    mutationFn: planCalendarItem,
    onSuccess: async (_result, input) => {
      await refresh(input.localDate);
      setPendingChoice(null);
      setNotice('Meal planned. It is not counted as eaten.');
    },
  });
  const logMutation = useMutation({
    mutationFn: logCalendarItem,
    onSuccess: async (_result, input) => {
      await refresh(input.localDate);
      setPendingChoice(null);
      setNotice('Meal logged for this date.');
    },
  });

  function submit(choice: PreparedChoice, action: 'log' | 'plan', requestId = crypto.randomUUID()) {
    const input: CalendarChoice = {
      requestId,
      localDate,
      section: choice.section,
      sourceKind: choice.kind,
      sourceId: choice.kind === 'food' || choice.kind === 'meal' ? choice.id : null,
      amount: choice.amount,
      unit: choice.unit,
      manualPayload: choice.snapshot ? { ...choice.snapshot, name: choice.name } : undefined,
      plannedItemId: choice.plannedItemId,
      expectedItemRevision: choice.expectedItemRevision,
    };
    setPendingChoice({ action, input });
    setNotice('');
    if (action === 'plan') planMutation.mutate(input);
    else logMutation.mutate(input);
  }

  function logPlanned(item: NonNullable<typeof dayQuery.data>['items'][number]) {
    const choice = readPlannedChoice(item.planned_payload);
    if (!choice || localDate > today) return;
    submit({
      kind: choice.sourceKind,
      id: choice.sourceId ?? item.id,
      name: plannedItemName(item.planned_payload) ?? 'Planned item',
      amount: choice.amount,
      unit: choice.unit,
      section: item.section,
      snapshot: choice.manualPayload,
      plannedItemId: item.id,
      expectedItemRevision: item.revision,
    }, 'log');
  }

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
  const remaining = target !== null && calories.value !== null ? target - calories.value : null;
  const isToday = localDate === today;
  const busy = planMutation.isPending || logMutation.isPending || reviseMutation.isPending || resizePlanMutation.isPending || removePlanMutation.isPending || restorePlanMutation.isPending || transferMutation.isPending;
  const rangeTitle = view === 'month'
    ? formatLocalDate(localDate, timezone, { month: 'long', year: 'numeric' })
    : `${formatLocalDate(rangeFrom, timezone, { day: 'numeric', month: 'short' })} – ${formatLocalDate(rangeTo, timezone, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const title = view === 'day'
    ? `${formatLocalDate(localDate, timezone, { month: 'long' })} ${formatLocalDate(localDate, timezone, { day: 'numeric' })}, ${formatLocalDate(localDate, timezone, { year: 'numeric' })}`
    : rangeTitle;

  return <>{headerHost && createPortal(<div className="calendar-toolbar">
      <div className="calendar-toolbar-navigation" aria-label="Calendar date navigation">
        <button className="calendar-today-button" type="button" onClick={() => chooseDate(today)}>Today</button>
        <button className="calendar-period-button" type="button" aria-label={`Previous ${view}`} onClick={() => movePeriod(-1)}><ChevronLeft size={20} /></button>
        <button className="calendar-period-button" type="button" aria-label={`Next ${view}`} onClick={() => movePeriod(1)}><ChevronRight size={20} /></button>
      </div>
      <div className="calendar-date-picker-control"><button className="calendar-month-toggle" type="button" aria-label={`Choose date, ${title}`} aria-controls="calendar-month-picker" aria-expanded={monthPickerOpen} onClick={() => {
        setPickerMonth(localDate.slice(0, 7));
        setMonthPickerOpen((open) => !open);
      }}><span className="calendar-date-label-full">{title}</span><span className="calendar-date-label-month">{formatLocalDate(localDate, timezone, { month: 'long' })}</span><ChevronDown aria-hidden="true" size={19} className={monthPickerOpen ? 'is-open' : ''} /></button>
      {monthPickerOpen && <section className="calendar-month-popover" id="calendar-month-picker" aria-label="Choose a calendar date">
        <div className="calendar-month-popover-head"><strong>{formatLocalDate(pickerFirst, timezone, { month: 'long', year: 'numeric' })}</strong><div><button type="button" aria-label="Previous month" onClick={() => setPickerMonth(addLocalMonths(pickerFirst, -1).slice(0, 7))}><ChevronLeft size={20} /></button><button type="button" aria-label="Next month" onClick={() => setPickerMonth(addLocalMonths(pickerFirst, 1).slice(0, 7))}><ChevronRight size={20} /></button></div></div>
        <div className="calendar-month-weekdays" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={index}>{day}</span>)}</div>
        {pickerQuery.isPending && <p className="calendar-picker-status">Loading dates…</p>}
        {pickerQuery.isError && <div className="calendar-picker-status"><p>Dates could not be loaded.</p><button type="button" onClick={() => void pickerQuery.refetch()}>Try again</button></div>}
        {pickerQuery.data && <div className="calendar-month-dates">{pickerQuery.data.map((day) => {
          const daySummary = summarizeDay(day.items, []);
          const eatenCalories = daySummary.calories.value;
          const pastOrToday = day.localDate <= today;
          const calorieLabel = pastOrToday && daySummary.eatenCount > 0 && eatenCalories !== null ? `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(eatenCalories)} kcal` : null;
          const planLabel = !calorieLabel && daySummary.plannedCount > 0 ? `${daySummary.plannedCount} planned` : null;
          const outside = day.localDate.slice(0, 7) !== pickerMonth;
          return <button key={day.localDate} className={`calendar-month-date${outside ? ' is-outside' : ''}${day.localDate === localDate ? ' is-selected' : ''}${day.localDate === today ? ' is-today' : ''}`} type="button" aria-current={day.localDate === today ? 'date' : undefined} aria-label={`${formatLocalDate(day.localDate, timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${calorieLabel ? `, ${calorieLabel} eaten` : planLabel ? `, ${planLabel}` : ''}`} onClick={() => selectDay(day.localDate)}><span>{formatLocalDate(day.localDate, timezone, { day: 'numeric' })}</span>{(calorieLabel || planLabel) && <small>{calorieLabel || planLabel}</small>}</button>;
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
          {calendarViews.map(({ value, label, icon: Icon }) => <button key={value} className={`calendar-view-option${view === value ? ' is-active' : ''}`} type="button" aria-current={view === value ? 'true' : undefined} onClick={() => chooseView(value)}><Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>{view === value && <Check className="calendar-view-check" size={16} strokeWidth={2} aria-hidden="true" />}</button>)}
        </div>}
      </div>
      <Link className="calendar-builder-link" to="/library?view=meals&create=1" aria-label="Build a meal"><NotebookPen size={18} strokeWidth={1.8} /><span className="calendar-builder-full">Build a meal</span><span className="calendar-builder-short">Build</span></Link>
    </div>, headerHost)}
    <div className="page-stack calendar-page" onTouchStart={(event) => {
      if (view !== 'day' || monthPickerOpen || !window.matchMedia('(max-width: 760px)').matches || event.touches.length !== 1) return;
      swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchEnd={(event) => {
      if (view !== 'day' || !swipeStart.current || event.changedTouches.length !== 1) return;
      const x = event.changedTouches[0].clientX - swipeStart.current.x;
      const y = event.changedTouches[0].clientY - swipeStart.current.y;
      swipeStart.current = null;
      if (Math.abs(x) > 55 && Math.abs(x) > Math.abs(y) * 1.4) chooseDate(addLocalDays(localDate, x < 0 ? 1 : -1));
    }} onTouchCancel={() => { swipeStart.current = null; }}>

    {profile.isError && <StatusMessage tone="error">We couldn’t load your profile. Refresh to see your saved timezone and targets.</StatusMessage>}
    {view === 'day' && dayQuery.isPending && <LoadingSkeleton label="Loading this calendar date" />}
    {view === 'day' && dayQuery.isError && <div className="page-stack"><StatusMessage tone="error">This date could not be loaded. Its entries and totals are unavailable.</StatusMessage><button className="secondary-button" type="button" onClick={() => void dayQuery.refetch()}>Try again</button></div>}
    {view !== 'day' && rangeQuery.isPending && <LoadingSkeleton label={`Loading calendar ${view}`} />}
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
          {fields.length > 0 && <section className={`calendar-nutrients${showAllNutrients ? ' is-expanded' : ' is-collapsed'}`} aria-label="Nutrients"><dl id="calendar-nutrient-metrics">{fields.map((field) => { const metric = summary.nutrients[field.field_id]!; return <div key={field.field_id}><dt>{field.standard_key === 'carbohydrate' ? 'Carbs' : field.name}</dt><dd>{metric.value === null ? 'Unknown' : `${number(metric.value)} ${field.unit}${metric.complete ? '' : ' · partial'}`}</dd></div>; })}</dl>{fields.length > 2 && <button className="calendar-nutrients-toggle" type="button" aria-controls="calendar-nutrient-metrics" aria-expanded={showAllNutrients} aria-label={showAllNutrients ? 'Show fewer nutrients' : `Show ${fields.length - 2} more nutrients`} onClick={() => setShowAllNutrients((current) => !current)}>{showAllNutrients ? 'Less' : `+${fields.length - 2}`}</button>}</section>}
          <section className="calendar-calories" aria-label="Daily calorie summary">
            <span className="calendar-metric-label">Calories eaten</span>
            <div className="calendar-calorie-value"><strong>{calories.value === null ? 'Unknown' : number(calories.value)}</strong><span>{target === null ? 'kcal' : `of ${number(target)} kcal`}{calories.complete ? '' : ' · partial'}</span></div>
            <p>{target === null ? 'Target not set' : remaining === null ? `${number(target)} kcal target` : `${number(Math.abs(remaining))} ${remaining >= 0 ? 'remaining' : 'over'}${calories.complete ? '' : ' based on known values'}`}</p>
            {target !== null && <div className="calorie-track" role="progressbar" aria-label="Calories eaten compared with target" aria-valuemin={0} aria-valuemax={target} aria-valuenow={calories.value ?? 0}><span style={{ width: `${Math.min(100, Math.max(0, (calories.value ?? 0) / target * 100))}%` }} /></div>}
          </section>
        </div>
      </div>
      <div className="calendar-day-main">

      {data.day?.status === 'completed' && <StatusMessage tone="info">This older date has a saved completion snapshot. Its target is preserved as recorded.</StatusMessage>}
      <section className="today-meals" aria-label="Meals">
        {mealGroups.length === 0 ? <div className="calendar-day-empty">
          <h2>{data.day?.status === 'completed' ? 'No meals recorded' : localDate > today ? 'Plan your first meal' : 'Your first meal goes here'}</h2>
          <p>{data.day?.status === 'completed'
            ? 'This day was completed without any logged or planned meals.'
            : localDate > today
              ? 'Build out this day at your own pace. Planned meals will appear here, ready to adjust or log when you eat.'
              : 'Log what you’ve eaten or plan what’s next. Your meals will appear here, and your nutrition totals will update above.'}</p>
          {data.day?.status !== 'completed' && <button className="calendar-empty-add" type="button" disabled={busy} onClick={(event) => openAdd(event)}><Plus size={22} strokeWidth={1.9} />{localDate > today ? 'Plan a meal' : 'Add a meal'}</button>}
        </div> :
        <div className="today-sections">{mealGroups.map(({ section, label, items }) => <section className="today-meal-section" key={section} aria-labelledby={label ? `calendar-${section}` : undefined} aria-label={label ? undefined : 'Meals'}>
          {label && <div className="today-section-heading"><h3 id={`calendar-${section}`}>{label}</h3></div>}
          <ul className="today-item-list">{items.map((item) => {
            const snapshot = item.state === 'eaten' ? readEatenSnapshot(item.eaten_snapshot) : null;
            const name = snapshot?.name ?? plannedItemName(item.planned_payload) ?? 'Planned item';
            return <li key={item.id} className={`today-item${expandedItemId === item.id ? ' is-actions-open' : ''}`}><div className="today-item-main"><div><h4>{name}</h4><p>{item.selected_amount} {item.selected_unit}</p></div><span className={`today-item-state ${item.state === 'eaten' ? 'is-eaten' : 'is-planned'}`}>{item.state === 'eaten' ? 'Eaten' : 'Planned'}</span></div>
              <p className="today-item-calories">{snapshot ? snapshot.calories.value === null ? 'Calories unknown' : `${number(snapshot.calories.value)} kcal` : 'Not counted · planned'}</p>
              <button className="calendar-item-more" type="button" aria-label={`Actions for ${name}`} aria-controls={`calendar-actions-${item.id}`} aria-expanded={expandedItemId === item.id} onClick={() => setExpandedItemId((current) => current === item.id ? null : item.id)}><Ellipsis size={19} /></button>
              <div className="today-item-actions" id={`calendar-actions-${item.id}`}>
                {item.state === 'planned' && localDate <= today && data.day?.status !== 'completed' && readPlannedChoice(item.planned_payload) && <button className="text-button" type="button" disabled={busy} onClick={() => logPlanned(item)}>Log as eaten</button>}
                {data.day?.status !== 'completed' && <button className="text-button" type="button" disabled={busy} onClick={() => { setEditingItem(item); setEditAmount(String(item.selected_amount ?? 1)); }}>Edit portion</button>}
                {item.state === 'eaten' && data.day?.status !== 'completed' && <button className="text-button" type="button" disabled={busy} onClick={() => reviseMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, action: 'remove', item })}>Remove</button>}
                {item.state === 'planned' && data.day?.status !== 'completed' && <button className="text-button" type="button" disabled={busy} onClick={() => removePlanMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, item })}>Remove plan</button>}
                {item.state === 'planned' && <><button className="text-button" type="button" disabled={busy || data.day?.status === 'completed'} onClick={() => { setTransferDate(addLocalDays(localDate, 1)); setTransferAction('copy'); setTransferItem(item); }}>Copy to date</button><button className="text-button" type="button" disabled={busy || data.day?.status === 'completed'} onClick={() => { setTransferDate(addLocalDays(localDate, 1)); setTransferAction('move'); setTransferItem(item); }}>Move to date</button></>}
              </div>
            </li>;
          })}</ul>
        </section>)}</div>}
      </section>
      </div>
      </section>
      {data.day?.status !== 'completed' && <button className="calendar-mobile-add" type="button" disabled={busy} aria-label="Add a meal" onClick={(event) => openAdd(event)}><Plus size={29} strokeWidth={1.9} /></button>}

      {reviseMutation.isError && reviseMutation.variables && <div className="page-stack"><StatusMessage tone="error">The meal change could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => reviseMutation.mutate(reviseMutation.variables)}>Retry same request</button></div>}
      {resizePlanMutation.isError && resizePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">The planned portion could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => resizePlanMutation.mutate(resizePlanMutation.variables)}>Retry same request</button></div>}
      {removePlanMutation.isError && removePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">Plan removal could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => removePlanMutation.mutate(removePlanMutation.variables)}>Retry same request</button></div>}
      {restorePlanMutation.isError && restorePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">Plan restoration could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => restorePlanMutation.mutate(restorePlanMutation.variables)}>Retry same request</button></div>}
      {transferMutation.isError && transferMutation.variables && <div className="page-stack"><StatusMessage tone="error">The plan date change could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => transferMutation.mutate(transferMutation.variables)}>Retry same request</button></div>}

      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {pendingChoice && (planMutation.isError || logMutation.isError) && <div className="page-stack"><StatusMessage tone="error">The save could not be confirmed. Refresh this date or retry the same request safely.</StatusMessage>
        <div className="calendar-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => pendingChoice.action === 'plan' ? planMutation.mutate(pendingChoice.input) : logMutation.mutate(pendingChoice.input)}>Retry same request</button><button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div></div>}
      {data.day?.status === 'completed' && <p className="field-hint">This historical completed date is preserved while its correction flow is rebuilt.</p>}
    </>}

    {restoreItem?.localDate === localDate && data?.day?.status !== 'completed' && <div className="calendar-undo"><span>Meal removed.</span><button type="button" className="text-button" disabled={busy} onClick={() => restoreItem.kind === 'eaten'
      ? reviseMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: restoreItem.item.id, expectedRevision: restoreItem.item.revision, action: 'restore' })
      : restorePlanMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: restoreItem.item.id, expectedRevision: restoreItem.item.revision })}>Undo</button></div>}

    <Dialog open={Boolean(editingItem)} title="Edit meal portion" closeDisabled={busy} onClose={() => setEditingItem(null)}>
      {editingItem && <>
        <p>Change this date only. The logged nutrition snapshot will be rescaled from its saved values.</p>
        <NumericField id="calendar-edit-amount" label={`Amount (${editingItem.selected_unit ?? 'serving'})`} min={0.0001} max={99_999_999} step="any" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} />
        {(reviseMutation.isError || resizePlanMutation.isError) && <StatusMessage tone="error">The portion could not be updated. Refresh this date and review the entry.</StatusMessage>}
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingItem(null)}>Cancel</button><button type="button" className="primary-button" disabled={busy || !Number.isFinite(Number(editAmount)) || Number(editAmount) <= 0} onClick={() => {
          const amount = Number(editAmount);
          if (editingItem.state === 'eaten') reviseMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: editingItem.id, expectedRevision: editingItem.revision, action: 'resize', amount, unit: editingItem.selected_unit ?? 'serving' });
          else resizePlanMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: editingItem.id, expectedRevision: editingItem.revision, amount });
        }}>Save portion</button></div>
      </>}
    </Dialog>

    <Dialog open={Boolean(transferItem)} title={transferAction === 'copy' ? 'Copy planned meal' : 'Move planned meal'} closeDisabled={busy} onClose={() => setTransferItem(null)}>
      <p>{transferAction === 'copy' ? 'A separate planned entry will be added to the selected date.' : 'The planned entry will be removed from this date and added to the selected date. Eaten entries cannot be moved.'}</p>
      <Field id="calendar-transfer-date" label="Destination date"><input className="text-field" id="calendar-transfer-date" type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} /></Field>
      {transferMutation.isError && <StatusMessage tone="error">The plan could not be changed. Refresh both dates and review them before retrying.</StatusMessage>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setTransferItem(null)}>Cancel</button><button type="button" className="primary-button" disabled={busy || !transferItem || !validDate(transferDate) || transferAction === 'move' && transferDate === localDate} onClick={() => transferItem && transferMutation.mutate({ requestId: crypto.randomUUID(), fromDate: localDate, toDate: transferDate, itemId: transferItem.id, expectedRevision: transferItem.revision, action: transferAction })}>{busy ? 'Saving…' : transferAction === 'copy' ? 'Copy meal' : 'Move meal'}</button></div>
    </Dialog>

    {userId && adding && <AddChoiceDialog open userId={userId} fields={profile.data?.nutrientFields ?? []} futureDate={adding === 'plan'} initialSection="unlabelled" dateLabel={formatLocalDate(localDate, timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} anchor={composerAnchor}
      actionMode={adding} onActionModeChange={localDate <= today ? setAdding : undefined}
      dialogTitle="Add a meal"
      onClose={() => setAdding(null)} onSavedOnly={(name) => { setAdding(null); setNotice(`${name} saved to your Library.`); }} onPrepared={(choice) => { const action = adding; setAdding(null); submit(choice, action); }} />}
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
      const activity = [summary.eatenCount > 0 ? `${summary.eatenCount} eaten` : '', summary.plannedCount > 0 ? `${summary.plannedCount} planned` : ''].filter(Boolean).join(' · ');
      const isSelected = day.localDate === selectedDate;
      const isToday = day.localDate === today;
      const isOutsideMonth = monthView && day.localDate.slice(0, 7) !== selectedDate.slice(0, 7);
      const visibleItems = day.items.slice(0, monthView ? 2 : 4);
      const dateLabel = formatLocalDate(day.localDate, timezone, { weekday: 'long', day: 'numeric', month: 'long' });
      return <button key={day.localDate} type="button" className={`calendar-date-card${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isOutsideMonth ? ' is-outside-month' : ''}`}
        aria-current={isToday ? 'date' : undefined}
        aria-label={`${dateLabel}${isToday ? ', today' : ''}, ${summary.eatenCount} eaten, ${summary.plannedCount} planned, ${calories === null ? 'calories unknown' : `${number(calories)} calories eaten`}${target === null ? '' : `, ${number(target)} calorie target`}`}
        onClick={() => onChoose(day.localDate)}>
        <span className="calendar-date-head"><span className="calendar-weekday-label">{formatLocalDate(day.localDate, timezone, { weekday: 'short' })}</span><span className="calendar-date-number">{formatLocalDate(day.localDate, timezone, { day: 'numeric' })}</span></span>
        {(!monthView || hasActivity) && <span className="calendar-date-summary" aria-hidden="true">
          {(summary.eatenCount > 0 || !monthView) && <span className="calendar-date-calories">{calories === null ? 'Unknown' : number(calories)} <small>{target === null || monthView ? 'kcal' : `of ${number(target)} kcal`}</small></span>}
          <span className="calendar-date-activity">{activity || (day.localDate > today ? 'No meals planned' : 'No meals logged')}</span>
          {!monthView && target !== null && calories !== null && <span className="calendar-date-progress"><span style={{ width: `${Math.min(100, Math.max(0, calories / target * 100))}%` }} /></span>}
        </span>}
        <span className="calendar-date-items" aria-hidden="true">{visibleItems.map((item) => <span key={item.id} className={`calendar-item-chip ${item.state === 'eaten' ? 'is-eaten' : 'is-planned'}`}>{item.state === 'eaten' ? readEatenSnapshot(item.eaten_snapshot)?.name ?? 'Logged meal' : plannedItemName(item.planned_payload) ?? 'Planned meal'}</span>)}{day.items.length > visibleItems.length && <span className="calendar-more-items">+{day.items.length - visibleItems.length} more</span>}</span>
      </button>;
    })}</div>
  </section>;
}
