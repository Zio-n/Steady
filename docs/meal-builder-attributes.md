# Meal builder and meal logging attributes

**Status:** Agreed product direction. Existing meal name, ordered food components, quantities/units, live nutrient calculation, optional finished weight, logging snapshots, and recent-meal reuse are already supported. Other attributes below are planned additions. Keep optional details quick to enter and out of the main logging path.

## Product model: foods, recipes, and logged meals

- A **food** is one reusable ingredient or packaged item with its own nutrition and portions.
- A **recipe** is the reusable definition: a name, ordered ingredients and amounts, yield, and optionally method, time, equipment, and storage notes. Steady currently stores the name, ingredients, and amounts as a saved `meals` record with `meal_components`; yield and method-related fields are planned. The Library presents these under Meals.
- A **logged meal** is an eating occasion on a date, such as breakfast or lunch. It can contain individual foods, a saved recipe, or both. Its nutrition is captured as a dated snapshot so later recipe or food edits do not rewrite history.
- The multi-item picker draft is temporary. Logging several picked items currently creates separate dated entries in the same meal section as one atomic save. It does not create a Library recipe or a named parent group. A saved recipe selected from search logs as one entry with its calculated recipe nutrition. Only an explicit save creates a reusable Library meal/recipe.
- Search combines foods and saved meals/recipes in one result list. A multi-item draft does not become searchable unless the user explicitly saves it. Community recipes, when added, will be separately published recipe versions, never public copies of the user's private Library or diary.

If the day view later needs to show several picked items as one named expandable occasion, add a stable group identifier to the dated entries. Do not represent that group by silently saving every logged combination as a Library recipe.

## Meal and recipe details

| Attribute | Implementation |
| --- | --- |
| Name, meal type, notes | User-entered fields on a saved meal; keep meal type optional and use a small controlled list. |
| Ingredients / foods | Ordered meal components referencing a personal or catalogue food; store amount and unit. Store recipe-specific preparation (chopped, peeled, drained) on the component or method step. Keep nutrition-relevant food states (raw, cooked, drained) as distinct food variants in the catalogue. |
| Servings / yield | Store the recipe's total yield and serving unit. Scaling servings multiplies component amounts; nutrition recalculates from those amounts. |
| Instructions | Optional ordered text steps. Keep ingredient references optional so entering a recipe stays fast. |
| Prep and cooking time | Optional minutes split into hands-on prep, cooking, and waiting time; derive total elapsed time rather than asking users to enter it twice. Map these directly from structured recipe data when present; otherwise use the recipe suggestion service below. |
| Equipment | Optional list of common equipment labels with free-text fallback. Use source fields when available, otherwise let the recipe suggestion service propose it. |
| Cleanup effort | Optional low / medium / high estimate. Let the recipe suggestion service estimate from the full method and equipment, and allow the author to change it. |
| Recipe origin country | Optionally record the country where the recipe was created or its ingredients are customary. This helps users interpret ingredient names and availability. Do not assume the creator's current home country is the recipe's origin. |
| Nutrition | Calculate whole-recipe and per-serving totals from known component values and quantities. Show calories and protein first; expose other known nutrients on expansion. Unknown stays unknown. |
| Weight / volume | Show or calculate only when the food has a verified conversion; never convert grams to millilitres by assumption. |
| Allergens / dietary flags | Derive from component data only when complete enough to support the claim; otherwise omit the flag or show that information is unavailable. |
| Leftovers and storage | Optional number of portions kept, storage duration/instructions, and reheating note. Treat these as user-entered recipe guidance, not safety guarantees. |

Imported catalogue portion options are source-provided amount labels and gram weights; none is currently marked as a default. Show them as selectable measures and avoid choosing a default through a loose label heuristic. CoFID edible proportion and specific gravity are stored separately as food factors, not as household servings.

## Logging and reuse

