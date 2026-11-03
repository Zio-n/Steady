import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Calendar, CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, NotebookPen, Plus, Settings } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { useProfile } from '../../features/profile/useProfile';
import { AddChoiceDialog, type PreparedChoice } from '../../features/today/AddChoiceDialog';
import { queryKeys } from '../../data/queryKeys';
import { rememberAddedFoodPortions } from '../../data/repositories/foodPortionPreferenceRepository';
import { editCalendarFoodSnapshot, removePlannedDayItem, resizePlannedDayItem, restorePlannedCalendarItem, reviseDayItem, type EditCalendarFoodSnapshotInput, type ReviseDayItemInput } from '../../data/repositories/dayRepository';
import { logCalendarItem, logCalendarItems, planCalendarItems, readCalendarDay, readCalendarRange, type CalendarChoice, type CalendarDay } from '../../data/repositories/calendarRepository';
import { addLocalDays, addLocalMonths, formatLocalDate, isValidLocalDate, localDateInTimezone, startOfLocalWeek } from '../../domain/dates';
import { plannedItemName, readEatenSnapshot, readPlannedChoice, readPlannedMeasure, summarizeDay, type DayItem } from '../../domain/daySummary';
import { isValidQuantity, QUANTITY_MAX, QUANTITY_MIN, QUANTITY_STEP } from '../../domain/numericLimits';
import { Dialog } from '../components/Dialog';
import { CalendarMealCard } from '../components/CalendarMealCard';
import { Field, NumericField } from '../components/Field';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';

const sections = [
  ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks'],
] as const;
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const validDate = (value: string | null) => value !== null && isValidLocalDate(value);
function groupDayItems(items: DayItem[]) {
  const groups: Array<{ id: string; grouped: boolean; items: DayItem[] }> = [];
  const positions = new Map<string, number>();
  for (const item of items) {
    const id = item.meal_group_id ? `meal:${item.meal_group_id}` : `item:${item.id}`;
    const position = positions.get(id);
    if (position === undefined) { positions.set(id, groups.length); groups.push({ id, grouped: Boolean(item.meal_group_id), items: [item] }); }
    else groups[position]!.items.push(item);
  }
  return groups;
}
type CalendarView = 'day' | 'week' | 'month';
const calendarViews = [
  { value: 'day', label: 'Day', icon: CalendarDays },
  { value: 'week', label: 'Week', icon: CalendarRange },
  { value: 'month', label: 'Month', icon: Calendar },
] as const;

