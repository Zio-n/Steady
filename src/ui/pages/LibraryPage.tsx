import { useState } from 'react';
import { useInfiniteQuery, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownAZ, Clock3, Plus, Search } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { archiveFood, deleteFood, loadFoodLibrary, loadFoodReferences, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { LibraryMeals } from '../../features/library/LibraryMeals';
import { queryKeys } from '../../data/queryKeys';
import { useProfile } from '../../features/profile/useProfile';
import { FoodEditor } from '../../features/library/FoodEditor';
import { LibraryEntryComposer } from '../../features/today/AddChoiceDialog';
import { loadFoodPortionPreferences } from '../../data/repositories/foodPortionPreferenceRepository';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

export function LibraryPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const profile = useProfile();
  const queryClient = useQueryClient();
  const activeWrites = useIsMutating();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const [editing, setEditing] = useState<FoodWithNutrients | null>(null);
  const [mealDraftDirty, setMealDraftDirty] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<FoodWithNutrients | null>(null);
  const [pageNotice, setPageNotice] = useState('');
  const [pageError, setPageError] = useState('');
  const foods = useInfiniteQuery({
    queryKey: userId ? queryKeys.foodSearch(userId, search.trim(), sort) : ['foods', 'signed-out'],
    queryFn: ({ pageParam }) => loadFoodLibrary(userId!, search.trim(), pageParam, 20, sort),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.length * 20 : undefined,
    enabled: Boolean(userId),
  });
  const portions = useQuery({
    queryKey: userId ? queryKeys.foodPortionPreferences(userId) : ['food-portions', 'signed-out'],
    queryFn: () => loadFoodPortionPreferences(userId!), enabled: Boolean(userId),
  });
  const foodReferences = useQuery({
    queryKey: deleteCandidate && userId ? queryKeys.foodReferences(userId, deleteCandidate.food.id) : ['food-references', 'closed'],
    queryFn: () => loadFoodReferences(userId!, deleteCandidate!.food.id), enabled: Boolean(deleteCandidate && userId),
  });
  const refreshFoods = (accountId: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.foods(accountId) }),
    queryClient.invalidateQueries({ queryKey: ['account', accountId, 'meal-library'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(accountId) }),
    queryClient.invalidateQueries({ queryKey: ['account', accountId, 'food-references'] }),
  ]);
  const deleteMutation = useMutation({
    mutationFn: ({ requestId, food }: { requestId: string; food: FoodWithNutrients }) => deleteFood(requestId, food.food.id, food.food.revision),
    onSuccess: async () => { setDeleteCandidate(null); setPageError(''); setPageNotice('Food deleted.'); if (userId) await refreshFoods(userId); },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'We couldn’t delete that food. Refresh and try again.'),
  });
  const archiveMutation = useMutation({
    mutationFn: ({ requestId, food }: { requestId: string; food: FoodWithNutrients }) => archiveFood(requestId, food.food.id, food.food.revision),
    onSuccess: async () => { setDeleteCandidate(null); setPageError(''); setPageNotice('Food archived.'); if (userId) await refreshFoods(userId); },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'We couldn’t archive that food. Refresh and try again.'),
  });
  const hasOpenEditor = isCreating || Boolean(editing);
  const handleSaved = () => {
    setEditing(null); setIsCreating(false); setSearch(''); setPageError(''); setPageNotice('Saved to Library.');
    if (userId) void refreshFoods(userId);
  };
  const confirmRemoval = () => {
    if (!deleteCandidate) return;
    const input = { requestId: crypto.randomUUID(), food: deleteCandidate };
    if ((foodReferences.data?.meals.length ?? 0) > 0) archiveMutation.mutate(input);
    else deleteMutation.mutate(input);
  };

  if (!userId) return <section className="page-stack"><LoadingSkeleton label="Loading your library" /></section>;
  if (profile.isPending) return <section className="page-stack"><div><p className="eyebrow">YOUR FOODS, YOUR WAY</p><h1>Library</h1></div><LoadingSkeleton label="Loading your nutrient fields" /></section>;
  if (profile.isError) return <section className="page-stack"><div><p className="eyebrow">YOUR FOODS, YOUR WAY</p><h1>Library</h1></div><StatusMessage tone="error">We couldn’t load your nutrient fields. Your foods are safe; return to Profile and try again.</StatusMessage></section>;
  const entries = foods.data?.pages.flatMap((page) => page.entries) ?? [];
  const fields = profile.data?.nutrientFields ?? [];

  return <section className="page-stack library-page">
    <UnsavedChangesPrompt isDirty={hasOpenEditor || mealDraftDirty || activeWrites > 0} />
    <div className="library-heading">
      <h1>Library</h1>
      <Button type="button" onClick={() => { setPageNotice(''); setPageError(''); setEditing(null); setIsCreating(true); }}><Plus size={17} aria-hidden="true" /> Add to library</Button>
    </div>
    <div className="library-search-row" role="search">
      <label className="library-search">
        <Search size={18} aria-hidden="true" /><span className="visually-hidden">Search your library</span>
        <input type="search" value={search} placeholder="Search your library" onChange={(event) => setSearch(event.target.value)} />
      </label>
      <button className="icon-button library-sort-button" type="button" title={sort === 'name' ? 'Sort by recent' : 'Sort A to Z'}
        aria-label={sort === 'name' ? 'Sorted by name. Sort by recent.' : 'Sorted by recent. Sort A to Z.'}
        onClick={() => setSort(sort === 'name' ? 'recent' : 'name')}>
        {sort === 'name' ? <ArrowDownAZ size={18} aria-hidden="true" /> : <Clock3 size={18} aria-hidden="true" />}
      </button>
    </div>
    {pageNotice && <StatusMessage tone="success">{pageNotice}</StatusMessage>}
    {pageError && <StatusMessage tone="error">{pageError}</StatusMessage>}
    <LibraryMeals userId={userId} fields={fields} search={search.trim()} foods={entries}
      portions={portions.data ?? {}} sort={sort}
      foodsPending={foods.isPending} foodsError={foods.isError} onRetryFoods={() => void foods.refetch()}
      hasMoreFoods={Boolean(foods.hasNextPage)} loadingMoreFoods={foods.isFetchingNextPage} onLoadMoreFoods={() => void foods.fetchNextPage()}
      onEditFood={(food) => { setEditing(food); setIsCreating(false); setPageNotice(''); }}
      onDeleteFood={(food) => { setDeleteCandidate(food); setPageError(''); }}
      onSavedMeal={() => { setSearch(''); setPageNotice('Meal saved.'); if (userId) void refreshFoods(userId); }}
      onDraftChange={setMealDraftDirty} />

    {editing && <Dialog open title="Edit food" className="logging-composer library-food-dialog" controlledClose lightDismiss onClose={() => setEditing(null)}>
      <FoodEditor key={editing.food.id} requestKey={`edit-${editing.food.id}`} food={editing} fields={fields}
        onSaved={handleSaved} onCancel={() => setEditing(null)} />
    </Dialog>}
    {isCreating && <LibraryEntryComposer userId={userId} fields={fields}
      onClose={() => { setIsCreating(false); setMealDraftDirty(false); }} onSaved={() => { handleSaved(); setMealDraftDirty(false); }} onDraftChange={setMealDraftDirty} />}

    <Dialog open={Boolean(deleteCandidate)} title={foodReferences.data?.meals.length ? 'Review food references' : 'Delete this food?'} onClose={() => setDeleteCandidate(null)}>
      {foodReferences.isPending ? <LoadingSkeleton label="Checking saved meal references" /> : foodReferences.isError ? <StatusMessage tone="error">We couldn’t check references, so the food cannot be removed yet. Retry after reconnecting.</StatusMessage> : foodReferences.data.meals.length ? <div className="food-reference-preview">
        <p>{deleteCandidate?.food.name} is used by these saved meals. Archive it from the Library to keep those meal references intact.</p>
        <ul>{foodReferences.data.meals.map((meal) => <li key={meal.id}>{meal.name}</li>)}</ul>
      </div> : <p>{deleteCandidate?.food.name} will be permanently removed from your library. This cannot be undone here.</p>}
      {(deleteMutation.isError || archiveMutation.isError) && <StatusMessage tone="error">{pageError}</StatusMessage>}
      <div className="dialog-actions">
        <Button variant="secondary" type="button" onClick={() => setDeleteCandidate(null)}>Keep food</Button>
        <Button type="button" disabled={foodReferences.isPending || foodReferences.isError || deleteMutation.isPending || archiveMutation.isPending} onClick={confirmRemoval}>
          {deleteMutation.isPending ? 'Deleting…' : archiveMutation.isPending ? 'Archiving…' : foodReferences.data?.meals.length ? 'Archive food' : 'Delete food'}
        </Button>
      </div>
    </Dialog>
  </section>;
}