| Attribute / action | Implementation |
| --- | --- |
| Date and time eaten | Save on each logged occurrence, separate from the reusable meal definition. |
| Amount eaten | Store servings or a supported custom quantity; scale logged nutrition from the saved meal's declared yield. |
| One-off changes | Store occurrence-level component/quantity overrides, so this log can differ without silently changing the saved meal. |
| Nutrition history | Freeze the resolved component names, amounts, basis, nutrient values, and source/version references in the eaten snapshot. |
| Recent meals | Rank the user's recent and saved meals for quick reuse; preserve their usual portion and allow adjustment before logging. |
| Recipe scaling | Recalculate ingredient quantities and nutrition from the chosen serving count; round display quantities sensibly but retain precise stored values. |

## Optional recipe suggestion service

Use a lightweight AI decision service only when structured source fields are absent and the recipe has text instructions or a description. Ask it for structured suggestions for prep/cook/wait time, equipment, and cleanup effort, with brief evidence from the supplied recipe text, confidence, and null for unsupported fields. Validate the output shape and bounds in code, show suggestions as estimates for author review, and cache them until the recipe changes. Do not call AI during logging or use it for arithmetic, nutrition, allergen decisions, or food-safety claims. Prefer direct source mapping where structured fields exist; AI must not turn missing source facts into confident claims.

Ingredient and recipe cost estimates are shelved. The [research checkpoint](ingredient-cost-coverage-review.md) records the local data and gaps for a possible future feature.

## Additional food-data enrichment priorities

These improve whether the meal attributes can be calculated and whether users can find/select the right food:

1. Use only normalized nutrient values in calculations; E1 added unit/provenance status and left unsupported Open Food Facts values source-unit-only.
2. Connect catalogue search results to an app flow that preserves source lineage when a user saves a shared food. E2 populated Open Food Facts alternate names and reviewed UK/US generic synonyms locally, with locale and provenance; the bounded search RPC is in place, but the current picker still searches private foods only.
3. Expand verified household portions and food-specific weight/volume conversions, especially for CoFID generic foods, which currently have no portions. CoFID's edible-proportion factor is an edible-yield adjustment, and specific gravity is a food-specific g↔ml conversion; neither should be presented as a household serving.
4. Preserve distinct nutrition-relevant variants such as raw/cooked, skinless/with skin, drained/undrained, and fat percentage. Keep recipe-specific chopping/peeling instructions on the recipe component or method step.
5. Show source-listed allergens separately from possible traces, preserving whether each source field came from ingredients or user input. For the current catalogue, Open Food Facts provides some such data; generic CoFID and USDA foods have none. Show “not reported” when absent, never infer allergen-free status, and never use AI to make allergen or safety claims.

Recipe instructions, equipment, cooking times, cleanup estimates, storage guidance, and leftovers are recipe-level data, not general food-catalogue attributes. Suggest missing time/equipment/cleanup fields from instructions with the lightweight AI flow above; do not use catalogue enrichment to fabricate them.

## Implementation order

1. Extend the private recipe definition with yield/serving unit, ordered method steps, active prep/cook/wait minutes, equipment, cleanup estimate, and storage/reheating notes. Extend components with optional preparation state. Keep these nullable/optional.
2. Use deterministic application code for serving scaling, nutrient totals, and total elapsed time. Preserve unknown values and only convert units where a verified conversion exists.
3. Keep the existing eaten snapshot boundary. On log, freeze the chosen servings/amount, one-off component changes, resolved nutrition and source/version details; later recipe edits must not rewrite the log.
4. Render ingredients and live nutrition first. Put effort, equipment, storage and other optional details behind progressive disclosure. Reuse the existing recent-meal flow; recipe yield scaling is a separate capability.
5. As an optional recipe enhancement, add a small AI suggestion call at recipe creation/import or when instructions change. It may suggest missing prep/cook/wait time, equipment and cleanup effort from supplied text. Return structured fields with supporting text and confidence; cache against the recipe revision, allow edits, and never invoke during meal logging. Directly copy fields when a trusted source already provides them.

## Display order

In the builder, prioritize ingredients and live nutrition; place time, equipment, cleanup, and storage under optional details. In the log, prioritize meal name, amount eaten, time, and nutrition for that amount. Keep source, licence, basis, and data-quality metadata inspectable in details rather than on every meal card.
