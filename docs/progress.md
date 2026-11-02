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
- Still placeholders: cottage, manor, bank, mailbox, blossom/autumn trees (list with sizes/anchors in `docs/assets.md`).
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

## Category override for connected accounts
- Choose Checking, Savings or Investments per connected asset account ("Show under" in the SnapTrade and BluPeak panels); "Use default" clears it. Stored in the existing account preferences (`categories`, key `finance-town:brokerage-prefs:v1`) by the same stable id as inclusion: the SnapTrade account id or `plaid:<environment>:<id>`, so Plaid environments never share a choice. Old saved preferences without the field load as no overrides.
- Display only: balance, inclusion, total net worth and home tier are unchanged; only the category subtotals move. The provider's own account type is never altered and nothing is written to a provider. Overdrawn Plaid accounts stay debts, and Sandbox accounts still never count.
- Checked with synthetic fixtures: moving a stand-in for Cash Management to Savings moved its balance between subtotals with net worth unchanged, the choice survived Refresh and a page reload, and Use default restored it. Tests in `tests/categories.test.ts`.

## Net worth history
- A "Net worth history" card in the bank dashboard (My accounts only; Demo never shows or records it). It starts recording from the first complete load; nothing is backfilled. `lib/netWorthHistory.ts` (pure, tested) and `components/NetWorthHistory.tsx`.
- One snapshot per local calendar day. A later complete load the same day replaces it; other days are never touched. Saved in `localStorage` key `finance-town:net-worth-history:v1` as `{day, at, netWorthCents, assetsCents, debtsCents, connected}` in integer cents. No account names, ids, credentials or provider payloads. Browser-local, not encrypted, and not part of manual backups. Capped at 3650 days. Unreadable saved history is never overwritten; the card says so and recording pauses.
- Recorded only when the totals are complete and fresh: something is counted, every included connected account is loaded, nothing connected is stale, and no included balance is pending. A locked session, partial totals, stale provider data and a Sandbox server record nothing (Sandbox balances never count). Manual-only totals record without unlocking.
- Opening the card reads saved snapshots only, so it never calls a provider. History that includes connected balances (`connected: true`) is hidden until the local access-code session is unlocked.
- Changing which accounts are included, left out or edited changes that day's totals, and therefore the history. Older days are not recalculated, so the line can step when inclusion changes. Re-categorizing an account does not change any total.
- One snapshot shows an honest "History starts today" state; the line appears from the second day. The exact amounts are in a table below the chart (latest 14 days).
- Checked with synthetic fixtures: manual-only recording, same-day replacement after loading and including a connected account, a multi-day chart (earlier days seeded as synthetic test data), lock hiding the connected history without recording, and Demo showing no card.

## School (Canvas calendar feeds)
- A school building north of the plaza (temporary code-drawn art in `game/art.ts`, footprint and walk in `game/layout.ts`, E-to-enter like the bank) plus a header School button. The dashboard (`components/SchoolDashboard.tsx`) shows Today, Next 7 days and a month calendar, with school and course labels and original Canvas links. Calendar dates only: no grades, submission status or completion.
- Server side only: `lib/server/{schoolHosts,schoolFeed,ics,schoolStore,schoolProvider,fixtureSchool}.ts`, routes `app/api/brokerage/school/{state,refresh}` (under `/api/brokerage` so the session cookie reaches them), same guard and unlock as the financial endpoints. Feed links come from `CANVAS_SDSU_FEED_URL` and `CANVAS_SDCCD_FEED_URL` in `.env.local` (empty placeholders added; existing values untouched), are host-checked at every redirect and never reach the browser, logs or exports. Parser: `ical.js`.
- Each school refreshes on its own with a 60 second cooldown and a last-updated time; a failure keeps that school's previous events with a stale warning. Setup and testing steps: `docs/school.md`.
- Real feeds inspected (field shapes only, no URLs printed): every event is an `event-assignment-N`, almost all with date-only `DTSTART` and no `DTEND`, so those show "Check Canvas for due time" instead of "All day". The default view is now Upcoming (today + 7 days, deadline order, empty days collapsed); the month calendar stays; the calendars card is compact by default. The user's school art is in place as `public/sprites/school.png` (96x75, nearest-sampled); the code-drawn schoolhouse stays as fallback.
- Town notice (`components/SchoolNotice.tsx`, `townNotice()` in `lib/school.ts`): top-left of the town shows today's calendar-item count and the next item across both schools, with a stale/unavailable tag; click opens School. It reads calendars already in memory (loaded by opening School once while unlocked) and never fetches; locked or unloaded it shows no calendar data. Counts are calendar items, not unfinished assignments. Fold toggles now show only the arrow.
- Verified with synthetic data (tests, `curl` auth checks, browser pass). Feeds loaded for the user; dates and times still to be compared with Canvas. The walk, collision and prompt were checked in the browser; the temporary art stays until custom art is provided.

