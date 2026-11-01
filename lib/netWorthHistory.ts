// Net worth history for My accounts: one snapshot per local calendar day, recorded from now on (never backfilled).
// Only integer-cent totals and a timestamp are stored. No account names, ids, credentials or provider payloads.
import type { Account } from "./finance";
import { MAX_MANUAL_CENTS, type Cents } from "./money";

export const HISTORY_KEY = "finance-town:net-worth-history:v1";
/** About ten years of daily snapshots. The oldest are dropped past this. */
export const MAX_HISTORY_ENTRIES = 3650;

export interface HistoryEntry {
  /** Local calendar day, YYYY-MM-DD. One entry per day. */
  day: string;
  /** When this day's snapshot was last updated (ISO). */
  at: string;
  netWorthCents: Cents;
  assetsCents: Cents;
  debtsCents: Cents;
  /** Whether connected (SnapTrade or Plaid) balances were part of the totals. Such history stays behind the unlock flow. */
  connected: boolean;
}

export type HistoryLoad = { status: "ok"; entries: HistoryEntry[] } | { status: "unreadable" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = MAX_MANUAL_CENTS * 1000; // totals add up many accounts: a loose bound that still rejects junk

const cents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= LIMIT;

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function validEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.day === "string" &&
    DAY.test(e.day) &&
    typeof e.at === "string" &&
    !Number.isNaN(Date.parse(e.at)) &&
    cents(e.netWorthCents) &&
    cents(e.assetsCents) &&
    cents(e.debtsCents) &&
    e.debtsCents >= 0 &&
    e.netWorthCents === e.assetsCents - e.debtsCents &&
    typeof e.connected === "boolean"
  );
}

/** Empty or missing is a fresh start. Anything that does not parse is "unreadable" and must never be overwritten. */
export function parseHistory(raw: string): HistoryLoad {
  if (!raw) return { status: "ok", entries: [] };
  try {
    const data: unknown = JSON.parse(raw);
    const list = data && typeof data === "object" ? (data as { entries?: unknown }).entries : undefined;
    if (!Array.isArray(list) || (data as { version?: unknown }).version !== 1 || !list.every(validEntry)) return { status: "unreadable" };
    const days = new Set(list.map((e) => e.day));
    if (days.size !== list.length) return { status: "unreadable" };
    return { status: "ok", entries: [...list].sort((a, b) => a.day.localeCompare(b.day)) };
  } catch {
    return { status: "unreadable" };
  }
}

export const serializeHistory = (entries: readonly HistoryEntry[]): string => JSON.stringify({ version: 1, entries });

export interface Totals {
  netWorthCents: Cents;
  assetsCents: Cents;
  debtsCents: Cents;
}

/** Today's snapshot replaces any earlier one from the same local day. Other days are never touched. */
export function recordSnapshot(entries: readonly HistoryEntry[], now: Date, totals: Totals, connected: boolean): HistoryEntry[] {
  const day = localDay(now);
  const next: HistoryEntry = {
    day,
    at: now.toISOString(),
    netWorthCents: totals.netWorthCents,
    assetsCents: totals.assetsCents,
    debtsCents: totals.debtsCents,
    connected,
  };
  const merged = [...entries.filter((e) => e.day !== day), next].sort((a, b) => a.day.localeCompare(b.day));
  return merged.slice(-MAX_HISTORY_ENTRIES);
}

/** The account id a saved inclusion turns into in the merged account list (Plaid ids already carry their environment). */
const accountIdFor = (prefId: string) => (prefId.startsWith("plaid:") ? prefId : `snaptrade:${prefId}`);

export interface RecordInput {
  mode: "demo" | "manual";
  /** Manual data readable. */
  manualOk: boolean;
  /** Merged accounts exactly as net worth uses them (includes `excluded` manual ones). */
  accounts: readonly Account[];
  /** Included connected account ids from the saved preferences. */
  included: readonly string[];
  /** Included connected balances not loaded yet (also true for a Sandbox server). */
  pending: boolean;
}

/**
 * True only when the totals are complete and fresh: My accounts mode, something counted, every included connected
 * account loaded and not stale. Partial totals, stale provider data and Sandbox (never counted) are never recorded.
 */
export function canRecord(input: RecordInput): boolean {
  if (input.mode !== "manual" || !input.manualOk || input.pending) return false;
  const live = input.accounts.filter((a) => !a.excluded);
  if (live.length === 0) return false;
  if (live.some((a) => a.source !== "manual" && a.stale)) return false;
  const present = new Set(live.map((a) => a.id));
  return input.included.every((id) => present.has(accountIdFor(id)));
}

export const hasConnected = (accounts: readonly Account[]): boolean =>
  accounts.some((a) => !a.excluded && (a.source === "snaptrade" || a.source === "plaid"));
