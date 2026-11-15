import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { archiveSavedMeal, hideRecentMeal, loadMeals, loadRecentMeals, type SavedMeal } from '../../data/repositories/mealRepository';
import type { FoodWithNutrients } from '../../data/repositories/foodRepository';
import type { FoodPortionPreferences } from '../../data/repositories/foodPortionPreferenceRepository';
import { queryKeys } from '../../data/queryKeys';
import type { NutrientField } from '../../data/repositories/profileRepository';
import { CALORIES, formatNutrition, mealMetric, portionValue, valueCertainty, type DraftFood } from '../../domain/mealComposer';
import { libraryDraft } from '../today/composerFoods';
import { Button } from '../../ui/components/Button';
import { CalendarMealCard, type CalendarMealFood, type CalendarMealMetric } from '../../ui/components/CalendarMealCard';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState } from '../../ui/components/EmptyState';
import { LoadingSkeleton } from '../../ui/components/LoadingSkeleton';
import { StatusMessage } from '../../ui/components/StatusMessage';
import { LibraryMealComposer } from '../today/AddChoiceDialog';
import { recentMealDrafts, recentMealName, savedMealDrafts } from '../today/composerFoods';

const PAGE_SIZE = 20;
type EditableMeal = { name: string; foods: DraftFood[]; recentKey?: string; mealId?: string; revision?: number };
type LibraryCard = { key: string; name: string; kind: 'Food' | 'Meal'; calories: string; caloriesIncomplete: boolean; foods: CalendarMealFood[]; metrics: CalendarMealMetric[]; sortTime: number; use: () => void; edit: () => void; remove?: () => void };
type RecentMealRemoval = { name: string; key: string };
const number = (value: number) => formatNutrition(value);

