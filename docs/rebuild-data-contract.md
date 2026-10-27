# Steady rebuild data contract

**Status:** R1 design baseline, 27 October 2026. No new schema has been applied to the original local database.

**Sources:** [Current Product Scope](https://app.notion.com/p/406dc7f9b1cb8122894bef1f6c77f554), [UX Update](https://app.notion.com/p/406dc7f9b1cb81f89d0ffc82f5756470), [Data Rules](https://app.notion.com/p/406dc7f9b1cb8167b950d13363fcf94b), [Nutrition Rules](https://app.notion.com/p/403dc7f9b1cb819b97a5ecd7d1fa17dc), and the user's food-data and barcode decisions in this chat.

## 1. Non-negotiable invariants

- `local_date` is an ISO calendar date in the account's saved IANA timezone. Day/week/month ranges must be bounded and computed in that timezone. A date read must perform **no database write**.
- Actual intake includes `eaten` entries only. Planned entries and virtual repeat occurrences produce a separate projection. Editing a food, saved meal, or public recipe never changes an eaten snapshot.
- Unknown nutrient value is `null`/absent, not zero. A calories-only block supplies kcal but leaves protein and other nutrients unknown. Mass/volume/serving conversion requires an explicit known conversion.
- Every private row is account-owned. Anonymous access is through specifically published recipe versions and public profiles/collections only. No public query can traverse to a diary, target, private food, or draft meal.
- New date, repeat, and transfer actions require a stable request ID or unique occurrence key so retries cannot double-create records. Correcting an old completed entry must not create a new carry decision.
- Existing `routine` eaten snapshots remain readable. Existing routine-generated planned `day_items` remain dated historical records; opening a date stops generating additional routine items after the new calendar cutover.

## 2. Entity and visibility map

| Entity | Current storage | Target contract | Owner / visibility / provenance | Migration rule |
| --- | --- | --- | --- | --- |
| Account settings and target history | `profiles`, `profile_target_versions`, `nutrient_fields` | Saved timezone, optional kcal/protein targets with explicit effective local date; first-meal setup independent of a weekly pattern. | Account owner only; target values are preferences. | Keep rows and target versions. New onboarding and target editing stop creating `weekly_pattern_versions`; historic patterns remain read-only. |
| Private food and personal correction | `foods`, `food_nutrients` | Explicit nutrient basis/unit; optional reference to catalogue source and source revision; corrected copy is separately owned and editable. | Account owner only; preserve original source/brand/missing-field metadata. | Keep IDs and archived foods. Add nullable provenance columns or a linked provenance table; never overwrite shared catalogue values or eaten snapshots. |
| Shared food catalogue | None; current `searchFoods` searches owner rows only | A separate indexed read model with source ID, licence, update time, brand, basis, kcal/protein and known missing fields. | Public/read-only source records; ingestion writes restricted to maintenance role. | Choose source mix only after B1 coverage/licence benchmark. Do not change private `foods` RLS to make search global. |
| Saved meal and components | `meals`, `meal_components` | Private reusable meal with food components and calories-only blocks; optional cost/effort; a stable definition revision. | Account owner only; every referenced private food has same owner. | Preserve current meals/components. Add new component type and nullable food reference through forward migration; old rows remain food components. |
| Dated day and entry | `days`, `day_items`, `day_item_history` | Read an empty day without materialisation; create a date row only on an explicit log/plan/target action. Eaten item stores nutrition snapshot; planned item stores the selected definition/version. | Account owner only; source may be private food/meal or copied public recipe version. | Keep IDs, states and snapshots. New date rows do not require `weeks` or `week_allocations`; old week links stay for legacy history until retirement. |
| Repeat rule and exception | None; old `routine_versions`/`routine_slots` are different semantics | Opt-in schedule for one saved meal, start/end or indefinite, timezone basis; one-date skip/edit/stop exceptions. Range reads may yield virtual *planned* occurrences without writing. | Account owner only; source meal/version captured at rule creation. | Do not convert a whole legacy routine into repeat rules automatically. Allow explicit user migration later if valuable. |
| Calorie transfer | `carry_decisions`, `carry_allocations` implement completion-difference carry | Append-only ledger: origin date, destination date, amount, time, request ID, active/reversed state and reversal reference; explicit preview and user action. | Account owner only; no intake moves with allowance. | Keep `carry_*` history separate and read-only. Never infer a new transfer from a completed day's difference. |
| Published recipe version | None; `meals` are private | Immutable public snapshot of selected meal content/nutrition/notes, optional image and effort fields, publication state and owner. | Public read only while published; author controls publication, moderator controls reports/takedown. | Publishing copies data into a version; it does not expose private `meals` or their source foods. Private copied meals and eaten logs remain after unpublish. |
| Public profile, collection, report | None | Minimal creator identity, ordered public recipe-version references, visibility state, report queue and moderation state. | Public read for published items; owner/moderator write boundaries. | Add separately after private calendar works; do not make diary or settings part of public profile. |

## 3. Calendar read contract

`readCalendarDay(account, localDate)` is a read-only operation. It returns `{ date, target, entries, actual, planned, legacyCompletion }`; no `ensure_*` RPC is allowed in its call chain. `entries` come from account-scoped `day_items`, plus a bounded in-memory expansion of active repeat rules for the requested range. A historical materialised routine plan appears once from `day_items` and is not regenerated. `actual` sums eaten snapshots; `planned` stays separate, and partial/unknown flags travel with each metric. The UI may show zero for an empty day, but does not create a `days` row to do so.

Target resolution, in order:

1. For a legacy completed day, show the stored completion target and nutrient snapshot as historical fact. No later target edit rewrites it.
2. For an open date, choose the latest `profile_target_versions.effective_from <= localDate`; apply only explicit new transfer adjustments for that date. Existing `base_planned_target_kcal` may be shown as a legacy snapshot during migration but is not the new source of truth.
3. If no target version exists, target and remaining allowance are unavailable; calculation, saving and logging still work. Do not invent a default target.

For week/month, use one bounded date-range query for entries and repeat rules, then aggregate with the same pure summary logic as day view. Month view is navigation and planning context, not a second ledger. Reading those views must not create days or occurrences.

## 4. Explicit write contract

- **Plan/log:** First explicit write to a date creates a minimal `days` row if absent. The new row may have nullable `week_start` and nullable legacy target snapshot fields. `day_items` remains the authoritative dated entry table; plan/log RPCs capture nutrition or planned source version in one transaction and return a revision. Repeat request IDs return the same result.
- **Eaten correction:** Replace/resize/remove/restore one entry by expected revision, retain history, and recalculate that date's actual from snapshots. Preserve legacy completed-day snapshot metadata; do not run carry logic. Prompt separately before any action that would alter a completed-day interpretation.
- **Copy/move:** Create a new dated planned item from a captured source/version; moving is an atomic create-and-retire operation with both dates checked. Eaten entries are never silently moved as if they were planned.
- **Repeat:** Saving a rule is explicit. Range reads calculate candidate occurrences; acting on one occurrence creates an exception or dated item with a `(user_id, rule_id, local_date)` uniqueness guarantee. Single-date edits do not alter the series.
- **Transfer:** Preview shows origin/destination targets before/after; commit writes ledger and request receipt transactionally. Reversal appends a reversal record. Never create a transfer on page read or day completion.
- **Publish:** Create an immutable public recipe version from a reviewed private meal. Reporting/unpublishing changes visibility; it does not delete historic private copies or eaten snapshots.

## 5. Safe migration order

1. Add read-only calendar repository/domain contracts first and prove empty-day reads make no writes. Keep current Today route on old calls until the new view is ready.
2. In a forward migration, relax only the `days` columns that force a week and target on *new* rows; keep old values and foreign keys for existing rows. Add a new explicit-day helper and new log/plan RPCs rather than changing `private.ensure_day_for_log` in place, because routine/carry/completion callers still use that helper.
3. Test the new RPCs against `steady_r0_app_restore_check`: owner isolation, missing target, duplicate request, planned/eaten separation, historic snapshot stability and no `weeks`/routine row change. Compare old account row counts and eaten nutrition hashes before/after.
4. Switch the Calendar route to the new read and write API. Disable `ensureDaySnapshot`, `ensureRoutineDay`, completion and carry queries in that route. Redirect `/routine` only after dated reads and writes work in the new shell.
5. Add repeat rules, catalogue, transfer ledger and public publication tables in separate migrations aligned with B1–B6. Keep legacy tables read-only during the compatibility window. Drop them only in a later reviewed migration after all records and old-client behavior are accounted for.

## 6. R1 acceptance evidence

- Empty-day read before/after row counts and query trace show no writes to `days`, `weeks`, `week_allocations`, `day_items` or routine tables.
- Explicit targetless plan/log works, while remaining allowance is unavailable until a target exists.
- Existing 2-account local backup restores with matching data hashes; tests do not reveal or alter the other account's rows.
- New mutations are idempotent and reject cross-account references and stale revisions.
- Old eaten snapshots, including `routine` source snapshots, parse and sum exactly as before.
- A migration applied to the isolated restored database passes focused tests; no migration runs on the original local database before a fresh backup.
