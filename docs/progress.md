# Progress

## Milestone 1: town, bank, home upgrade (done)
- Compact procedural pixel-art town: paths, plaza fountain, pond, orchard, fences, lamps, benches, home, bank.
- Character with WASD/arrow movement, collision (buildings, trees, props, pond, fountain), interaction prompt.
- Bank dashboard (React modal): checking, savings, investments, debts, 10 recent transactions, net worth. Pauses the town while open. Quick-access **Bank** button in the top bar.
- Integer-cent money model and net worth calculation.
- Labeled **Demo control** toggles sample net worth ($71,264.57 vs $108,671.44).
- Net worth >= $100,000 upgrades home (cottage -> manor) with sparkle + toast; persisted in localStorage; reverts to cottage if net worth falls back below $100,000.
- Tests: `tests/finance.test.ts`, `tests/milestones.test.ts`.

## Limitations
- Sample data only; no account connections.
- Home interaction only shows a message (no home dashboard yet).
- Desktop browser only; no touch or gamepad controls.
- No automated browser/e2e tests; scene behavior was verified manually in a browser.
- Single milestone (home upgrade). Milestone state is per-browser localStorage.
- `npm audit`: 16 moderate, 0 in production deps (`npm audit --omit=dev` is clean). All are the ESLint toolchain (`eslint` 9 -> `@eslint/config-array`/`@eslint/eslintrc`/`eslint-plugin-*`/`typescript-eslint` -> `minimatch` <11.0.1, glob DoS GHSA-g3hv-75wg-m249). Dev-only, runs on local config, no untrusted glob input. No compatible fix: `npm audit fix` changes nothing, and the "fix" offered is a nonsensical major downgrade (`eslint@4`, `eslint-config-next@12`). Forcing minimatch 11 would break ESLint 9 (CJS API). Revisit when `eslint-config-next`/ESLint ship a patched minimatch.

## Stabilization pass (done)
- Vitest warning was the CJS/ESM config loader, fixed earlier by `vitest.config.mts`; no warning now. Runtime pinned to Node 24 (`.nvmrc`, `engines`).
- Next.js root warning: caused by `~/package-lock.json` (and `~/package.json`) being detected as workspace root. Fixed with `turbopack.root` in `next.config.ts`; home files untouched. Build prints no warning.
- Single dev server on :3000; `npm run dev:stop` verifies the listener is this project's Next process before killing.
- AudioContext errors: not reproducible on a fresh tab after restart (console empty of errors). Likely a leftover from the StrictMode double mount leaving a second canvas/game; fixed by clearing the parent on cleanup in `TownGame.tsx`.
- Browser checks (scripted `KeyboardEvent`s dispatched on `window` in the in-app browser, NOT physical keyboard): home prompt + message; manor blocks walking into it from the door; dashboard open ignores movement keys and restores the prompt on close; 900x600 window has no horizontal overflow and the dashboard scrolls vertically.
- Not done: physical keyboard testing, real key-hold timing on other machines, windows narrower than 900px.

## Node 24 setup (done)
- `brew install node@24` (24.22.2, keg-only). Side effect: Homebrew upgraded `simdjson`, which broke the existing Homebrew Node 25.9.0 (missing libsimdjson.33). Repaired with `brew reinstall node`, which pulled the current formula, so the machine-wide `node` is now 26.13.0 (was 25.9.0). Nothing was uninstalled.
- Wrapper `scripts/with-node24.sh` + npm scripts + `.claude/` config (see CLAUDE.md). `node_modules` reinstalled with `npm ci` under Node 24: no EBADENGINE/engine warnings; Vitest runs with no warnings.
- Verified: `npm run node:check` -> `v24.22.2 /opt/homebrew/Cellar/node@24/24.22.2_2/bin/node`; the running `next-server` on :3000 has that binary mapped (lsof), not the default node.
- Checks under Node 24: tests 14/14, lint, build, typecheck pass. Note `typecheck` needs `.next` route types (`LayoutProps`), so run `build` or `dev` once first after deleting `.next`.
- Not verified: the in-app preview launcher (`preview_start`) only reads `.claude/launch.json` from the session's starting folder, which here is a scratch folder, so it could not load this project's config. Works once a session is opened in this folder.
- ESLint audit findings (16 moderate, dev-only) left as documented; no forced upgrades/downgrades.

