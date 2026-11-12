# Steady data contract

**Updated:** 12 November 2026. [Product scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554) owns direction. The [implementation plan](product-reset-and-semi-rebuild-plan.md) owns sequencing.

## Retained model

| Storage | Contract |
| --- | --- |
| `profiles`, `profile_target_versions`, `nutrient_fields` | Private timezone, effective-dated optional targets, nutrient definitions and persistent display/order preferences. Current setup and target editing do not require a weekly schedule. |
| `catalog_*` | Source-labelled shared read model, restricted ingestion, source licence and import provenance preserved. Imported missingness is not replaced with invented values. |
| `foods`, `food_nutrients`, `food_catalogue_origins` | Private food definitions and corrected catalogue copies. A private correction does not mutate the shared original. Ownership checks cover all references. |
| `meals`, `meal_components` | Private reusable groups of foods and quantities, with revision checks. No finished-weight/yield, method or publication model. |
| `days`, `day_items`, `day_item_history` | Dated planned/eaten/removed occurrences, frozen eaten nutrition and correction history. Existing source labels are historical data. Reading dates never generates entries. |
| `calendar_meal_series`, `calendar_meal_series_exceptions` | Daily and weekly plan templates with an interval, selected weekdays and an optional end date. Bounded calendar reads project occurrences. An explicit edit or log creates an exception for that date. |
| `mutation_receipts` | Stable request identity, input fingerprints and results for retry-safe writes. Reusing an ID with changed input is rejected. |
| `calendar_target_transfers` | Retained explicit allowance-transfer foundation; no active UI. No automatic completion/carry workflow. Extending it is outside Phase 0. |

## Invariants

- `local_date` is an ISO calendar date, interpreted using the saved IANA timezone. Range reads are bounded and perform no writes, including on empty dates.
- Actual intake sums eaten snapshots only. Plans remain separate. Editing a reusable food or meal never rewrites consumed history.
- Unknown nutrients remain null/absent, never zero. Partial totals carry incompleteness. Conversion between mass, volume and servings requires a known food-specific factor.
- Private records and referenced foods belong to the signed-in account. Catalogue access never grants access to another account's diary, meals or targets.
- Explicit writes create date rows as needed. Multi-item meal writes are transactional. Stale revisions and cross-account references fail; uncertain writes reconcile using the same request identity.
- Targetless logging works. For open dates, resolve the latest effective target version; remaining allowance is unavailable without a target. Stored completion targets/snapshots remain readable for old completed dates. The current UI keeps those dates read-only; no completion/correction workflow is retained for them.
- Planned copy/move operates on dated plans, never silently moves eaten intake. Snapshot edits change one occurrence and preserve its prior revision in history.

## Phase 0 schema boundary

`20261108120000_logging_reset_cleanup.sql` removes routine/Shuffle, weekly allocation, completion and automatic-carry APIs and tables, scheduling links, meal finished weight and abandoned cost research. It keeps dated entries, groups and snapshot history. `20261108121000_calendar_day_account_reference.sql` preserves the account reference directly on calendar dates. Old source enum labels and completed-date metadata are records, not executable compatibility paths. Applied migration history remains tracked; four optional catalogue-match seeds are guarded so a fresh installation does not require an external import.

## Composer writes

- `save_calendar_composer` saves a group, remembered portions and private variants in one transaction. It uses the existing request receipts and frozen nutrition snapshots. Normalizing each snapshot to the selected unit preserves the values previewed in the composer.
- Each logged value can carry its source and certainty. Missing nutrients remain unknown. Older snapshots retain their original values and metadata.
- A calorie block uses a tagged dated occurrence with an optional label. Explicit logging records its estimate. Attaching foods replaces it atomically in the same meal group.
- Repeat reads are bounded and perform no writes. A scoped edit or removal applies to one occurrence, that occurrence and the following ones, or the series. A split carries forward skipped dates and leaves eaten snapshots intact.
- Eaten entries require known calories. Planned food can retain missing calories and be corrected in the composer before logging.

## Nutrient display

- Calories are always shown. Nutrient visibility and order are saved in Settings. Food cards, meal totals in the composer, and calendar meal cards show up to the first three enabled nutrients in that order. With none enabled, those summaries show calories only.
- A food’s **Edit nutrients** action exposes all active nutrient fields. Visibility preferences leave stored values, nutrition calculations, and historical snapshots intact. The calendar day summary uses the enabled nutrients independently of the three-nutrient cap on meal summaries.
- An approximation mark (`≈`) identifies estimates. A dash (`—`) means unknown, and a total based on some of a meal’s foods is marked partial. Calorie-only entries capture calories and an optional label.

## Evidence

See [Phase 0 cleanup](phase-0-cleanup.md) for removal decisions, preservation evidence and checks. No user database reset is part of this work.
