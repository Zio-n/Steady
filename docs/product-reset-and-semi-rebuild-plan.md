# Steady implementation plan — logging reset

**Updated:** 12 November 2026

**Status:** The approved composer is implemented and verified locally. Phase 0 cleanup evidence remains in the [cleanup record](phase-0-cleanup.md).

**Next checkpoint:** Validate catalogue quality, logging time and accuracy with representative data and users before release.

## Direction and authority

The [Product Direction & Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554) defines the product. The [Notion implementation plan](https://app.notion.com/p/403dc7f9b1cb814ca6c6ddf402d57aa9) tracks sequencing; this file provides repository-specific work and acceptance criteria. Update both plans when sequencing changes. Design Docs describe interactions; Dev Docs describe implementation. Older briefs do not override the 8 November decisions.

Steady serves adults pursuing weight loss who understand calorie tracking but find ongoing logging too laborious. The core job is fast, dependable food/meal logging and reuse. Calendar planning supports that job.

### Current checkpoint

- **Present in source:** one calendar composer for catalogue and private food search, saved meals, manual food and calorie blocks. Search suggestions overlay the draft. Inline nutrition corrections can be reused as private variants. The composer uses the first three visible nutrients from Settings and preserves missing values and estimates. Daily and weekly repeats support scoped occurrence edits.
- **Removed in Phase 0:** Explore placeholder/navigation; recipe finished-weight UI/API; abandoned recipe/cost/visual work; unreachable Today/routine/Shuffle/completion/carry workflows and weekly-allocation code; obsolete dependencies/tests. Active settings already used date-effective targets; the old target editor was unreachable.
- **Verification:** local browser checks covered desktop and mobile logging, search overlays, reuse of a corrected food and a saved meal, calorie block replacement, and changes to following occurrences. The build, lint, 39 domain tests, 186 database assertions, contrast checks and PWA policy checks passed. Drafts live in the open composer. Catalogue benchmarks, measured usability and release checks remain.
- Food grouping remains an established feature. `MealEditor`, `MealBuilderPage`, `meals` and `meal_components` are not automatically recipe-only because some labels/comments say “recipe.”

## Scope guardrails

- Food search is the entry point, with personal history first. No barcode/label scanning, photo/voice logging, pantry imports or speculative AI layer in this build.
- Retain private food grouping, meal reuse, quantity conversion, nutrition arithmetic, snapshots, account isolation and date navigation.
- Physically remove implemented Explore, recipe discovery/publication, collections, creator/marketplace features, detailed recipe authoring, nested recipes, instructions, Instruction mode, timers and recipe-effort features. Do not implement proposed features just to remove them.
- Recipes remain a possible future improvement in Notion, without a delivery commitment or dormant code retained “just in case.”
- Nutrients beyond calories are optional. Unknown is not zero. Source and certainty are separate: user guesses remain estimated, and an assumed quantity makes derived nutrition estimated.
- Recurrence uses event-style series/occurrence semantics, not the old routine generator. Plans do not automatically become consumption, carry or debt.
- Billing, creator/team tools and commercial acquisition systems are not prerequisites. Existing optional transfer requirements do not justify keeping automatic completion/carry code.

## Phase 0 — remove obsolete features and establish a clean baseline

**Hard gate:** Complete this phase before new logging features or redesign implementation. Extracting retained meal behaviour and converting necessary existing data belong to cleanup; unrelated features do not.

### 0A. Audit dependencies and record the baseline

- [x] Record starting commit, working-tree changes, active routes and imports. Preserve unrelated user changes.
- [x] Run existing typecheck, lint, unit tests and build once. Record pre-existing failures and environment-dependent DB/PWA checks.
- [x] Produce a removal manifest: path/symbol, callers, delete/retain/extract decision, data dependencies, replacement if needed, and proving check. Trace RPCs, styles, exports, fixtures, scripts and package commands.
- [x] Identify data-bearing environments. Before schema changes, back up affected records and record counts and representative consumed-nutrition snapshots without committing personal data or secrets.

### 0B. Delete recipe implementation; retain food groups

| Current surface | Required cleanup | Retained behaviour / completion evidence |
| --- | --- | --- |
| `src/ui/pages/ExplorePage.tsx`, `src/router.tsx`, `src/ui/AppShell.tsx`, `src/app/RouteAnnouncement.tsx` | Delete Explore page, navigation, lazy import, announcement, unused icons/styles/assets and feature-specific route. Normal unknown-route handling can resolve old links. | No Explore placeholder, hidden entry point or dedicated compatibility implementation. |
| `src/features/library/MealEditor.tsx`, `src/ui/pages/MealBuilderPage.tsx`, `src/ui/pages/LibraryPage.tsx` | Preserve/extract food-group assembly, quantities and reuse. Remove recipe-only inputs/framing; delete components/pages made redundant by consolidation. | Users can still group foods, change quantities, save/reuse and log meals without recipe setup. |
| `src/features/today/AddChoiceDialog.tsx`, `OneOffMealForm.tsx`, `OneOffFoodForm.tsx` | Keep logging/grouping behaviour; remove recipe-only branches and duplicated authoring. Keep current useful behaviour stable before redesign. | Single-food and grouped-meal plan/log work with matching totals. |
| `src/domain/mealNutrition.ts`, `src/data/repositories/mealRepository.ts`, related tests | Retain group arithmetic/persistence. Remove recipe semantics/comments and obsolete routine methods; rename internal recipe-only errors and callers together. | Correct group totals, incomplete-nutrient handling and multiplier arithmetic. |
| `declared_total_weight_g` and finished-weight UI/API | Trace use, including group weight calculations in `AddChoiceDialog`. Remove recipe-only fields/arguments through forward migrations. Retain a conversion only if justified by the current meal contract. | No recipe dependency or invented gram conversion; consumed history still reconciles. |
| `scripts/generate-food-scenes.mjs`, `docs/food-scenes.svg`, `docs/food-scenes.png`, `docs/food-visual-system.md` | Remove recipe-counter generation and recipe-only artefacts/specs. Retain food/meal material only if useful, in scope and referenced. | No abandoned generator branch, dead recipe asset or active recipe visual requirement. |
| Any publication/creator/collection/instruction schema, API, component or package discovered in 0A | Delete actual implementation and obsolete grants/endpoints. The current Explore surface is a placeholder; many deeper recipe features exist only in docs. | No callable/dormant recipe feature. Legitimate catalogue permissions and provenance remain. |

**Deletion is required:** no `legacy/` copies, commented-out implementations, hidden routes, feature flags or renamed dormant recipe components. Git history provides recovery. Do not delete shared meal functionality to satisfy a keyword search.

### 0C. Remove other obsolete code and dependencies

- [x] Audit/delete unreachable `TodayPage.tsx`, `RoutinePage.tsx`, old `OnboardingPage.tsx`, `ShuffleSlotDialog.tsx`, `RoutineMealReviewDialog.tsx` and `CarryDecisionPreview.tsx`, after extracting retained helpers.
- [x] Remove obsolete routine/Shuffle/weekly allocation/completion/automatic-carry repository methods, query keys, domain code, styles, scripts, fixtures and tests. Candidates: `weeklyPlanRepository.ts`, `carryRepository.ts`, `shuffle.ts`, `carry.ts`, `allocationPreview.ts`, and `tests/integration/carry-concurrency.mjs`.
- [x] `ProfileTargetEditor.tsx` was already unreachable and was deleted with its weekly-allocation helpers. Active `ProfilePage` already uses `saveCalendarTargets`; no replacement was needed.
- [x] Reduce `dayRepository.ts` and `mealRepository.ts` to retained callers. Remove obsolete exports and privileged RPCs, not only UI imports.
- [x] Consolidate genuinely duplicated controls; avoid an unrelated architectural rewrite. Remove orphan CSS, assets, packages and package scripts with their callers.
- [x] Remove obsolete feature tests while retaining/adapting tests protecting calculations, snapshots, ownership, targets and the calendar. Do not keep a dead implementation to keep its tests passing.

### 0D. Clean the live data model safely

- [x] Trace tables, RPC signatures, triggers, constraints, policies and grants. Preserve private foods, catalogue provenance and food groups.
- [x] Convert necessary old group/diary data into the retained representation before dropping obsolete structures. Preserve local dates, quantities, missingness and historical nutrition; compare counts/totals.
- [x] Remove obsolete live functions, policies, triggers, columns and tables using forward migrations once consumers/data are resolved. Regenerate `src/data/database.types.ts`.
- [x] Do not leave a permanent second legacy execution path. Any temporary adapter has a removal step before the baseline gate closes. An old source label in a snapshot is data, not a reason to retain its old workflow.
- [x] Keep applied migration files as reproducible history; do not rewrite/delete them for cosmetic cleanup. New migrations must leave the resulting live schema clean. Squashing requires its own fresh-install and upgrade verification.
- [x] Test fresh installation and upgrading a representative restored database. This plan does not authorise resetting a data-bearing environment or losing user logs.

### 0E. Clean active documentation

- [x] Rewrite both active implementation plans around this cleanup-first sequence. Remove recipe delivery slices and obsolete scope-precedence rules.
- [x] Keep `README.md` truthful: current purpose, source-of-truth links, checkpoint, setup and supported commands. Remove stale commands when their features are deleted.
- [x] Rewrite `docs/rebuild-data-contract.md` for foods, variants, meal groups, occurrences, targets, calorie blocks and recurrence. Remove publication/creator/collection entities and obsolete routine/carry execution contracts.
- [x] Replace `docs/meal-builder-attributes.md` with a current grouping/logging contract, or delete it after moving useful material. Delete instruction, subrecipe, suggestion-service, effort and other abandoned requirements.
- [x] Clean `docs/food-data-enrichment-tracker.md`: remove recipe-suggestion work and recipe-only gates; retain source/licence evidence, nutrient units, food variants, portions and search-quality work.
- [x] Delete abandoned recipe/cost/visual research docs and generated output with no current provenance or operational purpose. Preserve required source/licence evidence independently. Keep the future-recipes idea in Notion rather than an implementation archive.
- [x] Update remaining catalogue benchmark/import, visual and PWA docs when links, commands or assumptions change. Historical results do not validate new code.
- [x] Clean the Notion overview and active Product/Design/Dev Docs so they agree. Delete obsolete recipe plans from active documentation; retain historical evidence only when needed, never as an alternative roadmap. Leave unrelated business/legal records alone.
- [x] Record actual deletions, retained functionality and checks in `docs/reset-execution-log.md`. Replace stale current-status sections; check links after deletions.

### Phase 0 acceptance — development-ready baseline

- [x] Removal manifest closed. A reviewed search across source, routes, styles, tests, scripts and docs finds no recipe/Explore/marketplace feature implementation, disabled branches or abandoned assets.
- [x] Remaining “recipe” mentions are limited to explicit exclusions/future ideas, applied migration history or genuine catalogue/source data. No obsolete routine/Shuffle/automatic-carry runtime remains.
- [x] Auth, settings/targets, search, quantities, grouping, reuse, calendar navigation, plan/log separation and history edits remain usable on phone/desktop and with keyboard input.
- [x] Live APIs/schema/generated types agree. Existing food/group/diary data survives upgrade; no permanent legacy runtime is retained.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:a11y`, `npm run build`, `npm run test:pwa` and retained DB tests pass using the supported post-cleanup commands.
- [x] Restore/migration checks preserve consumed snapshots; account isolation, idempotency, stale-revision rejection and read-without-write behaviour pass.
- [x] README, Notion direction/build plan and retained contracts agree. Links resolve; removal diff and runtime smoke evidence are recorded. A failed gate keeps Phase 0 open.

## Phase 1 — relevant-detail UX and data contracts

**Dependency:** Phase 0 accepted. Specify/review flows before implementing visual changes.

- [ ] Specify one search → choose → adjust → add flow for foods/groups, with history first, inline close-match edits and immediate reuse.
- [ ] Apply persistent nutrient visibility/order across search, entry/review, variant editing, group cards, summaries and settings. Reuse `nutrient_fields.is_displayed`/ordering where appropriate. Hiding fields does not delete values or create new nutrient definitions. Default to calories; no per-log nutrient-selection prompt.
- [ ] Define per-value provided/estimated/unknown status separately from source. User-entered guesses stay estimated. Derived status accounts for portion assumptions; hidden data retains its status. Do not invent verified/estimated labels for old records.
- [ ] Review compact plain values, `≈` estimates and `—` unknowns with accessible labels and inspectable assumptions. Reassess the information hierarchy across screens, not just a collapsed form section.
- [ ] Resolve unknown-calorie eaten-entry and incomplete-total/remaining-allowance behaviour before changing the current known-calories requirement. Never silently count unknown as zero.
- [ ] Keep numerical ranges out of the first implementation unless a defensible bounds method and total semantics are approved. No fabricated confidence intervals or silent midpoint substitution.

**Acceptance:** linked flow/state specifications and a testable summary contract; open decisions are explicit, not implicit code defaults.

## Phase 2 — fast entry, private variants and meal reuse

- [ ] Make recent/frequent foods and groups easy to reuse, with visible editable quantities. Frequency ranks suggestions; it does not average nutrient values.
- [ ] Edit a close match inline and use Add to remember the private version and log/plan it. No separate authoring task. Reuse matching personal versions rather than generating duplicates on each log/retry.
- [ ] A rename is optional after nutrient edits. Distinguish same-name versions using meaningful secondary detail. Quantity-only edits do not create variants.
- [ ] Preserve source lineage and the shared original. A calorie correction does not verify other nutrients; new defaults never rewrite consumed history.
- [ ] Retain food grouping, per-food quantities, totals, one-occurrence edits and retrievability after logging. No recipe instructions or yield required.
- [ ] Verify atomic group writes, request identity, retry/reconciliation, ownership and unsaved-edit handling. Persistent draft recovery is not assumed implemented; include it only if part of the approved flow.

**Acceptance:** first-time/reused food, close-match variant, same-name variant and grouped meal work end to end. Retries duplicate neither foods nor intake; previous logs stay unchanged.

## Phase 3 — first-class calorie blocks

- [ ] Add a calorie block through the same entry action: optional label, calories, dates and planned/eaten state. Foods and other nutrients are optional.
- [ ] Explicitly log a planned block's estimate without naming food, using the planned amount or an edited amount. Date passage/planning alone never records consumption.
- [ ] Attach food details to the same occurrence and atomically replace/reconcile its provisional estimate. Later detail must not create a second eaten entry or count the estimate plus food totals.
- [ ] Specify partial-detail and explicit total-override behaviour. An optional residual estimate must be deliberately recorded; unused planned calories are never automatically eaten.
- [ ] Keep planned and actual amounts separate; actual totals use consumption only. Preserve estimate markers and unknown nutrients.

**Acceptance:** plan 600 → log the 600 estimate without foods; or plan 600 → log foods totalling 540. Actual is respectively 600 or 540, never 1,140. Edits/undo/retries preserve one occurrence.

## Phase 4 — custom dates and event-style recurrence

- [ ] Preserve day/week/month navigation and date selection. Build on implemented calendar flows; the old routine and existing design intent do not establish delivered recurrence.
- [ ] Support opt-in series for foods, groups and calorie blocks: frequency/interval, relevant weekdays, start, end/until/count or indefinite repetition.
- [ ] Edit/delete this occurrence, this and following occurrences, or the series. Preserve exceptions and previously eaten history when splitting/changing future plans.
- [ ] Expand bounded requested ranges without writes on reads or unbounded precreation. Use unique occurrence identities and stable mutation requests.
- [ ] Keep future occurrences planned. Link explicit consumption without a duplicate reservation; test timezone/DST, end dates, skips, edits and concurrency.

**Acceptance:** one-date changes leave other dates alone; future-series changes never rewrite consumption; behaviours work across foods, groups and blocks.

## Phase 5 — quality and release readiness

- [ ] Re-run representative personal/generic/UK-product search and portion benchmarks. Keep source/licence safeguards. The old 30-query smoke sample is not an at-scale pass; the old 500-query gate remains open until its actual dataset/results exist.
- [ ] Measure total logging effort, including finding, quantity selection, correction, grouping and saving, for first/repeat entries and calories-only/selected-nutrient users. Set acceptance thresholds before the pilot; do not invent validated speed/accuracy claims.
- [ ] Assess omitted items and individual-entry errors alongside daily totals; offsetting errors can hide mistakes. Separate label/weighed-reference comparisons from perceived trust and uncertain restaurant estimates.
- [ ] Run focused checks for conversions, unknown/partial totals, estimate propagation, block reconciliation, immutable history, recurrence exceptions, retries and cross-account access.
- [ ] Run retained build/lint/typecheck/unit/PWA/a11y/DB checks and phone/desktop/keyboard smoke flows. Broaden/repeat when changes or failures justify it.
- [ ] Verify upgrade/restore, PWA update safety, attribution, recovery and current docs before declaring release-ready. Deployment remains a separate explicitly requested action.

## Completion reporting

For each phase, record removed/changed paths, migrations, retained behaviour, checks actually run and remaining gaps. Phase 0 is the first deliverable. New feature development starts only after that gate passes.
