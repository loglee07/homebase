// The last successful BluPeak snapshot lives in server memory only. Same rules as the brokerage store: a failed refresh
// keeps the previous snapshot and marks it stale, missing balances are never zero, and the cooldown counts from the last attempt.
import { logPlaidFailure } from "./plaidLog";
import { REFRESH_COOLDOWN_MS, STALE_AFTER_MS } from "../brokerage";
import { normalizeBank, type BankErrorCode, type BankSnapshot, type BankState, type PlaidEnvironment, type RawPlaidAccount, type VaultStatus } from "../plaid";

export interface BankProvider {
  load(): Promise<{ institution: string; accounts: RawPlaidAccount[] }>;
}

const KNOWN: BankErrorCode[] = [
  "environment_mismatch", "sync_changed", "storage_failed", "auth_failed", "rate_limited", "network", "timeout", "reconnect_required", "not_linked", "vault_unreadable", "unknown"];
const asBankError = (code: unknown): BankErrorCode => (KNOWN.includes(code as BankErrorCode) ? (code as BankErrorCode) : "unknown");

interface Internal {
  snapshot: BankSnapshot | null;
  lastError: BankErrorCode | null;
  lastAttemptAt: number | null;
  inFlight: Promise<void> | null;
}
// One slot per Plaid environment: a sandbox snapshot, cooldown or error can never leak into production (or the reverse).
const g = globalThis as unknown as { __ftBank?: Partial<Record<PlaidEnvironment, Internal>> };
const state = (env: PlaidEnvironment): Internal => ((g.__ftBank ??= {})[env] ??= { snapshot: null, lastError: null, lastAttemptAt: null, inFlight: null });
export const resetBankForTest = () => {
  g.__ftBank = undefined;
};

export function publicBankState(env: PlaidEnvironment, now: number, vault: VaultStatus, cooldownMs = REFRESH_COOLDOWN_MS): BankState {
  const s = state(env);
  const age = s.snapshot ? now - Date.parse(s.snapshot.fetchedAt) : 0;
  return {
    environment: env,
    vault,
    snapshot: s.snapshot,
    stale: s.snapshot !== null && (s.lastError !== null || age > STALE_AFTER_MS),
    lastError: s.lastError,
    lastAttemptAt: s.lastAttemptAt === null ? null : new Date(s.lastAttemptAt).toISOString(),
    cooldownUntil: s.lastAttemptAt === null ? null : new Date(s.lastAttemptAt + cooldownMs).toISOString(),
  };
}

/** After the user signs in again at the bank, the earlier failure no longer applies, so the cooldown is released. */
export function markReconnected(env: PlaidEnvironment) {
  const s = state(env);
  s.lastError = null;
  s.lastAttemptAt = null;
}

export type BankRefreshOutcome = "refreshed" | "cooldown" | "failed";

export async function refreshBank(
  env: PlaidEnvironment,
  provider: BankProvider,
  vault: () => Promise<VaultStatus>,
  now: () => number = Date.now,
  cooldownMs = REFRESH_COOLDOWN_MS,
): Promise<{ outcome: BankRefreshOutcome; state: BankState }> {
  const s = state(env);
  const done = async (outcome: BankRefreshOutcome) => ({ outcome, state: publicBankState(env, now(), await vault(), cooldownMs) });
  if (s.inFlight) {
    await s.inFlight;
    return done(s.lastError ? "failed" : "refreshed");
  }
  if (s.lastAttemptAt !== null && now() - s.lastAttemptAt < cooldownMs) return done("cooldown");
  s.lastAttemptAt = now();
  s.inFlight = (async () => {
    try {
      const { institution, accounts } = await provider.load();
      s.snapshot = normalizeBank(accounts, institution, new Date(now()).toISOString(), env);
      s.lastError = null;
    } catch (e) {
      logPlaidFailure("bank-refresh", e);
      s.lastError = asBankError((e as { code?: unknown } | null)?.code);
    }
  })();
  try {
    await s.inFlight;
  } finally {
    s.inFlight = null;
  }
  return done(s.lastError ? "failed" : "refreshed");
}
