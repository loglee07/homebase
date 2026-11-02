# Homebase

Renamed from Finance Town (display name only). The folder, package name, `FinanceTown` component, `finance-town:*` localStorage keys, backup format id and `finance-town` preview name are unchanged on purpose: renaming them would orphan saved data and backups.

Personal desktop-browser dashboard as a cozy pixel-art town. Walk a character into buildings to open real-life tools. No quests, stamina, grinding, or game currency; real-life milestones improve the world automatically.

@AGENTS.md

## Decisions
- Next.js 16 (App Router) + React 19 for UI/dashboards; Phaser 4 for the town. TypeScript strict.
- **Money is integer cents** (`lib/money.ts`). Never use float dollars. Debts are stored as positive amounts owed.
- **Two data modes** in the bank dashboard. **Demo** uses sample fixtures only (`lib/sampleData.ts`, never persisted). **My accounts** is manual entry: nickname, type (checking/savings/investment/debt) and a USD balance per account, nothing else. No bank credentials or account numbers are collected (nicknames that look like account numbers are rejected). Any future financial connection must be read-only; none exist yet.
- Manual accounts (`lib/manualAccounts.ts`): integer cents via `parseDollarsToCents` (rejects negatives, junk, >2 decimals); debts are stored and entered as positive amounts owed and subtracted once by `summarize()`. Persisted in `localStorage` key `finance-town:manual-accounts:v1` (browser-local, not encrypted; never put real values in source, logs, tests, docs or Git). Mode is saved in `finance-town:mode:v1`; each mode has its own milestone save (`finance-town:milestones:v1` demo, `finance-town:milestones:manual:v1` manual). Unreadable saved data is never overwritten: editing pauses until the user chooses to start fresh, which first copies it to `...:unreadable-backup`. Demo controls never touch manual data, and sample transactions are never shown in My accounts.
- **Brokerage (optional, read-only, live path unverified)**: SnapTrade Personal key, server-only (`lib/server/`, `app/api/brokerage/`). Only `listBrokerageAuthorizations` and `listUserAccounts` may be called (test-enforced); no trading, no connection changes, no userId/userSecret. Every route calls `guard()` first (loopback Host, same-origin, access code + session; fail closed). Dev server binds 127.0.0.1; never deploy or expose it. Credentials only in gitignored `.env.local` (`.env.example` has empty placeholders); never print env files, account numbers or raw provider responses, never NEXT_PUBLIC_ for secrets. Snapshot is in server memory only; brokerage accounts count only when the user includes them; manual accounts can be left out of net worth (never deleted). Details: `docs/brokerage.md`.
- **BluPeak via Plaid (optional, read-only, live path unverified)**: `lib/server/plaid*.ts`, routes under `app/api/brokerage/bank/`, same guard and session as SnapTrade. Link uses only `products: ["transactions"]` (never `balance`, Auth, Identity, Transfer); no redirect_uri (desktop popup OAuth). Only seven Plaid calls are allowed (test-enforced; the seventh is read-only `transactionsSync` for the activity history in `lib/server/plaidActivity.ts`, saved encrypted per environment and Item, never part of balances or net worth). The access token lives only in `.data/plaid-item.<env>.enc` (one file per Plaid environment; sandbox never counts toward net worth; switch with `npm run plaid:env -- sandbox|production`, never delete token files; gitignored, AES-256-GCM, key `FINANCE_TOWN_DATA_KEY` in `.env.local`, atomic writes); never print it, the key, env files or provider responses. One Item: duplicates are refused, reconnect uses update mode. Net worth uses current (not available) balance; overdraft = debt. Details: `docs/plaid.md`.
- **School (Canvas calendars, optional, read-only, live feeds unverified)**: `lib/server/school*.ts`, `lib/server/ics.ts` (ical.js), routes under `app/api/brokerage/school/` (must stay under `/api/brokerage`: the session cookie path). Feed links `CANVAS_SDSU_FEED_URL` / `CANVAS_SDCCD_FEED_URL` in `.env.local` only: server-side, host-allowlisted at every redirect, never in responses, logs, Git or exports. Calendar dates only (no grades or submission status). Details: `docs/school.md`.
- **One app-wide unlock**: a single server session (8 h, in memory) opens every protected building; one client (`components/useBrokerage.ts`), one header Lock button, any 401 locks all and clears private data from memory. No `localStorage` unlock flag, no stored code.
- Pixel art is procedural by default (`game/art.ts`, drawn to canvas textures). **No image assets are committed.** Optionally, the licensed Cute Fantasy Free pack (Kenmi, non-commercial, no redistribution) is loaded at runtime from the gitignored `public/licensed/cute-fantasy/`; without it the scene falls back to the procedural art. Never commit the pack or anything derived from it. Setup and the placeholder sprite list: `docs/assets.md`. Village is 480x320 (16px tiles) at fixed coordinates (buildings: school top, home west, bank east, Kitchen placeholder south-east; each has its own `*_BASE_Y` in `game/layout.ts`); the canvas fills the window (`Phaser.Scale.RESIZE`) with a whole-number camera zoom and extra decorative terrain around the village (`game/viewport.ts`).
- React and Phaser talk only through `game/bridge.ts` (`TownBridge`). Phaser code must stay behind the `ssr: false` dynamic import (`components/TownGame.tsx`).
- Milestones (`lib/milestones.ts`): net worth >= $100,000.00 gives home tier 2; falling below reverts to tier 1 (two-way for now; was one-way), computed from the active mode's accounts. Persisted in `localStorage` key `finance-town:milestones:v1`, read via `useSyncExternalStore`. The demo scenario is intentionally NOT persisted.
- Controls: WASD/arrows move, `E` interacts (Enter/Space deliberately unused: they would fight with focused buttons). Dashboard pauses the scene and releases key capture.

## Runtime
Node 24 LTS, installed as Homebrew keg-only `node@24` (24.22.2) at `/opt/homebrew/opt/node@24/bin`. The machine-wide `node` (Homebrew `node`, now 26.13.0) is untouched as the default for other projects.
- Every npm script runs through `scripts/with-node24.sh`, which prepends node@24 to PATH and exits if the major is not 24. So `npm run dev|build|test|lint|typecheck` use Node 24 regardless of the shell's default.
- `npm run install:locked` = `npm ci` under Node 24. Plain `npm install` in a default shell would use the default Node.
- `npm run node:check` prints the version and executable actually used.
- `.claude/settings.json` puts node@24 first on PATH for Claude Code sessions in this folder (applies to sessions started in this folder). `.claude/launch.json` defines the `finance-town` preview server through the same wrapper.
- `.nvmrc` (24), `engines` (>=24 <25) and `@types/node` ^24 document the pin; they do not activate it.
- Setup on a new machine: `brew install node@24`.

## Dev server
One dev server, always on port 3000: `npm run dev`. Stop it with `npm run dev:stop` (kills only a Next process whose cwd is this project; refuses otherwise). `next.config.ts` pins `turbopack.root` so the unrelated `~/package-lock.json` is ignored (do not touch that file).

## Commands
```bash
npm run dev          # http://localhost:3000
npm run dev:stop     # safe stop
npm test             # vitest: money, summary, milestone logic + persistence
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build (also type-checks)
```
`npm audit`: 16 moderate, all dev-only (see docs/progress.md); never use `--force`.
Run `npm test && npm run typecheck && npm run lint && npm run build` before finishing work.

## Layout
`lib/` pure logic (tested) · `game/` Phaser scene, art, layout, bridge · `components/` React UI · `tests/` vitest · `docs/progress.md` status.
