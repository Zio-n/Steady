# Calendar meal card QA

## Reference and implementation

- Reference: `/Users/zion/Downloads/IMG_7203.HEIC`, the user's latest meal-card sketch. The photo was rotated for comparison only.
- Preview: `http://localhost:5173/?review=3`.
- Browser viewport: 655 × 743 CSS pixels for the latest visual check.
- Evidence: `/private/tmp/steady-meal-final-read-v2.png` and `/private/tmp/steady-meal-final-comparison-v2.png` (655 × 743 CSS pixel viewport).
- Comparison includes the sketch and the real running implementation together. It was visually inspected after correcting the photo orientation.

## Flow changes

- The day occurrence fills its time row with a small inset and rounded corners. Selecting it adds a clear shadow. Eaten cards use a sage fill; planned cards use a warm amber fill. The state badge sits directly under the calorie count.
- Details open below the selected row as a floating surface. The calendar remains visible; there is no page scrim or modal backdrop. The 560px panel is centered on the active row and moves above it when there is not enough room below.
- The panel follows the sketch's hierarchy: actions at upper right, title and calories below, then item rows, a visible `Meal nutrition` section, and a bottom state action (`Mark as eaten` for planned meals; `Mark as not eaten` for eaten meals).
- Each food row opens its own nutrient details. In edit mode each food's attributes have their own collapsed disclosure; expanding one reveals its name, brand when supported, calories and nutrients at the food's declared basis. Portion editing stays a separate action.
- Eaten-food corrections update that entry's captured snapshot only. They do not mutate the shared food catalogue. `Save details` writes the expanded food's values; the row stays collapsed until the user chooses it.
- The vertical ellipsis opens the requested `Duplicate` action. Delete remains recoverable through the existing Undo path.

## Review findings corrected

- The previous detail panel was too wide and left-aligned for the full-width meal row. It is now 560px wide, centered on that row, and bounded by the viewport.
- Food summary values sat halfway across the panel because the list row's old grid layout constrained the new disclosure. The detail list now uses full-width rows, aligning portions and calories at the right edge.
- Edit mode initially exposed all nutrient controls at once. Each food's fields are now behind its own disclosure, with its basis shown explicitly (for example, `per 100 g`) so the value is distinct from the logged portion total.
- Meal nutrition was too easy to miss while collapsed, so it is now a visible section below the food rows. It shows the captured totals in compact nutrient cards.
- Eaten and planned cards had nearly identical fills; they now use visibly different sage and amber fills. The state badge is aligned under the calorie value.
- Existing Steady type, spacing and color tokens are retained. No generated imagery or new visual dependency was added.

## Checks

- Read view: two food rows, portions/calories aligned right, meal nutrition visible, selected card shadow, Eaten badge below calories, and a reversible `Mark as not eaten` action visible.
- Edit view: opening one food's details revealed only that food's fields; the other food stayed collapsed. Nutrition basis and editable fields were visible without saving or changing user data.
- Existing Duplicate menu was verified without invoking the mutation. Existing `Delete` routes through soft removal and Undo. Planned entries expose `Mark as eaten`; the state mutation was not invoked against the user's saved data.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` (67 passing), and `git diff --check` pass.
- The local food-snapshot migration was applied earlier in the active work. `npm run db:test` could not start because Supabase CLI attempted to write `/Users/zion/.supabase/telemetry.json` outside the writable workspace; the sandbox denied that write. No database-test result is claimed.
- Narrow mobile layout was not browser-verified in this pass; CSS collapses the edit fields to one column below 520px.

## Result

passed
