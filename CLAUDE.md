# Finance Town

Personal desktop-browser dashboard as a cozy pixel-art town. Walk a character into buildings to open real-life tools. No quests, stamina, grinding, or game currency; real-life milestones improve the world automatically.

@AGENTS.md

## Decisions
- Next.js 16 (App Router) + React 19 for UI/dashboards; Phaser 4 for the town. TypeScript strict.
- **Money is integer cents** (`lib/money.ts`). Never use float dollars. Debts are stored as positive amounts owed.
- **Sample data only** (`lib/sampleData.ts`). Any future financial connection must be read-only. No real account connections yet.
- All pixel art is procedural (`game/art.ts`, drawn to canvas textures). No image assets. World is 480x320 (16px tiles), scaled with `Phaser.Scale.FIT` + `pixelArt`.
- React and Phaser talk only through `game/bridge.ts` (`TownBridge`). Phaser code must stay behind the `ssr: false` dynamic import (`components/TownGame.tsx`).
- Milestones (`lib/milestones.ts`): net worth >= $100,000.00 upgrades home to tier 2. One-way, never downgraded. Persisted in `localStorage` key `finance-town:milestones:v1`, read via `useSyncExternalStore`. The demo scenario is intentionally NOT persisted.
- Controls: WASD/arrows move, `E` interacts (Enter/Space deliberately unused: they would fight with focused buttons). Dashboard pauses the scene and releases key capture.

## Runtime
Node 24 LTS (`.nvmrc` = 24; last checked patch 24.22.2; `engines` >=24 <25; `@types/node` ^24). No version manager is installed; this machine runs Homebrew Node 25.9.0, which works but is not the pinned line. To switch: `brew install node@24` then `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` (machine-level, not done).

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
