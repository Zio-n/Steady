import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultShuffleReplacementAmount, previewWholeDayShuffle, rankShuffleCandidates, shuffleDefaults, shufflePoolMessage, type ShuffleCandidate, type ShuffleContext } from '../../src/domain/shuffle.ts';

const candidate = (mealId: string, caloriesKcal: number | null, overrides: Partial<ShuffleCandidate> = {}): ShuffleCandidate => ({
  mealId,
  name: mealId,
  active: true,
  sections: ['lunch'],
  hasValidComponents: true,
  caloriesKcal,
  nutrients: { protein: 10, sugar: 2 },
  portionMultiplier: 1,
  revision: 1,
  ...overrides,
});

const context = (overrides: Partial<ShuffleContext> = {}): ShuffleContext => ({
  section: 'lunch',
  seed: 'account:2026-10-03:lunch:0',
  remainingCaloriesKcal: 600,
  remainingSlots: 2,
  proteinFieldId: 'protein',
  remainingProtein: 20,
  remainingNutrients: { protein: 20, sugar: 4, salt: null },
  recentMealIds: [],
  sameDayMealIds: [],
  ...overrides,
});

test('shuffle filters inactive, invalid, untagged and unscorable meals', () => {
  const ranked = rankShuffleCandidates([
    candidate('eligible', 300),
    candidate('inactive', 300, { active: false }),
    candidate('invalid', 300, { hasValidComponents: false }),
    candidate('untagged', 300, { sections: ['breakfast'] }),
    candidate('unknown-calories', null),
    candidate('bad-multiplier', 300, { portionMultiplier: 0 }),
  ], context());

  assert.deepEqual(ranked.map((entry) => entry.candidate.mealId), ['eligible']);
});

test('shuffle pool explanations distinguish an empty library, missing section tags and unusable nutrition', () => {
  assert.match(shufflePoolMessage('Breakfast', { activeMeals: 0, sectionTagged: 0, scorable: 0 }) ?? '', /Save an active meal/);
  assert.match(shufflePoolMessage('Breakfast', { activeMeals: 3, sectionTagged: 0, scorable: 0 }) ?? '', /No active saved meal is tagged for Breakfast/);
  assert.match(shufflePoolMessage('Breakfast', { activeMeals: 3, sectionTagged: 2, scorable: 0 }) ?? '', /valid recipe with known calories/);
  assert.equal(shufflePoolMessage('Breakfast', { activeMeals: 3, sectionTagged: 2, scorable: 1 }), null);
});

test('closest per-slot calorie fit leads while portion multiplier is respected', () => {
  const ranked = rankShuffleCandidates([
    candidate('far', 250, { portionMultiplier: 1 }),
    candidate('close', 200, { portionMultiplier: 1.5 }),
  ], context());

  assert.equal(ranked[0]?.candidate.mealId, 'close');
  assert.equal(ranked[0]?.projectedCaloriesKcal, 300);
});

test('known protein shortfall breaks equal calorie-fit ties; unknown protein earns no fit bonus', () => {
  const ranked = rankShuffleCandidates([
    candidate('unknown', 300, { nutrients: { protein: null, sugar: 0 } }),
    candidate('protein-fit', 300, { nutrients: { protein: 20, sugar: null } }),
    candidate('protein-low', 300, { nutrients: { protein: 5, sugar: null } }),
  ], context());

  assert.deepEqual(ranked.map((entry) => entry.candidate.mealId), ['protein-fit', 'protein-low', 'unknown']);
  assert.equal(ranked[0]?.proteinShortfall, 0);
  assert.equal(ranked[2]?.proteinShortfall, null);
});

test('selected non-protein nutrient overshoot is penalized without rewarding an increase', () => {
  const ranked = rankShuffleCandidates([
    candidate('sugar-over', 300, { nutrients: { protein: 10, sugar: 20 } }),
    candidate('sugar-safe', 300, { nutrients: { protein: 10, sugar: null } }),
  ], context());

  assert.equal(ranked[0]?.candidate.mealId, 'sugar-safe');
  assert.ok((ranked.find((entry) => entry.candidate.mealId === 'sugar-over')?.nutrientOvershootPenalty ?? 0) > 0);
  assert.equal(shuffleDefaults.recentLookbackLocalDays, 7);
});

