# Phase 0 cleanup — 8 November 2026

**Status:** Complete locally. Automated checks, retained-flow browser smoke and active-document cleanup passed. No Phase 1 features started.

## Baseline and preservation

Started from `cb7d5cc`. The only initial working-tree edits were the preceding README/implementation-plan update. Baseline typecheck, lint, 67 domain tests and build passed. Baseline database tests had pre-existing failures in the obsolete carry, completed-day correction and weekly-target suites; they are removed with those features.

The local Supabase database is the only environment changed. No hosted deployment or data-bearing reset. A private custom-format backup of public/private/auth/extensions/research/migration schemas and app records was saved outside Git before schema changes. Large unchanged catalogue rows were excluded; source/licence tables and necessary catalogue references were restored for the rehearsal. Private backup: `/tmp/steady-phase0-app-backup.dump` (temporary, not durable disaster recovery).

Upgrade copies were restored with original object grants; an initial no-ACL restore was rejected because it invalidated security tests. The clean rehearsal passed. Full-row hashes of retained food/group/day/entry/history fields match the restored pre-cleanup data: **3 accounts, 2 foods, 3 meal groups, 3 components, 8 dates, 18 diary entries and 6 history rows**. Only the intentionally removed scheduling links and unused finished-weight field were excluded from comparison. No saved group had a finished weight to convert. Consumed snapshots are included unchanged in that comparison.

## Closed removal manifest

| Surface / dependencies | Decision and data treatment | Proving evidence |
| --- | --- | --- |
| Explore page, router import/route, shell navigation/icon, route announcement | Delete placeholder and entry points; generic unknown-route handling remains. No publication/marketplace backend existed to preserve. | Import/source search, typecheck, navigation smoke. |
| Meal editor/Library finished-weight controls, AddChoiceDialog meal weight conversion, save-meal argument, `meals.declared_total_weight_g` | Delete recipe-only field and API argument. Retain component amounts, food-specific conversions and group arithmetic. No invented group gram conversion. | New six-argument `save_meal`, regenerated types, group/snapshot tests and browser save/reuse. |
| Today/Routine/old Onboarding pages; ProfileTargetEditor; CarryDecisionPreview, RoutineMealReviewDialog, ShuffleSlotDialog | Delete unreachable workflows. ProfileTargetEditor was already unreachable; active settings already use `saveCalendarTargets`, so no replacement editor was necessary. | Import audit, retained settings/setup smoke. |
| Carry/weekly-plan repositories; shuffle/carry/allocation-preview domains; obsolete day/meal/profile exports and query keys; DateStepper/Tabs controls | Delete obsolete callers and exports. Keep Calendar setup/read/plan/log/correction methods and current meal persistence. | Typecheck/lint, retained calculation/database suites. |
| Routine/Shuffle/weekly/completion/automatic-carry RPCs, helper functions, tables/types, `days.week_start`, `day_items.routine_occurrence_key` | Forward removal; retain dated items and their snapshots/history. Historical source enum labels/completed targets remain record data; completed dates stay read-only. No old mutation API retained. | Fresh schema + restored upgrade tests; live function-definition audit finds no dependency on deleted tables/field. |
| `steady_research` cost tables, recipe scene generator/SVG/PNG and ingredient-cost review | Remove abandoned research/code/assets. App backup captures research; Git history captures files. Keep actual catalogue licensing/provenance independently. | Schema/source/link audit. |
| Obsolete CSS, date-fns/date-fns-tz, carry-concurrency command/script and tests | Remove feature rules and selectors with no callers; preserve dynamic status/skeleton classes. Delete 18 obsolete DB suites and obsolete domain suites; adapt retained tests to Calendar APIs. | Production build, CSS runtime smoke, supported post-cleanup checks. |
| Active local contracts/tracker/PWA docs and Notion overview/product/design/dev docs | Remove abandoned recipe delivery/specification. Retain useful grouping, provenance and operating rules. Record recipes only as a possible future improvement in Notion scope. | Link/content audit and linked implementation plan. |

### Migration details

`20261108120000_logging_reset_cleanup.sql` is applied locally. It removes obsolete APIs/grants/schema and narrows `save_meal`. The follow-up `20261108121000_calendar_day_account_reference.sql` preserves the account foreign key directly on dates after removing the weeks link. Its regression rejects an orphan date. Generated TypeScript types come from the final cleaned schema. Four earlier catalogue-match seed migrations now insert only references present in `catalog_foods`: this fixes an observed empty-install foreign-key failure, preserves their behaviour with imported rows, and does not cosmetically rewrite migration history. No migrations were squashed or deleted.

Fresh installation was rehearsed in an isolated empty product database with Supabase auth schema/extensions: **all 69 migrations pass** without importing catalogue data. The retained database suite passes on that installation and a restored upgrade with correct grants. The original local database then received both forward migrations without reset. After browser testing, the disposable account was signed out and its identity-checked fixtures removed in foreign-key order; retained original-record hashes still match.

## Checks

| Check | Result |
| --- | --- |
| Typecheck / lint | Pass |
| Retained unit suite | 36/36 pass (obsolete feature suites removed, not skipped) |
| Contrast tokens | 9/9 pass; not a full accessibility audit |
| Production build | Pass |
| PWA cache policy | Pass; public shell only, no API cache |
| Database suites on fresh install / restored upgrade / upgraded local database | 10 files, 163 assertions pass on each |
| Retained record/snapshot preservation | Counts and full-row hashes match backup restoration |
| Live obsolete-function dependency audit | No remaining function references to removed routine/carry/weekly/research structures or finished weight |
| Browser phone/desktop/keyboard | Pass: phone 390 × 844 and desktop 1440 × 1000 viewport overrides; keyboard activation, form input, Library arrow-key tabs and picker navigation; no horizontal overflow or captured console errors. Details below |

## Runtime and release boundary

Smoke tests used a disposable local account, with no changes to existing diary records. Evidence screenshots were saved outside Git as `/tmp/steady-phase0-mobile.jpg` and `/tmp/steady-phase0-desktop.jpg`; the five disposable rehearsal databases were removed after verification. Verified: setup/timezone/target, catalogue search, amount scaling, two-food grouped log (369.5 kcal), inline snapshot correction without rename (376 kcal), effective target edit, manual calories-only food, saved-group creation and reuse. Planned occurrences keep actual calories at zero. The smoke pass caught an existing planned-card display bug: it used the eaten-only summary and displayed 0 kcal. Plans do not store a nutrition snapshot in the retained schema, so the card now honestly shows — rather than a false zero; full planned-nutrition presentation belongs in the Phase 1 contract.

This is development-baseline verification. Actual iOS/Android installation, screen-reader use, all dialog/error states, service-worker release compatibility, representative search quality, field-level uncertainty UI, first-class blocks, recurring series and durable drafts are not claimed delivered by Phase 0. Follow the [implementation plan](product-reset-and-semi-rebuild-plan.md) and [PWA operations](pwa-operations.md).
