import { describe, expect, it } from "vitest";
import {
  amountToCents,
  brokerageToAccounts,
  counted,
  markManual,
  needsAutoLoad,
  normalizeBrokerage,
  parsePrefs,
  possibleDuplicates,
  safeLabel,
  toggleId,
  type BrokerageState,
  type RawAccount,
  type RawConnection,
} from "@/lib/brokerage";
import { summarize } from "@/lib/finance";
import { serializeBackup } from "@/lib/manualBackup";
import { toAccounts } from "@/lib/manualAccounts";

const conns: RawConnection[] = [
  { id: "r", type: "read" },
  { id: "t", type: "trade" },
  { id: "d", type: "read", disabled: true },
];
const acct = (id: string, conn: string | undefined, amount: number | null | undefined, currency = "USD", extra: Partial<RawAccount> = {}): RawAccount => ({
  id,
  brokerage_authorization: conn,
  institution_name: "Fidelity",
  name: "Synthetic",
  balance: { total: amount === null ? null : { amount: amount as number, currency } },
  sync_status: { holdings: { last_successful_sync: "2026-10-31T21:00:00Z" } },
  ...extra,
});
const FETCHED = "2026-11-01T12:00:00.000Z";
const statusOf = (a: RawAccount, c = conns) => normalizeBrokerage(c, [a], FETCHED).accounts[0];

describe("amountToCents", () => {
  it("converts without float drift", () => {
    expect(amountToCents(1.005)).toBe(100); // the double is 1.00499..., rounded as stored, no multiply
    expect(amountToCents(0.1 + 0.2)).toBe(30);
    expect(amountToCents(12345.67)).toBe(1234567);
    expect(amountToCents(-5.5)).toBe(-550);
    expect(Object.is(amountToCents(-0.001), 0)).toBe(true);
  });
  it("rejects non-numbers, non-finite and oversized values", () => {
    for (const v of [NaN, Infinity, "12", null, undefined, 1e12, 5e15]) expect(amountToCents(v)).toBeNull();
  });
});

describe("normalizeBrokerage", () => {
  it("uses the documented total as-is: cash and holdings are not added again", () => {
    const a = statusOf(acct("a", "r", 1000.25));
    expect(a).toMatchObject({ status: "ok", valueCents: 100025, currency: "USD" });
    expect(Object.keys(a).sort()).toEqual(["asOf", "currency", "id", "institution", "name", "status", "valueCents"]);
  });
  it("keeps the brokerage's own sync time apart from the fetch time", () => {
    const snap = normalizeBrokerage(conns, [acct("a", "r", 1)], FETCHED);
    expect(snap.fetchedAt).toBe(FETCHED);
    expect(snap.accounts[0].asOf).toBe("2026-10-31T21:00:00.000Z");
    expect(statusOf(acct("a", "r", 1, "USD", { sync_status: null })).asOf).toBeNull();
  });
  it("never reads trade-enabled or unknown connections and drops their values", () => {
    for (const conn of ["t", "nope", undefined]) {
      expect(statusOf(acct("a", conn, 500))).toMatchObject({ status: "connection_not_read_only", valueCents: null });
    }
  });
  it("marks disabled connections, missing totals, other currencies and negatives explicitly (never zero)", () => {
    expect(statusOf(acct("a", "d", 5))).toMatchObject({ status: "connection_disabled", valueCents: null });
    expect(statusOf(acct("a", "r", null))).toMatchObject({ status: "unavailable", valueCents: null });
    expect(statusOf(acct("a", "r", undefined as unknown as number))).toMatchObject({ status: "unavailable", valueCents: null });
    expect(statusOf(acct("a", "r", 9, "CAD"))).toMatchObject({ status: "unsupported_currency", valueCents: null });
    expect(statusOf(acct("a", "r", 9, ""))).toMatchObject({ status: "unavailable", valueCents: null });
    expect(statusOf(acct("a", "r", -3))).toMatchObject({ status: "unsupported_negative", valueCents: null });
    expect(statusOf(acct("a", "r", 1, "USD", { status: "closed" }))).toMatchObject({ status: "unavailable", valueCents: null });
    expect(statusOf(acct("a", "r", 1e13))).toMatchObject({ status: "unavailable", valueCents: null });
  });
  it("accepts lowercase usd, keeps a real zero as zero, and skips duplicate ids", () => {
    expect(statusOf(acct("a", "r", 0, "usd"))).toMatchObject({ status: "ok", valueCents: 0 });
    expect(normalizeBrokerage(conns, [acct("a", "r", 1), acct("a", "r", 2)], FETCHED).accounts).toHaveLength(1);
  });
  it("counts connections", () => {
    expect(normalizeBrokerage(conns, [], FETCHED).connections).toEqual({ total: 3, readOnly: 2, blocked: 1 });
  });
  it("masks digit runs that could be account numbers and drops the number field", () => {
    expect(safeLabel("IRA 12345678", "x")).toBe("IRA ••••");
    expect(safeLabel("   ", "Account")).toBe("Account");
    const snap = normalizeBrokerage(conns, [acct("a", "r", 1, "USD", { name: "Retirement 998877", number: "998877" } as Partial<RawAccount>)], FETCHED);
    expect(JSON.stringify(snap)).not.toMatch(/998877/);
  });
});

