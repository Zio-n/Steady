import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Calculator, CalendarDays, Check, ChevronDown, Info, MoreHorizontal, Pencil, Plus, Repeat2, SlidersHorizontal, Trash2 } from 'lucide-react';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { saveCalendarComposer, type ComposerSave, type SeriesScope } from '../../data/repositories/calendarRepository';
import { searchCatalogFoods } from '../../data/repositories/catalogFoodRepository';
import { loadRecentChoices } from '../../data/repositories/dayRepository';
import { loadFoodEntry, loadFoodLibrary } from '../../data/repositories/foodRepository';
import { loadFoodPortionPreferences } from '../../data/repositories/foodPortionPreferenceRepository';
import { loadMealEntry, loadMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { choiceMatchScore } from '../../domain/choiceSearch';
import type { DayItem } from '../../domain/daySummary';
import { addLocalDays, formatLocalDate, isValidLocalDate } from '../../domain/dates';
import {
  basisValue, CALORIES, changeDraftPortion, editPortionValue, foodMultiplier, formatNutrition, mealMetric,
  portionValue, roundQuantity, validDraftFood, validFoodInput, valueCertainty, type DraftFood,
} from '../../domain/mealComposer';
import { CALORIE_MAX, CALORIE_STEP, isValidQuantity, NUTRIENT_MAX, NUTRIENT_STEP, QUANTITY_MAX, QUANTITY_MIN, QUANTITY_STEP } from '../../domain/numericLimits';
import { nextIdempotentRequest, type IdempotentRequest } from '../../domain/requestIdentity';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Field, NumericField } from '../../ui/components/Field';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { StyledSelect } from '../../ui/components/StyledSelect';
import { catalogueDraft, existingBlockDraft, libraryDraft, manualDraft, plannedDraft, prepareFood, snapshotDraft, type MealLabel } from './composerFoods';

