import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../app/AuthProvider';
import { archiveFood, deleteFood, loadFoodLibrary, loadFoodReferences, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { LibraryMeals } from '../../features/library/LibraryMeals';
import { queryKeys } from '../../data/queryKeys';
import { useProfile } from '../../features/profile/useProfile';
import { FoodEditor } from '../../features/library/FoodEditor';
import { CALORIES, formatNutrition, valueCertainty } from '../../domain/mealComposer';
import { libraryDraft } from '../../features/today/composerFoods';
import { loadFoodPortionPreferences } from '../../data/repositories/foodPortionPreferenceRepository';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

const formatPortion = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

export function LibraryPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const userId = session?.user.id;
  const profile = useProfile();
  const queryClient = useQueryClient();
  const activeWrites = useIsMutating();
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'meals' ? 'meals' : 'foods';
  const mealView = params.get('list') === 'saved' || params.has('saved') ? 'saved' : 'recent';
  const [pendingView, setPendingView] = useState<'foods' | 'meals' | null>(null);
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const [editing, setEditing] = useState<FoodWithNutrients | null>(null);
  const [mealDraftDirty, setMealDraftDirty] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<FoodWithNutrients | null>(null);
  const [pageNotice, setPageNotice] = useState('');
  const [pageError, setPageError] = useState('');
  const normalizedSearch = search.trim();
  const foods = useInfiniteQuery({
    queryKey: userId ? queryKeys.foodSearch(userId, normalizedSearch, sort) : ['foods', 'signed-out'],
    queryFn: ({ pageParam }) => loadFoodLibrary(userId!, normalizedSearch, pageParam, 20, sort),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.length * 20 : undefined,
    enabled: Boolean(userId && view === 'foods'),
  });
  const portions = useQuery({
    queryKey: userId ? queryKeys.foodPortionPreferences(userId) : ['food-portions', 'signed-out'],
    queryFn: () => loadFoodPortionPreferences(userId!),
    enabled: Boolean(userId && view === 'foods'),
  });
  useEffect(() => {
    if (params.get('create') === '1') navigate('/library?view=meals&list=saved', { replace: true });
  }, [navigate, params]);
  const foodReferences = useQuery({
    queryKey: deleteCandidate && userId ? queryKeys.foodReferences(userId, deleteCandidate.food.id) : ['food-references', 'closed'],
    queryFn: () => loadFoodReferences(userId!, deleteCandidate!.food.id),
    enabled: Boolean(deleteCandidate && userId),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ requestId, food }: { requestId: string; food: FoodWithNutrients }) => deleteFood(requestId, food.food.id, food.food.revision),
    onSuccess: async () => {
      setDeleteCandidate(null);
      setPageError('');
      setPageNotice('Food deleted.');
      if (userId) await refreshFoods(userId);
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'We couldn’t delete that food. Refresh and try again.'),
  });
  const archiveMutation = useMutation({
    mutationFn: ({ requestId, food }: { requestId: string; food: FoodWithNutrients }) => archiveFood(requestId, food.food.id, food.food.revision),
    onSuccess: async () => {
      setDeleteCandidate(null);
      setPageError('');
      setPageNotice('Food archived.');
      if (userId) await refreshFoods(userId);
    },
    onError: (error) => setPageError(error instanceof Error ? error.message : 'We couldn’t archive that food. Refresh and try again.'),
  });

  function refreshFoods(accountId: string) {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.foods(accountId) }),
      queryClient.invalidateQueries({ queryKey: ['account', accountId, 'meal-library'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recentChoices(accountId) }),
      queryClient.invalidateQueries({ queryKey: ['account', accountId, 'food-references'] }),
    ]);
  }

  function handleSaved() {
    setEditing(null);
    setIsCreating(false);
    setPageError('');
    setPageNotice('Food saved.');
    if (userId) void refreshFoods(userId);
  }

  function confirmRemoval() {
    if (!deleteCandidate) return;
    if ((foodReferences.data?.meals.length ?? 0) > 0) {
      archiveMutation.mutate({ requestId: crypto.randomUUID(), food: deleteCandidate });
      return;
    }
    deleteMutation.mutate({ requestId: crypto.randomUUID(), food: deleteCandidate });
  }

  const hasOpenEditor = isCreating || Boolean(editing);

  function switchView(next: 'foods' | 'meals') {
    setParams(next === 'meals' ? { view: 'meals' } : {});
    setSearch('');
    setPageError('');
    setPendingView(null);
  }

  function requestView(next: 'foods' | 'meals') {
    if (next === view) return;
    if (hasOpenEditor || activeWrites > 0) {
      setPendingView(next);
      return;
    }
    switchView(next);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'foods' : event.key === 'End' ? 'meals' : view === 'foods' ? 'meals' : 'foods';
    requestView(next);
    if (!hasOpenEditor && activeWrites === 0) document.getElementById(`library-${next}-tab`)?.focus();
  }

  if (!userId) return <section className="page-stack"><LoadingSkeleton label="Loading your library" /></section>;
  if (profile.isPending) return <section className="page-stack"><div><p className="eyebrow">YOUR FOODS, YOUR WAY</p><h1>Library</h1></div><LoadingSkeleton label="Loading your nutrient fields" /></section>;
  if (profile.isError) return <section className="page-stack"><div><p className="eyebrow">YOUR FOODS, YOUR WAY</p><h1>Library</h1></div><StatusMessage tone="error">We couldn’t load your nutrient fields. Your foods are safe; return to Profile and try again.</StatusMessage></section>;

  return (
    <section className="page-stack library-page">
      <UnsavedChangesPrompt isDirty={hasOpenEditor || mealDraftDirty || activeWrites > 0} />
      <div className="library-heading">
        <h1>Library</h1>
        {view === 'foods' && <Button type="button" onClick={() => { setPageNotice(''); setPageError(''); setEditing(null); setIsCreating(true); }}><Plus size={17} aria-hidden="true" /> Add food</Button>}
      </div>
      <div className="library-view-tabs" role="tablist" aria-label="Library type">
        <button id="library-foods-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={view === 'foods'} tabIndex={view === 'foods' ? 0 : -1} onClick={() => requestView('foods')} onKeyDown={handleTabKeyDown}>Foods</button>
        <button id="library-meals-tab" type="button" role="tab" aria-controls="library-panel" aria-selected={view === 'meals'} tabIndex={view === 'meals' ? 0 : -1} onClick={() => requestView('meals')} onKeyDown={handleTabKeyDown}>Meals</button>
      </div>
      <div id="library-panel" className="library-panel" role="tabpanel" aria-labelledby={`library-${view}-tab`} tabIndex={0}>
      <label className="library-search" role="search">
        <Search size={18} aria-hidden="true" />
        <span className="visually-hidden">Search {view}</span>
        <input type="search" value={search} placeholder={view === 'foods' ? 'Search foods and brands' : 'Search meals'} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {view === 'foods' ? <>
      <div className="library-controls"><span>{search ? 'Matching foods' : 'Saved foods'}</span><label>Sort <select className="text-field" value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'recent')}><option value="name">Name</option><option value="recent">Recently added</option></select></label></div>
      {pageNotice && <StatusMessage tone="success">{pageNotice}</StatusMessage>}
      {pageError && <StatusMessage tone="error">{pageError}</StatusMessage>}
      {isCreating && <FoodEditor key="new-food" requestKey="new-food" food={null} fields={profile.data?.nutrientFields ?? []} onSaved={handleSaved} onCancel={() => setIsCreating(false)} />}
      {editing && <FoodEditor key={editing.food.id} requestKey={`edit-${editing.food.id}`} food={editing} fields={profile.data?.nutrientFields ?? []} onSaved={handleSaved} onCancel={() => setEditing(null)} />}

      {foods.isPending ? <LoadingSkeleton label="Loading saved foods" /> : foods.isError ? (
        <div className="page-stack"><StatusMessage tone="error">We couldn’t load your foods. Your data is safe; try again.</StatusMessage><Button variant="secondary" type="button" onClick={() => void foods.refetch()}>Try again</Button></div>
      ) : foods.data.pages.every((page) => page.entries.length === 0) ? (
        <EmptyState icon={<BookOpen size={24} />} title={normalizedSearch ? 'No foods match that search' : 'Your library starts here'}>
          <p>{normalizedSearch ? 'Try another name or brand, or add this food to your library.' : 'Add foods you use often. You can leave unknown nutrients blank and add them later.'}</p>
        </EmptyState>
      ) : (
        <ul className="food-list" aria-label="Saved foods">
          {foods.data.pages.flatMap((page) => page.entries).map((entry) => {
            const remembered = portions.data?.[`library:${entry.food.id}`];
            const basis = libraryDraft(entry, { amount: String(entry.food.basis_amount), unit: entry.food.basis_unit });
            const estimated = valueCertainty(basis, CALORIES) === 'estimated';
            return (
            <li className="food-card" key={entry.food.id}>
              <div className="food-card-main">
                <div><h2>{entry.food.name}</h2>{entry.food.brand && <p className="food-brand">{entry.food.brand}</p>}</div>
                <div className="food-basis">
                  <span>{entry.food.calories_kcal === null ? '—' : `${estimated ? '≈' : ''}${formatNutrition(entry.food.calories_kcal)}`} kcal per {formatPortion.format(entry.food.basis_amount)} {entry.food.basis_unit}</span>
                  {remembered && <small>Last used · {formatPortion.format(Number(remembered.amount))} {remembered.unit}</small>}
                </div>
              </div>
              <div className="food-card-actions">
                <Button variant="secondary" type="button" onClick={() => { setEditing(entry); setIsCreating(false); setPageNotice(''); }}>Edit</Button>
                <button className="icon-button" type="button" aria-label={`Delete ${entry.food.name}`} onClick={() => { setDeleteCandidate(entry); setPageError(''); }}><Trash2 size={17} /></button>
              </div>
            </li>
          ); })}
        </ul>
      )}
      {foods.hasNextPage && <Button variant="secondary" type="button" disabled={foods.isFetchingNextPage} onClick={() => void foods.fetchNextPage()}>{foods.isFetchingNextPage ? 'Loading more…' : 'Load more foods'}</Button>}
      </> : <LibraryMeals userId={userId} fields={profile.data?.nutrientFields ?? []} search={normalizedSearch}
        view={mealView} onViewChange={(next) => setParams(next === 'saved' ? { view: 'meals', list: 'saved' } : { view: 'meals' }, { replace: true })}
        onSaved={() => { setSearch(''); setParams({ view: 'meals', list: 'saved' }, { replace: true }); }}
        onDraftChange={setMealDraftDirty} />}

      </div>

      <Dialog open={pendingView !== null} title="Switch Library view?" onClose={() => setPendingView(null)}>
        <p>{activeWrites > 0 ? 'A save is still in progress. Wait for it to finish before switching.' : hasOpenEditor ? `Your open ${view === 'foods' ? 'food' : 'meal'} editor has not been saved. Switching will discard its draft.` : 'The save has finished. You can switch views now.'}</p>
        <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setPendingView(null)}>Keep editing</Button><Button type="button" disabled={activeWrites > 0} onClick={() => { setIsCreating(false); setEditing(null); switchView(pendingView!); }}>Discard and switch</Button></div>
      </Dialog>

      <Dialog open={Boolean(deleteCandidate)} title={foodReferences.data?.meals.length ? 'Review food references' : 'Delete this food?'} onClose={() => setDeleteCandidate(null)}>
        {foodReferences.isPending ? <LoadingSkeleton label="Checking saved meal references" /> : foodReferences.isError ? <StatusMessage tone="error">We couldn’t check references, so the food cannot be removed yet. Retry after reconnecting.</StatusMessage> : foodReferences.data.meals.length ? (
          <div className="food-reference-preview">
            <p>{deleteCandidate?.food.name} is used by these saved meals. Archive it from the Library to keep those meal references intact.</p>
            <ul>{foodReferences.data.meals.map((meal) => <li key={meal.id}>{meal.name}</li>)}</ul>
          </div>
        ) : <p>{deleteCandidate?.food.name} will be permanently removed from your library. This cannot be undone here.</p>}
        {(deleteMutation.isError || archiveMutation.isError) && <StatusMessage tone="error">{pageError}</StatusMessage>}
        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={() => setDeleteCandidate(null)}>Keep food</Button>
          <Button type="button" disabled={foodReferences.isPending || foodReferences.isError || deleteMutation.isPending || archiveMutation.isPending} onClick={confirmRemoval}>
            {deleteMutation.isPending ? 'Deleting…' : archiveMutation.isPending ? 'Archiving…' : foodReferences.data?.meals.length ? 'Archive food' : 'Delete food'}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
