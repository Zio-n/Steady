import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CircleDashed, Pencil, Plus, Trash2 } from 'lucide-react';
import { archiveSavedMeal, loadMeals, loadRecentMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import { queryKeys } from '../../data/queryKeys';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { CALORIES, formatNutrition, mealMetric, type DraftFood } from '../../domain/mealComposer';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState } from '../../ui/components/EmptyState';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { LibraryMealComposer } from '../today/AddChoiceDialog';
import { recentMealDrafts, recentMealName, savedMealDrafts } from '../today/composerFoods';

const PAGE_SIZE = 20;
const formatPortion = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
type MealView = 'recent' | 'saved';
type EditableMeal = { name: string; foods: DraftFood[]; recentKey?: string; mealId?: string; revision?: number };

export function LibraryMeals({ userId, fields, search, view, onViewChange, onSaved, onDraftChange }: {
  userId: string; fields: NutrientField[]; search: string; view: MealView; onViewChange: (view: MealView) => void;
  onSaved: () => void; onDraftChange: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditableMeal | null>(null);
  const [remove, setRemove] = useState<SavedMeal['meal'] | null>(null);
  const [notice, setNotice] = useState('');
  const removalRequest = useRef<{ mealId: string; revision: number; id: string } | null>(null);
  const recent = useInfiniteQuery({
    queryKey: [...queryKeys.recentMeals(userId), 'library', search],
    queryFn: ({ pageParam }) => loadRecentMeals(search, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: view === 'recent',
  });
  const saved = useInfiniteQuery({
    queryKey: [...queryKeys.mealLibrary(userId, search), 'library'],
    queryFn: ({ pageParam }) => loadMeals(userId, search, PAGE_SIZE, 'name', pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: view === 'saved',
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['account', userId, 'meal-library'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.recentMeals(userId) }),
    queryClient.invalidateQueries({ queryKey: ['account', userId, 'food-references'] }),
  ]);
  const archive = useMutation({
    mutationFn: archiveSavedMeal,
    onSuccess: async () => {
      setRemove(null);
      setNotice('Saved meal removed.');
      await refresh();
    },
  });
  const active = view === 'recent' ? recent : saved;
  const recentCards = (recent.data?.pages.flat() ?? []).flatMap((meal) => {
    const foods = recentMealDrafts(meal);
    if (foods.length < 2) return [];
    return [{ meal, foods, name: recentMealName(foods) }];
  });
  const savedCards = (saved.data?.pages.flat() ?? []).map((entry) => {
    let foods: DraftFood[] = [];
    try { foods = savedMealDrafts(entry); } catch { /* Keep older meals visible so they can be repaired. */ }
    return { entry, foods };
  });

  function showSaved() {
    closeEditor();
    onSaved();
    setNotice('Meal saved.');
    void refresh();
  }

  function closeEditor() {
    onDraftChange(false);
    setEditor(null);
  }

  return <>
    <div className="library-meals-toolbar">
      <div className="library-meal-filters" role="group" aria-label="Meal list">
        <button type="button" aria-pressed={view === 'recent'} onClick={() => onViewChange('recent')}>Recent</button>
        <button type="button" aria-pressed={view === 'saved'} onClick={() => onViewChange('saved')}>Saved</button>
      </div>
      <Button type="button" variant="secondary" onClick={() => { setNotice(''); setEditor({ name: '', foods: [] }); }}>
        <Plus size={16} aria-hidden="true" /> New saved meal
      </Button>
    </div>
    {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
    {active.isPending ? <LoadingSkeleton label="Loading meals" /> : active.isError ? <div className="library-list-error">
      <StatusMessage tone="error">Meals couldn’t load.</StatusMessage>
      <Button variant="secondary" type="button" onClick={() => void active.refetch()}>Try again</Button>
    </div> : (view === 'recent' ? recentCards.length === 0 : savedCards.length === 0) ? (
      <EmptyState icon={<BookOpen size={24} />} title={search ? 'No matching meals' : view === 'recent' ? 'No recent meals' : 'No saved meals'}>
        {!search && view === 'recent' && <p>Meals you log with multiple foods appear here.</p>}
      </EmptyState>
    ) : <ul className="food-list" aria-label={view === 'recent' ? 'Recent meals' : 'Saved meals'}>
      {view === 'recent' ? recentCards.map(({ meal, foods, name }) => <li className="food-card meal-card" key={meal.key}>
        <MealDetails name={name} foods={foods} fields={fields} />
        <div className="food-card-actions meal-card-actions">
          <Link className="secondary-button" to={`/?recent=${meal.key}`} aria-label={`Use ${name}`}>Use</Link>
          {meal.savedMealId
            ? <button type="button" className="text-button" aria-label={`Find the saved copy of ${name}`} onClick={onSaved}>View saved</button>
            : <Button type="button" variant="secondary" onClick={() => { setNotice(''); setEditor({ name, foods, recentKey: meal.key }); }}>Name & save</Button>}
        </div>
      </li>) : savedCards.map(({ entry, foods }) => <li className="food-card meal-card" key={entry.meal.id}>
        <MealDetails name={entry.meal.name} foods={foods} fields={fields}
          unavailable={foods.length === 0} />
        <div className="food-card-actions meal-card-actions">
          {foods.length > 0 && <Link className="secondary-button" to={`/?meal=${entry.meal.id}`} aria-label={`Use ${entry.meal.name}`}>Use</Link>}
          {entry.meal.snapshot_foods === null
            ? <Link className="icon-button" to={`/build?edit=${entry.meal.id}&from=library`} aria-label={`Edit ${entry.meal.name}`}><Pencil size={17} aria-hidden="true" /></Link>
            : <button type="button" className="icon-button" aria-label={`Edit ${entry.meal.name}`} onClick={() => {
              setNotice(''); setEditor({ name: entry.meal.name, foods, mealId: entry.meal.id, revision: entry.meal.revision });
            }}><Pencil size={17} aria-hidden="true" /></button>}
          <button type="button" className="icon-button" aria-label={`Remove ${entry.meal.name}`} onClick={() => { archive.reset(); setRemove(entry.meal); }}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      </li>)}
    </ul>}
    {active.hasNextPage && <Button variant="secondary" type="button" disabled={active.isFetchingNextPage} onClick={() => void active.fetchNextPage()}>
      {active.isFetchingNextPage ? 'Loading…' : 'Load more meals'}
    </Button>}
    {editor && <LibraryMealComposer userId={userId} fields={fields} meal={editor} onClose={closeEditor} onSaved={showSaved} onDraftChange={onDraftChange} />}
    <Dialog open={Boolean(remove)} title="Remove saved meal?" closeDisabled={archive.isPending} onClose={() => setRemove(null)}>
      {remove && <p>{remove.name} will be removed from Saved.</p>}
      {archive.isError && <StatusMessage tone="error">{archive.error.message}</StatusMessage>}
      <div className="dialog-actions">
        <Button variant="secondary" type="button" disabled={archive.isPending} onClick={() => setRemove(null)}>Cancel</Button>
        <Button type="button" disabled={!remove || archive.isPending} onClick={() => {
          if (!remove) return;
          if (removalRequest.current?.mealId !== remove.id || removalRequest.current.revision !== remove.revision) {
            removalRequest.current = { mealId: remove.id, revision: remove.revision, id: crypto.randomUUID() };
          }
          archive.mutate({ requestId: removalRequest.current.id, meal: remove });
        }}>{archive.isPending ? 'Removing…' : 'Remove'}</Button>
      </div>
    </Dialog>
  </>;
}

function MealDetails({ name, foods, fields, unavailable }: {
  name: string; foods: DraftFood[]; fields: NutrientField[]; unavailable?: boolean;
}) {
  const calories = mealMetric(foods, CALORIES);
  return <div className="food-card-main">
    <h2>{name}</h2>
    {unavailable ? <p className="food-basis">Some foods are unavailable.</p> : <>
      <div className="library-meal-nutrition">
        <MealValue metric={calories} unit="kcal" />
        {fields.filter((field) => field.is_displayed).slice(0, 3).map((field) => {
          const metric = mealMetric(foods, field.field_id);
          return metric.value === null ? null : <span key={field.field_id}>{field.name} <MealValue metric={metric} unit={field.unit} /></span>;
        })}
      </div>
      <details className="library-meal-foods">
        <summary>{foods.length} {foods.length === 1 ? 'food' : 'foods'}</summary>
        <ul>{foods.map((food, index) => <li key={index}>
          <span>{food.name}{food.brand && ` · ${food.brand}`}</span><span>{formatPortion.format(Number(food.amount))} {food.unit}</span>
        </li>)}</ul>
      </details>
    </>}
  </div>;
}

function MealValue({ metric, unit }: { metric: ReturnType<typeof mealMetric>; unit: string }) {
  if (metric.value === null) return <span>— <span className="visually-hidden">Unknown </span>{unit}</span>;
  return <strong>
    {metric.estimated && <><span aria-hidden="true">≈</span><span className="visually-hidden">Approximately </span></>}
    {formatNutrition(metric.value)} {unit}
    {!metric.complete && <> <CircleDashed className="nutrition-incomplete-mark" size={12} aria-hidden="true" /><span className="visually-hidden">, incomplete</span></>}
  </strong>;
}
