// The last successful brokerage snapshot lives here, in server memory only (never on disk, never in logs).
// A failed refresh keeps the previous snapshot and marks it stale. Unavailable balances are never turned into zero.
import {
  REFRESH_COOLDOWN_MS,
  STALE_AFTER_MS,
  normalizeBrokerage,
  type BrokerageErrorCode,
  type BrokerageSnapshot,
  type BrokerageState,
  type RawAccount,
  type RawConnection,
} from "../brokerage";

export interface BrokerageProvider {
  /** Read-only: connections (to check permissions) and accounts with their documented totals. */
  load(): Promise<{ connections: RawConnection[]; accounts: RawAccount[] }>;
}

export class BrokerageError extends Error {
  constructor(readonly code: BrokerageErrorCode) {
    super(code); // the code is the whole message: provider text and bodies are never kept
  }
}

interface Internal {
  snapshot: BrokerageSnapshot | null;
  lastError: BrokerageErrorCode | null;
  lastAttemptAt: number | null;
  inFlight: Promise<void> | null;
}
const g = globalThis as unknown as { __ftBrokerage?: Internal };
const state = (): Internal => (g.__ftBrokerage ??= { snapshot: null, lastError: null, lastAttemptAt: null, inFlight: null });
export const resetBrokerageForTest = () => {
  g.__ftBrokerage = undefined;
};

export function publicState(now: number, cooldownMs = REFRESH_COOLDOWN_MS): BrokerageState {
  const s = state();
  const age = s.snapshot ? now - Date.parse(s.snapshot.fetchedAt) : 0;
  return {
    snapshot: s.snapshot,
    stale: s.snapshot !== null && (s.lastError !== null || age > STALE_AFTER_MS),
    lastError: s.lastError,
    lastAttemptAt: s.lastAttemptAt === null ? null : new Date(s.lastAttemptAt).toISOString(),
    cooldownUntil: s.lastAttemptAt === null ? null : new Date(s.lastAttemptAt + cooldownMs).toISOString(),
  };
}

export type RefreshOutcome = "refreshed" | "cooldown" | "failed";

/** One refresh at a time; a request inside the cooldown (counted from the last attempt, success or not) is refused without calling the provider. */
export async function refresh(
  provider: BrokerageProvider,
  now: () => number = Date.now,
  cooldownMs = REFRESH_COOLDOWN_MS,
): Promise<{ outcome: RefreshOutcome; state: BrokerageState }> {
  const s = state();
  if (s.inFlight) {
    await s.inFlight;
    return { outcome: s.lastError ? "failed" : "refreshed", state: publicState(now(), cooldownMs) };
  }
  if (s.lastAttemptAt !== null && now() - s.lastAttemptAt < cooldownMs) {
    return { outcome: "cooldown", state: publicState(now(), cooldownMs) };
  }
  s.lastAttemptAt = now();
  s.inFlight = (async () => {
    try {
      const { connections, accounts } = await provider.load();
      s.snapshot = normalizeBrokerage(connections, accounts, new Date(now()).toISOString());
      s.lastError = null;
    } catch (e) {
      s.lastError = e instanceof BrokerageError ? e.code : "unknown";
    }
  })();
  try {
    await s.inFlight;
  } finally {
    s.inFlight = null;
  }
  return { outcome: s.lastError ? "failed" : "refreshed", state: publicState(now(), cooldownMs) };
}
