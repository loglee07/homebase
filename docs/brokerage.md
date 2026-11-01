# Brokerage balances (SnapTrade Personal, read-only)

Optional. Shows Fidelity and Robinhood account totals next to your manual accounts in **My accounts**. Everything is read-only: the code calls exactly two SnapTrade read endpoints (list connections, list accounts) and nothing else. A test enforces that.

Sources: <https://docs.snaptrade.com/docs/getting-started>, <https://docs.snaptrade.com/docs/authentication-methods>, and the types shipped in `snaptrade-typescript-sdk`.

## How it works
- **Personal API key** auth (`SnaptradeAuth.personalApiKey`). No user registration, no `userId`, no `userSecret`.
- The SDK and the keys exist only in server code (`lib/server/`, `app/api/brokerage/`). The browser talks to this app's own `/api/brokerage/*` routes and receives, per account: institution, a display name, a status, one USD total and a timestamp. Account numbers are never copied out of the provider response, and long digit runs in names are masked.
- Value = the documented `balance.total` of each account ("total market value, includes cash, equity, fixed income"). Cash, holdings and buying power are never added to it. Converted to integer cents from the JSON number without float multiplication.
- **Permissions**: connections report `type` `read` or `trade`. Accounts on a trade-enabled (or unknown) connection are never read: their balance is dropped on the server and the panel says so. Disabled connections are listed as needing repair and not counted.
- Not counted, and shown as "Unavailable" (never as zero): missing total, closed account, non-USD currency, negative total, value too large.
- Two times are shown separately: **Brokerage data as of** (the brokerage's last sync, from SnapTrade) and **Fetched** (when Finance Town last loaded it). SnapTrade normally syncs once a day.
- Nothing counts until you tick **Include** on an account. If a manual account may be the same money (any manual investment account, or one named after the institution) you get a warning with a one-click **Leave out of net worth**. That only sets a flag; the manual record is never edited or deleted. Both choices live in `finance-town:brokerage-prefs:v1` (ids only, no balances) and are not part of manual backups.
- **Refresh** is the only action that contacts SnapTrade (never automatic), with a 60 second cooldown enforced by the server, counted from the last attempt even if it failed. A failed refresh keeps the previous snapshot, marks it **Stale**, and says why. The snapshot is held in server memory only: never on disk, never in `localStorage`.
- While included brokerage accounts have not loaded (locked, or before the first refresh) net worth is labelled "partial" and the home tier is not changed, so a locked page cannot downgrade your home. Once loaded, the tier follows net worth up and down as usual.

## Protection of the financial endpoints
Every route runs `guard()` first. Fail closed throughout.
1. **Loopback only**: the `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (blocks LAN and DNS-rebinding access). `npm run dev` and `npm start` bind to `127.0.0.1`. Live data is also refused if a hosting platform's env var (`VERCEL`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`) is set. Do not deploy or expose this app.
2. **Same origin**: `Sec-Fetch-Site` must not be cross-site, and POST/DELETE need an `Origin` equal to the host.
3. **Local access code** (`FINANCE_TOWN_ACCESS_CODE`, at least 12 characters): no code configured means no live data. Entering it creates a random 256-bit session token; the cookie is `HttpOnly; SameSite=Strict; Path=/api/brokerage` (plus `Secure` over HTTPS), 8 hour lifetime, kept in server memory (a server restart signs you out). The code is compared in constant time; 5 wrong tries lock logins for 15 minutes.
4. Responses are `Cache-Control: no-store`. Errors are fixed codes (`unauthorized`, `rate_limited`, ...); provider messages and response bodies are dropped, nothing financial is logged.

## Local setup (exact steps)
Do this in your own editor. Never paste credentials into chat, issues or commits.
1. Create a SnapTrade **Personal** key (verified email, two-factor on) at <https://dashboard.snaptrade.com/api-key>. You get a client ID and a consumer key.
2. Connect Fidelity and Robinhood to your SnapTrade account **with read-only access** (not trade), using SnapTrade's own dashboard or Connection Portal. Finance Town deliberately has no code to create or change connections.
3. Run `npm run env:init`. It copies `.env.example` to the gitignored `.env.local` (mode 600) without printing anything, and never overwrites an existing file.
4. Open `.env.local` and fill in `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` and `FINANCE_TOWN_ACCESS_CODE` (make one up, e.g. `openssl rand -base64 24`; you will type it in the app).
5. Restart: `npm run dev:stop && npm run dev`, open <http://localhost:3000>, choose **My accounts**, open the Bank, enter the access code, press **Load balances**, then tick the accounts to include.
6. If a manual account duplicates a connected one, use **Leave out of net worth** on it. BluPeak and other unrelated manual accounts are untouched.

Never use `NEXT_PUBLIC_` for any of these. `.env*` is gitignored except `.env.example`.

## Verification status
- **Mocked (done)**: unit tests with synthetic data (normalization, cents, statuses, merging, duplicate prevention, cooldown, stale snapshots, session, guard, source boundary checks) and a browser pass against the built-in synthetic fixtures (`FINANCE_TOWN_BROKERAGE_FIXTURES=1`, ignored in production, never contacts SnapTrade): lock, wrong and right code, load, include, duplicate warning and exclusion, refresh cooldown, failure with stale snapshot, partial net worth and frozen home tier. `curl` against the running server confirmed 401 without a session, 403 for a foreign Host, a missing or foreign Origin, and that the session cookie is HttpOnly and SameSite=Strict.
- **Live (NOT done)**: no real credentials were used or available. The real SnapTrade calls have never run. Unverified against the live service: the exact JSON shapes for your Fidelity and Robinhood accounts (field names come from the SDK types), whether `balance.total` is populated for them, and the connection `type` values. On first live use, check that included totals match your brokerage statements by eye, and that no account shows "Connection is not read-only".
