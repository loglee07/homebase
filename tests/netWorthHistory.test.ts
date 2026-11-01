import { describe, expect, it } from "vitest";
import { EMPTY_PREFS, brokerageToAccounts, markManual, normalizeBrokerage, type BrokerageState } from "@/lib/brokerage";
import { summarize, type Account } from "@/lib/finance";
import { bankPrefId, bankToAccounts, normalizeBank, type BankState } from "@/lib/plaid";
import { canRecord, hasConnected, localDay, parseHistory, recordSnapshot, serializeHistory, type HistoryEntry, type RecordInput } from "@/lib/netWorthHistory";
import { counted } from "@/lib/brokerage";

const T = (cents: number, debt = 0) => ({ netWorthCents: cents - debt, assetsCents: cents, debtsCents: debt });
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const entry = (day: string, nw: number): HistoryEntry => ({ day, at: `${day}T12:00:00.000Z`, netWorthCents: nw, assetsCents: nw, debtsCents: 0, connected: false });

describe("recordSnapshot", () => {
  it("adds a first entry and does not invent earlier days", () => {
    const out = recordSnapshot([], at(2026, 11, 1), T(500000), false);
    expect(out).toEqual([{ day: "2026-11-01", at: at(2026, 11, 1).toISOString(), netWorthCents: 500000, assetsCents: 500000, debtsCents: 0, connected: false }]);
  });
  it("keeps one snapshot per local day: later refreshes replace it", () => {
    const first = recordSnapshot([], at(2026, 11, 1, 9), T(100), false);
    const second = recordSnapshot(first, at(2026, 11, 1, 18), T(250, 50), true);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ day: "2026-11-01", netWorthCents: 200, assetsCents: 250, debtsCents: 50, connected: true });
    expect(second[0].at).toBe(at(2026, 11, 1, 18).toISOString());
  });
  it("starts a new entry on the next local calendar day and leaves older ones alone", () => {
    const base = [entry("2026-10-30", 1), entry("2026-10-31", 2)];
    const out = recordSnapshot(base, at(2026, 11, 1, 0, 5), T(3), false);
    expect(out.map((e) => e.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(out.slice(0, 2)).toEqual(base);
    expect(base).toHaveLength(2); // input not mutated
  });
  it("uses the local day, not UTC", () => {
    expect(localDay(at(2026, 11, 1, 23, 59))).toBe("2026-11-01");
    expect(localDay(at(2026, 11, 2, 0, 1))).toBe("2026-11-02");
    expect(localDay(at(2026, 1, 5))).toBe("2026-01-05");
  });
  it("keeps entries sorted and caps the length", () => {
    const out = recordSnapshot([entry("2026-11-03", 1)], at(2026, 11, 1), T(2), false);
    expect(out.map((e) => e.day)).toEqual(["2026-11-01", "2026-11-03"]);
  });
});

describe("persistence", () => {
  it("round-trips through the saved string", () => {
    const entries = recordSnapshot(recordSnapshot([], at(2026, 11, 1), T(100), false), at(2026, 11, 2), T(200, 20), true);
    expect(parseHistory(serializeHistory(entries))).toEqual({ status: "ok", entries });
  });
  it("stores only totals, a day and timestamps: no ids, names or provider data", () => {
    const text = serializeHistory(recordSnapshot([], at(2026, 11, 1), T(100), true));
    expect(Object.keys(JSON.parse(text).entries[0]).sort()).toEqual(["assetsCents", "at", "connected", "day", "debtsCents", "netWorthCents"]);
  });
  it("treats empty as a fresh start and anything damaged as unreadable (never overwritten)", () => {
    expect(parseHistory("")).toEqual({ status: "ok", entries: [] });
    const good = entry("2026-11-01", 5);
    for (const bad of [
      "not json",
      "[]",
      JSON.stringify({ version: 2, entries: [] }),
      JSON.stringify({ version: 1, entries: [{ ...good, netWorthCents: 6 }] }), // totals disagree
      JSON.stringify({ version: 1, entries: [{ ...good, netWorthCents: 5.5, assetsCents: 5.5 }] }),
      JSON.stringify({ version: 1, entries: [{ ...good, day: "11/01/2026" }] }),
      JSON.stringify({ version: 1, entries: [good, good] }),
      JSON.stringify({ version: 1, entries: [{ ...good, debtsCents: -1, assetsCents: 4 }] }),
    ])
      expect(parseHistory(bad)).toEqual({ status: "unreadable" });
  });
});

