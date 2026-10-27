# Steady reset execution log

**Started:** 27 October 2026  
**Plan:** [Product reset and semi-rebuild](product-reset-and-semi-rebuild-plan.md)  
**Current checkpoint:** R0 complete; R1 in progress. The first calendar read migration exists on the branch and has been tested only in an isolated restored database. The original database and current UI have not been migrated.

## R0 — Recoverable baseline

- Source: clean initial commit `14f26da` on `main`, already pushed to `https://github.com/Zio-n/Steady.git`. Annotated tag `baseline-before-reset-2026-10-27` points to that commit and is pushed to GitHub. Work is on `codex/calendar-reset`; `main` is unchanged.
- Deployment/data inventory: user confirmed the local Supabase database is the only data-bearing environment. `.env.local` points to the local API; the Supabase CLI reports no linked project. No `.vercel` link or `vercel.json` is present. There were no storage objects. This does not assert that no historical deployment ever existed.
- Original local database before a UI visit: 2 auth users, 2 profiles, 2 foods, 3 meals, 3 meal components, 6 days, 16 day items, 1 routine version, 2 routine slots, 0 carry decisions, 0 storage objects. Only counts were recorded; no personal row content or credentials are in this document.
- Private backup: `.local-backups/steady-local-pre-reset-2026-10-27.dump` (647,802 bytes, file mode `0600`; directory mode `0700`). SHA-256: `3df4233196cad3e20e079eacd277c111c2d9c08606729cf6ba8585b8d905a034`. `.local-backups/` is Git-ignored. This is a same-device migration backup, not off-device disaster recovery.
- Restore rehearsal: the full dump's Supabase `realtime` function failed in a plain isolated database because the restore role could not set `log_min_messages`. Restoring the application-relevant `public`, `auth`, `storage`, and `supabase_migrations` schemas into `steady_r0_app_restore_check` succeeded. Original/restored row counts matched for the tables above. The `foods`, `meals`, and `day_items` row hashes matched, as did 3 eaten entries, 4 planned entries, and 604 kcal in eaten snapshots. The failed disposable restore database was removed; the successful isolated copy remains for R1 migration tests.
- Existing code gates passed on the baseline source: lint, typecheck, 57 domain tests, 9 accessibility token contrast pairs, production build, PWA cache policy, and 22 pgTAP files / 362 database assertions. Database tests used `--network-id steady-loopback` because the default generated Docker network did not exist after Docker restarted. Tests did not change the recorded food, meal, or day-item hashes.
- Visual/keyboard smoke: authenticated Today loaded at desktop and 390 px phone width; phone document width matched viewport width, with bottom navigation and no horizontal overflow. Keyboard Tab reached Steady home, Today, Library, and Routine in order. This is a baseline observation, not a new-scope usability pass.

## Observed reset hazard

Simply opening Today on 27 October called the old day materialisation path and increased `public.days` from 6 to 7 without an explicit user edit. `public.day_items` stayed at 16. The backup and restored copy capture the state **before** that read. Do not use the current Today page for further audit navigation; R1 must make an empty-date read side-effect-free.

## R1 entry conditions and next work

1. [Rebuild data contract](rebuild-data-contract.md) records owner/visibility/provenance and the intended date, repeat, transfer and public recipe write rules. This is the R1 design baseline; later slices can refine fields without weakening the invariants.
2. `20261027140000_calendar_day_read.sql` adds `public.read_calendar_day(date)` as a `STABLE SECURITY INVOKER` function. It reads account-scoped target history, legacy completion snapshots and dated items without calling any `ensure_*` function. It returns `unset` for an account without a target.
3. `calendar_day_read.test.sql` passed 15 focused pgTAP assertions in `steady_r1_test`, an isolated copy of local app/auth/storage data with existing grants. The test covers target effective dates, empty dates without inserts, legacy completed targets, account isolation, targetless reads and execute permissions. The original local database has **not** received this migration.
4. Next: add a new explicit-write day helper and plan/log RPCs that do not require `weeks`; test them on the isolated copy. Then switch the client read path and remove routine materialisation from Calendar. Before applying any migration to the original, take a fresh backup that includes the additional empty day created by the UI visit.
