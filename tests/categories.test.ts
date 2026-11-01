import { describe, expect, it } from "vitest";
import {
  EMPTY_PREFS,
  brokerageToAccounts,
  counted,
  normalizeBrokerage,
  parsePrefs,
  setCategory,
  type BrokerageState,
  type RawAccount,
} from "@/lib/brokerage";
import { summarize } from "@/lib/finance";
import { bankPrefId, bankToAccounts, normalizeBank, type BankState } from "@/lib/plaid";
import { HOME_UPGRADE_THRESHOLD_CENTS } from "@/lib/milestones";

const milestoneTier = (cents: number) => (cents >= HOME_UPGRADE_THRESHOLD_CENTS ? 2 : 1);

const FETCHED = "2026-11-01T12:00:00.000Z";
const raw = (id: string, amount: number): RawAccount => ({
  id,
  brokerage_authorization: "r",
  institution_name: "Fidelity",
  name: "Cash Management (Individual - TOD)",
  balance: { total: { amount, currency: "USD" } },
});
const snapState = (accounts: RawAccount[]): BrokerageState => ({
  snapshot: normalizeBrokerage([{ id: "r", type: "read" }], accounts, FETCHED),
  stale: false,
  lastError: null,
  lastAttemptAt: FETCHED,
  cooldownUntil: null,
});
const withPrefs = (included: string[], categories = {}) => ({ ...EMPTY_PREFS, included, categories });
const totals = (accounts: ReturnType<typeof brokerageToAccounts>) => summarize(counted(accounts));

describe("connected account category override", () => {
  const state = snapState([raw("cash", 24.91), raw("ira", 80061.79)]);

  it("moves Cash Management to Savings: subtotals change, nothing else does", () => {
    const before = brokerageToAccounts(state, withPrefs(["cash", "ira"]));
    const after = brokerageToAccounts(state, withPrefs(["cash", "ira"], { cash: "savings" }));
    expect(before.find((a) => a.id === "snaptrade:cash")?.kind).toBe("investment");
    const moved = after.find((a) => a.id === "snaptrade:cash")!;
    expect(moved.kind).toBe("savings");
    expect(moved.balanceCents).toBe(2491);
    expect(totals(after).netWorthCents).toBe(totals(before).netWorthCents);
    expect(totals(after).netWorthCents).toBe(2491 + 8006179);
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id)); // same inclusion
    expect(summarize(after.filter((a) => a.kind === "savings")).netWorthCents).toBe(2491);
  });
  it("leaves the home tier unchanged", () => {
    const a = brokerageToAccounts(state, withPrefs(["cash", "ira"]));
    const b = brokerageToAccounts(state, withPrefs(["cash", "ira"], { cash: "savings" }));
    expect(milestoneTier(totals(b).netWorthCents)).toBe(milestoneTier(totals(a).netWorthCents));
  });
  it("does not include an account just because it has an override", () => {
    expect(brokerageToAccounts(state, withPrefs(["ira"], { cash: "savings" })).map((x) => x.id)).toEqual(["snaptrade:ira"]);
  });
  it("is saved by id, survives a reparse, and Use default clears it", () => {
    const set = setCategory(EMPTY_PREFS, "cash", "savings");
    expect(parsePrefs(JSON.stringify(set)).categories).toEqual({ cash: "savings" });
    const cleared = setCategory(set, "cash", null);
    expect(cleared.categories).toEqual({});
    expect(brokerageToAccounts(state, { ...cleared, included: ["cash"] })[0].kind).toBe("investment");
    expect(set.categories).toEqual({ cash: "savings" }); // input not mutated
  });
  it("survives a refresh: the next snapshot gets the same override", () => {
    const prefs = withPrefs(["cash"], { cash: "savings" });
    const refreshed = snapState([raw("cash", 30.0)]);
    expect(brokerageToAccounts(refreshed, prefs)[0]).toMatchObject({ kind: "savings", balanceCents: 3000 });
  });
  it("ignores unknown categories and old saved prefs without the field", () => {
    expect(parsePrefs('{"version":1,"included":["a"],"excludedManual":[]}').categories).toEqual({});
    expect(parsePrefs(JSON.stringify({ included: [], excludedManual: [], categories: { a: "debt", b: "savings", c: 5, "": "savings" } })).categories).toEqual({ b: "savings" });
    expect(parsePrefs(JSON.stringify({ categories: ["savings"] })).categories).toEqual({});
  });
});

describe("Plaid category override", () => {
  const acct = (id: string, current: number) => ({ account_id: id, name: "Checking", official_name: null, type: "depository", subtype: "checking", balances: { current, available: current, iso_currency_code: "USD" } });
  const stateOf = (env: "production" | "sandbox", accounts: ReturnType<typeof acct>[]): BankState => ({
    environment: env,
    vault: "linked",
    snapshot: normalizeBank(accounts as never, "BluPeak", FETCHED, env),
    stale: false,
    lastError: null,
    lastAttemptAt: FETCHED,
    cooldownUntil: null,
  });
  it("is keyed per environment: a sandbox choice never touches production", () => {
    const prod = stateOf("production", [acct("a1", 100)]);
    const prefs = withPrefs([bankPrefId("production", "a1")], { [bankPrefId("sandbox", "a1")]: "investment" });
    expect(bankToAccounts(prod, prefs)[0].kind).toBe("checking");
    const own = withPrefs([bankPrefId("production", "a1")], { [bankPrefId("production", "a1")]: "savings" });
    expect(bankToAccounts(prod, own)[0].kind).toBe("savings");
  });
  it("sandbox accounts never count, with or without an override", () => {
    const sb = stateOf("sandbox", [acct("a1", 100)]);
    expect(bankToAccounts(sb, withPrefs([bankPrefId("sandbox", "a1")], { [bankPrefId("sandbox", "a1")]: "savings" }))).toEqual([]);
  });
  it("an overdrawn account stays a debt whatever the override says", () => {
    const prod = stateOf("production", [acct("a1", -50)]);
    const id = bankPrefId("production", "a1");
    const [a] = bankToAccounts(prod, withPrefs([id], { [id]: "savings" }));
    expect(a.kind).toBe("debt");
    expect(a.balanceCents).toBe(5000);
  });
});
