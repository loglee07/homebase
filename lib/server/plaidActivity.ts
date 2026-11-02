// BluPeak transaction history through /transactions/sync. READ-ONLY. The history and the sync cursor are saved together
// in one encrypted record, and only after the whole batch (every page) has arrived, so a failure at any point leaves the
// previous history and cursor exactly as they were.
import { applyChanges, emptyActivity, type ActivityData, type BankActivityState, type RawSyncPage } from "../bankActivity";
import { REFRESH_COOLDOWN_MS, STALE_AFTER_MS } from "../brokerage";
import type { BankErrorCode, PlaidEnvironment } from "../plaid";
import { logPlaidFailure } from "./plaidLog";
import { PlaidServiceError, plaidDiag, plaidErrorCode, type PlaidApiLike } from "./plaidService";
import type { ActivityVault, TokenVault } from "./vault";

const MUTATION = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
/** Plaid says to restart the whole loop from the first page's cursor when the data changes mid-pagination. */
const MAX_RESTARTS = 3;
/** A runaway guard far above any real history (500 per page). */
const MAX_PAGES = 400;

export interface ActivityDeps {
  api: PlaidApiLike;
  token: TokenVault;
  activity: ActivityVault;
  environment: PlaidEnvironment;
  now?: () => number;
  cooldownMs?: number;
}

type Slot = { lastError: BankErrorCode | null; lastAttemptAt: number | null; inFlight: Promise<void> | null; preparing: boolean };
// One slot per environment and Item: nothing from sandbox can leak into production, or from one Item into another.
const g = globalThis as unknown as { __ftActivity?: Map<string, Slot> };
const slot = (env: PlaidEnvironment, itemId: string): Slot => {
  const m = (g.__ftActivity ??= new Map());
  const k = `${env}:${itemId}`;
  let s = m.get(k);
  if (!s) m.set(k, (s = { lastError: null, lastAttemptAt: null, inFlight: null, preparing: false }));
  return s;
};
export const resetActivityForTest = () => {
  g.__ftActivity = undefined;
};

const isMutation = (e: unknown) => e instanceof PlaidServiceError && e.diag?.errorCode === MUTATION;

