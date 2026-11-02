// BluPeak transaction history (Plaid /transactions/sync). Pure logic shared by server and browser: no SDK, no env, no I/O.
// This history is for reading only. Nothing here feeds account balances, net worth or the home tier: those come from
// balances alone (lib/plaid.ts), and a test keeps this module out of that path.
import { amountToCents, safeLabel } from "./brokerage";
import type { Cents } from "./money";
import type { BankErrorCode, PlaidEnvironment } from "./plaid";

/** The fields of a Plaid transaction this app reads. Everything else (location, counterparties, categories) is ignored. */
export interface RawPlaidTxn {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  pending?: boolean;
  pending_transaction_id?: string | null;
}

export interface RawSyncPage {
  added: RawPlaidTxn[];
  modified: RawPlaidTxn[];
  removed: { transaction_id?: string | null }[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
}

export interface BankTxn {
  /** Plaid's transaction id (opaque). A pending transaction and its posted version have different ids. */
  id: string;
  accountId: string;
  /** YYYY-MM-DD as the bank reports it. */
  date: string;
  description: string;
  /**
   * Signed from the account's point of view: positive is money coming in, negative is money going out.
   * Plaid says the opposite (positive = money left the account), so the sign is flipped exactly once, in normalizeTxn.
   */
  amountCents: Cents;
  pending: boolean;
  /** For a posted transaction: the id of the pending one it replaces, when the bank says so. */
  replacesId: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type NormalizedTxn = { kind: "ok"; txn: BankTxn } | { kind: "skipped" } | { kind: "invalid" };

/** "skipped": a real transaction we cannot show in dollars (another currency). "invalid": malformed, ignored. */
export function normalizeTxn(raw: RawPlaidTxn): NormalizedTxn {
  if (!raw || typeof raw.transaction_id !== "string" || !raw.transaction_id || typeof raw.account_id !== "string" || !raw.account_id) return { kind: "invalid" };
  if (!isoDay(raw.date)) return { kind: "invalid" };
  const cents = amountToCents(raw.amount);
  if (cents === null) return { kind: "invalid" };
  if (raw.unofficial_currency_code || (typeof raw.iso_currency_code === "string" && raw.iso_currency_code.toUpperCase() !== "USD")) return { kind: "skipped" };
  const out = cents === 0 ? 0 : -cents; // Plaid: positive = out. Here: negative = out.
  return {
    kind: "ok",
    txn: {
      id: raw.transaction_id,
      accountId: raw.account_id,
      date: raw.date,
      description: safeLabel(raw.merchant_name || raw.name, "Transaction"),
      amountCents: out,
      pending: raw.pending === true,
      replacesId: typeof raw.pending_transaction_id === "string" && raw.pending_transaction_id ? raw.pending_transaction_id : null,
    },
  };
}

/** The saved history of one Item (the server keeps this encrypted, together with the sync cursor). */
export interface ActivityData {
  /** Plaid's cursor after the last complete sync. Empty until the bank has prepared the history. */
  cursor: string;
  /** The bank has prepared the history. False means "still preparing", which is different from "ready and empty". */
  ready: boolean;
  /** Plaid reports the full history window has been loaded. */
  complete: boolean;
  syncedAt: string | null;
  transactions: BankTxn[];
  /** Ids of transactions in another currency: counted but not shown. */
  skippedIds: string[];
}

export const emptyActivity = (): ActivityData => ({ cursor: "", ready: false, complete: false, syncedAt: null, transactions: [], skippedIds: [] });

/**
 * Applies one complete batch of changes to a copy of the history. Keyed by transaction id, so a repeated add replaces
 * rather than duplicates. A posted transaction removes the pending one it names, so the pair never both show.
 */
export function applyChanges(base: ActivityData, pages: readonly Pick<RawSyncPage, "added" | "modified" | "removed">[]): ActivityData {
  const map = new Map(base.transactions.map((t) => [t.id, t]));
  const skipped = new Set(base.skippedIds);
  const put = (raw: RawPlaidTxn) => {
    const n = normalizeTxn(raw);
    if (n.kind === "invalid") return;
    if (n.kind === "skipped") {
      map.delete(raw.transaction_id);
      skipped.add(raw.transaction_id);
      return;
    }
    skipped.delete(n.txn.id);
    if (n.txn.replacesId && n.txn.replacesId !== n.txn.id) map.delete(n.txn.replacesId);
    map.set(n.txn.id, n.txn);
  };
  for (const p of pages) {
    for (const t of p.added) put(t);
    for (const t of p.modified) put(t);
    for (const r of p.removed) {
      if (typeof r?.transaction_id !== "string") continue;
      map.delete(r.transaction_id);
      skipped.delete(r.transaction_id);
    }
  }
  return { ...base, transactions: sortNewest([...map.values()]), skippedIds: [...skipped] };
}

/** Newest date first; within a day, pending first, then by id so the order never jumps between loads. */
export function sortNewest(txns: readonly BankTxn[]): BankTxn[] {
  return [...txns].sort((a, b) => (a.date === b.date ? Number(b.pending) - Number(a.pending) || a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1));
}

export interface ActivityFilter {
  accountId: string | "all";
  /** Inclusive YYYY-MM-DD bounds; empty string means open. */
  from: string;
  to: string;
}
export const NO_FILTER: ActivityFilter = { accountId: "all", from: "", to: "" };

export function filterTxns(txns: readonly BankTxn[], f: ActivityFilter): BankTxn[] {
  return txns.filter((t) => (f.accountId === "all" || t.accountId === f.accountId) && (!f.from || t.date >= f.from) && (!f.to || t.date <= f.to));
}

/** "Money in" and "Money out": the bank cannot tell income from a refund or a transfer, so nothing here says "income". */
export const directionOf = (t: Pick<BankTxn, "amountCents">): "in" | "out" | "none" => (t.amountCents > 0 ? "in" : t.amountCents < 0 ? "out" : "none");

/** What the browser receives. No access token, item id or raw Plaid fields. */
export interface BankActivityState {
  environment: PlaidEnvironment;
  /** not_synced: never synced here. preparing: the bank is still building the history. ready: loaded (possibly empty). */
  status: "not_synced" | "preparing" | "ready";
  /** Whether Plaid says every page of the history window has arrived. */
  complete: boolean;
  transactions: BankTxn[];
  skipped: number;
  syncedAt: string | null;
  /** The last sync failed: the saved history is shown as it was. */
  stale: boolean;
  lastError: BankErrorCode | null;
  lastAttemptAt: string | null;
  cooldownUntil: string | null;
  /** The saved history exists but cannot be read (wrong key). It is never overwritten. */
  unreadable: boolean;
}
