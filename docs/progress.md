# Progress

## Milestone 1: town, bank, home upgrade (done)
- Compact procedural pixel-art town: paths, plaza fountain, pond, orchard, fences, lamps, benches, home, bank.
- Character with WASD/arrow movement, collision (buildings, trees, props, pond, fountain), interaction prompt.
- Bank dashboard (React modal): checking, savings, investments, debts, 10 recent transactions, net worth. Pauses the town while open. Quick-access **Bank** button in the top bar.
- Integer-cent money model and net worth calculation.
- Labeled **Demo control** toggles sample net worth ($71,264.57 vs $108,671.44).
- Net worth >= $100,000 upgrades home (cottage -> manor) with sparkle + toast; persisted in localStorage; never downgraded.
- Tests: `tests/finance.test.ts`, `tests/milestones.test.ts`.

## Limitations
- Sample data only; no account connections.
- Home interaction only shows a message (no home dashboard yet).
- Desktop browser only; no touch or gamepad controls.
- No automated browser/e2e tests; scene behavior was verified manually in a browser.
- Single milestone (home upgrade). Milestone state is per-browser localStorage.
- `npm audit`: 16 moderate, 0 in production deps (`npm audit --omit=dev` is clean). All are the ESLint toolchain (`eslint` 9 -> `@eslint/config-array`/`@eslint/eslintrc`/`eslint-plugin-*`/`typescript-eslint` -> `minimatch` <11.0.1, glob DoS GHSA-g3hv-75wg-m249). Dev-only, runs on local config, no untrusted glob input. No compatible fix: `npm audit fix` changes nothing, and the "fix" offered is a nonsensical major downgrade (`eslint@4`, `eslint-config-next@12`). Forcing minimatch 11 would break ESLint 9 (CJS API). Revisit when `eslint-config-next`/ESLint ship a patched minimatch.
- Machine runs Node 25.9.0 (Homebrew), not the pinned Node 24; see CLAUDE.md for the one-time `brew install node@24` step.

## Stabilization pass (done)
- Vitest warning was the CJS/ESM config loader, fixed earlier by `vitest.config.mts`; no warning now. Runtime pinned to Node 24 (`.nvmrc`, `engines`).
- Next.js root warning: caused by `~/package-lock.json` (and `~/package.json`) being detected as workspace root. Fixed with `turbopack.root` in `next.config.ts`; home files untouched. Build prints no warning.
- Single dev server on :3000; `npm run dev:stop` verifies the listener is this project's Next process before killing.
- AudioContext errors: not reproducible on a fresh tab after restart (console empty of errors). Likely a leftover from the StrictMode double mount leaving a second canvas/game; fixed by clearing the parent on cleanup in `TownGame.tsx`.
- Browser checks (scripted `KeyboardEvent`s dispatched on `window` in the in-app browser, NOT physical keyboard): home prompt + message; manor blocks walking into it from the door; dashboard open ignores movement keys and restores the prompt on close; 900x600 window has no horizontal overflow and the dashboard scrolls vertically.
- Not done: physical keyboard testing, real key-hold timing on other machines, windows narrower than 900px.

## Next milestone
Second building with a real tool (e.g. a budget or goals hall) and a second milestone that changes the world; add a read-only data-source interface behind the sample data; add a Playwright smoke test for walk -> enter bank -> upgrade -> reload.
