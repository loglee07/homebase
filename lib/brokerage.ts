// Read-only brokerage data (SnapTrade Personal). Pure logic shared by server and browser: no SDK, no env, no I/O.
// Only a display name, an institution name, a status and one USD total per account ever reach the browser.
// Account numbers are never copied out of the provider response.
import type { Account } from "./finance";
import { MAX_MANUAL_CENTS, type Cents } from "./money";

export const REFRESH_COOLDOWN_MS = 60_000;
/** A snapshot older than this is shown as stale even if the last refresh succeeded. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const BROKERAGE_PREFS_KEY = "finance-town:brokerage-prefs:v1";

export type BrokerageStatus =
  | "ok"
  | "unavailable" // total missing, account closed or too large to represent
  | "unsupported_currency"
  | "unsupported_negative"
  | "connection_disabled"
  | "connection_not_read_only"; // trade-enabled or unknown connection: never read

export interface BrokerageAccount {
  /** The provider's account id (an opaque UUID, not an account number). */
  id: string;
  institution: string;
  name: string;
  status: BrokerageStatus;
  /** Documented total account value (cash + holdings) in USD cents. Null unless status is "ok". Never zero-filled. */
  valueCents: Cents | null;
  currency: string | null;
  /** When the brokerage last synced this account, as reported by the provider. Null when unknown. */
  asOf: string | null;
}

export interface BrokerageSnapshot {
  /** When Finance Town fetched this snapshot. Different from each account's asOf. */
  fetchedAt: string;
  accounts: BrokerageAccount[];
  connections: { total: number; readOnly: number; blocked: number };
}

export type BrokerageErrorCode = "auth_failed" | "rate_limited" | "network" | "timeout" | "unknown";

/** What the server tells the browser about the brokerage snapshot. */
export interface BrokerageState {
  snapshot: BrokerageSnapshot | null;
  /** The last refresh failed or the snapshot is old: values are the last successful ones. */
  stale: boolean;
  lastError: BrokerageErrorCode | null;
  lastAttemptAt: string | null;
  /** The refresh button is disabled until this time (ISO). */
  cooldownUntil: string | null;
}

// ---- normalization of the provider response (shapes are the minimal subset we read) ----

export interface RawConnection {
  id?: string;
  type?: string;
  disabled?: boolean;
}
export interface RawAccount {
  id: string;
  brokerage_authorization?: string;
  name?: string | null;
  institution_name?: string | null;
  status?: string | null;
  balance?: { total?: { amount?: number | null; currency?: string | null } | null } | null;
  sync_status?: { holdings?: { last_successful_sync?: string | null } | null } | null;
}

/** Dollars (a JSON number) to integer cents without float multiplication. Null for non-finite or oversized values. */
export function amountToCents(amount: unknown): Cents | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) >= 1e12) return null;
  const text = amount.toFixed(2); // exactly two decimals, e.g. "-1234.50"
  const cents = Number(text.replace(".", ""));
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_MANUAL_CENTS) return null;
  return cents === 0 ? 0 : cents; // normalize -0
}

/** Provider names can embed account numbers. Mask long digit runs and control characters, then cap the length. */
export function safeLabel(text: unknown, fallback: string): string {
  const cleaned = (typeof text === "string" ? text : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\d{4,}/g, "••••")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return cleaned || fallback;
}

const validIso = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

export function normalizeBrokerage(connections: RawConnection[], accounts: RawAccount[], fetchedAt: string): BrokerageSnapshot {
  const byId = new Map(connections.filter((c) => c.id).map((c) => [c.id as string, c]));
  const readOnly = connections.filter((c) => c.type === "read").length;
  const out: BrokerageAccount[] = [];
  const seen = new Set<string>();
  for (const a of accounts) {
    if (!a || typeof a.id !== "string" || !a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    const conn = a.brokerage_authorization ? byId.get(a.brokerage_authorization) : undefined;
    const base = {
      id: a.id,
      institution: safeLabel(a.institution_name, "Brokerage"),
      name: safeLabel(a.name, "Account"),
      currency: null as string | null,
      asOf: validIso(a.sync_status?.holdings?.last_successful_sync),
    };
    const none = (status: BrokerageStatus): BrokerageAccount => ({ ...base, status, valueCents: null });
    // Fail closed: an unknown or non-"read" connection is never read, and its balance is dropped here.
    if (!conn || conn.type !== "read") {
      out.push(none("connection_not_read_only"));
      continue;
    }
    if (conn.disabled) {
      out.push(none("connection_disabled"));
      continue;
    }
    const total = a.balance?.total;
    const currency = typeof total?.currency === "string" ? total.currency.toUpperCase() : null;
    base.currency = currency;
    const cents = amountToCents(total?.amount);
    if (a.status === "closed" || a.status === "archived" || a.status === "unavailable" || cents === null) {
      out.push(none("unavailable"));
    } else if (currency !== "USD") {
      out.push(none(currency ? "unsupported_currency" : "unavailable"));
    } else if (cents < 0) {
      out.push(none("unsupported_negative"));
    } else {
      out.push({ ...base, status: "ok", valueCents: cents });
    }
  }
  return {
    fetchedAt,
    accounts: out,
    connections: { total: connections.length, readOnly, blocked: connections.length - readOnly },
  };
}

// ---- preferences: which brokerage accounts count, which manual accounts are left out ----

/** Asset categories a connected account may be shown under. Debts are never re-categorized. */
export const ASSET_KINDS = ["checking", "savings", "investment"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABEL: Record<AssetKind, string> = { checking: "Checking", savings: "Savings", investment: "Investments" };
const isAssetKind = (v: unknown): v is AssetKind => typeof v === "string" && (ASSET_KINDS as readonly string[]).includes(v);

export interface BrokeragePrefs {
  version: 1;
  /** Brokerage account ids the user opted in to count. Nothing is counted by default. */
  included: string[];
  /** Manual account ids left out of net worth (records are kept). */
  excludedManual: string[];
  /**
   * Display-category overrides for connected accounts, by the same stable id as `included`
   * (a SnapTrade account id, or `plaid:<environment>:<id>`). Display only: balances, inclusion and net worth never change.
   */
  categories: Record<string, AssetKind>;
}
export const EMPTY_PREFS: BrokeragePrefs = { version: 1, included: [], excludedManual: [], categories: {} };

const categoryMap = (v: unknown): Record<string, AssetKind> => {
  const out: Record<string, AssetKind> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, kind] of Object.entries(v as Record<string, unknown>).slice(0, 500)) {
    if (id.length > 0 && id.length <= 80 && isAssetKind(kind)) out[id] = kind;
  }
  return out;
};

