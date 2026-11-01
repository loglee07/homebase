// Read-only bank balances from Plaid (BluPeak). Pure logic shared by server and browser: no SDK, no env, no I/O.
// Only an account name, type, two USD amounts and a timestamp reach the browser. Account numbers and masks are never copied.
import type { Account } from "./finance";
import { amountToCents, safeLabel, type BrokeragePrefs } from "./brokerage";
import type { Cents } from "./money";

/** BluPeak's published Plaid institution id. Checked on the server, never trusted from the browser. */
export const BLUPEAK_INSTITUTION_ID = "ins_109960";
export const BLUPEAK_NAME = "BluPeak";

/**
 * Which Plaid world a token, snapshot or preference belongs to. "sandbox" is Plaid's fake banks: shown for testing,
 * never counted. "fixtures" is this app's own synthetic test data (only with FINANCE_TOWN_BROKERAGE_FIXTURES=1).
 */
export type PlaidEnvironment = "sandbox" | "production" | "fixtures";
export const countsTowardNetWorth = (env: PlaidEnvironment) => env !== "sandbox";

export type BankStatus = "ok" | "unavailable" | "unsupported_currency" | "unsupported_type";

export interface BankAccount {
  /** Plaid's account id (opaque, not an account number). */
  id: string;
  institution: string;
  name: string;
  subtype: "checking" | "savings" | null;
  status: BankStatus;
  /** Current balance in USD cents. Negative means overdrawn. Null unless status is "ok". Never zero-filled. */
  currentCents: Cents | null;
  /** Available balance (net of pending items), shown separately and never used for net worth. Null when not reported. */
  availableCents: Cents | null;
  currency: string | null;
  /** When the bank last updated this balance, if Plaid says. Null when unknown. */
  asOf: string | null;
}

export interface BankSnapshot {
  environment: PlaidEnvironment;
  fetchedAt: string;
  institution: string;
  accounts: BankAccount[];
}

export type BankErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "network"
  | "timeout"
  | "reconnect_required"
  | "not_linked"
  | "vault_unreadable"
  | "environment_mismatch"
  | "unknown";

export type VaultStatus = "empty" | "linked" | "unreadable";

export interface BankState {
  /** The environment this server is running in. Snapshots from another environment are never mixed in. */
  environment: PlaidEnvironment;
  /** An Item is stored on the server. */
  vault: VaultStatus;
  snapshot: BankSnapshot | null;
  stale: boolean;
  lastError: BankErrorCode | null;
  lastAttemptAt: string | null;
  cooldownUntil: string | null;
}

export interface RawPlaidAccount {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances?: {
    available?: number | null;
    current?: number | null;
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
    last_updated_datetime?: string | null;
  } | null;
}

const validIso = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

export function normalizeBank(raw: RawPlaidAccount[], institution: string, fetchedAt: string, environment: PlaidEnvironment): BankSnapshot {
  const out: BankAccount[] = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a.account_id !== "string" || !a.account_id || seen.has(a.account_id)) continue;
    seen.add(a.account_id);
    const sub: BankAccount["subtype"] = a.subtype === "checking" ? "checking" : a.subtype === "savings" ? "savings" : null;
    const bal = a.balances ?? {};
    const currency = typeof bal.iso_currency_code === "string" ? bal.iso_currency_code.toUpperCase() : null;
    const base = {
      id: a.account_id,
      institution,
      name: safeLabel(a.name ?? a.official_name, "Account"),
      subtype: sub,
      currency,
      asOf: validIso(bal.last_updated_datetime),
    };
    const none = (status: BankStatus): BankAccount => ({ ...base, status, currentCents: null, availableCents: null });
    const current = amountToCents(bal.current);
    if (a.type !== "depository" || sub === null) out.push(none("unsupported_type"));
    else if (current === null) out.push(none("unavailable")); // missing is unavailable, never zero
    else if (currency !== "USD") out.push(none(currency || bal.unofficial_currency_code ? "unsupported_currency" : "unavailable"));
    else out.push({ ...base, status: "ok", currentCents: current, availableCents: amountToCents(bal.available) });
  }
  return { environment, fetchedAt, institution, accounts: out };
}

/** Preferences hold these ids, namespaced by Plaid environment so a sandbox id can never match (or be mistaken for) a production one. */
export const bankPrefId = (env: PlaidEnvironment, accountId: string) => `plaid:${env}:${accountId}`;
export const bankPrefEnvironment = (prefId: string): string | null => /^plaid:(sandbox|production|fixtures):/.exec(prefId)?.[1] ?? null;

/**
 * Included, readable USD accounts. The CURRENT balance counts (never available, which excludes pending items).
 * An overdrawn account (negative current) is money owed to the bank: it becomes a debt of the positive amount,
 * which summarize() subtracts exactly once.
 */
export function bankToAccounts(state: BankState | null, prefs: BrokeragePrefs): Account[] {
  if (!state?.snapshot) return [];
  const { snapshot, stale } = state;
  // Sandbox data (or a snapshot from another environment than the server's) never reaches net worth or the home tier.
  if (snapshot.environment !== state.environment || !countsTowardNetWorth(snapshot.environment)) return [];
  const out: Account[] = [];
  for (const a of snapshot.accounts) {
    if (a.status !== "ok" || a.currentCents === null || a.subtype === null || !prefs.included.includes(bankPrefId(snapshot.environment, a.id))) continue;
    const over = a.currentCents < 0;
    out.push({
      id: bankPrefId(snapshot.environment, a.id),
      name: over ? `${a.name} (overdrawn)` : a.name,
      kind: over ? "debt" : a.subtype,
      institution: a.institution,
      balanceCents: Math.abs(a.currentCents),
      source: "plaid",
      asOf: a.asOf ?? undefined,
      fetchedAt: snapshot.fetchedAt,
      stale,
    });
  }
  return out;
}

export const BANK_STATUS_TEXT: Record<Exclude<BankStatus, "ok">, string> = {
  unavailable: "Balance unavailable. Not counted.",
  unsupported_currency: "Not in US dollars. Not counted.",
  unsupported_type: "Only checking and savings are shown. Not counted.",
};

export const BANK_ERROR_TEXT: Record<BankErrorCode, string> = {
  auth_failed: "Plaid rejected the credentials.",
  rate_limited: "Plaid is rate limiting requests.",
  network: "Could not reach Plaid.",
  timeout: "Plaid took too long to answer.",
  reconnect_required: "BluPeak needs you to sign in again.",
  not_linked: "BluPeak is not connected.",
  vault_unreadable: "The saved connection could not be read.",
  environment_mismatch: "The saved connection belongs to a different Plaid environment.",
  unknown: "Plaid returned an unexpected error.",
};
