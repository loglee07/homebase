# Homebase

A cozy pixel-art town for your finances and daily tools. Walk a character into buildings to open them: the Bank (accounts and transactions), the School (Canvas calendars), the Home (it upgrades when net worth passes $100,000). Runs locally in your desktop browser. See `CLAUDE.md` and `docs/progress.md`.

(Renamed from Finance Town. The folder, package name and `finance-town:*` storage keys keep the old name on purpose so saved data keeps working.)

```bash
npm run install:locked   # npm ci under Node 24
npm run dev              # http://localhost:3000
```

Needs Node 24 (`brew install node@24`); every npm script picks it automatically.

Walk with WASD/arrows to a door and press **E** (or use the header buttons). Choose **Demo** for sample data, or **My accounts** to type in your own balances (saved in this browser only).

## Optional read-only connections
All are off until you add settings to a gitignored `.env.local`, share one local access code and unlock, and can never move money. The dev server only listens on 127.0.0.1; do not deploy it.
- **Brokerages** via SnapTrade: balances. `docs/brokerage.md`
- **BluPeak** via Plaid: balances and transaction history (Sync activity, shown in the Bank's Transactions card). History is for reference only and never counts toward balances, net worth or the home upgrade. Saved encrypted in `.data/` (gitignored). `docs/plaid.md`
- **School** via Canvas calendar feeds: due dates only. `docs/school.md`

## Checks
```bash
npm test && npm run typecheck && npm run lint && npm run build
```

## Art credit
Optional art: [Cute Fantasy Free](https://kenmi-art.itch.io/cute-fantasy-rpg) by Kenmi (non-commercial use, no redistribution). It is not included in this repo; see `docs/assets.md` to add it locally. Without it the game uses code-drawn art.
