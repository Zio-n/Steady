# Steady

Steady is a personal food tracker PWA. The current product brief and implementation plan live in Notion:

- [Current build brief](https://app.notion.com/p/3bbdc7f9b1cb80a2a44ef91e8887b3f6)
- [0→1 implementation plan](https://app.notion.com/p/3eddc7f9b1cb817b8611c5190d48c5c1)

The visual reference is `/Users/zion/Documents/Temp_Steady/steady-site/index.html`. Its HTML/CSS has been inspected; a rendered comparison is still pending. Manrope is bundled locally so the interface does not depend on a third-party font request at runtime.

## Stack

React, TypeScript, Vite, Tailwind CSS, Supabase Auth/Postgres via `supabase-js`, `vite-plugin-pwa`, and Vercel hosting.

## Local setup

1. Use Node 22.12 or later.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local` and add the Supabase URL and public publishable key (legacy anon key is also accepted) when the project is provisioned.
4. Run `npm run dev`.

## Local database

1. Start Docker Desktop (or another Docker-compatible runtime).
2. Run `npm run db:start` once to start the local Supabase services. Steady uses ports 54330–54339 so it can coexist with other local Supabase projects.
3. Set the local URL/publishable key printed by the CLI (API URL `http://127.0.0.1:54331`) in `.env.local` and restart Vite.
4. Run `npm run db:test` for pgTAP checks. `npm run db:reset` **recreates the local database and discards its current records**; use it only when a reset is intended.
5. Run `npm run db:stop` when you want to stop the services; local database volume data is retained by default.

If the stack was started with a custom Docker network, pass the same network to database tests, for example `npm run db:test -- --network-id steady-loopback`. Docker Desktop may still publish local Supabase ports on all host interfaces; verify the published bind addresses instead of assuming that the network option restricted them. Never expose this development stack on an untrusted network. The local secret key is not used by the browser app and must not be committed or pasted into logs.

Private TanStack Query keys are rooted in the account ID; callers must use these helpers for account-owned data.

## PWA assets and cache policy

`npm run generate:icons` regenerates regular 192/512 px icons, a safe-zone maskable icon, and the 180 px Apple touch icon from the tracked SVG sources. The manifest launches Steady in standalone mode. The service worker precaches only the public app shell, fonts, icons and build assets. It has no runtime API/auth caching or offline write queue; an offline shell does not mean records are available or saves will sync later.

The app shows a connectivity notice when the browser reports offline. A cold offline read settles into an error/retry state instead of waiting indefinitely; data still visible from an earlier load is labeled as potentially stale. When the browser reports a restored connection, active account data is refreshed; a failed refresh has a manual retry. A known-offline mutation fails before its request and is never replayed automatically. An uncertain write must be reconciled through its feature's refresh/same-request retry path. Drafts remain in component memory while the tab stays open, not in the service-worker cache. Local sign-out clears this device's session and private query cache even when the remote logout cannot be confirmed; it does not revoke sessions on other devices.

A new app version prompts for a user-approved reload. To avoid discarding edits, any input/change in the current tab conservatively defers that in-app update until the tab is closed and reopened, even if the edit was later saved. In-flight mutations also block the update. This is intentionally conservative until every form has a reliable clean-state signal. See [PWA operations and acceptance](docs/pwa-operations.md) for the deployment compatibility rules, behavior matrix, and the real-device checks that remain in Phase 10.

## Verification

- `npm run typecheck` checks the TypeScript project.
- `npm run lint` checks source, scripts, and integration tests.
- `npm run test:unit` runs pure domain tests.
- `npm run test:a11y` checks contrast for core text color pairs.
- `npm run test:pwa` checks the generated cache policy after a build.
- `npm run db:test -- --network-id steady-loopback` runs local pgTAP checks while that custom network is in use.
- `npm run test:carry-concurrency` checks competing carry writes using a synthetic local account and removes it afterward.
- `npm run build` runs type checking and creates the production PWA bundle.
