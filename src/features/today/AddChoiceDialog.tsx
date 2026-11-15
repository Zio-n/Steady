import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Calculator, CalendarDays, Check, ChevronDown, CircleDashed, Info, MoreHorizontal, Pencil, Plus, Repeat2, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import { DataError } from '../../data/dataError';
import { queryKeys } from '../../data/queryKeys';
import { saveCalendarComposer, type ComposerSave, type SeriesScope } from '../../data/repositories/calendarRepository';
import { saveCatalogFoodCopy, searchCatalogFoods } from '../../data/repositories/catalogFoodRepository';
import { loadRecentChoices } from '../../data/repositories/dayRepository';
import { loadFoodEntry, loadFoodLibrary, saveFood } from '../../data/repositories/foodRepository';
import { loadFoodPortionPreferences } from '../../data/repositories/foodPortionPreferenceRepository';
import { loadMealEntry, loadMeals, loadRecentMeals, saveSnapshotMeal, type SavedMeal } from '../../data/repositories/mealRepository';
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
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { StyledSelect } from '../../ui/components/StyledSelect';
import { catalogueDraft, existingBlockDraft, libraryDraft, loadDiaryItemDrafts, manualDraft, prepareFood, recentMealDrafts, recentMealName, savedMealDrafts, savedPortionDraft, snapshotDraft, type MealLabel } from './composerFoods';