export function LibraryMeals({ userId, fields, search, foods, portions, sort, foodsPending, foodsError, onRetryFoods,
  hasMoreFoods, loadingMoreFoods, onLoadMoreFoods, onEditFood, onDeleteFood, onSavedMeal, onDraftChange }: {
  userId: string; fields: NutrientField[]; search: string; foods: FoodWithNutrients[]; portions: FoodPortionPreferences; sort: 'name' | 'recent';
  foodsPending: boolean; foodsError: boolean; onRetryFoods: () => void; hasMoreFoods: boolean; loadingMoreFoods: boolean; onLoadMoreFoods: () => void;
  onEditFood: (food: FoodWithNutrients) => void; onDeleteFood: (food: FoodWithNutrients) => void; onSavedMeal: () => void; onDraftChange: (dirty: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditableMeal | null>(null);
  const [remove, setRemove] = useState<SavedMeal['meal'] | null>(null);
  const [recentRemove, setRecentRemove] = useState<RecentMealRemoval | null>(null);
  const removalRequest = useRef<{ mealId: string; revision: number; id: string } | null>(null);
  const recent = useInfiniteQuery({
    queryKey: [...queryKeys.recentMeals(userId), 'library', search],
    queryFn: ({ pageParam }) => loadRecentMeals(search, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  });
  const saved = useInfiniteQuery({
    queryKey: [...queryKeys.mealLibrary(userId, search), 'library', sort],
    queryFn: ({ pageParam }) => loadMeals(userId, search, PAGE_SIZE, sort, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => page.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['account', userId, 'meal-library'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.recentMeals(userId) }),
    queryClient.invalidateQueries({ queryKey: ['account', userId, 'food-references'] }),
  ]);
  const archive = useMutation({ mutationFn: archiveSavedMeal, onSuccess: async () => { setRemove(null); await refresh(); } });
  const removeRecent = useMutation({
    mutationFn: (key: string) => hideRecentMeal(userId, key),
    onSuccess: async () => {
      setRecentRemove(null);
      setExpanded(null);
      await refresh();
    },
  });
  const recentCards = (recent.data?.pages.flat() ?? []).flatMap((meal) => {
    const items = recentMealDrafts(meal);
    if (items.length < 2 || meal.savedMealId) return [];
    return [{ meal, items, name: recentMealName(items) }];
  });
  const savedCards = (saved.data?.pages.flat() ?? []).map((entry) => {
    let items: DraftFood[] = [];
    try { items = savedMealDrafts(entry); } catch { /* Keep older entries available to repair. */ }
    return { entry, items };
  });

  const foodCards: LibraryCard[] = foods.map((entry) => {
    const preference = portions[`library:${entry.food.id}`];
    const item = libraryDraft(entry, preference);
    const calories = portionValue(item, CALORIES);
    const metricFields = fields.filter((field) => field.is_displayed).slice(0, 3);
    const metrics = metricFields.flatMap((field) => {
      const value = portionValue(item, field.field_id);
      return value === null ? [] : [{ label: field.name, value: `${valueCertainty(item, field.field_id) === 'estimated' ? '≈' : ''}${number(value)} ${field.unit}`, incomplete: false }];
    });
    const detailMetrics = fields.flatMap((field) => {
      const value = portionValue(item, field.field_id);
      return value === null ? [] : [{ label: field.name, value: `${valueCertainty(item, field.field_id) === 'estimated' ? '≈' : ''}${number(value)} ${field.unit}` }];
    });
    const portion = `${item.amount} ${item.unit}`;
    const detailFood: CalendarMealFood = { key: entry.food.id, name: entry.food.name, brand: entry.food.brand, portion,
      calories: calories === null ? '—' : `${valueCertainty(item, CALORIES) === 'estimated' ? '≈' : ''}${number(calories)}`,
      metrics: detailMetrics };
    return { key: `food:${entry.food.id}`, name: entry.food.name, kind: 'Food', calories: detailFood.calories,
      caloriesIncomplete: calories === null, foods: [detailFood], metrics, sortTime: Date.parse(entry.food.created_at),
      use: () => navigate(`/?food=${entry.food.id}`), edit: () => onEditFood(entry), remove: () => onDeleteFood(entry) };
  });

  const mealCards: LibraryCard[] = [
    ...recentCards.map(({ meal, items, name }) => makeMealCard(`recent:${meal.key}`, name, items, fields, Date.parse(meal.localDate),
      () => navigate(`/?recent=${meal.key}`), () => setEditor({ name, foods: items, recentKey: meal.key }),
      () => { removeRecent.reset(); setRecentRemove({ name, key: meal.key }); })),
    ...savedCards.map(({ entry, items }) => makeMealCard(`meal:${entry.meal.id}`, entry.meal.name, items, fields, Date.parse(entry.meal.updated_at),
      () => navigate(`/?meal=${entry.meal.id}`), () => entry.meal.snapshot_foods === null
        ? navigate(`/build?edit=${entry.meal.id}&from=library`)
        : setEditor({ name: entry.meal.name, foods: items, mealId: entry.meal.id, revision: entry.meal.revision }),
      () => { archive.reset(); setRemove(entry.meal); })),
  ];
  const cards = [...foodCards, ...mealCards].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) : b.sortTime - a.sortTime);
  const isLoading = foodsPending || recent.isPending || saved.isPending;
  const hasError = foodsError || recent.isError || saved.isError;

  return <>
    <span className="visually-hidden" role="status">{removeRecent.isSuccess ? 'Meal removed from Library.' : ''}</span>
    {isLoading ? <LoadingSkeleton label="Loading your library" /> : hasError ? <div className="library-list-error">
      <StatusMessage tone="error">Some library items couldn’t load.</StatusMessage><Button variant="secondary" type="button" onClick={() => { onRetryFoods(); void recent.refetch(); void saved.refetch(); }}>Try again</Button>
    </div> : cards.length === 0 ? <EmptyState title={search ? 'No matching items' : 'Your library starts here'}>
      <p>{search ? 'Try another name, or add a food or meal.' : 'Foods you add and meals you log appear here.'}</p>
    </EmptyState> : <ul className="food-list library-unified-list" aria-label="Your items">
      {cards.map((card) => <li key={card.key}>
        <CalendarMealCard state="Eaten" title={card.name} calories={card.calories} caloriesIncomplete={card.caloriesIncomplete} foods={card.foods} metrics={card.metrics}
          expanded={expanded === card.key} onToggle={() => setExpanded((current) => current === card.key ? null : card.key)}
          busy={archive.isPending || removeRecent.isPending} libraryActions={{ kind: card.kind, onUse: card.use, onEdit: card.edit, onRemove: card.remove }} />
      </li>)}
    </ul>}
    {(hasMoreFoods || recent.hasNextPage || saved.hasNextPage) && <div className="library-load-more">
      {hasMoreFoods && <Button variant="secondary" type="button" disabled={loadingMoreFoods} onClick={onLoadMoreFoods}>{loadingMoreFoods ? 'Loading…' : 'More foods'}</Button>}
      {recent.hasNextPage && <Button variant="secondary" type="button" disabled={recent.isFetchingNextPage} onClick={() => void recent.fetchNextPage()}>{recent.isFetchingNextPage ? 'Loading…' : 'More recent meals'}</Button>}
      {saved.hasNextPage && <Button variant="secondary" type="button" disabled={saved.isFetchingNextPage} onClick={() => void saved.fetchNextPage()}>{saved.isFetchingNextPage ? 'Loading…' : 'More saved meals'}</Button>}
    </div>}
    {editor && <LibraryMealComposer userId={userId} fields={fields} meal={editor} onClose={() => { setEditor(null); onDraftChange(false); }} onSaved={() => { setEditor(null); onDraftChange(false); onSavedMeal(); void refresh(); }} onDraftChange={onDraftChange} />}
    <Dialog open={Boolean(recentRemove)} title="Remove from Library?" closeDisabled={removeRecent.isPending} onClose={() => setRecentRemove(null)}>
      {recentRemove && <p>{recentRemove.name} will stay in your Calendar.</p>}
      {removeRecent.isError && <StatusMessage tone="error">{removeRecent.error.message}</StatusMessage>}
      <div className="dialog-actions">
        <Button variant="secondary" type="button" disabled={removeRecent.isPending} onClick={() => setRecentRemove(null)}>Cancel</Button>
        <Button type="button" disabled={!recentRemove || removeRecent.isPending} onClick={() => {
          if (!recentRemove) return;
          removeRecent.mutate(recentRemove.key);
        }}>{removeRecent.isPending ? 'Removing…' : 'Remove meal'}</Button>
      </div>
    </Dialog>
    <Dialog open={Boolean(remove)} title="Remove saved meal?" closeDisabled={archive.isPending} onClose={() => setRemove(null)}>
      {remove && <p>{remove.name} will be removed from Library.</p>}
      {archive.isError && <StatusMessage tone="error">{archive.error.message}</StatusMessage>}
      <div className="dialog-actions"><Button variant="secondary" type="button" disabled={archive.isPending} onClick={() => setRemove(null)}>Cancel</Button>
        <Button type="button" disabled={!remove || archive.isPending} onClick={() => {
          if (!remove) return;
          if (removalRequest.current?.mealId !== remove.id || removalRequest.current.revision !== remove.revision) removalRequest.current = { mealId: remove.id, revision: remove.revision, id: crypto.randomUUID() };
          archive.mutate({ requestId: removalRequest.current.id, meal: remove });
        }}>{archive.isPending ? 'Removing…' : 'Remove'}</Button>
      </div>
    </Dialog>
  </>;
}

function makeMealCard(key: string, name: string, items: DraftFood[], fields: NutrientField[], sortTime: number, use: () => void, edit: () => void, remove?: () => void): LibraryCard {
  const calories = mealMetric(items, CALORIES);
  const shownFields = fields.filter((field) => field.is_displayed).slice(0, 3);
  const metrics = shownFields.flatMap((field) => {
    const metric = mealMetric(items, field.field_id);
    return metric.value === null ? [] : [{ label: field.name, value: `${metric.estimated ? '≈' : ''}${number(metric.value)} ${field.unit}`, incomplete: !metric.complete }];
  });
  const mealFoods: CalendarMealFood[] = items.map((item, index) => ({
    key: `${key}:${index}`, name: item.name, brand: item.brand, portion: `${item.amount} ${item.unit}`,
    calories: portionValue(item, CALORIES) === null ? '—' : `${valueCertainty(item, CALORIES) === 'estimated' ? '≈' : ''}${number(portionValue(item, CALORIES)!)}`,
    metrics: fields.flatMap((field) => {
      const value = portionValue(item, field.field_id);
      return value === null ? [] : [{ label: field.name, value: `${valueCertainty(item, field.field_id) === 'estimated' ? '≈' : ''}${number(value)} ${field.unit}` }];
    }),
  }));
  return { key, name, kind: 'Meal', calories: calories.value === null ? '—' : `${calories.estimated ? '≈' : ''}${number(calories.value)}`,
    caloriesIncomplete: !calories.complete, foods: mealFoods, metrics, sortTime, use, edit, remove };
}
