# Steady product reset and semi-rebuild implementation plan

**Prepared:** 27 October 2026  
**Status:** Gate R0 complete; R1 data-contract work in progress. See [reset execution log](reset-execution-log.md).

**Purpose:** Give a future implementation pass an ordered, testable route from the current routine-centred prototype to the current calendar-first product. The first delivery checkpoint is a safe, runnable reset baseline; the later checkpoints build the new product on it.

## 1. Decision basis and scope precedence

The [Current Product Scope (27 October)](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [Calendar, Meal Builder & Explore UX Update](https://app.notion.com/p/406dc7f9b1cb81f89d0ffc82f5756470), and [Data Rules for Manual Blocks, Transfers & Public Recipes](https://app.notion.com/p/406dc7f9b1cb8167b950d13363fcf94b) control the new direction. [Product Thesis](https://app.notion.com/p/403dc7f9b1cb818c903cc6381323aeae), [Target Users & Core Jobs](https://app.notion.com/p/403dc7f9b1cb81378b07c5252b21b76d), [Data & Nutrition Rules](https://app.notion.com/p/403dc7f9b1cb819b97a5ecd7d1fa17dc), and [Verification & Release Gates](https://app.notion.com/p/403dc7f9b1cb8138aa41d44d983c9112) supply cross-cutting requirements. The [Build Plan — New Scope](https://app.notion.com/p/403dc7f9b1cb814ca6c6ddf402d57aa9) supplies useful sequencing, but its own 27 October callout supersedes its no-sharing/no-billing exclusions. The older MVP page and 81-task routine plan are historical evidence, not the current feature list.

The [subscription/operator proposal](https://app.notion.com/p/406dc7f9b1cb819693c0d0f42b530bcf) is **Proposed**, not a build or launch instruction. Public recipes are in the active product scope. Billing, a paid gate, operator handover, and public promotion require separate decisions and the legal clearance described there. The user has also decided: avoid paid food-data services, avoid a weak catalogue, use no AI unless a measured gap justifies it, prefer close-match lookup plus fast personal nutrition correction, and do not make barcode scanning a prerequisite. These decisions govern the food-data work below.

### Target experience

1. Calendar opens on today; day/week/month navigation keeps dated planned and eaten entries distinct. Only eaten entries affect actual kcal/protein. A person may copy, move, edit one date, or explicitly repeat a planned meal.
2. One meal builder starts empty or from saved/recent/public recipe, shows live known nutrition, and supports calculate-only, save, log now, or plan for a selected date. Foods, quantities, custom foods, and calories-only blocks are available. Unknown protein/macros remain unknown.
3. The user can reuse a saved meal in a few taps, see remaining daily targets, and keep their diary and targets private.
4. Explore is secondary: public recipe detail, creator profile, collections, search/filter, link sharing, copy/personalise, report, and unpublish. Viewing a public recipe does not require an account.
5. Cost and effort fields are optional, user-entered, and shown only where known. Explicit calorie transfers and forward allocations are optional tools, never automatic debt.

### Explicit exclusions for this implementation

No default weekly routine, Shuffle, automatic calorie carry/debt, AI nutrition lookup or coach, supermarket scraping, social feed/messaging, clinical recommendations, weight-tracking flow, or native-app requirement. Barcode scanning is deferred until observed lookup failures justify it. No billing or partner/operator integration is part of the reset or personal-use release.

## 2. Current product audit (source inspection, 27 October)

This is a static source audit, not a production or deployed-UX audit. Git metadata was previously removed at the user's request, then the project was reinitialised and pushed to `Zio-n/Steady`. Execution now has a baseline commit, tag and isolated branch, recorded in the [reset execution log](reset-execution-log.md). `.env.local` is excluded by `.gitignore`; its secret values were not inspected or copied into this document.

| Area | What exists | Decision and reason |
| --- | --- | --- |
| App shell and routing | `src/router.tsx`, `src/ui/AppShell.tsx`: Today, Library, Routine, Profile; authenticated shell only. | **Rebuild navigation.** Calendar becomes home, Explore public/secondary, Settings quiet. Retain shared accessibility primitives and visual tokens where useful. |
| Identity and setup | `src/app/AuthProvider.tsx`, `ProtectedRoute.tsx`, `CompleteProfileRoute.tsx`, `src/ui/pages/OnboardingPage.tsx`: working account gate, target/timezone setup. | **Adapt.** Preserve auth and account isolation. Simplify onboarding language and route directly to first meal; remove week/routine framing. Public recipe routes must sit outside the private gate. |
| Food library | `src/data/repositories/foodRepository.ts`, `src/features/library/FoodEditor.tsx`, `foods`/`food_nutrients`: user-owned manual foods and nutrient bases. `searchFoods` searches only the owner's records. | **Keep the private-food foundation; add a distinct catalogue layer.** Current search cannot answer a first-time food query. Preserve manual entry, known units, null/unknown semantics, and personal corrections. |
| Meals | `src/data/repositories/mealRepository.ts`, `src/features/library/MealEditor.tsx`, `meals`/`meal_components`: saved meals composed of owned foods. | **Adapt.** Reuse calculation and persistence contracts after testing; replace separate creation paths with the unified builder and add calories-only blocks and publication snapshots. |
| Daily log | `src/data/repositories/dayRepository.ts`, `src/domain/daySummary.ts`, `days`/`day_items`: planned/eaten states, eaten snapshots, corrections, recent choices. | **Keep the invariants, refactor the workflow.** Planned does not count as actual and eaten snapshots are valuable. Existing `TodayPage.tsx` is 619 lines and mixes calendar, routine, carry, completion, and Shuffle; rebuild it by feature slices. |
| Day materialisation | `TodayPage` calls `ensureDaySnapshot` and `ensureRoutineDay` on read. `private.ensure_day_for_log` creates a `weeks` row and seven `week_allocations` before a `days` row; `days.week_start` is an FK to `weeks`. | **Decouple before removing old tables.** A cosmetic reset would leave a hidden weekly dependency and writes on page view. Define a simple date-target/read contract, backfill safely, then switch callers. |
| Routine/Shuffle | `src/ui/pages/RoutinePage.tsx`, `src/features/today/ShuffleSlotDialog.tsx`, `RoutineMealReviewDialog.tsx`, `src/domain/shuffle.ts`, related repository methods and migrations. | **Retire from the new surface.** Preserve historical rows and old snapshot readers until migration verification. Do not use old recurring slots as the new repeat-rule model. |
| Weekly budget/carry | `weeklyPlanRepository.ts`, `carryRepository.ts`, `src/domain/allocationPreview.ts`, `src/domain/carry.ts`, `CarryDecisionPreview.tsx`, `weeks`/`week_allocations`/`carry_*`. | **Retire old interaction and model.** New optional transfers need explicit origin/destination ledger entries and reversals; old completion-difference carry is not an appropriate base for automatic conversion. |
| Nutrition arithmetic | `src/domain/foodNutrition.ts`, `mealNutrition.ts`, `daySummary.ts` and database capture functions. | **Reuse with parity tests.** Existing unit conversion rejects unknown conversions; summaries preserve partial/unknown values. Extend both TypeScript and authoritative SQL for new component types. |
| Offline/PWA | `vite.config.ts`, `src/app/ConnectivityBanner.tsx`, `PwaUpdatePrompt.tsx`, `docs/pwa-operations.md`: public shell cache, no offline mutation queue. | **Preserve policy.** Recheck cache boundaries when public routes/images are added; never cache private API data as public assets. Installation remains optional. |
| Tests/CI | 57 domain tests, lint, typecheck, token contrast, build and PWA policy passed locally. The previous GitHub workflow was removed with the Git setup. | **Keep useful gates, replace obsolete tests as their features retire.** Re-establish CI after repository setup. These passes establish baseline code health, not proof that the new scope works. DB tests and deployed flows were not run during this audit. |

### Structural risks to resolve early

- The baseline commit and tag now make source changes reversible. Database changes still require the separate verified local backup recorded in the execution log.
- Day creation currently assumes a calorie target and weekly allocation; calculate-only and a lightweight first-meal flow must work without materialising a week. Decide deliberately whether logging requires a target (recommended: no; remaining allowance is unavailable until a target exists).
- `days.status = completed` and the completed-day correction RPC are tied to the old finish/carry workflow. The new calendar should not ask users to complete a day. Preserve historical completion/snapshot information and provide a correction path that does not create carry decisions.
- Profile calorie target edits currently take effect next Monday. The replacement target contract must support an explicit effective local date without silently rewriting earlier day snapshots.
- Food and meal components are owned by one account. External catalogue items and public recipes need separate identity, provenance, rights, and read permissions; making `foods` or `meals` globally readable would expose private records.
- Existing SQL migrations are an append-only history. Editing old migration files would create drift between existing installations and new ones.
- Eaten snapshots include old `routine` source values. Readers must continue to understand these even after the routine UI is gone.
- README still points to the old plan; update it only when the reset branch actually becomes the working product.

## 3. Delivery rules and reset checkpoint

Work on a dedicated `codex/` branch after the baseline exists. Keep `main`/any deployed environment usable until a replacement checkpoint is verified. Each checkpoint is a small commit plus the evidence listed below. Existing records are read-only during inventory and exports. No `git clean`, broad file deletion, `supabase db reset`, destructive migration, or production cutover is part of preparation.

The **reset-ready checkpoint** is a runnable React/Supabase app with auth, minimal target setup, private food and saved-meal access, a new calendar shell with an empty/dated state, and working data/error boundaries. Legacy Routine, Shuffle, and carry controls are absent from its navigation and calls. Historical records and their snapshot readers still work. This is the point at which feature rebuilding can continue without carrying the old UI structure forward. Do not declare reset-ready because a blank page renders: the data invariants and smoke path below must pass.

### Gate R0 — Establish a recoverable baseline

1. Inventory all source files, deployment configuration, local/remote Supabase projects, storage objects, environments, and whether real accounts/records exist. Read row counts and migration versions without exposing credentials or personal data. Record unknowns explicitly.
2. Review ignore rules, then add only intended source/config/docs to Git; exclude `.env*`, build artefacts, and local database volumes. Create an initial baseline commit and a named snapshot/ref before editing the app. Preserve a separate archive if a remote is unavailable. Verify a clean checkout can install and build.
3. Export any environment with real data before schema work, including auth/account mapping, private foods/meals/day records, old routine/carry records, and uploaded media if present. Record counts/checksums and practise restoring to an isolated database. If no live data exists, record that finding and use fixture data. Never perform a reset on the sole copy.
4. Record baseline commands: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:a11y`, `npm run build`, `npm run test:pwa`, and `npm run db:test` where Docker is available. Mark unrun gates as unrun, not passed. Capture a short visual/keyboard walkthrough of the current app on phone and desktop widths.

**Exit:** source and data can both be restored in an isolated environment; baseline checks/results and known failures are written down. **Rollback:** restore the snapshot ref and database backup; do not rely on untracked working files.

### Gate R1 — Define the replacement contracts before removing UI

1. Write a small target data map: account/settings, private foods and overrides, catalogue foods, saved meal + components, dated entry + eaten snapshot, repeat rule/occurrence exception, transfer ledger, public recipe version, collection, report. For each, record owner, visibility, source/provenance, write API, and deletion policy.
2. Define a *date* API that can read an empty day without writing, return target-as-of-date, and keep `planned`, `eaten`, and `removed` separate. Decide what happens when no target exists. Separate repeat expansion from logged entries; materialise only needed planned occurrences, idempotently.
   Remove the new flow's need for `days.week_start -> weeks`, weekly allocations, and manual day completion; retain legacy values for historical reads. Specify how targets apply to an already viewed date and how corrections to legacy completed days avoid old carry side effects.
3. Map old data: private foods/meals/day items and snapshots stay; routine-generated planned entries remain historical dated entries or are explicitly excluded from future generation after a recorded cutoff; old carry decisions remain historical/read-only and are **not** silently converted to transfers. Define old-to-new IDs and validation totals.
4. Prototype migrations against a restored copy. Add new tables/functions/policies first, backfill, compare counts and nutrition totals, then change readers/writers. Keep old structures until both migration and rollback window pass. Regenerate `src/data/database.types.ts` only after schema agreement.

**Exit:** schema/API design and migration verification queries are reviewable; no data is deleted; old snapshot formats remain readable. **Rollback:** switch app calls back to old endpoints while additive schema remains unused.

### Gate R2 — Build the clean app foundation (reset-ready)

1. Replace route/shell hierarchy with public recipe route placeholders and the private Calendar/Library/Explore/Settings shell. Keep public routes independent of `ProtectedRoute` and `CompleteProfileRoute`. Do not publish data from placeholder pages.
2. Break `TodayPage.tsx` into small Calendar date state, day query, summary, entry list, and entry action components. Start with day view and empty state, then existing private entry reads. Stop calling `ensureRoutineDay` and the old carry query. Make route/date selection timezone-aware.
3. Adapt onboarding to target + first-meal path and remove week-specific explanations. Retain authentication, profile safety, query keys scoped by account, loading/error states, design tokens, and keyboard focus behavior.
4. Hide/retire Routine, Shuffle, weekly allocation and carry surfaces only after the new shell and dated read path work. Remove obsolete client imports and unreachable components incrementally; leave historical database schema and snapshot readers until verified. Make the old route redirect to Calendar without invoking old mutations.
5. Confirm a saved private food/meal and a historical eaten day load in the reset shell; confirm an empty day does not create a routine/weekly plan. Confirm sign-out clears account data from the client.

**Exit:** the reset-ready checkpoint above is usable on phone and desktop, with no legacy routine/carry control or background routine generation. `lint`, `typecheck`, build, focused DB access tests, and a smoke walk pass. **Rollback:** deploy baseline app against additive schema; old UI and old data remain available until cutover.

### Implementation touch map for R1–R2

| Order | Files/contracts | Concrete action |
| --- | --- | --- |
| 1 | New `supabase/migrations/*` and `supabase/tests/database/*` | Add date/target read-write contract, compatibility and owner tests. Never rewrite the October migration files. |
| 2 | `src/data/database.types.ts`, `src/data/repositories/dayRepository.ts`, `src/data/queryKeys.ts` | Regenerate types, isolate new date APIs from routine/carry queries, maintain account-scoped cache keys. |
| 3 | `src/domain/dates.ts`, `src/domain/daySummary.ts`, `tests/domain/*` | Keep timezone and old snapshot support; add pure selected-date/summary contracts and focused regression cases. |
| 4 | `src/router.tsx`, `src/ui/AppShell.tsx`, `src/ui/pages/TodayPage.tsx`, new calendar feature files | Establish public/private route split and calendar shell, then migrate one dated action at a time. |
| 5 | `src/ui/pages/OnboardingPage.tsx`, `src/ui/pages/LibraryPage.tsx`, `src/ui/pages/ProfilePage.tsx` | Simplify onboarding, preserve private food/meal access, remove week-first navigation and copy. |
| 6 | `src/ui/pages/RoutinePage.tsx`, `src/features/today/*`, `src/domain/{shuffle,carry,allocationPreview}.ts`, old repositories | Remove only after import/reference search shows no active path. Retain legacy snapshot parsing and archival DB data. Retire obsolete tests at the same checkpoint, replacing them with new contract tests. |

## 4. Rebuild sequence after reset-ready

Each slice requires schema/API, UI, acceptance checks, and a brief migration note. Complete a slice before adding the next; do not reintroduce an old control to fill a gap.

### B1 — Food-data quality gate and private food selection

**Dependencies:** R0–R2. Before a catalogue implementation, assemble a representative UK query set from target-user meals: common ingredients, supermarket branded foods, serving variants, and ambiguous names. Define required fields (name, brand where applicable, kcal and protein basis, unit, provenance/licence, missing fields, update timestamp). Evaluate free candidates called out by [Data & Nutrition Rules](https://app.notion.com/p/403dc7f9b1cb819b97a5ecd7d1fa17dc), including USDA FoodData Central and Open Food Facts, for terms, coverage, accuracy, query latency, and operational limits. CoFID may be a generic-composition supplement, not the assumed main consumer catalogue. Record evidence and a go/no-go threshold **before** choosing ingestion or live lookup. A free source that fails the realistic query set is insufficient even if its dataset is large.

**Build:** a source-labelled search ranking exact/branded/personal matches sensibly with conventional text search; deduplicate obvious duplicates; show basis, brand, and missing nutrition. Let the user select a close match and save a private corrected copy with a short kcal/protein/basis edit. Preserve the original source and mark the copy as personally adjusted. Keep fast manual food creation. Use a local indexed subset, public API, or hybrid only after the benchmark demonstrates adequate quality and cost; budget hosting/storage/API usage even when data licences are free. Barcode remains a later usability decision and AI is not a dependency.

**Acceptance:** representative queries have documented hit quality and latency; the user can correct a close match quickly; corrections affect only their copy, never the shared source or past eaten snapshots; missing data is labelled; no paid-data or AI dependency is introduced without a separate evidence-backed decision. If no free mix meets the threshold, stop and report the gap rather than ship a misleading catalogue.

### B2 — Unified calculator and meal composition

**Dependencies:** B1 search/selection contract, R1 schema. Replace separate `OneOffFoodForm`, `OneOffMealForm`, and `MealEditor` user flows with one draft model: ingredient quantity/unit, custom food, calories-only block, optional label, and live totals. Support entry from empty, saved meal, recent choice, or (later) public recipe. Add optional effort/cost fields behind an expanded section. Keep calculation in a pure TypeScript module and mirror authoritative capture/validation in SQL; use one payload contract for calculate-only, save, log, and plan actions. Calculate-only must not write to the database or require an account if offered as the free preview.

**Acceptance:** known values scale with supported conversions; unknown protein/macros from a calories-only block remain unknown/partial; bad unit conversions are blocked; calculate-only leaves no records; save/reopen yields the same result; editing a saved meal cannot mutate an older eaten snapshot. Include multi-ingredient and mixed known/unknown cases.

### B3 — Calendar and daily actions

**Dependencies:** B2, R1 date API. Implement today default, previous/next, Today jump, day/week/month navigation, selected-date add/plan, and dated cards. The week/month views navigate and preview, while day stays the primary work surface. Provide log planned-as-eaten, edit a date, move, copy, delete/undo, and recent/saved reuse. Keep eaten actual separate from planned projection and show remaining kcal/protein only when targets/inputs support it. Preserve revision/idempotency handling for uncertain writes.

**Acceptance:** a new user can calculate and log a familiar meal without instructions; a returning user reuses one in a few taps; day/week/month agree on dates and totals across timezone and daylight-saving boundaries; a planned meal never raises actual intake; correcting an eaten entry updates its date without changing other dates or historic source snapshots. Verify responsive keyboard and phone interaction.

### B4 — Explicit repeats and date-specific exceptions

**Dependencies:** B3. Add repeat rules for user-selected planned meals only. Store schedule, start/end or indefinite status, timezone basis, and exceptions separately from dated eaten records. Generation must be idempotent and bounded for calendar queries. Single-occurrence edit/move/skip must not modify the rule; changing/stopping the series must have a clear scope prompt. Never repeat an eaten entry as eaten.

**Acceptance:** no default rule; rule starts and stops on intended dates; repeated instances are planned; the same range fetch cannot duplicate them; one-date changes survive later expansion; daylight-saving/month boundaries behave predictably.

### B5 — Optional target transfers and forward allocation

**Dependencies:** B3; can follow B4 or be developed separately once the date/target contract is stable. Model explicit origin, destination, amount, creator, timestamp, state, and reversal in an append-only ledger. Validate ownership, nonnegative resulting allowance, duplicate requests, overlapping changes, past/completed dates, and what happens to existing allocations. Show before/after target totals before confirmation. A transfer moves allowance only; consumed kcal stays on the original day. A forward allocation is an explicit choice, not a completion-triggered carry suggestion.

**Acceptance:** no automatic debt or transfer after over/under target; a user can review and reverse an allowed transfer; targets reconcile across affected dates; old `carry_*` rows are not silently reinterpreted; concurrent/duplicate writes cannot double-apply an amount.

### B6 — Public recipes and collections

**Dependencies:** B2, B3, R1 visibility model. Publish only an explicitly selected recipe version/snapshot. Add public creator profile, recipe detail with ingredients/quantities/preparation and known nutrition, optional images/effort, collection references, search/filter, and shareable links. Anonymous reads use public-only views/policies; private diary, targets, private foods, draft recipes, and other versions remain inaccessible. Copying a public recipe creates an owned editable meal/plan; later edits/unpublishing must not rewrite existing private copies/eaten logs. Add report and unpublish workflows, moderation access boundary, and documented data/image rights. Do not expose a public storage bucket without object-level publication rules.

**Acceptance:** a signed-out visitor can open a published recipe; cannot enumerate private records through API or media URLs; a signed-in user can copy/customise/plan it; publishing a new version or unpublishing does not corrupt historic use; reports can be recorded and acted on; practical filters return useful results without AI.

### B7 — Product release gate, then commercial decision gate

**Dependencies:** B1–B6, with optional transfer/effort work evaluated against the active scope before declaring the full product ready. Run the [Verification & Release Gates](https://app.notion.com/p/403dc7f9b1cb8138aa41d44d983c9112) and add public recipe/privacy/transfer checks absent from that older checklist. Test account isolation with two users and signed-out access; restored-data migration; backup/restore; error monitoring; mobile browser and keyboard flows; catalogue quality; source licences; current privacy copy. Keep a record of actual evidence, not inherited checkmarks from the old plan.

Only after the product works and the commercial/legal decision is documented should a separate plan consider £1.99 billing, trial/free boundaries, operator access, data handover, and analytics. Proposed price and licence terms are hypotheses, not acceptance criteria for the personal-use build.

## 5. Migration and cutover runbook

1. **Classify environments:** development, staging, deployed; record user/data presence and schema versions. Choose a data-bearing or empty path from evidence. Do not infer “prototype” means disposable data.
2. **Restore rehearsal:** seed an isolated database from the backup or representative fixtures, including an old routine plan, eaten snapshot, archived food, completed day and carry history. Compare per-account row counts and selected daily kcal/protein before/after migration.
3. **Additive changes:** create new tables/functions/indexes/RLS for catalogue, manual blocks, repeats, transfers and publication in forward migrations. Keep old SQL migrations unchanged. Make old read APIs operational through reset-ready; run both old and new snapshot readers where necessary.
4. **Backfill and verify:** migrate only data with an unambiguous mapping. Keep old IDs/source metadata. Convert private saved meals/foods as needed; retain old routine/carry rows as history. Record unmapped cases and expose them read-only or provide a deliberate resolution path. Verify account boundaries and snapshot totals.
5. **Switch application calls:** release new date API and UI behind the reset branch/staging environment. Check that old clients remain compatible during deployment and PWA update windows. Drain active sessions or use compatibility functions if old and new clients can overlap.
6. **Cutover:** deploy only after smoke, DB, privacy and restore gates pass. Monitor errors and sample reconciled totals. If a critical regression appears, return to the last compatible app version; do not roll back by dropping data written by the new version. Retire old tables/functions in a later migration after usage and backup retention are confirmed.

## 6. Verification matrix

| Gate | Minimum evidence |
| --- | --- |
| Reset safety | Baseline source ref, reviewed ignore list, data inventory, tested isolated restore, old/new schema compatibility. |
| Nutrition | Unit and quantity parity tests in TypeScript and SQL; unknown-vs-zero cases; calories-only blocks; personal override; saved meal edit leaves eaten snapshot unchanged. |
| Calendar | Targetless and targeted days; planned/eaten separation; copy/move/edit; local timezone and DST; day/week/month reconciliation; no read-side routine generation. |
| Repeats/transfers | Explicit opt-in, idempotency, exceptions, reversal, concurrent request behavior, no automatic calorie debt. |
| Privacy/public | Two-account RLS tests, anonymous public-only tests, private media denial, versioned published copies, report/unpublish. |
| Experience | First-meal and saved-meal usability sessions, phone-width and desktop, keyboard/screen reader basics, clear unknown/source labels. |
| Operations | Lint/typecheck/unit/build/PWA/DB suites, backup/export and restore, error monitoring, rollback rehearsal and release notes. |

## 7. Open decisions, with their point of resolution

- **Food catalogue:** exact free-source mix, licence compatibility, update cadence, coverage threshold, and hosting cost are unresolved until B1 benchmark. CoFID alone should not be assumed sufficient for branded UK lookup.
- **Existing data:** number of real accounts, deployed environment, and storage objects are unknown until R0. This determines the migration/backfill depth, never whether preservation is attempted.
- **Targetless calculation/logging:** R1 should confirm the recommended contract: calculate and log without a target; display remaining allowance only when a target exists.
- **Legacy generated plans:** R1 must pick a documented cutoff for future routine generation and decide how already materialised planned items appear in the new calendar. Do not discard them silently.
- **Public images/rights/moderation:** choose permitted uploads, retention, takedown and review responsibilities before B6 publication is enabled.
- **Subscription/operator:** wait for explicit product decision and qualified legal review described in the proposed business page; do not couple core data or UI to a payment provider now.

## 8. Requirement trace

| Requirement | Source | Delivery |
| --- | --- | --- |
| Calendar default, planned/eaten separation, date navigation, copy/move/repeat | [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [UX Update](https://app.notion.com/p/406dc7f9b1cb81f89d0ffc82f5756470) | R1–R2, B3–B4 |
| Unified calculate/save/log/schedule builder; known nutrition and optional effort | [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [UX Update](https://app.notion.com/p/406dc7f9b1cb81f89d0ffc82f5756470) | B1–B3 |
| Unknown nutrients, correct conversions, immutable eaten snapshots | [Data & Nutrition Rules](https://app.notion.com/p/403dc7f9b1cb819b97a5ecd7d1fa17dc), [Data Rules](https://app.notion.com/p/406dc7f9b1cb8167b950d13363fcf94b) | R1, B1–B3, B6 |
| Optional explicit transfer ledger without auto debt | [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [Data Rules](https://app.notion.com/p/406dc7f9b1cb8167b950d13363fcf94b) | B5 |
| Private diary, public recipe/collection and anonymous viewing | [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [Data Rules](https://app.notion.com/p/406dc7f9b1cb8167b950d13363fcf94b) | R1, B6 |
| Simple first meal, familiar-meal speed, saved reuse | [Target Users & Core Jobs](https://app.notion.com/p/403dc7f9b1cb81378b07c5252b21b76d), [Verification Gates](https://app.notion.com/p/403dc7f9b1cb8138aa41d44d983c9112) | R2, B1–B3, B7 |
| Free strong food data, no unnecessary AI, personal correction, barcode deferred | Direct user decisions in this chat | B1 |
| Commercial plans held outside core build | [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [Proposed business plan](https://app.notion.com/p/406dc7f9b1cb819693c0d0f42b530bcf) | B7 decision gate only |