type EntryState = ComposerSave['state'];
type Choice = { key: string; name: string; detail: string; calories: number | null; estimated?: boolean; select: () => void };
type SaveInput = ComposerSave & { libraryName?: string; libraryFood?: Omit<import('../../data/repositories/foodRepository').SaveFoodInput, 'requestId' | 'id' | 'expectedRevision'> & { catalogFoodId?: string; personallyAdjusted?: boolean } };
const MAX_ITEMS = 50;
const sectionOptions: Array<[MealLabel, string]> = [['unlabelled', 'No label'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
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
    {formatNutrition(value)}{unit && ` ${unit}`}{partial && <> <CircleDashed size={12} className="nutrition-incomplete-mark" aria-hidden="true" /><span className="visually-hidden">, incomplete</span></>}</>;
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

function ComposerFood({ food, fields, displayed, expanded, disabled, editingMeal, onExpand, onChange, onRemove }: {
  food: DraftFood; fields: NutrientField[]; displayed: NutrientField[]; expanded: boolean; disabled: boolean; editingMeal: boolean;
  onExpand: () => void; onChange: (food: DraftFood) => void; onRemove: () => void;
}) {
  const id = useId();
  const [renaming, setRenaming] = useState(false);
  const [showBrand, setShowBrand] = useState(Boolean(food.brand));
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
          <button type="button" disabled={disabled} onClick={() => { if (menu.current) menu.current.open = false; if (!expanded) onExpand(); setRenaming(true); }}><Pencil size={15} />{editingMeal ? 'Edit name and brand' : 'Rename'}</button>
          {fields.length > 0 && <button type="button" disabled={disabled} onClick={() => { if (menu.current) menu.current.open = false; if (!expanded) onExpand(); setEditingNutrients('all'); }}><SlidersHorizontal size={15} />Edit nutrients</button>}
        </div>
      </details>
    </div>
    {expanded && <div className="composer-food-editor" id={`${id}-editor`}>
      {renaming && <div className="composer-portion-pair">
        <Field id={`${id}-name`} label="Food name"><input id={`${id}-name`} className="text-field" autoFocus maxLength={160} value={food.name}
          disabled={disabled} onChange={(event) => onChange({ ...food, name: event.target.value, remember: true })} /></Field>
        {editingMeal && showBrand && <div className="composer-brand-field"><Field id={`${id}-brand`} label="Brand"><input id={`${id}-brand`} className="text-field" maxLength={120} placeholder="Brand name" value={food.brand ?? ''}
          disabled={disabled} onChange={(event) => onChange({ ...food, brand: event.target.value || null, remember: true })} /></Field>
          <button className="icon-button" type="button" aria-label="Remove brand" disabled={disabled} onClick={() => { onChange({ ...food, brand: null, remember: true }); setShowBrand(false); }}><X size={16} /></button>
        </div>}
        {editingMeal && !showBrand && <button className="composer-optional-trigger" type="button" disabled={disabled} onClick={() => setShowBrand(true)}><Plus size={15} aria-hidden="true" />Brand</button>}
      </div>}
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
        {grams && <NumericField id={`${id}-weight`} label={`${grams.unit} per unit`} value={unitWeight} min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} onChange={(event) => setUnitWeight(event.target.value)} />}
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

type LibraryMealDraft = {
  kind?: 'meal' | 'food' | 'entry'; name: string; recentKey?: string; mealId?: string; revision?: number; foods: DraftFood[]; onDraftChange?: (dirty: boolean) => void;
};

type ComposerProps = {
  userId: string; fields: NutrientField[]; initialDate: string; today: string; timezone: string; anchor: HTMLElement | null;
  block?: DayItem; editingItems?: DayItem[]; startEaten?: boolean; attachFoods?: boolean; onClose: () => void; onSaved: (input: ComposerSave) => void;
  reuse?: { recentKey: string } | { mealId: string } | { foodId: string };
  library?: LibraryMealDraft;
};
const emptyDraft: DraftFood[] = [];

export function LibraryMealComposer({ userId, fields, meal, onClose, onSaved, onDraftChange }: {
  userId: string; fields: NutrientField[]; meal: LibraryMealDraft; onClose: () => void; onSaved: () => void; onDraftChange: (dirty: boolean) => void;
}) {
  const date = new Date().toISOString().slice(0, 10);
  return <MealComposer userId={userId} fields={fields} initialDate={date} today={date} timezone="UTC" anchor={null}
    onClose={onClose} onSaved={onSaved} library={{ ...meal, kind: 'meal', onDraftChange }}
    initialFoods={meal.foods.map((food, index) => ({ ...food, key: `saved-${index}` }))} />;
}

export function LibraryFoodComposer({ userId, fields, onClose, onSaved, onDraftChange }: {
  userId: string; fields: NutrientField[]; onClose: () => void; onSaved: () => void; onDraftChange: (dirty: boolean) => void;
}) {
  const date = new Date().toISOString().slice(0, 10);
  return <MealComposer userId={userId} fields={fields} initialDate={date} today={date} timezone="UTC" anchor={null}
    onClose={onClose} onSaved={onSaved} library={{ kind: 'food', name: '', foods: [], onDraftChange }} initialFoods={emptyDraft} />;
}

export function LibraryEntryComposer({ userId, fields, onClose, onSaved, onDraftChange }: {
  userId: string; fields: NutrientField[]; onClose: () => void; onSaved: () => void; onDraftChange: (dirty: boolean) => void;
}) {
  const date = new Date().toISOString().slice(0, 10);
  return <MealComposer userId={userId} fields={fields} initialDate={date} today={date} timezone="UTC" anchor={null}
    onClose={onClose} onSaved={onSaved} library={{ kind: 'entry', name: '', foods: [], onDraftChange }} initialFoods={emptyDraft} />;
}

export function AddChoiceDialog(props: ComposerProps) {
  const { userId, editingItems, block, onClose, reuse } = props;
  const loadFoods = Boolean(editingItems?.length && !block);
  const draft = useQuery({
    queryKey: [...queryKeys.day(userId, props.initialDate), 'meal-draft', editingItems?.map(({ id, revision }) => [id, revision]), reuse],
    queryFn: async () => {
      let foods: DraftFood[] = [];
      if (reuse && 'foodId' in reuse) {
        const [food, portions] = await Promise.all([
          loadFoodEntry(userId, reuse.foodId),
          loadFoodPortionPreferences(userId).catch(() => null),
        ]);
        if (food) foods = [libraryDraft(food, portions?.[`library:${reuse.foodId}`])];
      } else if (reuse && 'mealId' in reuse) {
        const meal = await loadMealEntry(userId, reuse.mealId);
        if (meal) foods = savedMealDrafts(meal);
      } else if (reuse) {
        const [meal] = await loadRecentMeals('', 1, 0, reuse.recentKey);
        if (meal) foods = recentMealDrafts(meal);
      } else {
        foods = (await Promise.all(editingItems!.map((item) => loadDiaryItemDrafts(userId, item)))).flat();
      }
      if (!foods.length) throw new DataError('This item is unavailable.', 'not-found');
      return foods.map((food, index) => ({ ...food, key: `saved-${index}` }));
    },
    enabled: loadFoods || Boolean(reuse),
    gcTime: 0,
  });
  if ((loadFoods || reuse) && !draft.data) return <Dialog open title={reuse && 'foodId' in reuse ? 'Add a food' : reuse ? 'Add a meal' : 'Edit meal'} className="logging-composer is-compact" onClose={onClose} controlledClose lightDismiss>
    {draft.isError ? <>
      <StatusMessage tone="error">{draft.error.message}</StatusMessage>
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => void draft.refetch()}>Try again</Button></div>
    </> : <LoadingSkeleton label="Loading saved meal" />}
  </Dialog>;
  return <MealComposer {...props} initialFoods={loadFoods || reuse ? draft.data! : emptyDraft} />;
}

function MealComposer({ userId, fields, initialDate, today, timezone, anchor, block, editingItems, initialFoods, startEaten = false, attachFoods = false, onClose, onSaved, library }: ComposerProps & {
  initialFoods: DraftFood[];
}) {
  const id = useId();
  const [name, setName] = useState(library?.name ?? '');
  const [showMealName, setShowMealName] = useState(library?.kind === 'meal' || Boolean(library?.name));
  const [date, setDate] = useState(initialDate);
  const existing = editingItems?.[0];
  const series = existing?.series_id ? existing : undefined;
  const editingEntry = Boolean(existing);
  const mixedState = editingItems?.some((item) => item.state === 'eaten') && editingItems?.some((item) => item.state === 'planned');
  const initialState = initialDate > today ? 'planned' : startEaten ? 'eaten'
    : mixedState ? null : editingItems?.every((item) => item.state === 'planned') ? 'planned' : 'eaten';
  const initialSection = existing?.section ?? 'unlabelled';
  const [state, setState] = useState<EntryState | null>(initialState);
  const [section, setSection] = useState<MealLabel>(initialSection);
  const [frequency, setFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState(() => [(new Date(`${initialDate}T12:00Z`).getUTCDay() || 7)]);
  const [endsOn, setEndsOn] = useState('');
  const [scope, setScope] = useState<SeriesScope>('one');
  const [blockMode, setBlockMode] = useState(Boolean(block && !attachFoods));
  const [initialBlock] = useState(() => {
    const savedBlock = block ? existingBlockDraft(block) : null;
    if (savedBlock) return savedBlock;
    return { ...manualDraft(''), remember: false, details: { kind: 'calorie_block' as const, values: {} } };
  });
  const [calorieBlock, setCalorieBlock] = useState(initialBlock);
  const [initialDraft] = useState(initialFoods);
  const [foods, setFoods] = useState(initialDraft);
  const [activeKey, setActiveKey] = useState<string | null>(initialDraft.length === 1 ? initialDraft[0]!.key : null);
  const [removed, setRemoved] = useState<{ food: DraftFood; index: number } | null>(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [notice, setNotice] = useState('');
  const [discardHost, setDiscardHost] = useState<HTMLDialogElement | null>(null);
  const [uncertainSave, setUncertainSave] = useState<SaveInput | null>(null);
  const lastRequest = useRef<IdempotentRequest | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const mealNameInput = useRef<HTMLInputElement>(null);
  const searchArea = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const foodList = useRef<HTMLOListElement>(null);
  const discardDialog = useRef<HTMLElement>(null);
  const discardKeepEditing = useRef<HTMLButtonElement>(null);
  const discardReturnFocus = useRef<HTMLElement | null>(null);
  const schedule = useRef<HTMLDetailsElement>(null);
  const requestInFlight = useRef(false);
  const displayed = fields.filter((field) => field.is_displayed).slice(0, 3);
  const locale = navigator.language || null;
  const activeSearch = suggestions && !blockMode;
  useEffect(() => { if (discardHost) discardKeepEditing.current?.focus({ preventScroll: true }); }, [discardHost]);
  useEffect(() => { if (showMealName) mealNameInput.current?.focus({ preventScroll: true }); }, [showMealName]);
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
    mutationFn: (input: SaveInput) => {
      if ((library?.kind === 'food' || library?.kind === 'entry') && input.libraryFood) {
        const { catalogFoodId, personallyAdjusted, ...food } = input.libraryFood;
        if (catalogFoodId) return saveCatalogFoodCopy({ ...food, requestId: input.requestId, catalogFoodId, isPersonallyAdjusted: Boolean(personallyAdjusted) });
        return saveFood({ ...food, requestId: input.requestId, id: null, expectedRevision: null });
      }
      return library ? saveSnapshotMeal({
        requestId: input.requestId, name: input.libraryName!,
        foods: input.items, historyKey: library.recentKey, mealId: library.mealId, revision: library.revision,
      }) : saveCalendarComposer(input);
    },
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
    enabled: activeSearch && !library, staleTime: 60_000,
  });
  const recentMeals = useQuery({
    queryKey: [...queryKeys.recentMeals(userId), 'search', term],
    queryFn: () => loadRecentMeals(term, term ? 10 : 4),
    enabled: activeSearch && !library, staleTime: 60_000,
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
    try {
      addFoods(savedMealDrafts(meal, multiplier));
    } catch (error) {
      setNotice(error instanceof DataError ? error.message : 'Couldn’t add this saved meal.');
    }
  }

  async function addRecent(choice: NonNullable<typeof recents.data>[number]) {
    if (loadingRecent) return;
    setLoadingRecent(true);
    try {
      if (choice.kind === 'snapshot' && choice.snapshot) {
        const food = recentSnapshotDraft(choice.snapshot);
        if (food) { addFoods([food]); return; }
      } else if (choice.kind === 'meal') {
        const meal = await loadMealEntry(userId, choice.id);
        if (meal) { addMeal(meal, choice.amount); return; }
      } else {
        const food = await loadFoodEntry(userId, choice.id);
        if (food && !food.food.archived_at) {
          const portion = preferences.data?.[`library:${choice.id}`];
          if (portion) addFoods([libraryDraft(food, portion)]);
          else addFoods([savedPortionDraft(food, choice.amount, choice.unit)]);
          return;
        }
      }
      setNotice('This recent food or meal is unavailable.');
    } catch {
      setNotice('Could not load this recent choice. Try again.');
    } finally {
      setLoadingRecent(false);
    }
  }

  function recentSnapshotDraft(snapshot: NonNullable<NonNullable<typeof recents.data>[number]['snapshot']>) {
    const food = snapshotDraft(snapshot);
    const catalogueId = snapshot.logging?.catalogueFoodId;
    const remembered = catalogueId ? preferences.data?.[`catalogue:${catalogueId}`] : undefined;
    return food && remembered && food.portions.some(({ unit }) => unit === remembered.unit)
      ? changeDraftPortion(food, remembered.amount, remembered.unit) : food;
  }

  const matchesSearch = (name: string, brand: string | null = null) => !term || choiceMatchScore(name, brand, term) >= 0;
  const recentChoices: Choice[] = (recents.data ?? []).filter((choice) => (!library || choice.kind !== 'meal') && library?.kind !== 'food' && matchesSearch(choice.name)).slice(0, 5).map((choice) => {
    const snapshot = choice.snapshot ? recentSnapshotDraft(choice.snapshot) : null;
    const remembered = choice.kind === 'food' ? preferences.data?.[`library:${choice.id}`] : undefined;
    const portion = snapshot ?? remembered ?? choice;
    return {
      key: `${choice.kind}:${choice.id}`, name: choice.name, detail: `Recently used · ${portion.amount} ${portion.unit}`,
      calories: snapshot ? portionValue(snapshot, CALORIES) : null,
      estimated: snapshot ? valueCertainty(snapshot, CALORIES) === 'estimated' : undefined,
      select: () => void addRecent(choice),
    };
  });
  const recentGroups: Choice[] = (recentMeals.data ?? []).flatMap((meal) => {
    const foods = recentMealDrafts(meal);
    if (foods.length < 2 || meals.data?.some(({ meal: saved }) => saved.id === meal.savedMealId)) return [];
    const total = mealMetric(foods, CALORIES);
    return [{ key: `recent-meal:${meal.key}`, name: recentMealName(foods), detail: `Recent meal · ${foods.length} foods`,
      calories: total.value, estimated: total.estimated, select: () => addFoods(foods) }];
  });
  const savedChoices: Choice[] = library?.kind === 'food' ? [] : [
    ...(personal.data ?? []).filter(({ food }) => matchesSearch(food.name, food.brand)).map((entry) => {
      const food = libraryDraft(entry, preferences.data?.[`library:${entry.food.id}`]);
      return {
        key: `food:${entry.food.id}`, name: food.name,
        detail: [entry.food.logging_variant_key ? 'Your version' : 'Saved food', food.brand, `${food.amount} ${food.unit}`].filter(Boolean).join(' · '),
        calories: portionValue(food, CALORIES), estimated: valueCertainty(food, CALORIES) === 'estimated', select: () => addFoods([food]),
      };
    }),
    ...(meals.data ?? []).map((entry) => {
      let foods: DraftFood[] = [];
      try { foods = savedMealDrafts(entry); } catch { /* The saved meal stays available for repair in Library. */ }
      const total = mealMetric(foods, CALORIES);
      const count = foods.length || entry.components.length;
      return { key: `meal:${entry.meal.id}`, name: entry.meal.name, detail: `Saved meal · ${count} ${count === 1 ? 'food' : 'foods'}`,
        calories: total.value, estimated: total.estimated, select: () => addMeal(entry) };
    }),
  ];
  const sharedChoices: Choice[] = (term.length >= 2 ? catalogue.data ?? [] : []).map((entry) => {
    const food = catalogueDraft(entry, fields, preferences.data?.[`catalogue:${entry.food_id}`]);
    return {
      key: `catalogue:${entry.food_id}`, name: food.name, detail: [food.brand, `${food.amount} ${food.unit}`].filter(Boolean).join(' · '),
      calories: portionValue(food, CALORIES), estimated: valueCertainty(food, CALORIES) === 'estimated', select: () => addFoods([food]),
    };
  });
  const resultMap = new Map<string, Choice>();
  for (const choice of [...recentGroups, ...recentChoices, ...savedChoices, ...sharedChoices]) {
    if (!resultMap.has(choice.key)) resultMap.set(choice.key, choice);
  }
  const results = search.trim() === term ? [...resultMap.values()] : [];
  const searching = search.trim() !== term || personal.isPending || !library && (meals.isPending || recentMeals.isPending) || term.length >= 2 && catalogue.isFetching;

  const activeFoods = blockMode ? [{ ...calorieBlock, name: calorieBlock.name.trim() || 'Calorie block' }] : foods;
  const calories = mealMetric(activeFoods, CALORIES);
  const scheduleValid = frequency === 'none' || (Number.isInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 365
    && (frequency === 'daily' || weekdays.length > 0) && (!endsOn || isValidLocalDate(endsOn) && endsOn >= date));
  const savingFood = library?.kind === 'food' || library?.kind === 'entry' && activeFoods.length === 1 && !name.trim();
  const libraryFood = savingFood && activeFoods.length === 1 ? activeFoods[0] : undefined;
  const canSave = state !== null && isValidLocalDate(date) && activeFoods.length > 0 && activeFoods.length <= MAX_ITEMS && activeFoods.every(validDraftFood)
    && (savingFood ? Boolean(libraryFood?.name.trim()) : library?.kind === 'entry' ? Boolean(name.trim() || activeFoods.length > 1)
      : library ? Boolean(name.trim()) : scheduleValid && (state === 'planned' && !blockMode || calories.complete) && (state !== 'eaten' || date <= today));
  const dirty = library ? (library.kind === 'food' ? foods !== initialDraft : name !== library.name || foods !== initialDraft) : existing
    ? foods !== initialDraft || calorieBlock !== initialBlock || section !== initialSection || state !== initialState || scope !== 'one'
    : (foods.length > 0 && (foods !== initialDraft || date !== initialDate || section !== initialSection || state !== initialState || frequency !== 'none'))
      || calorieBlock.name !== '' || basisValue(calorieBlock, CALORIES) !== null;
  const onDraftChange = library?.onDraftChange;
  useEffect(() => { onDraftChange?.(dirty || locked); }, [onDraftChange, dirty, locked]);
  const title = library?.kind === 'food' ? 'Add food' : library?.kind === 'entry' || library?.recentKey ? 'Add to Library' : library ? library.mealId ? 'Edit saved meal' : 'New saved meal'
    : attachFoods ? 'Add foods to calorie block' : series ? 'Edit repeating meal' : editingEntry ? blockMode ? 'Edit calories' : 'Edit meal' : blockMode ? 'Add calories' : 'Add a meal';
  const verb = library?.kind === 'entry' ? activeFoods.length === 0 ? 'Save to Library' : savingFood ? 'Save food' : 'Save meal'
    : savingFood ? 'Save food' : library ? library.mealId ? 'Save changes' : 'Save meal'
    : startEaten ? 'Log meal' : editingEntry ? 'Save changes' : state === 'planned' ? blockMode ? 'Plan calories' : 'Plan meal' : blockMode ? 'Log calories' : 'Log meal';

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

  function startSave(input: SaveInput) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    save.mutate(input);
  }

  function submit() {
    if (!state || !canSave || locked || (editingEntry && !dirty && !startEaten)) return;
    const input = {
      libraryName: library ? name.trim() || (library.kind === 'entry' ? recentMealName(activeFoods) : '') : undefined,
      libraryFood: libraryFood ? {
        catalogFoodId: libraryFood.details.catalogueFoodId,
        personallyAdjusted: libraryFood.remember,
        name: libraryFood.name.trim(), brand: libraryFood.brand,
        basisAmount: libraryFood.basis.basisAmount, basisUnit: libraryFood.basis.basisUnit,
        gramsPerServing: libraryFood.basis.gramsPerServing ?? null,
        defaultPortionAmount: Number(libraryFood.amount), defaultPortionUnit: libraryFood.unit,
        caloriesKcal: libraryFood.basis.caloriesKcal,
        nutrients: Object.fromEntries(Object.entries(libraryFood.basis.nutrients).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
      } : undefined,
      localDate: date, state, items: activeFoods.map((food) => {
        const savedFood = editingEntry && initialDraft.some(({ key }) => key === food.key);
        return prepareFood(library || savedFood ? { ...food, remember: false } : food, fields, section);
      }),
      replaceGroup: !series ? editingItems?.map(({ id, revision }) => ({ id, revision })) : undefined,
      recurrence: frequency === 'none' ? undefined : { frequency, interval: Number(interval), weekdays, endsOn: endsOn || undefined },
      seriesEdit: series?.series_id ? { id: series.series_id, revision: series.series_revision!, scope } : undefined,
    };
    lastRequest.current = nextIdempotentRequest(lastRequest.current, input, () => crypto.randomUUID());
    setSuggestions(false);
    startSave({ ...input, requestId: lastRequest.current.requestId });
  }

  function requestClose() {
    if (save.isPending) return;
    if (dirty || uncertainSave) {
      discardReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDiscardHost(content.current?.closest('dialog') ?? null);
    } else onClose();
  }

  function keepEditing() {
    setDiscardHost(null);
    discardReturnFocus.current?.focus({ preventScroll: true });
    discardReturnFocus.current = null;
  }

  const renderChoice = (choice: Choice) => <li key={choice.key}><button type="button" disabled={locked || loadingRecent} onClick={choice.select}>
    <span><strong>{choice.name}</strong><small>{choice.detail}</small></span>
    <span className="composer-result-facts">{choice.calories !== null && <Metric value={choice.calories} estimated={choice.estimated} unit="kcal" />}<Plus size={16} aria-hidden="true" /></span>
  </button></li>;
  return <>
    <Dialog open title={title} className={`logging-composer${foods.length === 0 && !library ? ' is-compact' : ''}`} closeDisabled={save.isPending} onClose={discardHost ? keepEditing : requestClose} controlledClose lightDismiss>
      <div className="composer-content" ref={content}>
        {library?.kind === 'meal' ? <div className="composer-library-name"><Field label="Meal name" id={`${id}-meal-name`}>
          <input id={`${id}-meal-name`} ref={mealNameInput} className="text-field" value={name} maxLength={160} disabled={locked}
            placeholder="e.g. Usual breakfast" onChange={(event) => setName(event.target.value)} />
        </Field></div> : library ? null : <div className="composer-toolbar">
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
                <Field id={`${id}-until`} label="End date"><input id={`${id}-until`} type="date" className="text-field" min={date} value={endsOn}
                  disabled={locked} onChange={(event) => setEndsOn(event.target.value)} /></Field>
              </>}
            </div>
          </details>
          <div className="choice-action-picker composer-state" role="group" aria-label="Entry state">
            {(['eaten', 'planned'] as const).map((value) => <label key={value}><input type="radio" name={`${id}-state`} checked={state === value}
              disabled={locked || (value === 'eaten' && date > today)} onChange={() => {
                setState(value);
                if (value === 'eaten') { setFrequency('none'); setScope('one'); }
              }} />{value === 'eaten' ? 'Eaten' : 'Planned'}</label>)}
          </div>
        </div>}
        {!blockMode && <div className="composer-search-area" ref={searchArea}
          onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setSuggestions(false); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && suggestions) { event.preventDefault(); searchInput.current?.focus(); setSuggestions(false); }
            if (event.key === 'ArrowDown' && event.target === searchInput.current) {
              const first = event.currentTarget.querySelector<HTMLButtonElement>('.composer-suggestions button:not(:disabled)');
              if (first) { event.preventDefault(); first.focus(); }
            }
          }}>
          <label className="library-search composer-search"><Plus size={18} aria-hidden="true" /><span className="visually-hidden">{library ? 'Add food' : 'Add food or a meal'}</span>
            <input ref={searchInput} type="search" placeholder={library ? 'Add food…' : 'Add food or a meal…'} aria-controls={suggestions ? `${id}-suggestions` : undefined} value={search} autoComplete="off"
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
            {(personal.isError || meals.isError || recentMeals.isError || catalogue.isError) && <p className="field-hint" role="status">Some search results couldn’t load.</p>}
            <ul aria-label={library?.kind === 'food' ? 'Food suggestions' : 'Food and meal suggestions'}>{results.map(renderChoice)}
              {search.trim() && <li><button type="button" disabled={locked || loadingRecent} onClick={() => addFoods([manualDraft(search.trim())])}><span><strong>Add “{search.trim()}”</strong><small>Enter calories yourself</small></span><Plus size={16} /></button></li>}
            </ul>
            {searching && <p className="field-hint" role="status">Searching…</p>}
            {!searching && !search.trim() && results.length === 0 && <p className="field-hint">Search for a food to get started.</p>}
          </div>}
        </div>}
        {library?.kind === 'entry' && showMealName && <div className="composer-library-name composer-library-name-editable">
          <Field label="Meal name" id={`${id}-meal-name`}><input id={`${id}-meal-name`} ref={mealNameInput} className="text-field" value={name} maxLength={160} disabled={locked}
            placeholder="e.g. Usual breakfast" onChange={(event) => setName(event.target.value)} /></Field>
          <button className="icon-button" type="button" aria-label="Remove meal name" disabled={locked} onClick={() => { setName(''); setShowMealName(false); }}><X size={16} /></button>
        </div>}
        {library?.kind === 'entry' && foods.length > 0 && !showMealName && <button className="composer-name-trigger" type="button" disabled={locked} onClick={() => setShowMealName(true)}><Tag size={15} aria-hidden="true" />Name meal</button>}
        {!library && !editingEntry && (blockMode || foods.length === 0) && <div className="composer-entry-shortcuts">
          <button className="composer-calorie-switch" type="button" disabled={locked} onClick={() => {
            setSuggestions(false); setBlockMode((mode) => !mode);
          }}>
            {blockMode ? <Plus size={16} aria-hidden="true" /> : <Calculator size={16} aria-hidden="true" />}
            {blockMode ? 'Add foods instead' : 'Calories only'}
          </button>
        </div>}
        <div className="composer-items">
          {blockMode ? <div className="composer-block-fields">
            <FoodValueInput food={calorieBlock} field={CALORIES} label="Calories (kcal)" disabled={locked} onChange={setCalorieBlock} />
            <Field id={`${id}-name`} label="Name"><input className="text-field" id={`${id}-name`} placeholder="e.g. Dinner out" maxLength={160}
              value={calorieBlock.name} disabled={locked} onChange={(event) => setCalorieBlock({ ...calorieBlock, name: event.target.value })} /></Field>
          </div> : <>
            <ol className="composer-food-list" ref={foodList}>{foods.map((food) => <ComposerFood key={food.key} food={food} fields={fields} displayed={displayed} editingMeal={editingEntry || Boolean(library)}
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
            <div className="composer-total"><span>{savingFood ? 'Food total' : `Meal total · ${foods.length} ${foods.length === 1 ? 'food' : 'foods'}`}</span>
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
          {activeFoods.length > 0 && !canSave && <small className="field-hint">{library?.kind === 'meal' && !name.trim() ? 'Enter a meal name.' : library?.kind === 'food' && !libraryFood?.name.trim() ? 'Enter a food name.' : state === null ? 'Choose Eaten or Planned for this meal.'
            : activeFoods.length > MAX_ITEMS ? 'A meal can contain up to 50 foods.'
            : !library && !calories.complete && (state === 'eaten' || blockMode) ? 'Enter calories before saving.' : 'Check the amounts and nutrition values.'}</small>}
          {save.isError && <StatusMessage tone="error">{uncertainSave ? 'The save could not be confirmed. Retry to finish the same request.' : save.error.message}</StatusMessage>}
          {series && state === 'planned' && <SeriesScopeSelect value={scope} onChange={setScope} disabled={locked} />}
          {!scheduleValid && <small className="field-error">Check the repeat interval, weekdays and end date.</small>}
          <div className="composer-footer-actions">
            {!library && <label className="composer-label"><span className="visually-hidden">Meal label</span><StyledSelect value={section} disabled={locked} onChange={(event) => setSection(event.target.value as MealLabel)}>
              {sectionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </StyledSelect></label>}
            <Button type="button" disabled={save.isPending || !uncertainSave && (!canSave || (editingEntry && !dirty && !startEaten))}
              onClick={() => uncertainSave ? startSave(uncertainSave) : submit()}>
              <Check size={16} aria-hidden="true" />{save.isPending ? 'Saving…' : uncertainSave ? 'Retry save' : verb}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
    {discardHost && createPortal(<div className="composer-discard-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); keepEditing(); } }}>
      <section ref={discardDialog} className="composer-discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-discard-title`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); keepEditing(); return; }
          if (event.key !== 'Tab') return;
          const focusable = [...(discardDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          if (!focusable.length) return;
          if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
        }}>
        <h2 id={`${id}-discard-title`}>{uncertainSave ? 'Save status unknown' : 'Close this draft?'}</h2>
        <p>{uncertainSave ? `Check your ${library ? 'Library' : 'Calendar'} before retrying.` : 'Unsaved changes will be discarded.'}</p>
        <div className="composer-discard-actions">
          <button ref={discardKeepEditing} className="secondary-button" type="button" onClick={keepEditing}>Keep editing</button>
          <button className="primary-button" type="button" onClick={onClose}>{uncertainSave ? 'Close draft' : 'Discard'}</button>
        </div>
      </section>
    </div>, discardHost)}
  </>;
}