describe("what may be recorded", () => {
  const manual = markManual(
    [{ id: "m1", name: "Manual", kind: "checking", institution: "", balanceCents: 100000 }],
    { ...EMPTY_PREFS },
  );
  const stOf = (stale = false): BrokerageState => ({
    snapshot: normalizeBrokerage([{ id: "r", type: "read" }], [{ id: "b1", brokerage_authorization: "r", name: "X", institution_name: "Fid", balance: { total: { amount: 50, currency: "USD" } } }], "2026-11-01T12:00:00.000Z"),
    stale,
    lastError: stale ? "network" : null,
    lastAttemptAt: null,
    cooldownUntil: null,
  });
  const base = (over: Partial<RecordInput> = {}): RecordInput => ({ mode: "manual", manualOk: true, accounts: manual, included: [], pending: false, ...over });

  it("records manual-only totals in My accounts, never in Demo or with unreadable manual data", () => {
    expect(canRecord(base())).toBe(true);
    expect(canRecord(base({ mode: "demo" }))).toBe(false);
    expect(canRecord(base({ manualOk: false }))).toBe(false);
  });
  it("skips an empty account list", () => {
    expect(canRecord(base({ accounts: [] }))).toBe(false);
    expect(canRecord(base({ accounts: manual.map((a) => ({ ...a, excluded: true })) }))).toBe(false);
  });
  it("records complete, fresh connected totals", () => {
    const prefs = { ...EMPTY_PREFS, included: ["b1"] };
    const accounts = [...manual, ...brokerageToAccounts(stOf(), prefs)];
    expect(canRecord(base({ accounts, included: prefs.included }))).toBe(true);
    expect(hasConnected(accounts)).toBe(true);
    expect(hasConnected(manual)).toBe(false);
  });
  it("skips partial totals: pending, or an included account that did not load", () => {
    const prefs = { ...EMPTY_PREFS, included: ["b1"] };
    expect(canRecord(base({ included: prefs.included, pending: true }))).toBe(false);
    expect(canRecord(base({ included: ["b1"] }))).toBe(false); // locked: nothing loaded for b1
    expect(canRecord(base({ included: ["b1", "gone"], accounts: [...manual, ...brokerageToAccounts(stOf(), prefs)] }))).toBe(false);
  });
  it("skips stale provider data", () => {
    const prefs = { ...EMPTY_PREFS, included: ["b1"] };
    const accounts = [...manual, ...brokerageToAccounts(stOf(true), prefs)];
    expect(accounts.some((a) => a.stale)).toBe(true);
    expect(canRecord(base({ accounts, included: prefs.included }))).toBe(false);
  });
  it("skips Sandbox: sandbox balances never become accounts, so an included sandbox id is incomplete", () => {
    const raw = [{ account_id: "a1", name: "C", official_name: null, type: "depository", subtype: "checking", balances: { current: 10, available: 10, iso_currency_code: "USD" } }];
    const sb: BankState = { environment: "sandbox", vault: "linked", snapshot: normalizeBank(raw as never, "Bank", "2026-11-01T12:00:00.000Z", "sandbox"), stale: false, lastError: null, lastAttemptAt: null, cooldownUntil: null };
    const id = bankPrefId("sandbox", "a1");
    const prefs = { ...EMPTY_PREFS, included: [id] };
    const bank = bankToAccounts(sb, prefs);
    expect(bank).toEqual([]);
    expect(canRecord(base({ accounts: [...manual, ...bank], included: [id] }))).toBe(false);
    expect(canRecord(base({ accounts: [...manual, ...bank], included: [] }))).toBe(true); // manual totals stay unaffected by a sandbox run
  });
  it("snapshot totals match the dashboard's own calculation", () => {
    const accounts: Account[] = [...manual, { id: "d", name: "Card", kind: "debt", institution: "", balanceCents: 30000, source: "manual" }];
    const s = summarize(counted(accounts));
    expect(recordSnapshot([], at(2026, 11, 1), s, false)[0]).toMatchObject({ netWorthCents: 70000, assetsCents: 100000, debtsCents: 30000 });
  });
});