type EntryState = ComposerSave['state'];
type Choice = { key: string; name: string; detail: string; calories: number | null; estimated?: boolean; select: () => void };
const MAX_ITEMS = 50;
const sectionOptions: Array<[MealLabel, string]> = [['unlabelled', 'No label'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function SeriesScopeSelect({ value, onChange, disabled }: {
  value: SeriesScope; onChange: (value: SeriesScope) => void; disabled?: boolean;
}) {
  const id = useId();
  return <Field id={id} label="Apply to"><StyledSelect id={id} value={value} disabled={disabled}
    onChange={(event) => onChange(event.target.value as SeriesScope)}>
    <option value="one">This occurrence</option><option value="following">This and following occurrences</option><option value="all">Entire series</option>
  </StyledSelect></Field>;
}

function Metric({ value, estimated, partial, unit }: { value: number | null; estimated?: boolean; partial?: boolean; unit?: string }) {
  if (value === null) return <><span aria-hidden="true">—</span><span className="visually-hidden">Unknown</span></>;
  return <>{estimated && <><span aria-hidden="true">≈</span><span className="visually-hidden">Approximately </span></>}
    {formatNutrition(value)}{unit && ` ${unit}`}{partial && <small> · partial</small>}</>;
}

function FoodValueInput({ food, field, label, disabled, onChange }: {
  food: DraftFood; field: string; label: string; disabled: boolean; onChange: (next: DraftFood) => void;
}) {
  const id = useId();
  const [info, setInfo] = useState(false);
  const value = portionValue(food, field);
  const raw = food.inputs[field] ?? (value === null ? '' : String(Number(value.toFixed(field === CALORIES ? 4 : 6))));
  const certainty = valueCertainty(food, field);
  const source = food.details.values[field]?.source;
  const valid = validFoodInput(field, raw);
  return <div className="composer-value">
    <div className="composer-value-control">
      <NumericField id={id} label={label} value={raw} min={0} max={field === CALORIES ? CALORIE_MAX : NUTRIENT_MAX}
        step={field === CALORIES ? CALORIE_STEP : NUTRIENT_STEP} disabled={disabled || foodMultiplier(food) === null}
        aria-invalid={!valid} onChange={(event) => onChange(editPortionValue(food, field, event.target.value))} />
      {value !== null && <button type="button" className="icon-button composer-value-info" aria-expanded={info} aria-controls={`${id}-info`}
        aria-label={`${label} value information${certainty === 'estimated' ? ', estimated' : ''}`} onClick={() => setInfo((open) => !open)}>
        {certainty === 'estimated' ? '≈' : <Info size={16} />}
      </button>}
    </div>
    {info && value !== null && <div id={`${id}-info`} className="composer-value-detail">
      {source && <small>{source}</small>}
      <div role="group" aria-label={`${label} certainty`}>
        {(['estimated', 'provided'] as const).map((status) => <button key={status} type="button" disabled={disabled}
          aria-pressed={certainty === status} onClick={() => {
            onChange({ ...food, remember: true, details: { ...food.details, values: {
              ...food.details.values, [field]: { certainty: status, source: 'Your entry', unit: food.unit },
            } } });
            setInfo(false);
          }}>{status === 'estimated' ? 'Estimate' : 'Supplied value'}</button>)}
      </div>
    </div>}
  </div>;
}

function ComposerFood({ food, fields, displayed, expanded, disabled, onExpand, onChange, onRemove }: {
  food: DraftFood; fields: NutrientField[]; displayed: NutrientField[]; expanded: boolean; disabled: boolean;
  onExpand: () => void; onChange: (food: DraftFood) => void; onRemove: () => void;
}) {
  const id = useId();
  const [renaming, setRenaming] = useState(false);
  const [editingNutrients, setEditingNutrients] = useState<'preferred' | 'all' | null>(null);
  const [newUnit, setNewUnit] = useState<string | null>(null);
  const [unitWeight, setUnitWeight] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const unit = food.portions.find((option) => option.unit === food.unit);
  const grams = food.portions.find((option) => option.unit === 'g' || option.unit === 'ml');
  const amountValid = isValidQuantity(food.amount);

  function selectUnit(nextUnit: string) {
    if (nextUnit === '__custom') {
      setNewUnit('');
      setUnitWeight('');
      return;
    }
    const option = food.portions.find(({ unit }) => unit === nextUnit);
    if (!option || !unit) return;
    setNewUnit(null);
    onChange(changeDraftPortion(food, amountValid ? String(roundQuantity(Number(food.amount) * unit.ratio / option.ratio)) : food.amount, nextUnit));
  }

  function useCustomUnit() {
    const name = newUnit?.trim();
    if (!name || name.length > 24) return;
    const previous = food.portions.find(({ unit }) => unit.toLowerCase() === name.toLowerCase());
    if (previous) {
      selectUnit(previous.unit);
      return;
    }
    if (grams && unitWeight && isValidQuantity(unitWeight) && unit) {
      const ratio = grams.ratio * Number(unitWeight);
      onChange(changeDraftPortion({ ...food, portions: [...food.portions, { unit: name, ratio }], remember: true },
        String(roundQuantity(Number(food.amount) * unit.ratio / ratio)), name));
    } else {
      onChange({ ...food, amount: '1', unit: name, portions: [{ unit: name, ratio: 1 }],
        basis: { basisAmount: 1, basisUnit: name, caloriesKcal: null, nutrients: {}, gramsPerServing: null },
        details: { ...food.details, values: {}, assumption: undefined }, inputs: {}, remember: true });
    }
    setNewUnit(null);
  }

  const nutrientEditorFields = editingNutrients === 'all' ? fields : displayed;
  return <li data-food-key={food.key} className={`composer-food${expanded ? ' is-expanded' : ''}`}>
    <div className="composer-food-head">
      <button type="button" className="composer-food-toggle" aria-expanded={expanded} aria-controls={`${id}-editor`} onClick={onExpand}>
        <strong>{food.name || 'Food'}</strong>
        {!expanded && <small>{food.amount} {food.unit}{food.brand ? ` · ${food.brand}` : ''}</small>}
      </button>
      {!expanded && <span className="composer-food-calories"><Metric value={portionValue(food, CALORIES)} estimated={valueCertainty(food, CALORIES) === 'estimated'} unit="kcal" /></span>}
      <button type="button" className="icon-button" aria-label={`Remove ${food.name}`} disabled={disabled} onClick={onRemove}><Trash2 size={17} /></button>
      <details className="composer-food-menu" ref={menu} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }} onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}>
        <summary className="icon-button" aria-label={`More actions for ${food.name}`}><MoreHorizontal size={18} /></summary>
        <div className="composer-dropdown">
          <button type="button" disabled={disabled} onClick={() => { if (menu.current) menu.current.open = false; if (!expanded) onExpand(); setRenaming(true); }}><Pencil size={15} />Rename</button>
          {fields.length > 0 && <button type="button" disabled={disabled} onClick={() => { if (menu.current) menu.current.open = false; if (!expanded) onExpand(); setEditingNutrients('all'); }}><SlidersHorizontal size={15} />Edit nutrients</button>}
        </div>
      </details>
    </div>
    {expanded && <div className="composer-food-editor" id={`${id}-editor`}>
      {renaming && <Field id={`${id}-name`} label="Food name"><input id={`${id}-name`} className="text-field" autoFocus maxLength={160} value={food.name}
        disabled={disabled} onChange={(event) => onChange({ ...food, name: event.target.value, remember: true })} /></Field>}
      <div className="composer-portion-fields">
        <div className="composer-portion-pair">
          <NumericField id={`${id}-amount`} label="Amount" value={food.amount} min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP}
            disabled={disabled} aria-invalid={!amountValid} onChange={(event) => onChange(changeDraftPortion(food, event.target.value))} />
          <Field id={`${id}-unit`} label="Unit"><StyledSelect id={`${id}-unit`} value={newUnit === null ? food.unit : '__custom'}
            disabled={disabled} onChange={(event) => selectUnit(event.target.value)}>
            {food.portions.map((portion) => <option key={portion.unit}>{portion.unit}</option>)}
            <option value="__custom">Custom unit…</option>
          </StyledSelect></Field>
        </div>
        <FoodValueInput food={food} field={CALORIES} label="Calories (kcal)" disabled={disabled} onChange={onChange} />
      </div>
      {newUnit !== null && <div className="composer-custom-unit">
        <Field id={`${id}-custom`} label="Unit name"><input className="text-field" id={`${id}-custom`} value={newUnit} maxLength={24} onChange={(event) => setNewUnit(event.target.value)} /></Field>
        {grams && <NumericField id={`${id}-weight`} label={`${grams.unit} per unit (optional)`} value={unitWeight} min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} onChange={(event) => setUnitWeight(event.target.value)} />}
        {!unitWeight && <small className="field-hint">Enter nutrition for the new unit if its conversion is unknown.</small>}
        <div className="composer-inline-actions"><button className="text-button" type="button" onClick={() => setNewUnit(null)}>Cancel</button>
          <Button variant="secondary" type="button" disabled={disabled || !newUnit.trim() || Boolean(unitWeight && !isValidQuantity(unitWeight))} onClick={useCustomUnit}>Use unit</Button></div>
      </div>}
      {unit?.assumption && <small className="composer-assumption"><Info size={14} />{unit.assumption}</small>}
      {!amountValid && <small className="field-error">Enter a positive amount with up to four decimal places.</small>}
      {editingNutrients && <div className="composer-nutrient-editor">
        <div className="composer-inline-actions"><button className="text-button" type="button" onClick={() => setEditingNutrients(null)}>Done</button></div>
        <div className="composer-nutrient-inputs">{nutrientEditorFields.map((field) => <FoodValueInput key={field.field_id}
          food={food} field={field.field_id} label={`${field.name} (${field.unit})`} disabled={disabled} onChange={onChange} />)}</div>
      </div>}
    </div>}
    {!(expanded && editingNutrients) && displayed.length > 0 && <div className="composer-food-nutrients">
      {displayed.map((field) => <button type="button" className="composer-metric" key={field.field_id} disabled={disabled}
        aria-label={`Edit ${field.name} for ${food.name}`} onClick={() => { if (!expanded) onExpand(); setEditingNutrients('preferred'); }}>
        <span>{field.name}</span><strong><Metric value={portionValue(food, field.field_id)} estimated={valueCertainty(food, field.field_id) === 'estimated'} unit={field.unit} /></strong>
      </button>)}
    </div>}
  </li>;
}