## Next milestone
Second building with a real tool (e.g. a budget or goals hall) and a second milestone that changes the world; add a read-only data-source interface behind the sample data; add a Playwright smoke test for walk -> enter bank -> upgrade -> reload.

## App-wide unlock
- One server session for Bank, School and future buildings; one shared client, a verification on every load plus a 60 second and tab-return re-check, and a single global Lock button in the header. Any 401 from a protected route locks every building and clears private data from memory (saved data stays). Timeout: 8 hours from unlock, absolute; a server restart also ends it. Tests in `tests/brokerageServer.test.ts`.

## Nameplates
- Wooden "Home", "Bank" and "School" plaques float above the buildings (`game/nameplates.ts` data, `components/Nameplates.tsx` overlay, `.ft-plaque` styles). They are DOM text over the canvas, so lettering stays crisp; placement follows the camera (see Responsive viewport). Each plaque sits 4 world pixels above the sprite's highest opaque pixel (cottage 57, manor/bank/school 54, bell tower included) and follows the home tier. They bob and sway gently (staggered, off under reduced-motion). Pointer-transparent, `aria-hidden`, not part of the scene: no collision, no effect on movement or E prompts. To label a new building add an entry to `NAMEPLATES`/`nameplatesFor` with its center x and roof y. If a sprite's height changes, update `roofOf(...)` there. The school notice moved to the bottom-left so it never covers a plaque.

## Responsive viewport
- The canvas fills the area under the toolbar (`Scale.RESIZE`, a `ResizeObserver` on the container, `100dvh` page with no scroll), with no letterbox bars. `game/viewport.ts` picks a whole-number camera zoom (1 + one step per 800px of width, never so high that under 200 world pixels of height show), so pixels stay square and crisp. Wide windows show extra terrain; small windows follow the player, clamped inside the village, so every door stays reachable.
- Extra terrain: a grass tile sprite plus a decorative forest (`buildPadTrees`, 240px left/right and 160px up/down of the village). No collision (the player stays inside the old world bounds), and the zoom rule guarantees the camera never shows past it.
- Nameplates track the camera through `TownBridge.view` (moved in the DOM, no per-frame React renders). The school notice and E prompt are positioned in the stage, which is now exactly the visible game area. Village coordinates, collisions, labels and interactions are unchanged. Checked at 900x600, 1440x900 and 2400x1000 including live resizes.

## Town notice states and HUD header
- The notice said "No calendars set up" because the calendar state was only read once School had been opened, so an empty list looked like "no feeds". Configuration was fine (both feed variables set). Now unlocking reads the server's cached calendars (no feed fetch; feeds are still fetched only when School is opened or Refresh is pressed), and `noticeKind()` in `lib/school.ts` separates: checking, off (no access code), locked, loading, could not read (local server), none (no feed link set), not loaded yet, loading from Canvas, failed, and ok (stale flagged). "No calendars set up" appears only when the server reports no configured school.
- Header redesigned as a pixel HUD (`components/Hud.tsx`, `components/PixelIcon.tsx`, `.hud*` styles): wooden title plaque, Bank/School menu buttons, a gold coin counter (accessible label "Net worth in USD", tooltip, Loading/Partial tag when included balances are missing), a de-emphasized home tier, a compact Data menu (Demo shows a DEMO tag in the menu and on the counter) and the global Lock (a "Locked" indicator while locked). Icons are inline SVG pixel art; no image files. The town's height follows the header (the canvas observes its container). Amounts still come from integer cents via `formatCents`.

## Session idle timeout
- 30 minute inactivity limit beside the 8 hour absolute limit, tracked on the server (`checkSession`/`touchSession` in `lib/server/session.ts`, `POST /api/brokerage/activity`). Details and the refresh-vs-restart finding are in `docs/brokerage.md` (Session timeouts and restarts). Verified with controlled-clock unit tests and, on the fixture server with a 12 second idle window, in the browser: polling and reloads do not extend it, activity does, the 8 hour limit does not move, and a lock in one tab locks the other.