const state = (snapshotAccounts: RawAccount[], stale = false): BrokerageState => ({
  snapshot: normalizeBrokerage(conns, snapshotAccounts, FETCHED),
  stale,
  lastError: stale ? "network" : null,
  lastAttemptAt: FETCHED,
  cooldownUntil: FETCHED,
});

describe("net worth merge", () => {
  const manual = toAccounts({ version: 1, accounts: [
    { id: "m1", name: "Everyday", kind: "checking", balanceCents: 100000, updatedAt: "2026-11-01T00:00:00.000Z" },
    { id: "m2", name: "Fidelity old entry", kind: "investment", balanceCents: 1234567, updatedAt: "2026-11-01T00:00:00.000Z" },
    { id: "m3", name: "BluPeak", kind: "savings", balanceCents: 50000, updatedAt: "2026-11-01T00:00:00.000Z" },
  ] });
  const st = state([acct("b1", "r", 12345.67), acct("b2", "r", 9, "CAD"), acct("b3", "t", 77)]);

  it("counts nothing from the brokerage until the user includes an account", () => {
    expect(brokerageToAccounts(st, parsePrefs(""))).toEqual([]);
  });
  it("counts only included, readable USD accounts", () => {
    const prefs = { version: 1 as const, included: ["b1", "b2", "b3", "missing"], excludedManual: [], categories: {} };
    const got = brokerageToAccounts(st, prefs);
    expect(got.map((a) => a.id)).toEqual(["snaptrade:b1"]);
    expect(got[0]).toMatchObject({ kind: "investment", balanceCents: 1234567, source: "snaptrade", fetchedAt: FETCHED, asOf: "2026-10-31T21:00:00.000Z", stale: false });
  });
  it("double counts a duplicate until the manual copy is excluded, then does not, and never deletes it", () => {
    const included = { version: 1 as const, included: ["b1"], excludedManual: [] as string[], categories: {} };
    const both = [...markManual(manual, included), ...brokerageToAccounts(st, included)];
    expect(summarize(counted(both)).netWorthCents).toBe(100000 + 1234567 + 50000 + 1234567);
    const fixed = { ...included, excludedManual: ["m2"], categories: {} };
    const merged = [...markManual(manual, fixed), ...brokerageToAccounts(st, fixed)];
    expect(summarize(counted(merged)).netWorthCents).toBe(100000 + 50000 + 1234567);
    expect(merged.filter((a) => a.source === "manual")).toHaveLength(3); // the excluded record is still listed
    expect(merged.find((a) => a.id === "m2")?.excluded).toBe(true);
  });
  it("flags likely duplicates but leaves BluPeak alone", () => {
    expect(possibleDuplicates({ institution: "Fidelity" }, manual)).toEqual(["m2"]);
    expect(possibleDuplicates({ institution: "Robinhood" }, manual)).toEqual(["m2"]); // manual investment accounts always asked about
    expect(possibleDuplicates({ institution: "Robinhood" }, manual.filter((m) => m.kind !== "investment"))).toEqual([]);
  });
  it("keeps stale values counted but marked", () => {
    const stale = state([acct("b1", "r", 10)], true);
    const got = brokerageToAccounts(stale, { version: 1, included: ["b1"], excludedManual: [], categories: {} });
    expect(got[0]).toMatchObject({ balanceCents: 1000, stale: true });
  });
  it("returns nothing when there is no snapshot (unavailable is not zero)", () => {
    expect(brokerageToAccounts(null, { version: 1, included: ["b1"], excludedManual: [], categories: {} })).toEqual([]);
    expect(brokerageToAccounts({ ...st, snapshot: null }, { version: 1, included: ["b1"], excludedManual: [], categories: {} })).toEqual([]);
  });
});

describe("prefs", () => {
  it("parses leniently and toggles", () => {
    expect(parsePrefs("not json")).toEqual({ version: 1, included: [], excludedManual: [], categories: {} });
    expect(parsePrefs(JSON.stringify({ included: ["a", 3, "a", ""], excludedManual: "x" }))).toEqual({ version: 1, included: ["a"], excludedManual: [], categories: {} });
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("manual backups stay free of provider data", () => {
  it("export has no brokerage fields, preferences or inclusion flags", () => {
    const text = serializeBackup({ version: 1, accounts: [{ id: "m1", name: "Everyday", kind: "checking", balanceCents: 1, updatedAt: "2026-11-01T00:00:00.000Z" }] }, () => "2026-11-01T00:00:00.000Z");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["accounts", "exportedAt", "format", "version"]);
    expect(text).not.toMatch(/snaptrade|brokerage|included|excluded|asOf|fetchedAt/i);
  });
});

describe("auto-load", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("loads when nothing is loaded or the copy is over an hour old, and leaves fresh copies alone", () => {
    expect(needsAutoLoad(null, now)).toBe(true);
    expect(needsAutoLoad(undefined, now)).toBe(true);
    expect(needsAutoLoad("garbage", now)).toBe(true);
    expect(needsAutoLoad("2026-11-01T11:30:00Z", now)).toBe(false);
    expect(needsAutoLoad("2026-11-01T10:59:59Z", now)).toBe(true);
  });
});