export function AddChoiceDialog({ userId, fields, initialDate, today, timezone, anchor, block, plannedItems, startEaten = false, attachFoods = false, onClose, onSaved }: {
  userId: string; fields: NutrientField[]; initialDate: string; today: string; timezone: string; anchor: HTMLElement | null;
  block?: DayItem; plannedItems?: DayItem[]; startEaten?: boolean; attachFoods?: boolean; onClose: () => void; onSaved: (input: ComposerSave) => void;
}) {
  const id = useId();
  const [date, setDate] = useState(initialDate);
  const existingPlan = plannedItems?.[0];
  const series = existingPlan?.series_id ? existingPlan : undefined;
  const editingEntry = Boolean(block || existingPlan);
  const [state, setState] = useState<EntryState>(initialDate > today || !startEaten && (block?.state === 'planned' || existingPlan) ? 'planned' : 'eaten');
  const [section, setSection] = useState<MealLabel>(block?.section ?? existingPlan?.section ?? 'unlabelled');
  const [frequency, setFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState(() => [(new Date(`${initialDate}T12:00Z`).getUTCDay() || 7)]);
  const [endsOn, setEndsOn] = useState('');
  const [scope, setScope] = useState<SeriesScope>('one');
  const [blockMode, setBlockMode] = useState(Boolean(block && !attachFoods));
  const [calorieBlock, setCalorieBlock] = useState(() => {
    const existing = block ? existingBlockDraft(block) : null;
    if (existing) return existing;
    return { ...manualDraft(''), remember: false, details: { kind: 'calorie_block' as const, values: {} } };
  });
  const [foods, setFoods] = useState<DraftFood[]>(() => !block && plannedItems ? plannedItems.flatMap((item) => {
    const food = plannedDraft(item);
    return food ? [{ ...food, key: item.id }] : [];
  }) : []);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ food: DraftFood; index: number } | null>(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [notice, setNotice] = useState('');
  const [discard, setDiscard] = useState(false);
  const [uncertainSave, setUncertainSave] = useState<ComposerSave | null>(null);
  const lastRequest = useRef<IdempotentRequest | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const searchArea = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const foodList = useRef<HTMLOListElement>(null);
  const schedule = useRef<HTMLDetailsElement>(null);
  const requestInFlight = useRef(false);
  const displayed = fields.filter((field) => field.is_displayed).slice(0, 3);
  const locale = navigator.language || null;
  const activeSearch = suggestions && !blockMode;
  useLayoutEffect(() => {
    const dialog = content.current?.closest('dialog');
    if (!anchor || !dialog) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      dialog.style.setProperty('--composer-anchor-x', `${rect.left + rect.width / 2}px`);
      dialog.style.setProperty('--composer-anchor-y', `${rect.top + rect.height / 2}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      dialog.style.removeProperty('--composer-anchor-x');
      dialog.style.removeProperty('--composer-anchor-y');
    };
  }, [anchor]);
  const save = useMutation({
    mutationFn: (input: ComposerSave) => saveCalendarComposer(input),
    onSuccess: (_result, input) => onSaved(input),
    onError: (error, input) => {
      if (!(error instanceof DataError) || error.retryable) setUncertainSave(input);
    },
    onSettled: () => { requestInFlight.current = false; },
  });
  const locked = save.isPending || Boolean(uncertainSave);
  const recents = useQuery({ queryKey: queryKeys.recentChoices(userId), queryFn: () => loadRecentChoices(userId), enabled: activeSearch, staleTime: 60_000 });
  const preferences = useQuery({ queryKey: queryKeys.foodPortionPreferences(userId), queryFn: () => loadFoodPortionPreferences(userId), staleTime: 60_000 });
  const personal = useQuery({
    queryKey: [...queryKeys.foods(userId), 'composer', term],
    queryFn: async () => (await loadFoodLibrary(userId, term, 0, term ? 15 : 8, term ? 'name' : 'recent')).entries,
    enabled: activeSearch, staleTime: 60_000,
  });
  const meals = useQuery({
    queryKey: [...queryKeys.mealLibrary(userId, term), 'composer'],
    queryFn: () => loadMeals(userId, term, term ? 10 : 6, term ? 'name' : 'recent'),
    enabled: activeSearch, staleTime: 60_000,
  });
  const catalogue = useQuery({
    queryKey: queryKeys.catalogFoodSearch(term, locale),
    queryFn: () => searchCatalogFoods(term, locale, 16),
    enabled: activeSearch && term.length >= 2, staleTime: 60_000,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 120);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (activeKey) foodList.current?.querySelector(`[data-food-key="${CSS.escape(activeKey)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  useEffect(() => {
    if (!suggestions) return;
    const dismiss = (event: PointerEvent) => {
      if (!searchArea.current?.contains(event.target as Node)) setSuggestions(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [suggestions]);

  function addFoods(entries: DraftFood[]) {
    if (foods.length + entries.length > MAX_ITEMS) {
      setNotice('A meal can contain up to 50 foods.');
      return;
    }
    const additions = entries.map((food) => ({ ...food, key: crypto.randomUUID() }));
    setFoods((current) => [...current, ...additions]);
    setActiveKey(additions.length === 1 ? additions[0]!.key : null);
    setSearch('');
    setSuggestions(false);
    setNotice('');
  }

  function addMeal(meal: SavedMeal, multiplier = 1) {
    if (!meal.components.length || meal.components.some((component) => !component.food || component.food.archived_at)) {
      setNotice('Some foods in this saved meal are unavailable. Update it in the Library.');
      return;
    }
    const entries = meal.components.map((component) => {
      const entry = libraryDraft({ food: component.food!, nutrients: component.nutrients });
      const amount = String(roundQuantity(component.amount * multiplier));
      return { ...entry, amount, unit: component.unit };
    });
    addFoods(entries);
  }

  async function addRecent(choice: NonNullable<typeof recents.data>[number]) {
    if (loadingRecent) return;
    setLoadingRecent(true);
    try {
      if (choice.kind === 'snapshot' && choice.snapshot) {
        const food = snapshotDraft(choice.snapshot);
        if (food) { addFoods([food]); return; }
      } else if (choice.kind === 'meal') {
        const meal = await loadMealEntry(userId, choice.id);
        if (meal) { addMeal(meal, choice.amount); return; }
      } else {
        const food = await loadFoodEntry(userId, choice.id);
        if (food) { addFoods([libraryDraft(food, { amount: String(choice.amount), unit: choice.unit })]); return; }
      }
      setNotice('This recent food or meal is unavailable.');
    } catch {
      setNotice('Could not load this recent choice. Try again.');
    } finally {
      setLoadingRecent(false);
    }
  }

  const matchesSearch = (name: string, brand: string | null = null) => !term || choiceMatchScore(name, brand, term) >= 0;
  const recentChoices: Choice[] = (recents.data ?? []).filter((choice) => matchesSearch(choice.name)).slice(0, 5).map((choice) => ({
    key: `${choice.kind}:${choice.id}`, name: choice.name, detail: `Recently used · ${choice.amount} ${choice.unit}`,
    calories: choice.snapshot?.calories.value ?? null, estimated: choice.snapshot?.logging?.values[CALORIES]?.certainty === 'estimated',
    select: () => void addRecent(choice),
  }));
  const savedChoices: Choice[] = [
    ...(personal.data ?? []).filter(({ food }) => matchesSearch(food.name, food.brand)).map((entry) => {
      const food = libraryDraft(entry, preferences.data?.[`library:${entry.food.id}`]);
      return {
        key: `food:${entry.food.id}`, name: food.name,
        detail: [entry.food.logging_variant_key ? 'Your version' : 'Saved food', food.brand, `${food.amount} ${food.unit}`].filter(Boolean).join(' · '),
        calories: portionValue(food, CALORIES), estimated: valueCertainty(food, CALORIES) === 'estimated', select: () => addFoods([food]),
      };
    }),
    ...(meals.data ?? []).filter(({ meal }) => matchesSearch(meal.name)).map((entry) => ({
      key: `meal:${entry.meal.id}`, name: entry.meal.name, detail: `Saved meal · ${entry.components.length} foods`,
      calories: null, select: () => addMeal(entry),
    })),
  ];
  const sharedChoices: Choice[] = (term.length >= 2 ? catalogue.data ?? [] : []).map((entry) => {
    const food = catalogueDraft(entry, fields, preferences.data?.[`catalogue:${entry.food_id}`]);
    return {
      key: `catalogue:${entry.food_id}`, name: food.name, detail: [food.brand, `${food.amount} ${food.unit}`].filter(Boolean).join(' · '),
      calories: portionValue(food, CALORIES), estimated: valueCertainty(food, CALORIES) === 'estimated', select: () => addFoods([food]),
    };
  });
  const resultMap = new Map<string, Choice>();
  for (const choice of [...recentChoices, ...savedChoices, ...sharedChoices]) {
    if (!resultMap.has(choice.key)) resultMap.set(choice.key, choice);
  }
  const results = search.trim() === term ? [...resultMap.values()] : [];
  const searching = search.trim() !== term || personal.isPending || meals.isPending || term.length >= 2 && catalogue.isFetching;

  const activeFoods = blockMode ? [{ ...calorieBlock, name: calorieBlock.name.trim() || 'Calorie block' }] : foods;
  const calories = mealMetric(activeFoods, CALORIES);
  const scheduleValid = frequency === 'none' || (Number.isInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 365
    && (frequency === 'daily' || weekdays.length > 0) && (!endsOn || isValidLocalDate(endsOn) && endsOn >= date));
  const canSave = isValidLocalDate(date) && activeFoods.length > 0 && activeFoods.length <= MAX_ITEMS && activeFoods.every(validDraftFood)
    && scheduleValid && (state === 'planned' && !blockMode || calories.complete) && (state !== 'eaten' || date <= today);
  const dirty = foods.length > 0 || calorieBlock.name !== '' || basisValue(calorieBlock, CALORIES) !== null;
  const title = attachFoods ? 'Add foods to calorie block' : series ? 'Edit repeating meal' : existingPlan ? 'Edit planned meal' : blockMode ? 'Add calories' : 'Add a meal';
  const verb = editingEntry ? 'Update entry' : state === 'planned' ? blockMode ? 'Plan calories' : 'Plan meal' : blockMode ? 'Log calories' : 'Log meal';

  function chooseDate(next: string) {
    if (!isValidLocalDate(next)) return;
    setDate(next);
    if (frequency === 'none') setWeekdays([new Date(`${next}T12:00Z`).getUTCDay() || 7]);
    if (next > today) setState('planned');
    if (schedule.current) {
      schedule.current.open = false;
      schedule.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  }

  function startSave(input: ComposerSave) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    save.mutate(input);
  }

  function submit() {
    if (!canSave || locked) return;
    const input = {
      localDate: date, state, items: activeFoods.map((food) => prepareFood(food, fields, section)),
      replace: block && !series ? { id: block.id, revision: block.revision } : undefined,
      replaceGroup: existingPlan && !series && !block ? plannedItems?.map(({ id, revision }) => ({ id, revision })) : undefined,
      recurrence: frequency === 'none' ? undefined : { frequency, interval: Number(interval), weekdays, endsOn: endsOn || undefined },
      seriesEdit: series?.series_id ? { id: series.series_id, revision: series.series_revision!, scope } : undefined,
    };
    lastRequest.current = nextIdempotentRequest(lastRequest.current, input, () => crypto.randomUUID());
    setSuggestions(false);
    startSave({ ...input, requestId: lastRequest.current.requestId });
  }

  function requestClose() {
    if (save.isPending) return;
    if (dirty || uncertainSave) setDiscard(true);
    else onClose();
  }

  const renderChoice = (choice: Choice) => <li key={choice.key}><button type="button" disabled={locked || loadingRecent} onClick={choice.select}>
    <span><strong>{choice.name}</strong><small>{choice.detail}</small></span>
    <span className="composer-result-facts">{choice.calories !== null && <Metric value={choice.calories} estimated={choice.estimated} unit="kcal" />}<Plus size={16} aria-hidden="true" /></span>
  </button></li>;

  return <>
    <Dialog open title={title} className={`logging-composer${foods.length === 0 ? ' is-compact' : ''}`} closeDisabled={save.isPending} onClose={requestClose} controlledClose lightDismiss>
      <div className="composer-content" ref={content}>
        <div className="composer-toolbar">
          <details className="composer-schedule" ref={schedule} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={(event) => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.preventDefault();
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }}>
            <summary className="composer-date" aria-label="Date and repeat"><CalendarDays size={16} />{formatLocalDate(date, timezone, { weekday: 'short', day: 'numeric', month: 'short' })}{(frequency !== 'none' || series) && <Repeat2 size={15} />}<ChevronDown size={14} /></summary>
            <div className="composer-dropdown composer-date-options">
              {!editingEntry && <div className="composer-inline-actions"><Button type="button" variant="secondary" disabled={locked} onClick={() => chooseDate(today)}>Today</Button>
                <Button type="button" variant="secondary" disabled={locked} onClick={() => chooseDate(addLocalDays(today, 1))}>Tomorrow</Button></div>}
              <Field id={`${id}-date`} label="Date"><input className="text-field" type="date" id={`${id}-date`} value={date}
                disabled={locked || editingEntry} onChange={(event) => chooseDate(event.target.value)} /></Field>
              {!editingEntry && <Field id={`${id}-repeat`} label="Repeat"><StyledSelect id={`${id}-repeat`}
                value={frequency} disabled={locked} onChange={(event) => {
                  const value = event.target.value as typeof frequency;
                  setFrequency(value);
                  if (value !== 'none') setState('planned');
                }}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></StyledSelect></Field>}
              {frequency !== 'none' && <>
                <NumericField id={`${id}-interval`} label={frequency === 'daily' ? 'Every (days)' : 'Every (weeks)'} min={1} max={365} step={1}
                  value={interval} disabled={locked} onChange={(event) => setInterval(event.target.value)} />
                {frequency === 'weekly' && <div className="composer-weekdays" role="group" aria-label="Repeat on">
                  {weekdayNames.map((day, index) => <button type="button" key={day} aria-label={day} aria-pressed={weekdays.includes(index + 1)} disabled={locked}
                    onClick={() => setWeekdays((current) => current.includes(index + 1) ? current.filter((value) => value !== index + 1) : [...current, index + 1])}>{day.slice(0, 2)}</button>)}
                </div>}
                <Field id={`${id}-until`} label="End date (optional)"><input id={`${id}-until`} type="date" className="text-field" min={date} value={endsOn}
                  disabled={locked} onChange={(event) => setEndsOn(event.target.value)} /></Field>
              </>}
            </div>
          </details>
          <div className="choice-action-picker composer-state" role="group" aria-label="Entry state">
            {(['eaten', 'planned'] as const).map((value) => <label key={value}><input type="radio" name={`${id}-state`} checked={state === value}
              disabled={locked || (value === 'eaten' ? date > today : block?.state === 'eaten')} onChange={() => {
                setState(value);
                if (value === 'eaten') { setFrequency('none'); setScope('one'); }
              }} />{value === 'eaten' ? 'Eaten' : 'Planned'}</label>)}
          </div>
        </div>
        {!blockMode && <div className="composer-search-area" ref={searchArea}
          onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setSuggestions(false); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && suggestions) { event.preventDefault(); searchInput.current?.focus(); setSuggestions(false); }
            if (event.key === 'ArrowDown' && event.target === searchInput.current) {
              const first = event.currentTarget.querySelector<HTMLButtonElement>('.composer-suggestions button:not(:disabled)');
              if (first) { event.preventDefault(); first.focus(); }
            }
          }}>
          <label className="library-search composer-search"><Plus size={18} aria-hidden="true" /><span className="visually-hidden">Add food or a saved meal</span>
            <input ref={searchInput} type="search" placeholder="Add food or a saved meal…" aria-controls={`${id}-suggestions`} value={search} autoComplete="off"
              maxLength={160} disabled={locked} onFocus={() => setSuggestions(true)} onClick={() => setSuggestions(true)}
              onChange={(event) => { setSearch(event.target.value); setSuggestions(true); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && suggestions && results[0] && !loadingRecent) {
                  event.preventDefault();
                  results[0].select();
                }
              }} />
          </label>
          {suggestions && <div className="composer-suggestions" id={`${id}-suggestions`}>
            {(personal.isError || meals.isError || catalogue.isError) && <p className="field-hint" role="status">Some search results could not be loaded.</p>}
            <ul aria-label="Food and meal suggestions">{results.map(renderChoice)}
              {search.trim() && <li><button type="button" disabled={locked || loadingRecent} onClick={() => addFoods([manualDraft(search.trim())])}><span><strong>Add “{search.trim()}”</strong><small>Enter calories yourself</small></span><Plus size={16} /></button></li>}
            </ul>
            {searching && <p className="field-hint" role="status">Searching…</p>}
            {!searching && !search.trim() && results.length === 0 && <p className="field-hint">Search for a food to get started.</p>}
          </div>}
        </div>}
        {!editingEntry && (blockMode || foods.length === 0) && <div className="composer-entry-shortcuts">
          <button className="composer-calorie-switch" type="button" disabled={locked} onClick={() => {
            setSuggestions(false); setBlockMode((mode) => !mode);
          }}>
            {blockMode ? <Plus size={16} aria-hidden="true" /> : <Calculator size={16} aria-hidden="true" />}
            {blockMode ? 'Add foods instead' : 'Calories only'}
          </button>
        </div>}
        <div className="composer-items">
          {blockMode ? <div className="composer-block-fields">
            <Field id={`${id}-label`} label="Label (optional)"><input className="text-field" id={`${id}-label`} placeholder="e.g. Dinner" maxLength={160}
              value={calorieBlock.name} disabled={locked} onChange={(event) => setCalorieBlock({ ...calorieBlock, name: event.target.value })} /></Field>
            <FoodValueInput food={calorieBlock} field={CALORIES} label="Calories (kcal)" disabled={locked} onChange={setCalorieBlock} />
          </div> : <>
            <ol className="composer-food-list" ref={foodList}>{foods.map((food) => <ComposerFood key={food.key} food={food} fields={fields} displayed={displayed}
              expanded={activeKey === food.key} disabled={locked} onExpand={() => setActiveKey((key) => key === food.key ? null : food.key)}
              onChange={(next) => setFoods((current) => current.map((entry) => entry.key === food.key ? next : entry))}
              onRemove={() => {
                setRemoved({ food, index: foods.indexOf(food) });
                setFoods((current) => current.filter((entry) => entry.key !== food.key));
              }} />)}</ol>
          </>}
          {notice && <StatusMessage>{notice}</StatusMessage>}
        </div>
        <div className="composer-footer">
          {!blockMode && foods.length > 0 && <>
            <div className="composer-total"><span>Meal total · {foods.length} {foods.length === 1 ? 'food' : 'foods'}</span>
              <strong><Metric value={calories.value} estimated={calories.estimated} partial={!calories.complete} unit="kcal" /></strong></div>
            {displayed.length > 0 && <dl className="composer-total-nutrients">{displayed.map((field) => {
              const metric = mealMetric(foods, field.field_id);
              return <div key={field.field_id}><dt>{field.name}</dt><dd><Metric value={metric.value} estimated={metric.estimated} partial={!metric.complete} unit={field.unit} /></dd></div>;
            })}</dl>}
          </>}
          {removed && <div className="composer-undo" role="status"><span>{removed.food.name} removed</span><button type="button" className="text-button" disabled={locked || foods.length >= MAX_ITEMS} onClick={() => {
            setFoods((current) => [...current.slice(0, removed.index), removed.food, ...current.slice(removed.index)]);
            setRemoved(null);
          }}>Undo</button></div>}
          {activeFoods.length > 0 && !canSave && <small className="field-hint">{!calories.complete && (state === 'eaten' || blockMode) ? 'Enter calories before saving.' : 'Check the amounts and nutrition values.'}</small>}
          {save.isError && <StatusMessage tone="error">{uncertainSave ? 'The save could not be confirmed. Retry to finish the same request.' : save.error.message}</StatusMessage>}
          {series && state === 'planned' && <SeriesScopeSelect value={scope} onChange={setScope} disabled={locked} />}
          {!scheduleValid && <small className="field-error">Check the repeat interval, weekdays and end date.</small>}
          <div className="composer-footer-actions">
            {!blockMode && !editingEntry && <label className="composer-label"><span className="visually-hidden">Meal label</span><StyledSelect value={section} disabled={locked} onChange={(event) => setSection(event.target.value as MealLabel)}>
              {sectionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </StyledSelect></label>}
            <Button type="button" disabled={save.isPending || !uncertainSave && !canSave} onClick={() => uncertainSave ? startSave(uncertainSave) : submit()}>
              <Check size={16} aria-hidden="true" />{save.isPending ? 'Saving…' : uncertainSave ? 'Retry save' : verb}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
    <Dialog open={discard} title="Close meal draft?" onClose={() => setDiscard(false)}>
      <p>{uncertainSave ? 'The save has not been confirmed. Check the calendar before adding this meal again.' : 'Your changes to this meal will be discarded.'}</p>
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setDiscard(false)}>Keep editing</Button><Button type="button" onClick={onClose}>Close draft</Button></div>
    </Dialog>
  </>;
}