export function createActivityService(deps: ActivityDeps) {
  const { api, token, activity, environment } = deps;
  const now = deps.now ?? Date.now;
  const cooldown = deps.cooldownMs ?? REFRESH_COOLDOWN_MS;

  const readItem = async () => {
    const stored = await token.read();
    if (stored.status === "empty") throw new PlaidServiceError("not_linked");
    if (stored.status === "unreadable") throw new PlaidServiceError("vault_unreadable");
    if (stored.item.environment !== environment) throw new PlaidServiceError("environment_mismatch");
    return stored.item;
  };

  /** Pulls every page into memory, then saves cursor and history in one write. Throws without saving on any failure. */
  async function runSync(): Promise<{ preparing: boolean }> {
    const item = await readItem();
    const saved = await activity.read(item.itemId);
    if (saved.status === "unreadable") throw new PlaidServiceError("vault_unreadable");
    const base: ActivityData = saved.status === "ok" ? saved.data : emptyActivity();

    for (let attempt = 0; ; attempt++) {
      const pages: RawSyncPage[] = [];
      let cursor = base.cursor;
      try {
        for (let n = 0; ; n++) {
          if (n >= MAX_PAGES) throw new PlaidServiceError("unknown");
          let res;
          try {
            res = await api.transactionsSync({ access_token: item.accessToken, cursor: cursor || undefined });
          } catch (e) {
            throw e instanceof PlaidServiceError ? e : new PlaidServiceError(plaidErrorCode(e), plaidDiag("transactionsSync", e));
          }
          const page = res.data;
          pages.push(page);
          if (typeof page.next_cursor !== "string") throw new PlaidServiceError("unknown");
          cursor = page.next_cursor;
          if (!page.has_more) break;
        }
      } catch (e) {
        if (isMutation(e) && attempt < MAX_RESTARTS) continue; // start over from the saved cursor, discarding every page read so far
        if (isMutation(e)) throw new PlaidServiceError("sync_changed", (e as PlaidServiceError).diag);
        throw e;
      }

      const last = pages[pages.length - 1];
      const status = last.transactions_update_status ?? "";
      // Plaid answers "not ready" with empty arrays and an empty cursor. That is not an empty history, and it must not
      // be saved as one: nothing is committed, and the next sync starts from the same (empty) cursor.
      const notReady = cursor === "" || status === "TRANSACTIONS_UPDATE_STATUS_NOT_READY";
      if (notReady) {
        if (saved.status === "ok" && saved.data.ready) throw new PlaidServiceError("unknown"); // never trade real history for "preparing"
        return { preparing: true };
      }
      const next: ActivityData = {
        ...applyChanges(base, pages),
        cursor,
        ready: true,
        complete: status === "HISTORICAL_UPDATE_COMPLETE",
        syncedAt: new Date(now()).toISOString(),
      };
      try {
        await activity.write(item.itemId, next); // history and cursor, together, or neither
      } catch {
        throw new PlaidServiceError("storage_failed");
      }
      return { preparing: false };
    }
  }

  const stateFor = (itemId: string | null, data: ActivityData | null, unreadable: boolean): BankActivityState => {
    const s = itemId ? slot(environment, itemId) : null;
    const age = data?.syncedAt ? now() - Date.parse(data.syncedAt) : 0;
    return {
      environment,
      status: data?.ready ? "ready" : s?.preparing ? "preparing" : "not_synced",
      complete: data?.complete ?? false,
      transactions: data?.transactions ?? [],
      skipped: data?.skippedIds.length ?? 0,
      syncedAt: data?.syncedAt ?? null,
      stale: !!data?.ready && (s?.lastError != null || age > STALE_AFTER_MS),
      lastError: s?.lastError ?? null,
      lastAttemptAt: s?.lastAttemptAt == null ? null : new Date(s.lastAttemptAt).toISOString(),
      cooldownUntil: s?.lastAttemptAt == null ? null : new Date(s.lastAttemptAt + cooldown).toISOString(),
      unreadable,
    };
  };

  async function read(): Promise<BankActivityState | null> {
    const stored = await token.read();
    if (stored.status !== "ok" || stored.item.environment !== environment) return null;
    const saved = await activity.read(stored.item.itemId);
    return stateFor(stored.item.itemId, saved.status === "ok" ? saved.data : null, saved.status === "unreadable");
  }

  type Outcome = "synced" | "cooldown" | "failed";
  async function sync(): Promise<{ outcome: Outcome; state: BankActivityState | null }> {
    const stored = await token.read();
    if (stored.status !== "ok" || stored.item.environment !== environment) return { outcome: "failed", state: null };
    const s = slot(environment, stored.item.itemId);
    const done = async (outcome: Outcome) => ({ outcome, state: await read() });
    // A second request while one runs waits for it and shares its result: two syncs can never race on the same cursor.
    if (s.inFlight) {
      await s.inFlight;
      return done(s.lastError ? "failed" : "synced");
    }
    if (s.lastAttemptAt !== null && now() - s.lastAttemptAt < cooldown) return done("cooldown");
    s.lastAttemptAt = now();
    s.inFlight = (async () => {
      try {
        const r = await runSync();
        s.preparing = r.preparing;
        s.lastError = null;
      } catch (e) {
        logPlaidFailure("bank-activity", e);
        const code = e instanceof PlaidServiceError ? e.code : "unknown";
        s.lastError = (["vault_unreadable", "environment_mismatch", "not_linked", "reconnect_required", "auth_failed", "rate_limited", "network", "timeout", "sync_changed", "storage_failed"] as string[]).includes(code) ? (code as BankErrorCode) : "unknown";
      }
    })();
    try {
      await s.inFlight;
    } finally {
      s.inFlight = null;
    }
    return done(s.lastError ? "failed" : "synced");
  }

  return { read, sync };
}
export type ActivityService = ReturnType<typeof createActivityService>;