/** Sets, or with null clears, one account's display category. Returns new prefs. */
export function setCategory(prefs: BrokeragePrefs, id: string, kind: AssetKind | null): BrokeragePrefs {
  const { [id]: _removed, ...rest } = prefs.categories;
  void _removed;
  return { ...prefs, categories: kind === null ? rest : { ...rest, [id]: kind } };
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))].slice(0, 500) : [];

export function parsePrefs(raw: string): BrokeragePrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return EMPTY_PREFS;
    const d = data as Record<string, unknown>;
    return { version: 1, included: idList(d.included), excludedManual: idList(d.excludedManual), categories: categoryMap(d.categories) };
  } catch {
    return EMPTY_PREFS;
  }
}

export const toggleId = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

// ---- merging into the account list the calculators already use ----

/** Included, readable USD accounts only. Anything else is listed in the panel but never counted. */
export function brokerageToAccounts(state: BrokerageState | null, prefs: BrokeragePrefs): Account[] {
  if (!state?.snapshot) return [];
  const { snapshot, stale } = state;
  return snapshot.accounts
    .filter((a) => a.status === "ok" && a.valueCents !== null && prefs.included.includes(a.id))
    .map((a) => ({
      id: `snaptrade:${a.id}`,
      name: a.name,
      kind: (prefs.categories[a.id] ?? "investment") as AssetKind,
      institution: a.institution,
      balanceCents: a.valueCents as Cents,
      source: "snaptrade" as const,
      asOf: a.asOf ?? undefined,
      fetchedAt: snapshot.fetchedAt,
      stale,
    }));
}

export function markManual(accounts: Account[], prefs: BrokeragePrefs): Account[] {
  return accounts.map((a) => ({ ...a, source: "manual" as const, excluded: prefs.excludedManual.includes(a.id) }));
}

/** Everything that adds to net worth. */
export const counted = (accounts: readonly Account[]): Account[] => accounts.filter((a) => !a.excluded);

/**
 * Manual accounts that might be the same money as this brokerage account: any manual investment account,
 * or any account whose nickname contains the institution's first word. A hint to ask the user, never a merge.
 */
export function possibleDuplicates(
  b: { institution: string },
  manual: readonly Pick<Account, "id" | "name" | "kind">[],
  kinds: readonly Account["kind"][] = ["investment"],
): string[] {
  const word = b.institution.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 3) ?? "";
  return manual
    .filter((m) => kinds.includes(m.kind) || (word !== "" && m.name.toLowerCase().includes(word)))
    .map((m) => m.id);
}

export const STATUS_TEXT: Record<Exclude<BrokerageStatus, "ok">, string> = {
  unavailable: "Balance unavailable. Not counted.",
  unsupported_currency: "Not in US dollars. Not counted.",
  unsupported_negative: "Negative value is not supported. Not counted.",
  connection_disabled: "Connection needs repair in SnapTrade. Not counted.",
  connection_not_read_only: "Connection is not read-only. Never read.",
};

export const ERROR_TEXT: Record<BrokerageErrorCode, string> = {
  auth_failed: "SnapTrade rejected the credentials.",
  rate_limited: "SnapTrade is rate limiting requests.",
  network: "Could not reach SnapTrade.",
  timeout: "SnapTrade took too long to answer.",
  unknown: "SnapTrade returned an unexpected error.",
};