type AttributeNutrientField = { field_id: string; name: string; unit: string };
function CalendarMealIngredientEditor({ item, snapshot, component, componentIndex, fields, busy, onSave, brandEditable, collapsible }: {
  item: DayItem; snapshot: NonNullable<ReturnType<typeof readEatenSnapshot>>; component: Record<string, unknown>; componentIndex: number;
  fields: AttributeNutrientField[]; busy: boolean; brandEditable: boolean; collapsible: boolean;
  onSave: (input: Omit<EditCalendarFoodSnapshotInput, 'requestId' | 'localDate' | 'itemId' | 'expectedRevision'>) => void;
}) {
  const basis = component ? `${String(component.basis_amount ?? '')} ${String(component.basis_unit ?? '')}`.trim() : '';
  const basisNutrients = component?.nutrients_per_basis && typeof component.nutrients_per_basis === 'object' ? component.nutrients_per_basis as Record<string, { value?: number | null }> : {};
  const [name, setName] = useState(String(component.food_name ?? snapshot.name));
  const [brand, setBrand] = useState(brandEditable ? snapshot.brand ?? '' : '');
  const [calories, setCalories] = useState(component?.calories_per_basis == null ? '' : String(component.calories_per_basis));
  const [nutrients, setNutrients] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.field_id, basisNutrients[field.field_id]?.value == null ? '' : String(basisNutrients[field.field_id]!.value)])));
  const componentCount = snapshot.components?.length ?? 0;
  const kcalValue = Number(calories);
  const valid = name.trim().length > 0 && name.length <= 160 && Number.isFinite(kcalValue) && kcalValue >= 0 && kcalValue < 100_000_000
    && Object.values(nutrients).every((value) => value === '' || Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) < 100_000_000);
  const portion = `${number(Number(component.amount ?? snapshot.selected_amount))} ${String(component.unit ?? snapshot.selected_unit)}`;
  const calorieMetric = component.calories && typeof component.calories === 'object' ? component.calories as { value?: number | null } : {};
  const rowKcal = (calorieMetric.value ?? (componentCount === 1 ? snapshot.calories.value : null)) == null ? '—' : number(calorieMetric.value ?? snapshot.calories.value ?? 0);
  const basisKcal = component.calories_per_basis == null ? '—' : number(Number(component.calories_per_basis));
  const content = <div className="calendar-meal-edit-component-content">
      <div className="calendar-meal-edit-item-fields">
        <Field id={`meal-food-name-${item.id}-${componentIndex}`} label="Food name"><input className="text-field" id={`meal-food-name-${item.id}-${componentIndex}`} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
        {brandEditable && <Field id={`meal-food-brand-${item.id}`} label="Brand"><input className="text-field" id={`meal-food-brand-${item.id}`} value={brand} maxLength={120} onChange={(event) => setBrand(event.target.value)} /></Field>}
        <NumericField id={`meal-food-kcal-${item.id}-${componentIndex}`} label={`Calories per ${basis}`} min={0} max={99_999_999.9999} step={0.01} value={calories} onChange={(event) => setCalories(event.target.value)} />
        {fields.map((field) => <NumericField key={field.field_id} id={`meal-food-${field.field_id}-${item.id}-${componentIndex}`} label={`${field.name} (${field.unit})`} min={0} max={99_999_999.9999} step={0.01} value={nutrients[field.field_id] ?? ''} onChange={(event) => setNutrients((current) => ({ ...current, [field.field_id]: event.target.value }))} />)}
      </div>
      <div className="calendar-meal-edit-item-actions"><span className="calendar-meal-edit-basis">Per {basis}</span><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => onSave({ componentIndex, name, brand: brandEditable ? brand.trim() || null : snapshot.brand ?? null, caloriesPerBasis: kcalValue, nutrientsPerBasis: Object.fromEntries(fields.map((field) => [field.field_id, nutrients[field.field_id] === '' ? null : Number(nutrients[field.field_id])])) })}>Save details</button></div>
    </div>;
  return collapsible
    ? <details className={`calendar-meal-edit-component${componentIndex === 0 && componentCount === 1 ? ' is-direct' : ''}`}>
        <summary>
          <span>{componentIndex === 0 && componentCount === 1 ? 'Food details' : String(component.food_name ?? snapshot.name)}</span>
          <small>{componentIndex === 0 && componentCount === 1 ? `per ${basis}` : portion}</small>
          <strong>{componentIndex === 0 && componentCount === 1 ? basisKcal : `${rowKcal} kcal`}</strong>
        </summary>
        {content}
      </details>
    : <div className="calendar-meal-edit-component is-direct">{content}</div>;
}

