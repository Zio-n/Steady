import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthProvider';
import { loadFoodLibrary, type FoodWithNutrients } from '../../data/repositories/foodRepository';
import { loadMealEntry } from '../../data/repositories/mealRepository';
import { queryKeys } from '../../data/queryKeys';
import { MealEditor } from '../../features/library/MealEditor';
import { useProfile } from '../../features/profile/useProfile';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusMessage } from '../components/StatusMessage';
import { UnsavedChangesPrompt } from '../components/UnsavedChangesPrompt';

export function MealBuilderPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const profile = useProfile();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDirty, setIsDirty] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const onDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), []);
  const foods = useQuery({
    queryKey: userId ? [...queryKeys.foods(userId), 'builder'] : ['foods', 'signed-out', 'builder'],
    queryFn: async () => {
      const entries: FoodWithNutrients[] = [];
      let hasMore = true;
      while (hasMore) {
        const page = await loadFoodLibrary(userId!, '', entries.length, 100, 'recent');
        entries.push(...page.entries);
        hasMore = page.hasMore;
      }
      return entries;
    },
    enabled: Boolean(userId),
  });
  const meal = useQuery({
    queryKey: userId && editId ? ['account', userId, 'builder-meal', editId] : ['builder-meal', 'new'],
    queryFn: () => loadMealEntry(userId!, editId!),
    enabled: Boolean(userId && editId),
  });
  const returnTo = params.get('from') === 'calendar' ? '/' : '/library?view=meals';
  const onSaved = useCallback(() => {
    setHasSaved(true);
    setIsDirty(false);
    if (userId) void queryClient.invalidateQueries({ queryKey: ['account', userId, 'meal-library'] });
  }, [queryClient, userId]);
  useEffect(() => {
    if (hasSaved) navigate('/library?view=meals&saved=1', { replace: true });
  }, [hasSaved, navigate]);

  if (!userId || profile.isPending || foods.isPending || (editId && meal.isPending)) return <div className="meal-builder-loading"><LoadingSkeleton label="Opening meal builder" /></div>;
  if (profile.isError || foods.isError || meal.isError) return <div className="meal-builder-loading"><StatusMessage tone="error">We couldn’t load the meal builder. Your saved foods and meals are unchanged.</StatusMessage></div>;
  if (editId && !meal.data) return <div className="meal-builder-loading"><StatusMessage tone="error">This meal is no longer available in your Library.</StatusMessage></div>;
  return <>
    <UnsavedChangesPrompt isDirty={isDirty && !hasSaved} />
    <MealEditor key={editId ?? 'new-meal'} requestKey={editId ?? 'new-meal'} meal={editId ? meal.data ?? null : null} foods={foods.data ?? []} fields={profile.data?.nutrientFields ?? []} userId={userId} onSaved={onSaved} onCancel={() => navigate(returnTo)} onDirtyChange={onDirtyChange} />
  </>;
}