test('same-day duplicates are excluded when alternatives exist and penalized when unavoidable', () => {
  const options = [candidate('already-used', 300), candidate('fresh', 300)];
  const withAlternative = rankShuffleCandidates(options, context({ sameDayMealIds: ['already-used'] }));
  assert.deepEqual(withAlternative.map((entry) => entry.candidate.mealId), ['fresh']);

  const exhausted = rankShuffleCandidates([options[0]!], context({ sameDayMealIds: ['already-used'] }));
  assert.equal(exhausted[0]?.repeatsToday, true);
  assert.equal(exhausted[0]?.recentPenalty, shuffleDefaults.sameDayRepetitionPenalty);
});

test('recently used meals receive a soft penalty and seeded ties are repeatable', () => {
  const options = [candidate('recent', 300), candidate('new', 300)];
  const ranked = rankShuffleCandidates(options, context({ recentMealIds: ['recent'] }));
  assert.equal(ranked[0]?.candidate.mealId, 'new');
  assert.equal(ranked.find((entry) => entry.candidate.mealId === 'recent')?.usedRecently, true);
  assert.deepEqual(
    rankShuffleCandidates(options, context({ seed: 'stable-seed' })).map((entry) => entry.candidate.mealId),
    rankShuffleCandidates([...options].reverse(), context({ seed: 'stable-seed' })).map((entry) => entry.candidate.mealId),
  );
});

test('invalid remaining-slot and allowance inputs produce no candidate list', () => {
  assert.deepEqual(rankShuffleCandidates([candidate('meal', 300)], context({ remainingSlots: 0 })), []);
  assert.deepEqual(rankShuffleCandidates([candidate('meal', 300)], context({ remainingCaloriesKcal: Number.NaN })), []);
});

test('whole-day shuffle processes slots in stable order and updates projected allowance after each pick', () => {
  const candidates = [
    candidate('shared', 250, { sections: ['breakfast', 'lunch'], nutrients: { protein: 5, sugar: 0 } }),
    candidate('breakfast-low', 100, { sections: ['breakfast'], nutrients: { protein: 2, sugar: 0 } }),
    candidate('lunch-fresh', 240, { sections: ['lunch'], nutrients: { protein: 8, sugar: 0 } }),
  ];
  const result = previewWholeDayShuffle([
    { itemId: 'lunch-slot', section: 'lunch', amount: 1, position: 0 },
    { itemId: 'breakfast-slot', section: 'breakfast', amount: 1, position: 0 },
  ], candidates, {
    seed: 'whole-day',
    targetCaloriesKcal: 500,
    currentCaloriesKcal: 0,
    currentCaloriesComplete: true,
    proteinFieldId: 'protein',
    targetNutrients: { protein: 20 },
    currentNutrients: { protein: 0 },
    completeNutrients: { protein: true },
    recentMealIds: [],
    sameDayMealIds: [],
  });

  assert.deepEqual(result.suggestions.map((entry) => entry.slot.itemId), ['breakfast-slot', 'lunch-slot']);
  assert.deepEqual(result.suggestions.map((entry) => entry.ranked?.candidate.mealId), ['shared', 'lunch-fresh']);
  assert.deepEqual(result.suggestions.map((entry) => entry.projectedCaloriesKcal), [250, 490]);
  assert.equal(result.projectedCaloriesKcal, 490);
  assert.equal(result.projectedNutrients.protein, 13);
});

test('whole-day preview reports section exhaustion without erasing other slot suggestions', () => {
  const result = previewWholeDayShuffle([
    { itemId: 'dinner-slot', section: 'dinner', amount: 1, position: 0 },
    { itemId: 'lunch-slot', section: 'lunch', amount: 1, position: 0 },
  ], [candidate('lunch', 250)], {
    seed: 'whole-day',
    targetCaloriesKcal: 900,
    currentCaloriesKcal: 100,
    currentCaloriesComplete: true,
    targetNutrients: {},
    currentNutrients: {},
    completeNutrients: {},
    recentMealIds: [],
    sameDayMealIds: [],
  });

  assert.equal(result.suggestions[0]?.ranked?.candidate.mealId, 'lunch');
  assert.equal(result.suggestions[1]?.ranked, null);
  assert.equal(result.caloriesComplete, false);
});

test('whole-day replacement keeps meal servings but never reuses a food-unit amount as servings', () => {
  assert.equal(defaultShuffleReplacementAmount('manual', 'meal', 1.5, 'servings'), 1.5);
  assert.equal(defaultShuffleReplacementAmount('routine', null, 2, 'serving'), 2);
  assert.equal(defaultShuffleReplacementAmount('manual', 'food', 40, 'g'), 1);
  assert.equal(defaultShuffleReplacementAmount('manual', 'one_off_meal', 3, 'servings'), 1);
});