function CalendarMealItemEditor({ item, fields, busy, onSave, onEditPortion, onRemove }: {
  item: DayItem; fields: AttributeNutrientField[]; busy: boolean;
  onSave: (input: Omit<EditCalendarFoodSnapshotInput, 'requestId' | 'localDate' | 'itemId' | 'expectedRevision'>) => void;
  onEditPortion: () => void; onRemove: () => void;
}) {
  const snapshot = readEatenSnapshot(item.eaten_snapshot);
  const components = snapshot?.components as unknown as Array<Record<string, unknown>> | undefined;
  const editableSource = snapshot && ['food', 'one_off_food', 'meal', 'one_off_meal'].includes(snapshot.source);
  const name = snapshot?.name ?? plannedItemName(item.planned_payload) ?? 'Food';
  const portion = `${number(snapshot?.selected_amount ?? item.selected_amount ?? 1)} ${snapshot?.selected_unit ?? item.selected_unit ?? 'serving'}`;
  const calories = snapshot?.calories.value == null ? '—' : number(snapshot.calories.value);
  return <article className="calendar-meal-edit-item">
    <div className="calendar-meal-edit-item-heading"><div><strong>{name}</strong>{snapshot?.brand && <small>{snapshot.brand}</small>}<span>{portion} · {calories} kcal</span></div><div><button type="button" className="text-button" disabled={busy} onClick={onEditPortion}>Portion</button><button type="button" className="text-button" disabled={busy} onClick={onRemove}>{item.state === 'planned' ? 'Remove' : 'Delete'}</button></div></div>
    {snapshot && editableSource && components?.map((component, index) => <CalendarMealIngredientEditor key={`${item.id}-${index}-${item.revision}`} item={item} snapshot={snapshot} component={component} componentIndex={index} fields={fields} busy={busy} brandEditable={index === 0 && (snapshot.source === 'food' || snapshot.source === 'one_off_food')} collapsible onSave={onSave} />)}
  </article>;
}

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
  const [searchOpen, setSearchOpen] = useState(() => searchParams.get('start') === 'meal');
  const [draftCount, setDraftCount] = useState(0);
  const [draftHost, setDraftHost] = useState<HTMLElement | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{ action: 'log' | 'plan'; input: CalendarChoice | CalendarChoice[] } | null>(null);
  const [editingItem, setEditingItem] = useState<DayItem | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [restoreItems, setRestoreItems] = useState<{ items: Array<{ item: DayItem; kind: 'eaten' | 'planned' }>; localDate: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [showAllNutrients, setShowAllNutrients] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
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
    setSearchOpen(false);
    setMonthPickerOpen(false);
    setPendingChoice(null);
    setNotice('');
    setSearchParams({ ...(date === today ? {} : { date }), ...(view === 'day' ? {} : { view }) });
  }

  function chooseView(nextView: CalendarView) {
    setAdding(null); setSearchOpen(false); setMonthPickerOpen(false); setViewMenuOpen(false); setNotice('');
    setSearchParams({ ...(localDate === today ? {} : { date: localDate }), ...(nextView === 'day' ? {} : { view: nextView }) });
  }

  function selectDay(date: string) {
    setAdding(null); setSearchOpen(false); setMonthPickerOpen(false); setNotice('');
    setSearchParams({ ...(date === today ? {} : { date }) });
  }

  function movePeriod(delta: number) {
    chooseDate(view === 'month' ? addLocalMonths(localDate, delta) : addLocalDays(localDate, view === 'week' ? delta * 7 : delta));
  }

  function openAdd(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setComposerAnchor({ left: window.innerWidth > 900 ? Math.max(16, window.innerWidth - 480) : 14,
      top: window.innerWidth > 900 ? Math.max(175, Math.min(rect.top, window.innerHeight - 440)) : rect.bottom + 14,
      width: window.innerWidth > 900 ? 440 : window.innerWidth - 28 });
    setAdding(localDate > today ? 'plan' : 'log');
    setSearchOpen(true);
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
      if (input.action === 'remove' && removedItem) setRestoreItems({ items: [{ item: { ...removedItem, state: 'removed', revision: removedItem.revision + 1 }, kind: 'eaten' }], localDate: input.localDate, message: 'Meal removed.' });
      if (input.action === 'restore') setRestoreItems(null);
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
      setRestoreItems({ items: [{ item: { ...input.item, state: 'removed', revision: input.item.revision + 1 }, kind: 'planned' }], localDate: input.localDate, message: 'Plan removed.' });
      setNotice('Plan removed. You can undo this change.');
    },
  });
  const restorePlanMutation = useMutation({ mutationFn: restorePlannedCalendarItem, onSuccess: async (_result, input) => {
    await refresh(input.localDate); setRestoreItems(null); setNotice('Plan restored.');
  } });
  const editFoodSnapshotMutation = useMutation({
    mutationFn: editCalendarFoodSnapshot,
    onSuccess: async (_result, input) => { await refresh(input.localDate); setNotice('Food details updated for this meal.'); },
  });
  const planMutation = useMutation({
    mutationFn: (input: CalendarChoice | CalendarChoice[]) => planCalendarItems(Array.isArray(input) ? input : [input]),
    onSuccess: async (_result, input) => {
      const first = Array.isArray(input) ? input[0]! : input;
      try {
        await rememberAddedFoodPortions(userId!, (Array.isArray(input) ? input : [input]).map(({ sourceKind, sourceId, amount, unit, manualPayload }) => ({ sourceKind, sourceId, amount, unit, manualPayload })));
        await queryClient.invalidateQueries({ queryKey: queryKeys.foodPortionPreferences(userId!) });
      } catch {
        // Calendar changes are committed separately from this convenience value.
      }
      await refresh(first.localDate);
      setPendingChoice(null);
      setNotice(Array.isArray(input) ? `${input.length} items planned. They are not counted as eaten.` : 'Meal planned. It is not counted as eaten.');
    },
  });
  const logMutation = useMutation({
    mutationFn: (input: CalendarChoice | CalendarChoice[]) => Array.isArray(input) ? logCalendarItems(input) : input.plannedItemId ? logCalendarItem(input) : logCalendarItems([input]),
    onSuccess: async (_result, input) => {
      const first = Array.isArray(input) ? input[0]! : input;
      try {
        await rememberAddedFoodPortions(userId!, (Array.isArray(input) ? input : [input]).map(({ sourceKind, sourceId, amount, unit, manualPayload }) => ({ sourceKind, sourceId, amount, unit, manualPayload })));
        await queryClient.invalidateQueries({ queryKey: queryKeys.foodPortionPreferences(userId!) });
      } catch {
        // Calendar changes are committed separately from this convenience value.
      }
      await refresh(first.localDate);
      setPendingChoice(null);
      setNotice(Array.isArray(input) ? `Logged ${input.length} items for this date.` : 'Meal logged for this date.');
    },
  });

  function submit(choice: PreparedChoice | PreparedChoice[], action: 'log' | 'plan', requestId = crypto.randomUUID()) {
    const choices = Array.isArray(choice) ? choice : [choice];
    const inputs = choices.map((entry, index): CalendarChoice => ({
      requestId: entry.requestId ?? (index === 0 && choices.length === 1 ? requestId : crypto.randomUUID()), localDate,
      section: entry.section, sourceKind: entry.kind,
      sourceId: entry.kind === 'food' || entry.kind === 'meal' ? entry.id : null,
      amount: entry.amount, unit: entry.unit,
      manualPayload: entry.snapshot ? { ...entry.snapshot, name: entry.name } : undefined,
      measure: entry.measure,
      plannedItemId: entry.plannedItemId, expectedItemRevision: entry.expectedItemRevision,
    }));
    const input = inputs.length > 1 ? inputs : inputs[0]!;
    setPendingChoice({ action, input });
    setNotice('');
    if (action === 'plan') planMutation.mutate(input);
    else logMutation.mutate(input);
  }

  function markMealEaten(items: DayItem[]) {
    const choices = items.filter((item) => item.state === 'planned').flatMap((item): PreparedChoice[] => {
      const planned = readPlannedChoice(item.planned_payload);
      if (!planned) return [];
      return [{ kind: planned.sourceKind, id: planned.sourceId ?? item.id, name: plannedItemName(item.planned_payload) ?? 'Planned food', amount: planned.amount,
        unit: planned.unit, section: item.section, snapshot: planned.manualPayload, plannedItemId: item.id, expectedItemRevision: item.revision,
        measure: readPlannedMeasure(item.planned_payload) }];
    });
    if (choices.length > 0) submit(choices, 'log');
  }

  function snapshotAsPrivateFood(snapshot: NonNullable<ReturnType<typeof readEatenSnapshot>>, component?: Record<string, unknown>) {
    component ??= (snapshot.components as unknown as Array<Record<string, unknown>>)[0];
    const perBasis = component?.nutrients_per_basis && typeof component.nutrients_per_basis === 'object'
      ? component.nutrients_per_basis as Record<string, { value?: number | null }> : {};
    return { name: String(component?.food_name ?? snapshot.name), basisAmount: Number(component?.basis_amount ?? 100), basisUnit: String(component?.basis_unit ?? 'g'),
      caloriesKcal: Number(component?.calories_per_basis ?? 0),
      nutrients: Object.fromEntries(Object.entries(perBasis).map(([id, nutrient]) => [id, nutrient?.value ?? null])) };
  }

  async function duplicateMeal(items: DayItem[]) {
    setMealActionBusy(true);
    try {
      const isPlanned = items.every((item) => item.state === 'planned');
      const choices: CalendarChoice[] = items.flatMap((item): CalendarChoice[] => {
        const planned = item.state === 'planned' ? readPlannedChoice(item.planned_payload) : null;
        const snapshot = item.state === 'eaten' ? readEatenSnapshot(item.eaten_snapshot) : null;
        if (!planned && !snapshot) return [];
        let sourceKind: CalendarChoice['sourceKind']; let sourceId: string | null; let manualPayload: Record<string, unknown> | undefined; let amount: number; let unit: string;
        if (planned) {
          sourceKind = planned.sourceKind; sourceId = planned.sourceId; manualPayload = planned.manualPayload; amount = planned.amount; unit = planned.unit;
        } else if (snapshot) {
          amount = snapshot.selected_amount; unit = snapshot.selected_unit;
          if (snapshot.source === 'food' || snapshot.source === 'one_off_food' || snapshot.source === 'routine') {
            sourceKind = 'one_off_food'; sourceId = null; manualPayload = snapshotAsPrivateFood(snapshot);
          } else if (snapshot.source === 'meal' || snapshot.source === 'one_off_meal') {
            const components = snapshot.components as unknown as Array<Record<string, unknown>>;
            return components.map((component) => ({ requestId: crypto.randomUUID(), localDate, section: item.section, sourceKind: 'one_off_food' as const,
              sourceId: null, amount: Number(component.amount ?? 1), unit: String(component.unit ?? 'serving'), manualPayload: snapshotAsPrivateFood(snapshot, component) }));
          } else { sourceKind = 'meal'; sourceId = snapshot.source_id; }
        } else return [];
        return [{ requestId: crypto.randomUUID(), localDate, section: item.section, sourceKind, sourceId, amount, unit, manualPayload,
          measure: snapshot?.display_measure ?? readPlannedMeasure(item.planned_payload) }];
      });
      if (choices.length === 0) throw new Error('This meal cannot be duplicated from its saved details.');
      if (isPlanned) await planCalendarItems(choices); else await logCalendarItems(choices);
      await refresh(localDate); setNotice(isPlanned ? 'Meal duplicated as a plan.' : 'Meal duplicated.');
    } catch {
      await dayQuery.refetch(); setNotice('The meal could not be duplicated from its saved details.');
    } finally { setMealActionBusy(false); }
  }

  async function deleteMeal(items: DayItem[], action: 'delete' | 'not-eaten' = 'delete') {
    setMealActionBusy(true);
    try {
      const removed = await Promise.all(items.map(async (item) => {
        if (item.state === 'planned') {
          await removePlannedDayItem({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision });
          return { item: { ...item, state: 'removed' as const, revision: item.revision + 1 }, kind: 'planned' as const };
        }
        await reviseDayItem({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, action: 'remove' });
        return { item: { ...item, state: 'removed' as const, revision: item.revision + 1 }, kind: 'eaten' as const };
      }));
      const message = action === 'not-eaten' ? 'Meal marked as not eaten.' : 'Meal removed.';
      setRestoreItems({ items: removed, localDate, message }); setExpandedGroupId(null); await refresh(localDate); setNotice(`${message} You can undo this change.`);
    } catch {
      await dayQuery.refetch(); setNotice('The meal could not be removed completely. The day has been refreshed.');
    } finally { setMealActionBusy(false); }
  }

  async function undoMealRemoval() {
    if (!restoreItems || restoreItems.localDate !== localDate) return;
    setMealActionBusy(true);
    try {
      await Promise.all(restoreItems.items.map(({ item, kind }) => kind === 'eaten'
        ? reviseDayItem({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, action: 'restore' })
        : restorePlannedCalendarItem({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision })));
      setRestoreItems(null); await refresh(localDate); setNotice('Meal restored.');
    } catch { await dayQuery.refetch(); setNotice('The meal could not be fully restored. The day has been refreshed.'); }
    finally { setMealActionBusy(false); }
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
  const [mealActionBusy, setMealActionBusy] = useState(false);
  const busy = planMutation.isPending || logMutation.isPending || reviseMutation.isPending || resizePlanMutation.isPending || removePlanMutation.isPending || restorePlanMutation.isPending || editFoodSnapshotMutation.isPending || mealActionBusy;
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
      <Link className="calendar-builder-link" to="/build?from=calendar" aria-label="Build a meal"><NotebookPen size={18} strokeWidth={1.8} /><span className="calendar-builder-full">Build a meal</span><span className="calendar-builder-short">Build</span></Link>
    </div>, headerHost)}
    <div className={`page-stack calendar-page${adding ? ' is-composing' : ''}${searchOpen ? ' is-searching' : ''}`} onTouchStart={(event) => {
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
      {data.day?.status !== 'completed' && <button type="button" className="calendar-day-add-surface" aria-label="Add a meal in this day" disabled={busy || Boolean(adding)} onClick={openAdd}><span><Plus size={18} aria-hidden="true" /> Add a meal</span></button>}

      {data.day?.status === 'completed' && <StatusMessage tone="info">This older date has a saved completion snapshot. Its target is preserved as recorded.</StatusMessage>}
      <section className="today-meals" aria-label="Meals">
        {adding && <div ref={setDraftHost} id="calendar-meal-draft-slot" className="calendar-meal-draft-slot" />}
        {mealGroups.length === 0 && !adding ? data.day?.status === 'completed' ? <div className="calendar-day-empty">
          <h2>{data.day?.status === 'completed' ? 'No meals recorded' : localDate > today ? 'Plan your first meal' : 'Your first meal goes here'}</h2>
          <p>{data.day?.status === 'completed'
            ? 'This day was completed without any logged or planned meals.'
            : localDate > today
              ? 'Build out this day at your own pace. Planned meals will appear here, ready to adjust or log when you eat.'
              : 'Log what you’ve eaten or plan what’s next. Your meals will appear here, and your nutrition totals will update above.'}</p>
        </div> : null :
        <div className="today-sections">{mealGroups.map(({ section, label, items }) => <section className="today-meal-section" key={section} aria-labelledby={label ? `calendar-${section}` : undefined} aria-label={label ? undefined : 'Meals'}>
          {label && <h3 className="visually-hidden" id={`calendar-${section}`}>{label}</h3>}
          <ul className="today-item-list">{groupDayItems(items).map((group) => {
            const groupFields = profile.data?.nutrientFields ?? fields;
            const groupSummary = summarizeDay(group.items, groupFields.map((field) => field.field_id));
            const allEaten = group.items.every((item) => item.state === 'eaten');
            const allPlanned = group.items.every((item) => item.state === 'planned');
            const status = allEaten ? 'Eaten' : allPlanned ? 'Planned' : 'Partly eaten';
            const mealFoods = group.items.map((item) => {
              const snapshot = readEatenSnapshot(item.eaten_snapshot);
              const planned = readPlannedChoice(item.planned_payload);
              const itemComponents = snapshot?.components as unknown as Array<Record<string, unknown>> | undefined;
              const ingredients = itemComponents && itemComponents.length > 1 ? itemComponents.map((component, index) => {
                const componentCalories = component.calories && typeof component.calories === 'object' ? (component.calories as { value?: number | null }).value : null;
                const nutrientValues = component.nutrients && typeof component.nutrients === 'object' ? component.nutrients as Record<string, { value?: number | null }> : {};
                return { key: `${item.id}-${index}`, name: String(component.food_name ?? 'Food'), portion: `${number(Number(component.amount ?? 1))} ${String(component.unit ?? 'serving')}`,
                  calories: componentCalories == null ? '—' : number(componentCalories), metrics: [...groupFields].sort((a, b) => { const order = ['protein', 'carbohydrate', 'fat']; return (order.includes(a.standard_key ?? '') ? order.indexOf(a.standard_key!) : 99) - (order.includes(b.standard_key ?? '') ? order.indexOf(b.standard_key!) : 99); }).flatMap((field) => {
                    const value = nutrientValues[field.field_id]?.value;
                    return value == null ? [] : [{ label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name, value: `${number(value)} ${field.unit}` }];
                  }) };
              }) : undefined;
              return {
                key: item.id,
                name: snapshot?.name ?? plannedItemName(item.planned_payload) ?? 'Food',
                brand: snapshot?.brand,
                portion: `${number(snapshot?.selected_amount ?? planned?.amount ?? item.selected_amount ?? 1)} ${snapshot?.selected_unit ?? planned?.unit ?? item.selected_unit ?? 'serving'}`,
                calories: snapshot?.calories.value == null ? '—' : number(snapshot.calories.value),
                metrics: snapshot ? [...groupFields].sort((a, b) => { const order = ['protein', 'carbohydrate', 'fat']; return (order.includes(a.standard_key ?? '') ? order.indexOf(a.standard_key!) : 99) - (order.includes(b.standard_key ?? '') ? order.indexOf(b.standard_key!) : 99); }).flatMap((field) => {
                  const value = snapshot.nutrients[field.field_id];
                  return value ? [{ label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name, value: value.value == null ? '—' : `${number(value.value)} ${field.unit}` }] : [];
                }) : [], ingredients,
              };
            });
            const metrics = allEaten ? [...groupFields].sort((a, b) => { const order = ['protein', 'carbohydrate', 'fat']; return (order.includes(a.standard_key ?? '') ? order.indexOf(a.standard_key!) : 99) - (order.includes(b.standard_key ?? '') ? order.indexOf(b.standard_key!) : 99); }).flatMap((field) => {
              const key = field.standard_key;
              const nutrient = groupSummary.nutrients[field.field_id];
              return [{ label: key === 'carbohydrate' ? 'Carbs' : field.name, value: nutrient?.value == null ? '—' : `${number(nutrient.value)} ${field.unit}` }];
            }) : [];
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
                state={`${status} meal`}
                label={label}
                calories={groupSummary.calories.value === null ? '—' : number(groupSummary.calories.value)}
                foods={mealFoods}
                metrics={metrics}
                expanded={expandedGroupId === group.id}
                onToggle={() => setExpandedGroupId((current) => current === group.id ? null : group.id)}
                onDelete={data.day?.status !== 'completed' ? () => void deleteMeal(group.items) : undefined}
                onDuplicate={data.day?.status !== 'completed' ? () => void duplicateMeal(group.items) : undefined}
                onMarkEaten={group.items.some((item) => item.state === 'planned') && localDate <= today && data.day?.status !== 'completed' ? () => markMealEaten(group.items) : undefined}
                onMarkNotEaten={allEaten && data.day?.status !== 'completed' ? () => void deleteMeal(group.items, 'not-eaten') : undefined}
                busy={busy}
              >
                <div className="calendar-meal-saved-details">{group.items.map((item) => <CalendarMealItemEditor key={`${item.id}-${item.revision}`} item={item} fields={(profile.data?.nutrientFields ?? []).map(({ field_id, name, unit }) => ({ field_id, name, unit }))} busy={busy} onSave={(values) => editFoodSnapshotMutation.mutate({ ...values, requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision })} onEditPortion={() => { setEditingItem(item); setEditAmount(String(item.selected_amount ?? 1)); }} onRemove={() => item.state === 'eaten'
                  ? reviseMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, action: 'remove', item })
                  : removePlanMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: item.id, expectedRevision: item.revision, item })} />)}</div>
              </CalendarMealCard>
            </li>;
          })}</ul>
        </section>)}</div>}
      </section>
      </div>
      </section>


      {reviseMutation.isError && reviseMutation.variables && <div className="page-stack"><StatusMessage tone="error">The meal change could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => reviseMutation.mutate(reviseMutation.variables)}>Retry same request</button></div>}
      {resizePlanMutation.isError && resizePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">The planned portion could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => resizePlanMutation.mutate(resizePlanMutation.variables)}>Retry same request</button></div>}
      {removePlanMutation.isError && removePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">Plan removal could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => removePlanMutation.mutate(removePlanMutation.variables)}>Retry same request</button></div>}
      {restorePlanMutation.isError && restorePlanMutation.variables && <div className="page-stack"><StatusMessage tone="error">Plan restoration could not be confirmed.</StatusMessage><button className="text-button" type="button" disabled={busy} onClick={() => restorePlanMutation.mutate(restorePlanMutation.variables)}>Retry same request</button></div>}

      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {pendingChoice && (planMutation.isError || logMutation.isError) && <div className="page-stack"><StatusMessage tone="error">The save could not be confirmed. Refresh this date or retry the same request safely.</StatusMessage>
        <div className="calendar-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => pendingChoice.action === 'plan' ? planMutation.mutate(pendingChoice.input) : logMutation.mutate(pendingChoice.input)}>Retry same request</button><button type="button" className="text-button" onClick={() => void dayQuery.refetch()}>Refresh date</button></div></div>}
      {data.day?.status === 'completed' && <p className="field-hint">This historical completed date is preserved while its correction flow is rebuilt.</p>}
    </>}

    {restoreItems?.localDate === localDate && data?.day?.status !== 'completed' && <div className="calendar-undo"><span>{restoreItems.message}</span><button type="button" className="text-button" disabled={busy} onClick={() => void undoMealRemoval()}>Undo</button></div>}

    <Dialog open={Boolean(editingItem)} title="Edit meal portion" closeDisabled={busy} onClose={() => setEditingItem(null)}>
      {editingItem && <>
        <p>Change this date only. The logged nutrition snapshot will be rescaled from its saved values.</p>
        <NumericField id="calendar-edit-amount" label={`Amount (${editingItem.selected_unit ?? 'serving'})`} min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={editAmount} onChange={(event) => setEditAmount(event.target.value)} />
        {(reviseMutation.isError || resizePlanMutation.isError) && <StatusMessage tone="error">The portion could not be updated. Refresh this date and review the entry.</StatusMessage>}
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingItem(null)}>Cancel</button><button type="button" className="primary-button" disabled={busy || !isValidQuantity(editAmount)} onClick={() => {
          const amount = Number(editAmount);
          if (editingItem.state === 'eaten') reviseMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: editingItem.id, expectedRevision: editingItem.revision, action: 'resize', amount, unit: editingItem.selected_unit ?? 'serving' });
          else resizePlanMutation.mutate({ requestId: crypto.randomUUID(), localDate, itemId: editingItem.id, expectedRevision: editingItem.revision, amount });
        }}>Save portion</button></div>
      </>}
    </Dialog>

    {userId && adding && <AddChoiceDialog open={searchOpen} userId={userId} fields={profile.data?.nutrientFields ?? []} futureDate={adding === 'plan'} initialSection="unlabelled" dateLabel={formatLocalDate(localDate, timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} anchor={composerAnchor} draftHost={draftHost}
      actionMode={adding} onActionModeChange={localDate <= today ? setAdding : undefined}
      dialogTitle="Add a meal"
      onDraftCountChange={setDraftCount} onResumeSearch={() => setSearchOpen(true)} onDiscardDraft={() => { setSearchOpen(false); setAdding(null); }}
      onClose={() => { setSearchOpen(false); if (draftCount === 0) setAdding(null); }} onSavedOnly={(name) => { setSearchOpen(false); if (draftCount === 0) setAdding(null); setNotice(`${name} saved to your Library.`); }} onPrepared={(choice) => { const action = adding; setAdding(null); setSearchOpen(false); submit(choice, action); }} />}
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
      const groupedItems = groupDayItems(day.items);
      const visibleItems = groupedItems.slice(0, monthView ? 2 : 4);
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
        <span className="calendar-date-items" aria-hidden="true">{visibleItems.map((group) => { const item = group.items[0]!; const name = item.state === 'eaten' ? readEatenSnapshot(item.eaten_snapshot)?.name ?? 'Logged meal' : plannedItemName(item.planned_payload) ?? 'Planned meal'; return <span key={group.id} className={`calendar-item-chip ${item.state === 'eaten' ? 'is-eaten' : 'is-planned'}`}>{group.grouped ? `${name} +${group.items.length - 1}` : name}</span>; })}{groupedItems.length > visibleItems.length && <span className="calendar-more-items">+{groupedItems.length - visibleItems.length} more</span>}</span>
      </button>;
    })}</div>
  </section>;
}