## Licensed art integration (done, local only)
- Cute Fantasy Free (Kenmi) loaded at runtime from gitignored `public/licensed/cute-fantasy/`; procedural art is the fallback. See `docs/assets.md`.
- Pack used for: autotiled grass/path/pond, flowers and tufts, oak trees, lamps, rocks, flower bushes, fences, player. Pond is now tile-aligned in pack mode (`isWater`, `waterBlocks`).
- Still placeholders: cottage, manor, bank, fountain, bench, mailbox, blossom/autumn trees (list with sizes/anchors in `docs/assets.md`).
- Checked: no licensed files tracked or in git history; remote `origin/main` is only the initial commit. Verified in the browser with and without the pack folder; no new automated tests.

## Cottage rendering and doorstep (done)
- Cottage sprite re-sampled with nearest-neighbor (no blended colors); runtime already crisp (`pixelArt`, pixelated canvas, 1:1 sprite, 1.47x non-integer canvas scale like all sprites). Home path now starts under the building so it meets the door; the door prompt was reached by walking in the browser.
- The cottage is a temporary high-detail asset; replace with native 64x72 art (see `docs/assets.md`).
- Manor tier not re-verified after these changes.

## Bank, manor, cobblestone path (done)
- Custom `bank.png` and `home_2.png` (96x75, nearest-sampled like the cottage) replace the code-drawn buildings; bank walk now starts under the building. Cobblestone tile (`cobble.png`) replaces dirt in pack mode. Home and bank door prompts verified by walking in the browser; manor tier now verified.
- Custom sprites load with or without the pack (code-drawn art only if a file fails to load). The cobblestone path needs the pack's path tiles, so without the pack the path stays code-drawn dirt.
- Bank sign text unreadable at 96px.

## Bank dashboard redesign (done)
- Accounts in a 2x2 grid (1 column under 760px); net worth hero with assets and debts explained underneath; pixel font for headings only, regular font for names and all figures.
- Milestone panel: before unlocking, progress toward $100,000 (floored percent, amount to go); once the home tier is upgraded, "Home upgraded · milestone achieved" (`milestoneStatus` in `lib/milestones.ts`, driven by the tier, not by current net worth).
- Transactions carry an explicit `kind` in the fixtures (income, spending, transfer, investment, debt_payment); labels and tones in `TRANSACTION_KIND`. Transfers, investment purchases and debt payments are neutral and labeled; amounts and signs are the account-level values.
- Verified in the browser at 1440x900 and 900x600: Esc closes, focus starts on Leave bank, body scrolls vertically, no horizontal overflow, locked and unlocked messaging. Movement pausing code was not touched and not re-tested by walking.
- Limitation: home tier currently reverts when net worth falls below $100,000 (a later request); the "stays unlocked" message therefore only differs from net-worth state if one-way behavior is restored.
- Bank artwork intentionally keeps the original sign art, no text overlay. Building-name labels may come later as a separate interface layer.

## My accounts mode (done)
- Separate **My accounts** mode next to Demo (top-bar "Data" switch, saved across reloads). Add, edit and delete accounts (nickname, type, USD balance) from the bank dashboard; "Updated <date>" per account (moves only when the balance changes); empty start with a setup prompt.
- Validation: integer cents, positive amounts only, max two decimals, nickname 1-40 chars and not number-like. Net worth, assets and debts reuse `summarize()`; the home tier uses the existing milestone logic on the active mode's net worth, with a separate saved milestone per mode and no toast when merely switching modes.
- Transactions in My accounts: an explanatory "not available yet" card; sample transactions never appear.
- Unreadable saved data: warning, editing paused, explicit "Keep a backup and start fresh" (copies the raw data to an unreadable-backup key first).
- Verified: 36+ unit tests (parsing, validation, add/edit/delete, loading, mode separation, upgrade and downgrade); in the browser at 1280x800 and 900x600: empty setup, validation errors and focus, add checking and debt (net worth 1,234.56 - 234.50 = 1,000.06), edit prefill, Esc backs out form then bank with focus returned, delete confirm, reload persistence, upgrade to manor from manual balances and downgrade after delete, demo switch leaving manual data untouched, corrupt data and backup. Test data was removed from the preview browser afterwards.
- Limitations: localStorage is not encrypted and is per browser; no multi-device sync (backup/restore is a manual file copy); one currency (USD); no transaction entry; failed browser writes show a warning but are not retried.

