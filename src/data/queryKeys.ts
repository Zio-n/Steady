/**
 * Every private query is rooted in the authenticated account ID. This keeps
 * cached data from one account from being reused after an account switch.
 */
export const queryKeys = {
  account: (userId: string) => ['account', userId] as const,
  profile: (userId: string) => ['account', userId, 'profile'] as const,
  foods: (userId: string) => ['account', userId, 'foods'] as const,
  foodSearch: (userId: string, search: string, sort: string) => ['account', userId, 'foods', search, sort] as const,
  foodReferences: (userId: string, foodId: string) => ['account', userId, 'food-references', foodId] as const,
  foodPortionPreferences: (userId: string) => ['account', userId, 'food-portion-preferences'] as const,
  catalogFoodSearch: (search: string, locale: string | null) => ['catalogue', 'food-search', search, locale] as const,
  mealLibrary: (userId: string, search: string) => ['account', userId, 'meal-library', search] as const,
  day: (userId: string, localDate: string) => ['account', userId, 'day', localDate] as const,
  calendarRange: (userId: string, fromDate: string, toDate: string) => ['account', userId, 'calendar-range', fromDate, toDate] as const,
  recentChoices: (userId: string) => ['account', userId, 'recent-choices'] as const,
};
