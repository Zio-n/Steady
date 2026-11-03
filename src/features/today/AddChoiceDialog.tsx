import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { BookMarked, Check, ChevronDown, Pencil, Search, Trash2 } from 'lucide-react';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { loadFoodEntry, loadFoodLibrary, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { nutrientsForUserFields, saveCatalogFoodCopy, searchCatalogFoods, type CatalogFoodSearchResult } from '../../data/repositories/catalogFoodRepository';
import { loadMealEntry, loadMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import { loadRecentChoices } from '../../data/repositories/dayRepository';
import { queryKeys } from '../../data/queryKeys';
import { loadFoodPortionPreferences, type PortionPreferenceKey } from '../../data/repositories/foodPortionPreferenceRepository';
import { calculateFoodPortion, convertFoodAmount } from '../../domain/foodNutrition.ts';
import { calculateMealNutrition } from '../../domain/mealNutrition.ts';
import { isPreviewableQuantity, isValidQuantity, QUANTITY_MAX, QUANTITY_MIN, QUANTITY_STEP } from '../../domain/numericLimits';
import { choiceMatchScore } from '../../domain/choiceSearch.ts';
import { OneOffFoodForm } from './OneOffFoodForm';
import { OneOffMealForm } from './OneOffMealForm';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { CalendarMealCard } from '../../ui/components/CalendarMealCard';
import { Field, NumericField } from '../../ui/components/Field';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { UnitSelect } from '../../ui/components/UnitPicker';
import { CatalogFoodCorrectionForm, type CatalogueFoodCorrection } from '../library/CatalogFoodCorrectionForm';

type Selection = { kind: 'food'; value: FoodWithNutrients } | { kind: 'meal'; value: SavedMeal };
type Result = Selection & { score: number };
function DraftHost({ calendar, host, children }: { calendar: boolean; host: HTMLElement | null; children: React.ReactNode }) {
  return calendar ? host ? createPortal(children, host) : null : children;
}
export type MealLabel = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unlabelled';
export type PreparedChoice = { kind: Selection['kind'] | 'one_off_food' | 'one_off_meal'; id: string; name: string; amount: number; unit: string; section: MealLabel; requestId?: string; snapshot?: Record<string, unknown>; measure?: { kind: 'weight' | 'volume'; value: number } | null; plannedItemId?: string; expectedItemRevision?: number };
type DraftItem = { key: string; choice: PreparedChoice; amount: string; unit: string; food?: FoodWithNutrients; meal?: SavedMeal; catalogueFood?: CatalogFoodSearchResult; editingDetails?: boolean };
type PortionDraft = { amount: string; unit: string };
type DraftNutrient = { value: number | null; complete: boolean };
type DraftNutrition = { ok: boolean; calories: number | null; canLog: boolean; nutrients: Record<string, DraftNutrient> };
const labels: Array<[Exclude<MealLabel, 'unlabelled'>, string]> = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
const quantityRangeHint = `Use ${QUANTITY_MIN}–${QUANTITY_MAX}, with up to 4 decimal places.`;
const number = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000 && absolute < 100_000_000) {
    const compact = Math.floor(absolute / 10_000) / 100;
    return `${value < 0 ? '−' : ''}${compact.toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: absolute >= 100_000_000 ? 'compact' : 'standard' }).format(value);
};
function cataloguePortions(food: CatalogFoodSearchResult) {
  return food.portions ?? (food.default_portion?.is_named ? [food.default_portion] : []);
}
function catalogueBasis(food: CatalogFoodSearchResult, fields: NutrientField[], unit = food.basis_unit) {
  const portion = cataloguePortions(food).find((candidate) => candidate.unit.toLocaleLowerCase() === unit.trim().toLocaleLowerCase());
  const sourceNutrients = nutrientsForUserFields(food, fields);
  const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
  const basisAmountPerUnit = basisUnit === 'g' || basisUnit === 'kg'
    ? portion?.grams_per_unit
    : basisUnit === 'ml' || basisUnit === 'l' ? portion?.millilitres_per_unit : null;
  if (basisAmountPerUnit == null) return {
    basisAmount: food.basis_amount, basisUnit: food.basis_unit, gramsPerServing: null,
    caloriesKcal: food.calories_kcal, nutrients: sourceNutrients,
  };
  return {
    basisAmount: food.basis_amount, basisUnit: food.basis_unit, gramsPerServing: basisAmountPerUnit, servingUnit: unit,
    caloriesKcal: food.calories_kcal, nutrients: sourceNutrients,
  };
}
function savedFoodBasis(food: FoodWithNutrients['food'], nutrients: Record<string, number | null>) {
  return {
    basisAmount: food.basis_amount, basisUnit: food.basis_unit,
    gramsPerServing: food.grams_per_serving, servingUnit: food.default_portion_unit,
    caloriesKcal: food.calories_kcal, nutrients,
  };
}
function portionCountLabel(amount: string, unit: string) {
  const count = Number(amount);
  const normalized = unit.trim();
  const fixedUnits = new Set(['g', 'kg', 'mg', 'mcg', 'ml', 'l']);
  const displayedUnit = count <= 1 || fixedUnits.has(normalized) ? normalized
    : normalized.endsWith('y') ? `${normalized.slice(0, -1)}ies`
      : `${normalized}${normalized.endsWith('s') ? '' : 's'}`;
  return `${amount} ${displayedUnit}`;
}
const massFactors: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, mg: 0.001, milligram: 0.001, milligrams: 0.001, mcg: 0.000001, ug: 0.000001 };
const volumeFactors: Record<string, number> = { ml: 1, millilitre: 1, millilitres: 1, milliliter: 1, milliliters: 1, l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000 };
function cataloguePortionOptions(food: CatalogFoodSearchResult, amount?: string, unit?: string) {
  const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
  const standardUnits = basisUnit === 'g' || basisUnit === 'kg' ? ['g', 'kg', 'mg', 'mcg']
    : basisUnit === 'ml' || basisUnit === 'l' ? ['ml', 'l'] : [food.basis_unit];
  const options = [...new Set([...standardUnits, ...cataloguePortions(food).map((portion) => portion.unit)])];
  return amount !== undefined && unit !== undefined
    ? options.filter((nextUnit) => isValidQuantity(convertCataloguePortionAmount(food, amount, unit, nextUnit)))
    : options;
}
function cataloguePortionFactor(food: CatalogFoodSearchResult, unit: string): number | null {
  const normalized = unit.trim().toLocaleLowerCase();
  const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
  const standard = (basisUnit === 'g' || basisUnit === 'kg' ? massFactors : basisUnit === 'ml' || basisUnit === 'l' ? volumeFactors : {})[normalized];
  if (standard !== undefined) return standard;
  const portion = cataloguePortions(food).find((candidate) => candidate.unit.toLocaleLowerCase() === normalized);
  return basisUnit === 'g' || basisUnit === 'kg' ? portion?.grams_per_unit ?? null
    : basisUnit === 'ml' || basisUnit === 'l' ? portion?.millilitres_per_unit ?? null : null;
}
function convertCataloguePortionAmount(food: CatalogFoodSearchResult, amount: string, fromUnit: string, toUnit: string) {
  if (fromUnit === toUnit) return amount;
  const fromFactor = cataloguePortionFactor(food, fromUnit);
  const toFactor = cataloguePortionFactor(food, toUnit);
  if (fromFactor == null || toFactor == null || toFactor <= 0) return amount;
  return String(Number(amount) * fromFactor / toFactor);
}
function savedFoodPortionOptions(food: FoodWithNutrients['food'], amount?: string, unit?: string) {
  const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
  const isMass = Object.hasOwn(massFactors, basisUnit);
  const isVolume = Object.hasOwn(volumeFactors, basisUnit);
  const standardUnits = isMass ? ['g', 'kg', 'mg', 'mcg'] : isVolume ? ['ml', 'l'] : [food.basis_unit];
  const servingUnit = food.grams_per_serving != null && isMass ? [food.default_portion_unit] : [];
  const options = [...new Set([...standardUnits, ...servingUnit])];
  return amount !== undefined && unit !== undefined
    ? options.filter((nextUnit) => isValidQuantity(convertSavedFoodPortionAmount(food, amount, unit, nextUnit)))
    : options;
}
function savedFoodPortionFactor(food: FoodWithNutrients['food'], unit: string): number | null {
  const normalized = unit.trim().toLocaleLowerCase();
  const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
  if (Object.hasOwn(massFactors, basisUnit)) {
    const standard = massFactors[normalized];
    if (standard !== undefined) return standard;
    if (food.grams_per_serving != null && normalized === food.default_portion_unit.trim().toLocaleLowerCase()) return food.grams_per_serving;
  }
  if (Object.hasOwn(volumeFactors, basisUnit)) return volumeFactors[normalized] ?? null;
  return normalized === basisUnit ? 1 : null;
}
function convertSavedFoodPortionAmount(food: FoodWithNutrients['food'], amount: string, fromUnit: string, toUnit: string) {
  if (fromUnit === toUnit) return amount;
  const fromFactor = savedFoodPortionFactor(food, fromUnit);
  const toFactor = savedFoodPortionFactor(food, toUnit);
  return fromFactor == null || toFactor == null || toFactor <= 0 ? amount : String(Number(amount) * fromFactor / toFactor);
}
function mealNutrition(entry: SavedMeal, fields: NutrientField[], multiplier = 1) {
  return calculateMealNutrition(entry.components.map((component) => ({
    foodId: component.food_id,
    food: component.food ? {
      basisAmount: component.food.basis_amount, basisUnit: component.food.basis_unit,
      gramsPerServing: component.food.grams_per_serving, servingUnit: component.food.default_portion_unit, caloriesKcal: component.food.calories_kcal,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, component.nutrients[field.field_id] ?? null])),
    } : null,
    amount: component.amount, unit: component.unit,
  })), fields.map((field) => field.field_id), multiplier);
}

export function AddChoiceDialog({ open, userId, fields, futureDate, onClose, onPrepared, onSavedOnly, initialSection = 'unlabelled', dialogTitle, submitLabel, actionMode, onActionModeChange, dateLabel, anchor, draftHost = null, onDraftCountChange, onResumeSearch, onDiscardDraft }: {
  open: boolean; userId: string; fields: NutrientField[]; futureDate: boolean;
  initialSection?: MealLabel; dialogTitle?: string; submitLabel?: string;
  actionMode?: 'log' | 'plan'; onActionModeChange?: (action: 'log' | 'plan') => void;
  dateLabel?: string; anchor?: { left: number; top: number; width: number } | null;
  draftHost?: HTMLElement | null; onDraftCountChange?: (count: number) => void; onResumeSearch?: () => void; onDiscardDraft?: () => void;
  onClose: () => void; onPrepared: (choice: PreparedChoice | PreparedChoice[]) => void;
  onSavedOnly?: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draftDetailHost, setDraftDetailHost] = useState<HTMLDivElement | null>(null);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueSelection, setCatalogueSelection] = useState<CatalogFoodSearchResult | null>(null);
  const [selectedCatalogueFood, setSelectedCatalogueFood] = useState<CatalogFoodSearchResult | null>(null);
  const [catalogueError, setCatalogueError] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftItemsCollapsed, setDraftItemsCollapsed] = useState(false);
  const [resultPortions, setResultPortions] = useState<Record<string, PortionDraft>>({});
  const [editingResultPortionKey, setEditingResultPortionKey] = useState<string | null>(null);
  const editingPortionOriginal = useRef<{ key: string; portion: PortionDraft } | null>(null);
  const [newMode, setNewMode] = useState<'item' | 'ingredients' | null>(null);
  const [newDirty, setNewDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmIngredientSwitch, setConfirmIngredientSwitch] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [section, setSection] = useState<MealLabel>(initialSection);
  const [labelOpen, setLabelOpen] = useState(initialSection !== 'unlabelled');
  const [recentLoadingId, setRecentLoadingId] = useState('');
  const [recentError, setRecentError] = useState('');
  const [recentOrigin, setRecentOrigin] = useState<{ amount: number; unit: string } | null>(null);
  const catalogueCopyRequests = useRef(new Map<string, { signature: string; requestId: string }>());
  const activeWrites = useIsMutating();
  const controlId = useId();
  useEffect(() => {
    if (!dateLabel || !open) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.meal-log-composer .choice-search input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [dateLabel, open]);
  useEffect(() => { onDraftCountChange?.(draftItems.length); }, [draftItems.length, onDraftCountChange]);
  const recents = useQuery({ queryKey: queryKeys.recentChoices(userId), queryFn: () => loadRecentChoices(userId), enabled: open, staleTime: 60_000 });
  const portionPreferences = useQuery({
    queryKey: queryKeys.foodPortionPreferences(userId),
    queryFn: () => loadFoodPortionPreferences(userId),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const foods = useQuery({
    queryKey: [...queryKeys.foods(userId), 'log-picker', catalogueQuery || 'recent'],
    queryFn: async () => (await loadFoodLibrary(userId, catalogueQuery, 0, catalogueQuery ? 50 : 12, catalogueQuery ? 'name' : 'recent')).entries,
    enabled: open, staleTime: 60_000,
  });
  const meals = useQuery({
    queryKey: [...queryKeys.mealLibrary(userId, catalogueQuery), 'log-picker', catalogueQuery || 'recent'],
    queryFn: () => loadMeals(userId, catalogueQuery, catalogueQuery ? 50 : 12, catalogueQuery ? 'name' : 'recent'),
    enabled: open, staleTime: 60_000,
  });
  const catalogueLocale = typeof navigator === 'undefined' ? null : navigator.language || null;
  function handleDialogClose() {
    setResultPortions({});
    setEditingResultPortionKey(null);
    editingPortionOriginal.current = null;
    onClose();
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => setCatalogueQuery(search.trim()), 120);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const catalogue = useQuery({
    queryKey: queryKeys.catalogFoodSearch(catalogueQuery, catalogueLocale),
    queryFn: () => searchCatalogFoods(catalogueQuery, catalogueLocale, 20),
    enabled: open && !selection && !catalogueSelection && !newMode && !selectedCatalogueFood && catalogueQuery.length >= 2,
    staleTime: 60_000,
  });
  const addCatalogueFood = useMutation({
    mutationFn: async ({ food, correction }: { food: CatalogFoodSearchResult; correction: CatalogueFoodCorrection }) => {
      const input = {
        catalogFoodId: food.food_id,
        name: correction.name,
        brand: food.brand,
        basisAmount: correction.basisAmount,
        basisUnit: food.basis_unit,
        defaultPortionAmount: correction.basisAmount,
        defaultPortionUnit: food.basis_unit,
        caloriesKcal: correction.caloriesKcal,
        nutrients: correction.nutrients,
        isPersonallyAdjusted: correction.isPersonallyAdjusted,
      };
      const signature = JSON.stringify(input);
      const previous = catalogueCopyRequests.current.get(food.food_id);
      const requestId = previous?.signature === signature ? previous.requestId : crypto.randomUUID();
      catalogueCopyRequests.current.set(food.food_id, { signature, requestId });
      const result = await saveCatalogFoodCopy({ ...input, requestId });
      const id = result && typeof result === 'object' && !Array.isArray(result) && 'id' in result ? result.id : null;
      if (typeof id !== 'string') throw new Error('Missing private food ID');
      const entry = await loadFoodEntry(userId, id);
      if (!entry) throw new Error('Saved private food was not returned');
      return { entry, catalogFoodId: food.food_id };
    },
    onSuccess: async ({ entry, catalogFoodId }) => {
      catalogueCopyRequests.current.delete(catalogFoodId);
      setCatalogueError('');
      setSelectedCatalogueFood(null);
      setCatalogueSelection(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.foods(userId) });
      choose({ kind: 'food', value: entry });
    },
    onError: () => setCatalogueError('We couldn’t add that catalogue food. Your log or plan is unchanged; try again.'),
  });
  const results = useMemo(() => {
    if (!search.trim()) return [] as Result[];
    const foodMatches: Result[] = (foods.data ?? []).map((value) => ({ kind: 'food', value, score: choiceMatchScore(value.food.name, value.food.brand, search) }));
    const mealMatches: Result[] = (meals.data ?? []).map((value) => ({ kind: 'meal', value, score: choiceMatchScore(value.meal.name, null, search) }));
    return [...foodMatches, ...mealMatches].filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || (a.kind === 'food' ? a.value.food.name : a.value.meal.name).localeCompare(b.kind === 'food' ? b.value.food.name : b.value.meal.name)).slice(0, 50);
  }, [foods.data, meals.data, search]);
  const unifiedSearchResults = useMemo(() => {
    const saved = (catalogueQuery === search.trim() ? results : []).map((result) => ({ kind: 'saved' as const, result, score: result.score,
      key: 'library-' + result.kind + '-' + (result.kind === 'food' ? result.value.food.id : result.value.meal.id),
      name: result.kind === 'food' ? result.value.food.name : result.value.meal.name }));
    const shared = (catalogueQuery === search.trim() ? catalogue.data ?? [] : []).map((food) => ({ kind: 'catalogue' as const, food,
      score: choiceMatchScore(food.name, food.brand, search), key: 'catalogue-' + food.food_id, name: food.name }));
    return [...saved, ...shared].filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [results, catalogue.data, catalogueQuery, search]);
  const recentlyAdded = useMemo(() => {
    const recentKeys = new Set((recents.data ?? []).map((choice) => `${choice.kind}:${choice.id}`));
    return [
      ...(foods.data ?? []).filter((entry) => !recentKeys.has(`food:${entry.food.id}`)).map((value) => ({ kind: 'food' as const, value })),
      ...(meals.data ?? []).filter((entry) => !recentKeys.has(`meal:${entry.meal.id}`)).map((value) => ({ kind: 'meal' as const, value })),
    ].sort((a, b) => (b.kind === 'food' ? b.value.food.created_at : b.value.meal.created_at)
      .localeCompare(a.kind === 'food' ? a.value.food.created_at : a.value.meal.created_at)).slice(0, 8);
  }, [foods.data, meals.data, recents.data]);
  const nutrition = useMemo(() => {
    if (catalogueSelection) return { kind: 'food' as const, result: calculateFoodPortion(
      catalogueBasis(catalogueSelection, fields, unit), Number(amount), unit,
    ) };
    if (!selection) return null;
    if (selection.kind === 'meal') return { kind: 'meal' as const, result: mealNutrition(selection.value, fields, Number(amount)) };
    const food = selection.value.food;
    return { kind: 'food' as const, result: calculateFoodPortion(savedFoodBasis(food,
      Object.fromEntries(fields.map((field) => [field.field_id, selection.value.nutrients[field.field_id] ?? null]))), Number(amount), unit) };
  }, [selection, catalogueSelection, fields, amount, unit]);
  function catalogueChoice(food: CatalogFoodSearchResult, selectedAmount = food.default_portion?.amount ?? food.basis_amount, selectedUnit = food.default_portion?.unit ?? food.basis_unit): PreparedChoice {
    const basis = catalogueBasis(food, fields, selectedUnit);
    return {
      kind: 'one_off_food', id: '', name: food.name, amount: selectedAmount, unit: selectedUnit, section,
      requestId: crypto.randomUUID(),
      snapshot: {
        basisAmount: basis.basisAmount, basisUnit: basis.basisUnit, caloriesKcal: basis.caloriesKcal,
        nutrients: basis.nutrients, gramsPerServing: basis.gramsPerServing, servingUnit: basis.servingUnit,
        catalogueFoodId: food.food_id, brand: food.brand,
      },
    };
  }
  function defaultResultPortion(result: Selection): PortionDraft {
    return result.kind === 'food'
      ? { amount: String(result.value.food.default_portion_amount), unit: result.value.food.default_portion_unit }
      : { amount: '1', unit: 'serving' };
  }
  function getResultPortion(key: string, result: Selection): PortionDraft {
    const preferenceKey = result.kind === 'food' ? `library:${result.value.food.id}` as PortionPreferenceKey : null;
    const savedPreference = preferenceKey ? portionPreferences.data?.[preferenceKey] : undefined;
    const validPreference = savedPreference && result.kind === 'food' && canAddSavedPortion(result, savedPreference) ? savedPreference : undefined;
    return resultPortions[key] ?? validPreference ?? defaultResultPortion(result);
  }
  function beginPortionEdit(key: string, portion: PortionDraft) {
    editingPortionOriginal.current = { key, portion: { ...portion } };
    setEditingResultPortionKey(key);
  }
  function cancelPortionEdit(key: string) {
    const original = editingPortionOriginal.current;
    if (!original || original.key !== key) return;
    setResultPortions((current) => ({ ...current, [key]: original.portion }));
    editingPortionOriginal.current = null;
    setEditingResultPortionKey(null);
  }
  function finishPortionEdit() {
    editingPortionOriginal.current = null;
    setEditingResultPortionKey(null);
  }
  function updateResultPortion(key: string, changes: Partial<PortionDraft>, result: Selection) {
    const fallback = getResultPortion(key, result);
    setResultPortions((current) => ({ ...current, [key]: { ...(current[key] ?? fallback), ...changes } }));
  }
  function canAddSavedPortion(result: Selection, portion: PortionDraft) {
    if (!isValidQuantity(portion.amount) || !portion.unit.trim()) return false;
    if (result.kind === 'meal') return portion.unit === 'serving';
    const food = result.value.food;
    return calculateFoodPortion(savedFoodBasis(food, {}), Number(portion.amount), portion.unit).ok;
  }
  function canAddCataloguePortion(food: CatalogFoodSearchResult, portion: PortionDraft) {
    if (!isValidQuantity(portion.amount) || !portion.unit.trim()) return false;
    return calculateFoodPortion(catalogueBasis(food, fields, portion.unit), Number(portion.amount), portion.unit).ok;
  }
  function stageSaved(result: Selection, portion = defaultResultPortion(result)) {
    if (draftItems.length >= 50) return;
    if (!canAddSavedPortion(result, portion)) return;
    setDraftItemsCollapsed(true);
    if (result.kind === 'food') {
      const food = result.value;
      const choice: PreparedChoice = { kind: 'food', id: food.food.id, name: food.food.name, amount: Number(portion.amount), unit: portion.unit, section, requestId: crypto.randomUUID() };
      setDraftItems((current) => [...current, { key: crypto.randomUUID(), choice, amount: String(choice.amount), unit: choice.unit, food }]);
    } else {
      const choice: PreparedChoice = { kind: 'meal', id: result.value.meal.id, name: result.value.meal.name, amount: Number(portion.amount), unit: 'serving', section, requestId: crypto.randomUUID() };
      setDraftItems((current) => [...current, { key: crypto.randomUUID(), choice, amount: portion.amount, unit: 'serving', meal: result.value }]);
    }
  }
  function stageCatalogue(food: CatalogFoodSearchResult, portion: PortionDraft = food.default_portion
    ? { amount: String(food.default_portion.amount), unit: food.default_portion.unit }
    : { amount: String(food.basis_amount), unit: food.basis_unit }) {
    if (draftItems.length >= 50) return;
    if (!canAddCataloguePortion(food, portion)) return;
    setDraftItemsCollapsed(true);
    const choice = catalogueChoice(food, Number(portion.amount), portion.unit);
    setDraftItems((current) => [...current, { key: crypto.randomUUID(), choice, amount: String(choice.amount), unit: choice.unit, catalogueFood: food }]);
  }
  function updateDraftItem(key: string, changes: { amount?: string; unit?: string }) {
    setDraftItems((current) => current.map((item) => {
      if (item.key !== key) return item;
      const nextAmount = changes.amount ?? (changes.unit && item.catalogueFood
        ? convertCataloguePortionAmount(item.catalogueFood, item.amount, item.unit, changes.unit)
        : changes.unit && item.food ? convertSavedFoodPortionAmount(item.food.food, item.amount, item.unit, changes.unit)
          : item.amount);
      const nextUnit = changes.unit ?? item.unit;
      const snapshot = item.catalogueFood && changes.unit
        ? { ...(item.choice.snapshot ?? {}), gramsPerServing: catalogueBasis(item.catalogueFood, fields, nextUnit).gramsPerServing, servingUnit: catalogueBasis(item.catalogueFood, fields, nextUnit).servingUnit }
        : item.choice.snapshot;
      return { ...item, amount: nextAmount, unit: nextUnit, choice: { ...item.choice, amount: Number(nextAmount), unit: nextUnit, snapshot, requestId: crypto.randomUUID() } };
    }));
  }
  function originalDraftNutrition(item: DraftItem) {
    if (item.meal) return null;
    if (item.food) return {
      ...savedFoodBasis(item.food.food, Object.fromEntries(fields.map((field) => [field.field_id, item.food!.nutrients[field.field_id] ?? null]))),
    };
    if (item.catalogueFood) return {
      ...catalogueBasis(item.catalogueFood, fields, item.unit),
    };
    return null;
  }
  function startDraftDetailsEdit(item: DraftItem) {
    const original = originalDraftNutrition(item);
    const prior = item.choice.snapshot;
    const source = prior ? {
      basisAmount: Number(prior.basisAmount), basisUnit: String(prior.basisUnit),
      gramsPerServing: typeof prior.gramsPerServing === 'number' ? prior.gramsPerServing : null,
      servingUnit: typeof prior.servingUnit === 'string' ? prior.servingUnit : null,
      caloriesKcal: typeof prior.caloriesKcal === 'number' ? prior.caloriesKcal : null,
      nutrients: (prior.nutrients ?? {}) as Record<string, number | null>,
    } : original;
    if (!source) return;
    const snapshot = {
      basisAmount: source.basisAmount, basisUnit: source.basisUnit, caloriesKcal: source.caloriesKcal,
      gramsPerServing: source.gramsPerServing, servingUnit: source.servingUnit,
      nutrients: Object.fromEntries(fields.map((field) => [field.field_id, source.nutrients[field.field_id] ?? null])),
      catalogueFoodId: item.catalogueFood?.food_id,
    };
    setDraftItems((items) => items.map((entry) => entry.key === item.key ? {
      ...entry, editingDetails: true,
      choice: { ...entry.choice, kind: 'one_off_food', snapshot },
    } : entry));
  }
  function updateDraftFoodDetail(item: DraftItem, field: 'name' | 'caloriesKcal' | string, value: string) {
    const snapshot = item.choice.snapshot ?? {};
    if (field === 'name') {
      setDraftItems((items) => items.map((entry) => entry.key === item.key ? {
        ...entry, choice: { ...entry.choice, kind: 'one_off_food', name: value, snapshot: { ...snapshot, name: value } },
      } : entry));
      return;
    }
    const nutrients = (snapshot.nutrients && typeof snapshot.nutrients === 'object' ? snapshot.nutrients : {}) as Record<string, number | null>;
    const parsed = value.trim() === '' ? null : Number(value);
    const nextSnapshot = field === 'caloriesKcal'
      ? { ...snapshot, caloriesKcal: parsed }
      : { ...snapshot, nutrients: { ...nutrients, [field]: parsed } };
    setDraftItems((items) => items.map((entry) => entry.key === item.key ? {
      ...entry, choice: { ...entry.choice, kind: 'one_off_food', snapshot: nextSnapshot },
    } : entry));
  }
  function draftNutrition(item: DraftItem) {
    if (item.meal) {
      const result = mealNutrition(item.meal, fields, Number(item.amount));
      const nutrition = result.ok ? result.nutrition : null;
      const nutrients = Object.fromEntries(fields.map((field) => {
        const metric = nutrition?.nutrients[field.field_id];
        return [field.field_id, { value: metric?.value ?? null, complete: metric?.complete ?? false }];
      }));
      return { ok: result.ok, calories: nutrition?.calories.value ?? null, canLog: Boolean(nutrition?.canLog), nutrients } satisfies DraftNutrition;
    }
    const source = item.choice.snapshot ? {
      basisAmount: Number(item.choice.snapshot.basisAmount),
      basisUnit: String(item.choice.snapshot.basisUnit),
      gramsPerServing: typeof item.choice.snapshot.gramsPerServing === 'number' ? item.choice.snapshot.gramsPerServing : null,
      servingUnit: typeof item.choice.snapshot.servingUnit === 'string' ? item.choice.snapshot.servingUnit : null,
      caloriesKcal: typeof item.choice.snapshot.caloriesKcal === 'number' ? item.choice.snapshot.caloriesKcal : null,
      nutrients: (item.choice.snapshot.nutrients ?? {}) as Record<string, number | null>,
    } : item.food ? {
      ...savedFoodBasis(item.food.food, Object.fromEntries(fields.map((field) => [field.field_id, item.food!.nutrients[field.field_id] ?? null]))),
    } : item.catalogueFood ? {
      basisAmount: item.catalogueFood.basis_amount, basisUnit: item.catalogueFood.basis_unit, gramsPerServing: null,
      caloriesKcal: item.catalogueFood.calories_kcal, nutrients: nutrientsForUserFields(item.catalogueFood, fields),
    } : null;
    if (!source) return { ok: false, calories: null, canLog: false, nutrients: Object.fromEntries(fields.map((field) => [field.field_id, { value: null, complete: false }])) } satisfies DraftNutrition;
    const result = calculateFoodPortion(source, Number(item.amount), item.unit);
    const nutrients = Object.fromEntries(fields.map((field) => {
      const value = result.ok ? result.nutrients[field.field_id] ?? null : null;
      return [field.field_id, { value, complete: value !== null }];
    }));
    return { ok: result.ok, calories: result.ok ? result.caloriesKcal : null, canLog: result.ok && result.canLog, nutrients } satisfies DraftNutrition;
  }
  function draftMeasure(item: DraftItem): { kind: 'weight' | 'volume'; value: number } | null {
    if (!isValidQuantity(item.amount)) return null;
    if (item.meal) {
      const weight = item.meal.meal.declared_total_weight_g;
      return weight && weight > 0 ? { kind: 'weight', value: weight * Number(item.amount) } : null;
    }
    const source = item.choice.snapshot ? {
      basisUnit: String(item.choice.snapshot.basisUnit ?? ''),
      gramsPerServing: typeof item.choice.snapshot.gramsPerServing === 'number' ? item.choice.snapshot.gramsPerServing : null,
      servingUnit: typeof item.choice.snapshot.servingUnit === 'string' ? item.choice.snapshot.servingUnit : null,
    } : originalDraftNutrition(item);
    if (!source) return null;
    const basisUnit = source.basisUnit.trim().toLocaleLowerCase();
    const kind = Object.hasOwn(massFactors, basisUnit) ? 'weight' : Object.hasOwn(volumeFactors, basisUnit) ? 'volume' : null;
    if (!kind) return null;
    const targetUnit = kind === 'weight' ? 'g' : 'ml';
    let value = convertFoodAmount(Number(item.amount), item.unit, targetUnit, source.gramsPerServing);
    if (value === null && source.servingUnit?.trim().toLocaleLowerCase() === item.unit.trim().toLocaleLowerCase()) {
      value = convertFoodAmount(Number(item.amount), 'serving', targetUnit, source.gramsPerServing);
    }
    return value !== null && Number.isFinite(value) ? { kind, value } : null;
  }
  const draftNutritionValues = draftItems.map((item) => draftNutrition(item));
  const draftCaloriesComplete = draftNutritionValues.every((value) => value.ok && value.calories !== null);
  const draftHasKnownCalories = draftNutritionValues.some((value) => value.calories !== null);
  const draftCaloriesTotal = draftNutritionValues.reduce((total, value) => total + (value.calories ?? 0), 0);
  const draftNutrientTotals = fields.map((field) => {
    const values = draftNutritionValues.map((nutrition) => nutrition.nutrients[field.field_id] ?? { value: null, complete: false });
    const knownValues = values.flatMap((entry) => entry.value === null ? [] : [entry.value]);
    return { field, value: knownValues.length ? knownValues.reduce((sum, value) => sum + value, 0) : null, complete: values.every((entry) => entry.complete) };
  });
  const primaryDraftNutrients = ['protein', 'carbohydrate', 'fat'].flatMap((key) => draftNutrientTotals.filter(({ field }) => field.standard_key === key));
  const draftMeasures = draftItems.map(draftMeasure);
  const allDraftMeasuresKnown = draftMeasures.every((measure) => measure !== null);
  const totalWeight = allDraftMeasuresKnown ? draftMeasures.reduce((sum, measure) => sum + (measure?.kind === 'weight' ? measure.value : 0), 0) : 0;
  const totalVolume = allDraftMeasuresKnown ? draftMeasures.reduce((sum, measure) => sum + (measure?.kind === 'volume' ? measure.value : 0), 0) : 0;
  const draftCanSubmit = draftItems.length > 0 && draftItems.every((item) => isValidQuantity(item.amount))
    && draftItems.every((item) => item.choice.name.trim().length > 0 && item.choice.name.length <= 160)
    && draftNutritionValues.every((value) => value.ok && (futureDate || value.canLog));
  const allowMultiAdd = !submitLabel;
  const proteinField = fields.find((field) => field.standard_key === 'protein');
  const reviewFields = fields.filter((field) => field.is_displayed);
  const canUse = Boolean(isValidQuantity(amount) && (selection || catalogueSelection) && nutrition?.result.ok
    && !(selection?.kind === 'meal' && selection.value.components.some((component) => component.food?.archived_at))
    && (futureDate || (nutrition.kind === 'food' ? nutrition.result.canLog : nutrition.result.nutrition.canLog)));
  const height = Math.min(400, window.innerHeight * .72);
  const composerStyle = anchor ? {
    '--composer-left': Math.max(12, anchor.left) + 'px',
    '--composer-width': Math.min(anchor.width, window.innerWidth - Math.max(12, anchor.left) - 12) + 'px',
    '--composer-top': (anchor.top + height <= window.innerHeight - 12 ? anchor.top : Math.max(12, (window.innerHeight - height) / 2)) + 'px',
  } as CSSProperties : undefined;
  function choose(result: Selection, key?: string) {
    setCatalogueSelection(null); setSelectedCatalogueFood(null);
    setSelection(result); setNewMode(null); setRecentOrigin(null);
    if (result.kind === 'food') {
      const portion = key ? getResultPortion(key, result) : defaultResultPortion(result);
      setAmount(portion.amount); setUnit(portion.unit);
    }
    else { setAmount('1'); setUnit('serving'); }
  }
  async function chooseRecent(choice: NonNullable<typeof recents.data>[number]) {
    setRecentLoadingId(choice.id); setRecentError('');
    try {
      if (choice.kind === 'food') {
        const value = await loadFoodEntry(userId, choice.id);
        if (!value) throw new Error('Unavailable');
        choose({ kind: 'food', value });
      } else {
        const value = await loadMealEntry(userId, choice.id);
        if (!value) throw new Error('Unavailable');
        choose({ kind: 'meal', value });
      }
      setAmount(String(choice.amount)); setUnit(choice.unit);
      setRecentOrigin({ amount: choice.amount, unit: choice.unit });
    } catch { setRecentError('This recent choice is no longer available. Search for another meal.'); }
    finally { setRecentLoadingId(''); }
  }
  function returnToSearch() {
    if (newDirty || activeWrites > 0) { setConfirmDiscard(true); return; }
    setNewMode(null); setSelection(null); setCatalogueSelection(null); setSelectedCatalogueFood(null);
  }
  function applyCatalogueSelection() {
    if (!catalogueSelection || !foodResult?.ok) return;
    onPrepared(catalogueChoice(catalogueSelection, Number(amount), unit));
  }
  function changeReviewUnit(nextUnit: string) {
    const nextAmount = catalogueSelection
      ? convertCataloguePortionAmount(catalogueSelection, amount, unit, nextUnit)
      : selection?.kind === 'food'
        ? convertSavedFoodPortionAmount(selection.value.food, amount, unit, nextUnit)
        : amount;
    setAmount(nextAmount);
    setUnit(nextUnit);
  }
  function submitDraftMeal() {
    if (!draftCanSubmit) return;
    onPrepared(draftItems.map((item) => ({ ...item.choice, amount: Number(item.amount), unit: item.unit, section, measure: draftMeasure(item), requestId: item.choice.requestId ?? crypto.randomUUID() })));
  }
  function resultRow(result: Selection, key: string, showLibraryBadge = true) {
    const name = result.kind === 'food' ? result.value.food.name : result.value.meal.name;
    const portion = getResultPortion(key, result);
    const amountValid = isPreviewableQuantity(portion.amount);
    const storableAmount = isValidQuantity(portion.amount);
    const preview = result.kind === 'meal' && amountValid ? mealNutrition(result.value, fields, Number(portion.amount)) : null;
    const foodPreview = result.kind === 'food' && amountValid ? calculateFoodPortion(savedFoodBasis(result.value.food, result.value.nutrients), Number(portion.amount), portion.unit) : null;
    const calories = result.kind === 'food' ? foodPreview?.ok ? foodPreview.caloriesKcal : null : preview?.ok ? preview.nutrition.calories.value : null;
    const protein = result.kind === 'food' ? proteinField && foodPreview?.ok ? foodPreview.nutrients[proteinField.field_id] : null
      : preview?.ok && proteinField ? preview.nutrition.nutrients[proteinField.field_id]?.value : null;
    const basis = result.kind === 'food' ? result.value.food.brand : result.value.components.length + ' foods';
    const portionFact = allowMultiAdd ? editingResultPortionKey === key
      ? <span className="choice-result-portion-editor" onBlur={(event) => { const next = event.relatedTarget as Node | null; if (!next || !event.currentTarget.contains(next)) cancelPortionEdit(key); }}><NumericField id={`result-amount-${key}`} label={result.kind === 'meal' ? 'Servings' : 'Amount'} autoFocus min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={portion.amount} aria-invalid={!storableAmount} aria-describedby={!storableAmount ? `result-amount-${key}-error` : undefined} onChange={(event) => updateResultPortion(key, { amount: event.target.value }, result)} />{result.kind === 'food' ? <UnitSelect id={`result-unit-${key}`} value={portion.unit} units={savedFoodPortionOptions(result.value.food, portion.amount, portion.unit)} onChange={(nextUnit) => updateResultPortion(key, { unit: nextUnit, amount: convertSavedFoodPortionAmount(result.value.food, portion.amount, portion.unit, nextUnit) }, result)} /> : <span className="choice-result-unit-static">serving</span>}{!storableAmount && <small id={`result-amount-${key}-error`} className="choice-result-input-error">{quantityRangeHint}</small>}<button type="button" className="icon-button choice-result-portion-done" aria-label="Done editing portion" onClick={finishPortionEdit}><Check size={16} /></button></span>
      : <button type="button" className="choice-result-portion-summary" aria-label={`Edit portion, currently ${portionCountLabel(portion.amount, portion.unit)}`} aria-expanded={false} onClick={() => beginPortionEdit(key, portion)}><span>{portionCountLabel(portion.amount, portion.unit)}</span></button>
      : <small className="choice-result-basis">per {result.kind === 'food' ? `${number(result.value.food.basis_amount)} ${result.value.food.basis_unit}` : 'serving'}</small>;
    const info = <><span className="choice-result-name"><strong>{name}</strong>{showLibraryBadge && <small className="choice-library-marker"><BookMarked size={13} aria-hidden="true" /> In Library</small>}{basis && <small>{basis}</small>}</span><span className="choice-result-facts"><span className="choice-result-primary-facts"><strong>{calories == null ? '— kcal' : number(calories) + ' kcal'}</strong>{proteinField && <small>{protein == null ? '—' : number(protein) + ' ' + proteinField.unit} protein</small>}</span>{!allowMultiAdd && <small className="choice-result-basis">per {result.kind === 'food' ? `${number(result.value.food.basis_amount)} ${result.value.food.basis_unit}` : 'serving'}</small>}</span></>;
    return <li key={key}><div className={`choice-result-row${editingResultPortionKey === key ? ' is-editing' : ''}`}>{allowMultiAdd ? <><button className="choice-result-main choice-result-main-add" type="button" aria-label={`Add ${name}, ${portion.amount} ${portion.unit} to meal`} disabled={!canAddSavedPortion(result, portion)} onClick={() => stageSaved(result, portion)}>{info}</button><div className="choice-result-portion">{portionFact}</div></> : <button className="choice-result-main" type="button" aria-label={`Choose ${name}`} onClick={() => choose(result, key)}>{info}</button>}</div></li>;
  }
  function catalogueResultRow(food: CatalogFoodSearchResult, key: string) {
    const preference = portionPreferences.data?.[`catalogue:${food.food_id}` as PortionPreferenceKey];
    const portion = resultPortions[key] ?? preference ?? (food.default_portion
      ? { amount: String(food.default_portion.amount), unit: food.default_portion.unit }
      : { amount: String(food.basis_amount), unit: food.basis_unit });
    const portionLabel = resultPortions[key] || preference ? portionCountLabel(portion.amount, portion.unit) : food.default_portion?.label || portionCountLabel(portion.amount, portion.unit);
    const amountValid = isPreviewableQuantity(portion.amount);
    const storableAmount = isValidQuantity(portion.amount);
    const preview = amountValid ? calculateFoodPortion(catalogueBasis(food, fields, portion.unit), Number(portion.amount), portion.unit) : null;
    const calories = preview?.ok ? preview.caloriesKcal : null;
    const protein = proteinField && preview?.ok ? preview.nutrients[proteinField.field_id] : null;
    const portionFact = allowMultiAdd ? editingResultPortionKey === key
      ? <span className="choice-result-portion-editor" onBlur={(event) => { const next = event.relatedTarget as Node | null; if (!next || !event.currentTarget.contains(next)) cancelPortionEdit(key); }}><NumericField id={`result-amount-${key}`} label="Amount" autoFocus min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={portion.amount} aria-invalid={!storableAmount} aria-describedby={!storableAmount ? `result-amount-${key}-error` : undefined} onChange={(event) => setResultPortions((current) => ({ ...current, [key]: { ...portion, amount: event.target.value } }))} /><UnitSelect id={`result-unit-${key}`} value={portion.unit} units={cataloguePortionOptions(food, portion.amount, portion.unit)} onChange={(nextUnit) => setResultPortions((current) => ({ ...current, [key]: { amount: convertCataloguePortionAmount(food, portion.amount, portion.unit, nextUnit), unit: nextUnit } }))} />{!storableAmount && <small id={`result-amount-${key}-error`} className="choice-result-input-error">{quantityRangeHint}</small>}<button type="button" className="icon-button choice-result-portion-done" aria-label="Done editing portion" onClick={finishPortionEdit}><Check size={16} /></button></span>
      : <button type="button" className="choice-result-portion-summary" aria-label={`Edit portion, currently ${portionLabel}`} aria-expanded={false} onClick={() => beginPortionEdit(key, portion)}><span>{portionLabel}</span></button>
      : <small className="choice-result-basis">per {number(food.basis_amount)} {food.basis_unit}</small>;
    const info = <><span className="choice-result-name"><strong>{food.name}</strong><small>{[food.brand, food.quality_status === 'incomplete' ? 'some nutrition missing' : null].filter(Boolean).join(' · ')}</small></span><span className="choice-result-facts"><span className="choice-result-primary-facts"><strong>{calories == null ? '— kcal' : number(calories) + ' kcal'}</strong><small>{protein == null ? '—' : number(protein) + ' ' + (proteinField?.unit ?? 'g')} protein</small></span>{!allowMultiAdd && <small className="choice-result-basis">per {number(food.basis_amount)} {food.basis_unit}</small>}</span></>;
    return <li key={key}><div className={`choice-result-row${editingResultPortionKey === key ? ' is-editing' : ''}`}>{allowMultiAdd ? <><button className="choice-result-main choice-result-main-add" type="button" aria-label={`Add ${food.name}, ${portionCountLabel(portion.amount, portion.unit)} to meal`} disabled={!canAddCataloguePortion(food, portion)} onClick={() => stageCatalogue(food, portion)}>{info}</button><div className="choice-result-portion">{portionFact}</div></> : <button className="choice-result-main" type="button" aria-label={`Choose ${food.name}`} onClick={() => { setCatalogueError(''); setCatalogueSelection(food); const initial = preference ?? (food.default_portion ? { amount: String(food.default_portion.amount), unit: food.default_portion.unit } : { amount: String(food.basis_amount), unit: food.basis_unit }); setAmount(String(initial.amount)); setUnit(initial.unit); }}>{info}</button>}</div></li>;
  }
  const loading = foods.isPending || meals.isPending || recents.isPending;
  const hasSearch = Boolean(search.trim());
  const searchPending = hasSearch && (catalogueQuery !== search.trim() || catalogue.isFetching || foods.isPending || meals.isPending);
  const selectedName = catalogueSelection?.name ?? (selection?.kind === 'food' ? selection.value.food.name : selection?.value.meal.name);
  const foodResult = nutrition?.kind === 'food' ? nutrition.result : null;
  const mealResult = nutrition?.kind === 'meal' ? nutrition.result : null;
  const labelControl = <div className="meal-composer-label"><div className="meal-composer-label-heading"><strong>Meal label</strong></div><button className="meal-label-trigger" type="button" aria-expanded={labelOpen} aria-controls={controlId + '-label-options'} onClick={() => setLabelOpen((value) => !value)}>{section === 'unlabelled' ? '+ Add label' : labels.find(([value]) => value === section)?.[1]}</button>{labelOpen && <div id={controlId + '-label-options'} className="meal-composer-label-options" role="group" aria-label="Choose a meal label">{([['unlabelled', 'No label'], ...labels] as Array<[MealLabel, string]>).map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} onClick={() => { setSection(value); setLabelOpen(false); }}>{label}</button>)}</div>}</div>;
  return <><Dialog open={open} modal={!dateLabel} title={dialogTitle ?? 'Add a meal'} closeDisabled={activeWrites > 0} onClose={handleDialogClose} className={dateLabel ? 'meal-log-composer' : ''} style={composerStyle}>
    {actionMode && onActionModeChange && <div className="choice-action-picker" role="group" aria-label="Entry state"><label><input type="radio" name={controlId + '-action'} checked={actionMode === 'log'} onChange={() => onActionModeChange('log')} />Eaten</label><label><input type="radio" name={controlId + '-action'} checked={actionMode === 'plan'} onChange={() => onActionModeChange('plan')} />Planned</label></div>}
    {!selection && !catalogueSelection && !newMode && <div className="meal-composer-search-state">
      <label className="library-search choice-search"><Search size={19} aria-hidden="true" /><span className="visually-hidden">Search foods and meals</span><input autoFocus type="search" placeholder="Search foods and meals" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {recentError && <StatusMessage tone="error">{recentError}</StatusMessage>}
      {(foods.isError || meals.isError) && <StatusMessage tone="error">Some saved items could not be loaded. Close and try again.</StatusMessage>}
      {allowMultiAdd && (draftItems.length > 0 || dateLabel) && <DraftHost calendar={Boolean(dateLabel)} host={draftHost}>
      {draftItems.length === 0 ? <button type="button" className="calendar-meal-draft-placeholder" onClick={onResumeSearch} aria-label="Choose food for this meal"><span>New meal</span><strong>Choose food to start</strong></button> : <section className={`choice-meal-draft${dateLabel ? ' calendar-day-meal-card-container' : ''}`} aria-label={dateLabel ? 'Draft meal' : 'Meal items'}>
        {dateLabel ? <CalendarMealCard
          state="Draft meal"
          onDetailHost={setDraftDetailHost}
          calories={draftHasKnownCalories ? number(draftCaloriesTotal) : '—'}
          foods={draftItems.map((item, index) => ({ key: item.key, name: item.choice.name, brand: item.food?.food.brand ?? item.catalogueFood?.brand, portion: portionCountLabel(item.amount, item.unit), calories: draftNutritionValues[index]?.calories == null ? '—' : number(draftNutritionValues[index]!.calories!) }))}
          metrics={[...draftNutrientTotals.map(({ field, value, complete }) => ({ label: field.standard_key === 'carbohydrate' ? 'Carbs' : field.name, value: complete && value !== null ? `${number(value)} ${field.unit}` : '—' })), ...(totalWeight > 0 ? [{ label: 'Weight', value: `${number(totalWeight)} g` }] : []), ...(totalVolume > 0 ? [{ label: 'Volume', value: `${number(totalVolume)} ml` }] : [])]}
          expanded={!draftItemsCollapsed && !open}
          compact={open}
          onToggle={() => { if (open) { onClose(); setDraftItemsCollapsed(false); } else setDraftItemsCollapsed((collapsed) => !collapsed); }}
        /> : <>
          <button type="button" className="choice-meal-draft-heading" aria-expanded={!draftItemsCollapsed} aria-controls={`${controlId}-draft-items`} onClick={() => setDraftItemsCollapsed((collapsed) => !collapsed)}><span className="choice-meal-draft-title"><strong>Meal items</strong><span>{draftItems.length}</span></span><span className="choice-meal-draft-heading-end"><span className="choice-meal-draft-calories"><strong>{draftHasKnownCalories ? number(draftCaloriesTotal) : '—'}</strong><span>kcal</span></span><ChevronDown size={17} className={draftItemsCollapsed ? '' : 'is-expanded'} aria-hidden="true" /></span></button>
          {(draftItemsCollapsed || draftItems.length > 1) && <p className="choice-meal-draft-summary" aria-label="Items in this meal">{draftItems.slice(0, 3).map((item) => <span key={item.key}>{item.choice.name}{(item.food?.food.brand ?? item.catalogueFood?.brand) ? ` · ${item.food?.food.brand ?? item.catalogueFood?.brand}` : ''} <small>({portionCountLabel(item.amount, item.unit)})</small></span>)}{draftItems.length > 3 && <span>+{draftItems.length - 3} more</span>}</p>}
          <div className="choice-meal-draft-facts" aria-label="Meal totals">{primaryDraftNutrients.map(({ field, value, complete }) => <span key={field.field_id}>{field.standard_key === 'carbohydrate' ? 'Carbs' : field.name} <strong>{complete && value !== null ? `${number(value)} ${field.unit}` : '—'}</strong></span>)}{totalWeight > 0 && <span>Weight <strong>{number(totalWeight)} g</strong></span>}{totalVolume > 0 && <span>Volume <strong>{number(totalVolume)} ml</strong></span>}</div>
        </>}
        <DraftHost calendar={Boolean(dateLabel)} host={draftDetailHost}><div id={`${controlId}-draft-items`} className="choice-meal-draft-details" hidden={draftItemsCollapsed}>
        {!draftCaloriesComplete && draftCaloriesTotal > 0 && <p className="choice-meal-draft-partial">Some calorie values are missing; this is the known total.</p>}
        {draftItems.length >= 50 && <p className="field-hint">This meal has reached its item limit.</p>}
        <ol>{draftItems.map((item) => {
          const itemNutrition = draftNutrition(item);
          const brand = item.food?.food.brand ?? item.catalogueFood?.brand;
          const snapshot = item.choice.snapshot ?? {};
          const snapshotNutrients = (snapshot.nutrients && typeof snapshot.nutrients === 'object' ? snapshot.nutrients : {}) as Record<string, number | null>;
          const editableFood = Boolean(item.food || item.catalogueFood);
          return <li key={item.key} className="choice-meal-draft-item">
            <div className="choice-meal-draft-item-name"><span className="choice-meal-draft-item-title"><strong>{item.choice.name}</strong>{brand?.trim() && <small className="choice-meal-draft-brand">{brand}</small>}</span><span className="choice-meal-draft-item-calories">{itemNutrition.calories === null ? '—' : number(itemNutrition.calories)} <small>kcal</small></span><div className="choice-meal-draft-item-actions">{editableFood && <button type="button" className="icon-button" aria-label={`${item.editingDetails ? 'Close' : 'Edit'} ${item.choice.name} details`} aria-expanded={Boolean(item.editingDetails)} onClick={() => item.editingDetails ? setDraftItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, editingDetails: false } : entry)) : startDraftDetailsEdit(item)}><Pencil size={14} /></button>}<button type="button" className="icon-button" aria-label={`Remove ${item.choice.name}`} title="Remove" onClick={() => setDraftItems((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 size={15} /></button></div></div>
            <div className="choice-meal-draft-controls"><NumericField id={`draft-amount-${item.key}`} label="Amount" min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={item.amount} aria-invalid={!isValidQuantity(item.amount)} onChange={(event) => updateDraftItem(item.key, { amount: event.target.value })} />{item.food ? <UnitSelect id={`draft-unit-${item.key}`} value={item.unit} units={savedFoodPortionOptions(item.food.food, item.amount, item.unit)} onChange={(nextUnit) => updateDraftItem(item.key, { unit: nextUnit })} /> : item.catalogueFood ? <UnitSelect id={`draft-unit-${item.key}`} value={item.unit} units={cataloguePortionOptions(item.catalogueFood, item.amount, item.unit)} onChange={(nextUnit) => updateDraftItem(item.key, { unit: nextUnit })} /> : <UnitSelect id={`draft-unit-${item.key}`} value={item.unit} units={['serving']} onChange={(nextUnit) => updateDraftItem(item.key, { unit: nextUnit })} />}</div>
            {item.editingDetails && <div className="choice-meal-draft-food-editor">
              <Field id={`draft-name-${item.key}`} label="Food name"><input className="text-field" id={`draft-name-${item.key}`} value={item.choice.name} maxLength={160} onChange={(event) => updateDraftFoodDetail(item, 'name', event.target.value)} /></Field>
              <NumericField id={`draft-kcal-${item.key}`} label="Calories (kcal)" min={0} max={99999999} step={0.01} value={snapshot.caloriesKcal == null ? '' : String(snapshot.caloriesKcal)} onChange={(event) => updateDraftFoodDetail(item, 'caloriesKcal', event.target.value)} />
              <small className="choice-meal-draft-food-basis">Values per {number(Number(snapshot.basisAmount))} {String(snapshot.basisUnit ?? '')}</small>
              <div className="choice-meal-draft-food-nutrients">{fields.map((field) => <NumericField key={field.field_id} id={`draft-${item.key}-${field.field_id}`} label={`${field.name} (${field.unit})`} min={0} max={99999999} step={0.01} value={snapshotNutrients[field.field_id] == null ? '' : String(snapshotNutrients[field.field_id])} onChange={(event) => updateDraftFoodDetail(item, field.field_id, event.target.value)} />)}</div>
            </div>}
          </li>;
        })}</ol>
        {labelControl}
        {draftItems.some((item) => !isValidQuantity(item.amount)) && <p className="field-hint">Use an amount from 0.0001 to 99,999,999.9999, with up to 4 decimal places.</p>}
        {draftItems.some((item) => !item.choice.name.trim() || item.choice.name.length > 160) && <p className="field-hint">Each item needs a name.</p>}
        {!futureDate && draftItems.some((item) => !draftNutrition(item).canLog) && <p className="field-hint">Each item needs known calories before it can be logged.</p>}
        </div>
        {draftItemsCollapsed && draftItems.some((item) => !isValidQuantity(item.amount)) && <p className="field-hint">Check item amounts before logging.</p>}
        {draftItemsCollapsed && !futureDate && draftItems.some((item) => !draftNutrition(item).canLog) && <p className="field-hint">Each item needs known calories before it can be logged.</p>}
        <div className="dialog-actions"><button className="text-button" type="button" onClick={() => { setDraftItems([]); setDraftItemsCollapsed(false); onDiscardDraft?.(); }}>{dateLabel ? 'Discard' : 'Clear'}</button>{dateLabel && !open && <button className="text-button calendar-draft-add-food" type="button" onClick={onResumeSearch}>+ Add food</button>}<Button type="button" disabled={!draftCanSubmit} onClick={submitDraftMeal}>{futureDate ? 'Plan meal' : 'Log meal'}</Button></div>
        </DraftHost>
      </section>}
      </DraftHost>}
      {loading && !hasSearch && <LoadingSkeleton label="Loading saved items" />}
      {!hasSearch && !loading && <>
        {(recents.data?.length ?? 0) > 0 && <><p className="eyebrow choice-list-label">RECENTLY USED</p><ul className="choice-results" aria-label="Recently used foods and meals">{recents.data!.slice(0, 6).map((choice) => <li key={choice.kind + '-' + choice.id}><button type="button" disabled={recentLoadingId === choice.id} onClick={() => void chooseRecent(choice)}><span><strong>{choice.name}</strong><small>Last used {number(choice.amount)} {choice.unit}</small></span><span className="choice-result-facts"><small>{recentLoadingId === choice.id ? 'Loading…' : 'Use again'}</small></span></button></li>)}</ul></>}
        {recentlyAdded.length > 0 && <><p className="eyebrow choice-list-label">IN YOUR LIBRARY</p><ul className="choice-results" aria-label="Saved foods and meals">{recentlyAdded.slice(0, 6).map((entry) => resultRow(entry, entry.kind + '-' + (entry.kind === 'food' ? entry.value.food.id : entry.value.meal.id), false))}</ul></>}
        {!dateLabel && (recents.data?.length ?? 0) === 0 && recentlyAdded.length === 0 && <p className="field-hint">Your Library is empty. Add your first food below.</p>}
      </>}
      {hasSearch && <>
        <p className="eyebrow choice-list-label">SEARCH RESULTS {searchPending ? '· SEARCHING' : ''}</p>
        {catalogue.isError && <StatusMessage tone="error">Catalogue search is temporarily unavailable.</StatusMessage>}
        {unifiedSearchResults.length > 0 ? <ul className="choice-results" aria-label="Food and meal search results">
          {unifiedSearchResults.map((item) => item.kind === 'saved' ? resultRow(item.result, item.key) : catalogueResultRow(item.food, item.key))}
        </ul> : searchPending ? <p className="field-hint">Searching…</p> : catalogueQuery.length >= 2 && <p className="field-hint">No matches. Add a food if needed.</p>}
      </>}
      {(!hasSearch ? !loading && recentlyAdded.length === 0 && (recents.data?.length ?? 0) === 0 : !searchPending && unifiedSearchResults.length === 0) && <div className="meal-composer-new-actions"><span>Can’t find it?</span><button type="button" onClick={() => setNewMode('item')}>Add new food</button></div>}
    </div>}
    {newMode && <div className="meal-composer-new"><button className="text-button" type="button" onClick={returnToSearch}>← Back to search</button><h3>{newMode === 'ingredients' ? 'New meal' : 'New food'}</h3>{newMode === 'ingredients'
      ? <OneOffMealForm userId={userId} fields={fields} futureDate={futureDate} section={section} initialName={newItemName} onPrepared={onPrepared} onSavedOnly={(name) => { handleDialogClose(); onSavedOnly?.(name); }} onDirtyChange={setNewDirty} extraFields={labelControl} />
      : <OneOffFoodForm userId={userId} fields={fields} futureDate={futureDate} section={section} onPrepared={onPrepared} onSavedOnly={(name) => { handleDialogClose(); onSavedOnly?.(name); }} onDirtyChange={setNewDirty} onAddIngredients={foods.data?.length ? (name, hasNutritionEdits) => { setNewItemName(name); if (hasNutritionEdits) setConfirmIngredientSwitch(true); else { setNewDirty(false); setNewMode('ingredients'); } } : undefined} extraFields={labelControl} />}</div>}
    {(selection || catalogueSelection) && <div className="choice-review">
      {selectedCatalogueFood ? <>
        {catalogueError && <StatusMessage tone="error">{catalogueError}</StatusMessage>}
        <CatalogFoodCorrectionForm key={selectedCatalogueFood.food_id} food={selectedCatalogueFood} fields={fields} saving={addCatalogueFood.isPending} onCancel={() => { setSelectedCatalogueFood(null); setCatalogueError(''); addCatalogueFood.reset(); }} onSave={(correction) => addCatalogueFood.mutate({ food: selectedCatalogueFood, correction })} />
      </> : <>
      <div className="choice-review-heading"><div><p className="eyebrow">REVIEW {catalogueSelection ? 'FOOD' : 'PORTION'}</p><h3>{selectedName}</h3></div><div className="choice-review-actions">{catalogueSelection && <button type="button" className="icon-button" aria-label="Edit food details" title="Edit food details" onClick={() => { setCatalogueError(''); setSelectedCatalogueFood(catalogueSelection); }}><Pencil size={17} /></button>}<button type="button" className="text-button" onClick={returnToSearch}>Change</button></div></div>
      {recentOrigin && <StatusMessage tone="info">Using current nutrition with the last used portion ({recentOrigin.amount} {recentOrigin.unit}).</StatusMessage>}
      {catalogueSelection && <p className="field-hint">{[catalogueSelection.brand, 'per ' + number(catalogueSelection.basis_amount) + ' ' + catalogueSelection.basis_unit].filter(Boolean).join(' · ')}</p>}
      <div className="choice-portion-fields"><NumericField id="choice-amount" label={selection?.kind === 'meal' ? 'Servings' : 'Amount'} min={QUANTITY_MIN} max={QUANTITY_MAX} step={QUANTITY_STEP} value={amount} aria-invalid={!isValidQuantity(amount)} onChange={(event) => setAmount(event.target.value)} />{catalogueSelection && <UnitSelect id="choice-unit" value={unit} units={cataloguePortionOptions(catalogueSelection, amount, unit)} onChange={changeReviewUnit} />}{selection?.kind === 'food' && <UnitSelect id="choice-unit" value={unit} units={savedFoodPortionOptions(selection.value.food, amount, unit)} onChange={changeReviewUnit} />}</div>
      {!isValidQuantity(amount) && <p className="field-hint">Use a value from 0.0001 to 99,999,999.9999, with up to 4 decimal places.</p>}
      {nutrition && !nutrition.result.ok && <StatusMessage tone="error">Review the amount and unit. This portion cannot be calculated from the saved food.</StatusMessage>}
      {foodResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{foodResult.caloriesKcal == null ? 'Unknown' : number(foodResult.caloriesKcal) + ' kcal'}</dd></div>{reviewFields.map((field) => <div key={field.field_id}><dt>{field.name}</dt><dd>{foodResult.nutrients[field.field_id] == null ? 'Unknown' : number(foodResult.nutrients[field.field_id]!) + ' ' + field.unit}</dd></div>)}</dl>}
      {mealResult?.ok && <dl className="food-portion-values"><div><dt>Calories</dt><dd>{mealResult.nutrition.calories.value == null ? 'Unknown' : number(mealResult.nutrition.calories.value) + ' kcal' + (mealResult.nutrition.calories.complete ? '' : ' · partial')}</dd></div>{reviewFields.map((field) => { const metric = mealResult.nutrition.nutrients[field.field_id]!; return <div key={field.field_id}><dt>{field.name}</dt><dd>{metric.value == null ? 'Unknown' : number(metric.value) + ' ' + field.unit + (metric.complete ? '' : ' · partial')}</dd></div>; })}</dl>}
      {!futureDate && nutrition?.result.ok && !canUse && <p className="field-hint">Calories must be known to log this entry.</p>}
      {labelControl}
      <div className="dialog-actions"><Button variant="secondary" type="button" onClick={handleDialogClose}>Cancel</Button><Button type="button" disabled={!canUse} onClick={() => catalogueSelection ? applyCatalogueSelection() : selection && onPrepared({ kind: selection.kind, id: selection.kind === 'food' ? selection.value.food.id : selection.value.meal.id, name: selectedName!, amount: Number(amount), unit: selection.kind === 'food' ? unit : 'serving', section })}>{submitLabel ?? (futureDate ? 'Add to plan' : 'Log as eaten')}</Button></div>
      </>}
    </div>}
  </Dialog>
  <Dialog open={confirmIngredientSwitch} title="Add ingredients instead?" onClose={() => setConfirmIngredientSwitch(false)}><p>The nutrition values entered here will be replaced by totals from the ingredients. The name will be kept.</p><div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setConfirmIngredientSwitch(false)}>Keep editing</Button><Button type="button" onClick={() => { setConfirmIngredientSwitch(false); setNewDirty(false); setNewMode('ingredients'); }}>Add ingredients</Button></div></Dialog>
  <Dialog open={confirmDiscard} title={`Discard this new ${newMode === 'ingredients' ? 'meal' : 'food'}?`} closeDisabled={activeWrites > 0} onClose={() => setConfirmDiscard(false)}><p>Your draft has not been saved.</p><div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button type="button" disabled={activeWrites > 0} onClick={() => { setNewMode(null); setSelection(null); setNewDirty(false); setConfirmDiscard(false); }}>Discard</Button></div></Dialog></>;
}