## Manual account backup and restore (done)
- My accounts toolbar in the bank: **Export backup** downloads `finance-town-accounts-YYYY-MM-DD.json` (format `finance-town-manual-accounts`, version 1: id, nickname, type, integer-cent balance, updated date, plus `exportedAt`). Demo data and home tier are never exported; the tier is re-derived from imported balances. `finance-town-accounts-*.json` is gitignored.
- **Import backup** (file picker): the whole file is validated first (size cap 1 MB, malformed JSON, wrong format, unsupported version, duplicate ids, bad types, negative/fractional/unsafe money, bad names and dates, unknown shape). A preview shows account count and net worth; nothing changes until "Replace my accounts" is confirmed. Cancel, Esc, invalid files and storage failure leave current data untouched. The replacement is written and read back before it is reported as saved.
- Verified: unit tests for round trip and rejection cases; in the browser: export contents and filename, preview then cancel unchanged, 9 invalid files rejected with data unchanged, simulated storage failure leaves data unchanged, successful replace upgraded the home to the manor, focus returns to Import after cancel/Esc, at 900x600 the toolbar and import preview have no overflow and all buttons are reachable (no fixes needed), player does not move while the bank or the import preview is open. Test data removed from the preview browser afterwards.
- Limitations: the backup is a plain unencrypted file with balances, so keep it private; replace is not undoable (export first); one format version.

## Brokerage balances via SnapTrade Personal (done, mocked only)
- Read-only Fidelity/Robinhood totals in My accounts, behind a loopback-only, same-origin, access-code-protected local API. Setup, behavior and the full list of protections: `docs/brokerage.md`.
- Added: `lib/brokerage.ts` (pure: cents, statuses, merge, duplicates, prefs), `lib/server/*` (guard, session, in-memory snapshot, SnapTrade client, synthetic fixtures), `app/api/brokerage/*`, `components/BrokeragePanel.tsx`, `components/useBrokerage.ts`, `.env.example`, `npm run env:init`. `npm run dev` and `start` now bind to 127.0.0.1.
- Verified with synthetic data only (tests + browser against fixtures + curl on the auth boundary). **Live SnapTrade calls were not run**; see "Verification status" in `docs/brokerage.md`.
- Interface cleanup: the empty state depends on manual accounts and included connected accounts together; with connected accounts and no manual ones the button reads "Add a manual account". Copy now says manual balances are saved in this browser and brokerage balances come from SnapTrade (read-only); the "nothing connects" claim is gone. With connected accounts the transactions card says transaction syncing is not implemented yet. Checked with synthetic fixtures in the empty, connected-only, manual-only and both states (net worth, include/exclude and refresh unchanged).
- Limitations: snapshot is lost on server restart (press Refresh again); one SnapTrade account (yours); USD only; totals only, no holdings or transactions; duplicate detection is a hint, the user decides; provider data and credentials are never in manual backups.

## BluPeak balances via Plaid (done, mocked only)
- Read-only BluPeak checking/savings in My accounts, behind the existing session and loopback guard. Setup, behavior, token storage and verification status: `docs/plaid.md`. SnapTrade is unchanged.
- Added: `lib/plaid.ts` (pure), `lib/server/{vault,plaidService,plaid,bankStore,bankProvider,fixtureBank}.ts`, `app/api/brokerage/bank/*`, `components/{BluPeakPanel,useBank,apiCall}`, `scripts/{env-lib,env-init,vault-key}.mjs` (`npm run env:init` now appends missing placeholders instead of only creating the file; `npm run vault:key`), `.env.example` keys, `/.data/` gitignore.
- Verified with synthetic data only: unit tests, `curl` on the auth boundary, browser pass on fixtures. **Fixtures only at this point; see the live result below.** A browser pass caught the session cookie not reaching the BluPeak routes; fixed by keeping the routes under `/api/brokerage`.
- Environment separation: vault file per Plaid environment (`.data/plaid-item.<env>.enc`, environment bound into the encryption), cache, cooldown and preferences per environment, mismatches rejected (`environment_mismatch`). Sandbox is labeled, cannot be included and never counts toward net worth or the home tier. Per-environment secrets `PLAID_SECRET_SANDBOX` / `PLAID_SECRET_PRODUCTION`. Switch with `npm run plaid:env -- sandbox|production` (changes only `PLAID_ENV`, keeps the production token). Build audit: the `vault.ts` Turbopack file-tracing warning is gone (`turbopackIgnore` on the fs paths); `.next/static`, `.next/server`, trace files and `public/` contain no secret values and no vault file, only UI help text naming the file.
- Live result (2026-11-01): production BluPeak link, exchange, encrypted save and balance Refresh worked. The first Refresh timed out at the 20 second limit and the second succeeded (~7s), so the balance call now has a 60 second limit and refresh failures log sanitized Plaid identifiers. Details and what is still unverified: `docs/plaid.md`.
- Limitations: one Item (BluPeak); balances only (Transactions is requested at Link but not read); desktop popup OAuth only, no redirect URI; snapshot lost on server restart (the encrypted token is not); checking and savings only, USD only.

## Next milestone
Second building with a real tool (e.g. a budget or goals hall) and a second milestone that changes the world; add a read-only data-source interface behind the sample data; add a Playwright smoke test for walk -> enter bank -> upgrade -> reload.
