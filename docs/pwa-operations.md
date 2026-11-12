# PWA operations and acceptance

This is the operating contract for the local-first *shell*, not an offline-first data store. Public shell assets are precached; authentication, account records, and API responses are not. Steady requires a connection for fresh records and saves.

## Connection and data states

| Situation | Required behavior | Current implementation |
| --- | --- | --- |
| Open cold while offline | Shell may open; no invented zero/empty account data; show unavailable/retry. | Reads settle as errors; Calendar uses an unavailable state when no cached day exists. |
| Go offline after a successful load | Keep already-rendered values only as last loaded data; do not imply they are current. | Sticky offline banner labels visible data as last loaded while online. |
| Attempt a write while browser reports offline | Fail promptly, keep any open draft, never queue or replay it. | Mutation guard rejects before its request; mutation network mode never pauses. |
| Connection returns | Refresh active account queries; no write replay. | Reconnecting banner; refresh failure offers a manual retry. |
| Request outcome is uncertain | Do not assume failure and blindly create another record. | Feature-specific idempotency/request IDs, revision checks, refresh, and explicit retry flows remain the authority. Custom-nutrient creation reuses its field ID for unchanged retries and checks that exact saved row after an insert error. Verify visible server state before retrying other operations that may have committed. |
| Sign out while network is unavailable | Clear this device's local session and account query cache, without claiming remote revocation. | Local-scope sign-out verifies session removal after a remote error; auth state change clears private queries. Other devices remain signed in. |

Drafts are only in the live tab's component state. Closing, reloading, or installing a replacement does not preserve them. In-app navigation and tab close warn on the guarded editors, including both Profile target edits and unfinished custom-nutrient/name edits; a pending write also blocks in-app route navigation. Switching Library's Foods/Meals tabs with an editor open requires an explicit discard confirmation, and switching is unavailable during a write. The Calendar choice picker likewise confirms before switching away from a selected item or edited one-off form; its one-off Library saves reuse the request ID for unchanged retries after an uncertain response. Explicitly closing a choice dialog cancels its draft. The PWA update prompt additionally treats *any* input/change in the tab as an edit latch, so even a saved search requires closing and reopening before applying an update. This errs toward retaining user work but is not a durable draft system.

## Update and deployment contract

1. Apply database migrations before publishing code that needs them. Destructive cleanup requires a backup and a tested upgrade. Phase 0 is local and removes obsolete APIs; no previous hosted client exists. Before any future hosted release, establish an old-client compatibility/retirement policy rather than assuming destructive changes are compatible.
2. Publish the new app shell and let the service worker offer an update. Never force an immediate reload over unsaved edits or an in-flight mutation. The user may choose **Later**.
3. Reopen/update a clean tab and verify the new client against the migrated database. Separately verify the *previous* released client against that same database before considering a migration compatible. The latter is **not yet verifiable** because Steady has no hosted previous release.
4. Roll back application assets independently if necessary. Do not roll back a database migration that would invalidate already-written records or an older/newer client without a tested recovery procedure.

No production deployment has occurred. The old-client/new-database and new-client/new-database compatibility matrix, release rollback, and real service-worker update sequence therefore remain open acceptance items, not claimed passes.

## Device and accessibility acceptance still to perform

Run on at least one real iOS Safari installation and one Android Chrome installation, plus desktop. Test initial install, standalone launch, deep links, tab-to-standalone transitions, keyboard opening over a long form, safe-area insets, offline cold launch, offline after data load, reconnect with failed then successful refresh, an uncertain save, sign-out offline, update **Later** and **Update now**, and recovery after an update error. Use disposable account data for write tests.

Automated checks cover core token contrast and public-only precache. Phase 0 browser evidence is recorded in [the cleanup log](phase-0-cleanup.md). Earlier responsive/keyboard checks apply to the old build and do not validate removed pages or the current build. Real-device installation, actual screen-reader announcements, 200% zoom, every dialog state and production release/update behaviour remain release checks. A token contrast pass is not a full accessibility audit.