## Auto-load of net worth
- Included connected balances load automatically after unlock (see `docs/brokerage.md`, Auto-load), replacing the visit to the Bank to press Load. Verified on the fixture server: restart, unlock from School, counter completes with one refresh call, and a lock/unlock cycle does not refetch.

- Town calendar notice: top-right of the game area under the header; minimize button collapses it to a calendar badge with today's count (preference in `finance-town:notice-minimized:v1`, no calendar data). Hover previews, click/Enter/Space/tap pins open. "Open School" is separate. Never fetches. The controls hint line was removed.
- Landscaping pass: uneven tree clusters with clearings, an irregular tile-authored pond (`POND_ROWS`), a rounded octagon plaza (`PLAZA_ROWS`), benches/lamps on the plaza edge, flowers and bushes grouped by doors (`FLOWER_PATCHES`). `tests/layout.test.ts` flood-fills the walkable map from the spawn.
- Bench (30x16) and fountain (35x34, static, no water animation) are our own sprites in `public/sprites/` (binary alpha, trimmed, nearest-neighbor resized). Collision: bench 26x6 at its base, fountain 32x17 (`FOUNTAIN_BLOCK`).
- Hitboxes: buildings block only their 24px wall base (walk behind the roof), fountain blocks its whole basin (36x25), water collision is inset 5px on land-facing edges.
- Fountain water animates: 4 frames (`fountain_0..3.png`, shimmer and a rippling jet) cycled every 180ms.
- Map redone after a reference image: school top-centre, home west, bank east, a Kitchen placeholder south-east (the bank's shape with an orange tile roof, `public/sprites/kitchen.png`; its door shows a "coming soon" toast, it will track meals and macros later), a round plaza with six lamps, a pond south-west, a dense forest thinning into a meadow (`MEADOW` in `game/layout.ts`), flower beds and bushes by doors and around the plaza. Each building now has its own base y (`*_BASE_Y`).
- Paths redone: circular plaza (radius 4.4 tiles) around the fountain, straight 2-wide walks to each door, a kitchen walk ending in a landing at its door. Tree canopies are kept off every path, the plaza and the doors (tested).
- Shadows (`game/shadows.ts`): one upper-left light; flat translucent ground shadows under buildings (slab + right-side strip), trees (except the pack's shaded oak, which bakes its own), benches, lamps, mailbox, fountain and the code-drawn player. All sit at depth 0.5, under every object.

- Removed the placeholder Kitchen (building, nameplate, door, interaction, toast, path spur, collision, `kitchen.png`). The plot is plain park using the existing meadow, bushes and flowers. The trail south and the pond are unchanged. Nutrition tracking belongs to the separate MacroTrack project; no nutrition data was ever stored here.
- Tree variety: pines and birches (`public/sprites/tree_pine.png` 24x36, `tree_birch.png` 19x40, background removed, halos eroded, nearest-neighbor resized) replace some existing oaks, so tree count and positions are unchanged (`BASE_TREES` vs `TREES` in `game/layout.ts`). Pines come in clusters in the forest outside the meadow (also in the decorative pad forest); a few birches stand near the pond and in the park. Oaks stay the majority. Trunk collisions are 6px (pine) and 5px (birch) wide. No blossom trees were added. Works in both art modes (the sprites load in each; procedural `tree_pine`/`tree_birch` textures exist only as a fallback).
- Tree mix (superseded by the nature/paving refinement below): the oak-type trees were split evenly three ways. Birches fill in from the pond and park outward; pines prefer the outer woodland, in stands. Sizes vary by tier: small 0.9x, medium 1x, large 1.1x (pines and birches have a sprite per tier, `tree_<kind>_s/_l.png`; oaks scale by the same factors). Large trees fall back to medium where the bigger canopy would reach a path or door.
- Forest is now a wall about three trees deep (`FOREST_DEPTH` = 51px) around the edge of the village; the meadow inside has no trees, like the reference map (without its diagonal paths, which were not added). Trees only ever stand in the wall; the even oak/pine/birch split and size tiers apply within it.

## Nature and paving refinement
- Grass: lighter, slightly warmer base with two soft 2x2-tile variants (`grassVariant` in `game/layout.ts`; the pack's grass tile is shifted per variant in `game/licensed.ts`, code-drawn colors in `game/art.ts`) and about 40 sparse tufts (`tuftSpots`). No overlay or filter.
- Paving: `game/cobble.ts` generates a seamless 48x48 light warm-grey cobble (about 64 small angular stones, joints only slightly darker) used by both art modes; `public/sprites/cobble.png` is gone. Plaza is a compact 8x8 rounded square with 3-tile clipped corners (`PLAZA`, `isPlaza`), keeping at least 44px of walking space beside the fountain. The school walk now meets the plaza straight on.
- Trees: oaks stay the largest group; pines only in the outer band (30px) of the wall; birches fewer and dimmer (sprites at 0.78 brightness), in 5 small clusters of 2-3 with open ground between them (`diversify`). Tree count and positions unchanged.
- Shrubs (`shrubSpots`): about 20 non-colliding flowering bushes beside some oaks, at building foundations, beside each bench and on the pond's west, north and south banks (the east bank stays bare). Shore tufts add low growth; the pond stays mostly visible.
- Missing assets (not stretched or faked): the pack has only the flowering bush, so there is no plain green shrub, reed, cattail or lily cluster. Plain shrubs and shore reeds would be new sprites at the oak's density and outline weight.
- Collisions, entrances, shadows and the no-pack fallback are unchanged; layout tests flood-fill both art modes and both home tiers.

## Perimeter forest rebuild
- One woodland rule replaces the old wall, the pad scatter and the species-swap pass (`buildForest` in `game/layout.ts`). Trunks sit on staggered rows (20px across, 14px between rows, odd rows shifted, small jitter, minimum gap 16px), so canopies overlap in depth and leave no holes, and they are kept only outside the town clearing.
- The clearing (`clearingDistance`) is a smooth union of eight ellipses (plaza, school, home, bank, east side, pond, park, south trail) plus low-frequency noise, so its edge bulges around the buildings and recedes between them; the village corners are woodland. Tests keep every door, building, pond bank, bench, lamp, the spawn and the trail inside it with no trunk in it, and check the edge is not straight on any side.
- The same forest continues past the village (`FOREST_PAD_X/Y` 300/210); `buildPadTrees(padX, padY)` is just a window onto it, so a bigger window shows more of the same trees and reloads/resizes never move anything. `TREES` (with trunk collisions) is the part inside the village.
- Species: oaks dominate (a little blossom/autumn kept at about 5% each); pines form broad stands from a second noise field away from the clearing edge; birches are a few clusters of up to three. Sizes use the same three tiers.
- Shrubs by trees now stand on the clearing side of selected front-row oaks (they follow the clearing edge). Flowers, tufts and shrubs stay inside the clearing (`openGround`).

## Stone paving and path edge
- Paving now comes from the supplied stonework image: reduced to 20 colors, nearest-neighbor at 1/12 scale (stones about 9-11px wide), then made seamless by replacing a 16px band on each axis with a minimum-error cut through the joints (crop offset 0,60 chosen for the lowest wrap error). Stored as palette-indexed rows in `game/pavingData.ts` (88x88); `game/cobble.ts` and `cobble.png` are gone. Previewed repeated 3x3 before use, no visible seam; `tests/paving.test.ts` checks the wrap against the texture's own neighbour contrast.
- `game/paving.ts` builds the whole-village paving once: texture sampled by world position (independent of the edge), then a thin grass-green rim 1px deep (rarely 2) with gaps in runs of three so it never reads as a sawtooth; outer corners lose their tip pixel (stepped, not pointed). Alpha is only 0 or 255 (no blur). Both art modes lay it over their own lawn, so the pack's bushy path tiles are no longer used and the fallback paths are stone too.
- Layout, path widths, collisions and entrances unchanged (paving follows `isPath`; tests assert the paved tile centres equal the path tiles).

## Path edge rebuild
- The pack's spiky path fringe is gone. `game/pathMasks.ts` holds only the paved shape of the pack's 13 path tiles (rounded corners kept); `pavingLayer` in `game/paving.ts` assembles them by the pack's autotile rules, smooths the outline across tile joins (two 5x5 majority passes), paints stone from the texture, a 1px muted grey-green rim and rare 1-2px grass tufts. Alpha is only 0 or 255, so the lawn shows through and nothing is blended; both art modes use it, so the fallback paths are stone too. Paths that run off the map keep going instead of ending in a cap.
- Stone palette remapped once to light neutral-grey faces (about 170-186) and medium-grey joints (about 118-128), at the 1/16 scale texture. Path footprint (the pack's geometry: a 2-tile path is about 16px wide) and collisions are unchanged.

## Circular plaza
- The plaza is a true circle (`PLAZA` = center 240,192, radius 64 in `game/layout.ts`), defined in pixels, not tiles. `pavingLayer` fills it with `inPlazaDisc` before the shared outline smoothing, so the existing stone texture is clipped by the circle and boundary tiles are partly visible, with a pixel-level silhouette (no blur, no tile-sized steps). The four walks are centered on its diameters and meet it at the tile block's sides, widths and stone pattern unchanged.
- `isPlaza(c, r)` is now "the circle touches this tile", so the logic that keeps trees, flowers and shrubs off paving still holds. Verified against a temporary circle outline (removed); the silhouette matched it. Forest, buildings, props, texture and interactions are unchanged.

## Lawn texture
- The lawn is now an actual grass texture (`game/grass.ts`): the base green with thin vertical blades (lit tip, body, shaded root, about 5% of pixels are roots) and a few darker flecks. It is a pure function of the world pixel, so it never repeats in rows; the small fill tile around the village wraps at 64px so it tiles seamlessly. Base greens are unchanged (the pack tile's main green plus the same three shades; the code-drawn greens in the fallback), so the lawn keeps its color. Both art modes use it.
- The pond's pack tiles carried flat pack-green squares around the bank; those pixels are now clear over the lawn, so no squares show around the water.

## Plaza resized to an ellipse
- The plaza is now a smaller ellipse, 58px wide radius by 44px tall (`PLAZA` = center 240,192, `rx` 58, `ry` 44; first 50, then shrunk again), a little wider than tall, instead of the 64px circle. The four walks keep their 16px paved width and run into it along its axes through `PLAZA_ARMS` (`inPlazaShape`), so there is no gap where the ellipse pulled back from the old tile block. `isPlaza` is "the ellipse touches this tile". Props (lamps, benches), the stone texture, forest and interactions are unchanged; the lamps now stand a little outside the paving. Silhouette checked against a temporary outline (removed).

## Path edge grass blades
- Replaced the loose grass overflow (`OVERFLOW`) and rare tufts with a near-continuous fringe of thin vertical grass blades along every path edge, matching the reference. Blades are 1-3px tall at uneven heights (about 30/40/30%), colored dark root, mid body, light tip (`FRINGE` in `game/paving.ts`). On top edges they rise out of the lawn above the stone; on bottom edges they overlap the stone's lowest rows; on left and right edges short 1-2px blades lean onto the stone. Stone shows between blades (about 80% of edge columns carry one). Both art modes share it.

## Yard fence
- The home now has a full fence: a closed rectangle on the tile grid (`YARD` in `game/layout.ts`, columns 4-11, rows 3-9) around the manor's largest footprint, open only at the two walk columns in front of the door. `FENCES` is one piece per tile with a `part` (corners, sides, rails, rail ends at the gap); pack mode maps parts to Fences.png frames (`FENCE_FRAME` in `game/licensed.ts`), the fallback draws `fence` and `fence_side` in `game/art.ts`. Each piece blocks the player; the gap does not. The two plaza-ring lamps beside the yard moved out to x 198 and 282, two door bushes moved inside the fence, one outside, and shrubs keep clear of the fence.

## Quiet lawn and path edge
- Sources found: the dense speckle came from `game/grass.ts` (a per-pixel blade root on 5% of pixels, three pixels each, plus 3.5% flecks, about a fifth of the lawn) together with `grassVariant` (32px tile patches of three base shades, in `game/licensed.ts` and `game/art.ts`); the repeated edge blades came from the fringe loop in `game/paving.ts` (a blade on about 80% of edge columns).
- Lawn: one base green (the pack tile's green, lightened as before; the code-drawn green in the fallback) with smooth value-noise blotches of plus or minus 3 shades (16px lattice, wraps with the 64px fill tile) and sparse grouped tufts (one cluster of two to four 2-3px blades in about 11% of 16px cells). `grassVariant` and its tile patches are gone. No blur, overlay or filter; everything is whole logical pixels.
- Paving edge: only the 1px muted rim remains, plus occasional small tufts (one in about twenty contact pixels, one to three blades 2-3px tall) that stand on the lawn beside the stone and never over it. Paving texture, plaza and path geometry are unchanged.

## Grass clumps over the path edge (corrects "Quiet lawn and path edge")
- Organic grass overlap is wanted on the cobblestone edge, so the occasional tufts are replaced by clumps that grow from the lawn and partly cover the outermost stones, as in the reference. Seven hand-drawn clump variants (`CLUMPS` in `game/paving.ts`, two to six columns wide, each column an overlap of 0-3 stone pixels and a rise of 1-3 lawn pixels) are laid along each side of an edge by `edgeProfile`: a slow noise swings between full stretches (clumps nearly touching, deeper overlap) and bare stretches (long gaps, the muted rim and stone showing), with varied variants, widths and gaps. Colors: dark root, mid body, lit tip, from the lawn's palette.
- The grass is a separate overlay step: the stone shape is `pavingMask` (unchanged: pack masks, ellipse plaza, smoothing) and the layer only paints green inside and just beside it, so the boundary is never distorted. Widths, collisions and the plaza are untouched. The quiet lawn texture is unchanged.

## Edge grass: source, and hand-drawn clump sprites
- Source of the mismatch (found by dumping the paving layer and isolating the green pixels): there are no PNGs or sprite crops for the lawn or the path-edge grass; both are procedural. The lawn is `game/grass.ts`; the edge grass was `game/paving.ts` painting columns from `[overlap, rise]` pairs in three flat colors, which read as 1px vertical strokes with a stray lit dot on top, spaced by noise. Scaling was not the cause (everything is 1 logical pixel, drawn at the camera's whole-number zoom, the same pixel size as the reference); the shapes and the placement were.
- Replaced by seven hand-drawn clump sprites (`game/grassClumps.ts`, five rows each, widths 3-11, palette d/m/l = the lawn's dark root, mid, lit tip). `paving.ts` places them per side of an edge (`edgeProfile`), mirrored at random and sunk -1/0/+1 pixel into the stone, then draws each sprite column relative to the local edge pixel, so on a curve it follows the boundary. Mostly full coverage with some exposed stretches. Drawn on top; the stone shape (`pavingMask`) is untouched.

## Fence: sides only
- The yard fence no longer wraps the house. Two side runs (`YARD` columns 5 and 10, rows 7-8) start at the house walls (their tops tuck behind the building) and run forward to a front rail on row 9 with the two-column gap for the door walk. Nothing behind the house. Door bushes moved to x 102 and 154, inside the fence.

## Fence finished, collision gaps closed
- The side runs now turn in at the top with a short rail to the house wall (`tl` / `tr` corner frames), so the fence visibly joins the house from both sides; front corners and rail ends were already posts.
- Collision bug: each piece had one rectangle (a thin post for sides, a 16px rail for corners), so the bottom corners had an 8px hole above the front rail and the end pieces blocked empty tile halves. `FencePiece` now carries `solids` (post plus the rail it actually has), and a test walks every point of the side runs, return rails and front rails and asserts they are blocked while the door walk stays open.

## Edge grass: leaf clusters
- The edge sprites in `game/grassClumps.ts` were redrawn as small clusters of one to three thin leaves (dark root on the lawn, mid leaf, lit tip over the stone), uneven in length and leaning a pixel here and there, in the same palette as before. Placement in `paving.ts`: roots stay on the lawn (`shift` 0 or 1, never less than the stone's first row), leaves reach 2-4 pixels over the paving, and the noise now yields varied stretches of exposed stone between fuller runs. Paving, path geometry and the rest of the town are unchanged.

## Edge grass: upright tufts (v3)
- `game/grassClumps.ts` now holds six upright tufts (five rows: tips, two or three uneven leaves with a two-pixel foot tapering to one, a small connected mid-green base, one dark root pixel). They stand upright on every side of the stone: on top and bottom edges one sprite column per edge column (top edge: the base sinks 0-1 rows into the stone, or stays on the lawn; bottom edge: roots on the lawn, leaves rising over the stone's last rows), on left and right edges a tuft takes five rows of the edge and stands beside the stone with 0-2 columns over it, so the left edge no longer reads as horizontal comb teeth.
- Earlier versions are kept, uncompiled, in `docs/grass-sprites/` (v1 bushy, v2 rotated leaves, with a README).
- Checked in the running game at 800x600 against the reference crop at the same logical scale: the overflow is present but still fainter and sparser than the reference's near-continuous dark fringe; palette and density were left alone on purpose.
