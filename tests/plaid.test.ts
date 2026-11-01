import { describe, expect, it } from "vitest";
import { counted, markManual, possibleDuplicates, type BrokeragePrefs } from "@/lib/brokerage";
import { summarize } from "@/lib/finance";
import { toAccounts } from "@/lib/manualAccounts";
import { serializeBackup } from "@/lib/manualBackup";
import { bankPrefEnvironment, bankPrefId, bankToAccounts, normalizeBank, type BankState, type PlaidEnvironment, type RawPlaidAccount } from "@/lib/plaid";

const FETCHED = "2026-11-01T12:00:00.000Z";
const acct = (id: string, current: number | null, available: number | null, over: Partial<RawPlaidAccount> = {}): RawPlaidAccount => ({
  account_id: id,
  name: "Synthetic",
  type: "depository",
  subtype: "checking",
  balances: { current, available, iso_currency_code: "USD", unofficial_currency_code: null, last_updated_datetime: "2026-11-01T09:00:00Z" },
  ...over,
});
const one = (a: RawPlaidAccount) => normalizeBank([a], "BluPeak", FETCHED, "production").accounts[0];
const stateOf = (raws: RawPlaidAccount[], stale = false, env: PlaidEnvironment = "production"): BankState => ({
  environment: env,
  vault: "linked",
  snapshot: normalizeBank(raws, "BluPeak", FETCHED, env),
  stale,
  lastError: stale ? "network" : null,
  lastAttemptAt: FETCHED,
  cooldownUntil: FETCHED,
});
const inc = (...ids: string[]): BrokeragePrefs => ({ version: 1, included: ids.map((id) => bankPrefId("production", id)), excludedManual: [] });

describe("normalizeBank", () => {
  it("keeps current and available apart, in integer cents", () => {
    expect(one(acct("a", 1234.56, 1100))).toMatchObject({ status: "ok", currentCents: 123456, availableCents: 110000, subtype: "checking", asOf: "2026-11-01T09:00:00.000Z" });
    expect(one(acct("a", 0.1 + 0.2, null))).toMatchObject({ currentCents: 30, availableCents: null });
  });
  it("treats a missing current balance as unavailable, never zero", () => {
    expect(one(acct("a", null, 50))).toMatchObject({ status: "unavailable", currentCents: null, availableCents: null });
    expect(one(acct("a", undefined as unknown as number, 50))).toMatchObject({ status: "unavailable", currentCents: null });
    expect(one(acct("a", 0, 0))).toMatchObject({ status: "ok", currentCents: 0 }); // a real zero stays zero
  });
  it("rejects other currencies, other account types and subtypes", () => {
    const cad = acct("a", 5, 5);
    cad.balances = { ...cad.balances, iso_currency_code: "CAD" };
    expect(one(cad)).toMatchObject({ status: "unsupported_currency", currentCents: null });
    const none = acct("a", 5, 5);
    none.balances = { ...none.balances, iso_currency_code: null };
    expect(one(none)).toMatchObject({ status: "unavailable" });
    expect(one(acct("a", 5, 5, { subtype: "money market" }))).toMatchObject({ status: "unsupported_type" });
    expect(one(acct("a", 5, 5, { type: "credit", subtype: "credit card" }))).toMatchObject({ status: "unsupported_type" });
  });
  it("copies no account number or mask and masks digit runs in names", () => {
    const snap = normalizeBank([{ ...acct("a", 1, 1, { name: "Checking 123456789" }), mask: "6789" } as RawPlaidAccount], "BluPeak", FETCHED, "production");
    expect(JSON.stringify(snap)).not.toMatch(/123456789|6789/);
    expect(Object.keys(snap.accounts[0]).sort()).toEqual(["asOf", "availableCents", "currency", "currentCents", "id", "institution", "name", "status", "subtype"]);
  });
  it("skips duplicate ids", () => {
    expect(normalizeBank([acct("a", 1, 1), acct("a", 2, 2)], "BluPeak", FETCHED, "production").accounts).toHaveLength(1);
  });
});

describe("net worth", () => {
  const manual = toAccounts({ version: 1, accounts: [
    { id: "m1", name: "Everyday", kind: "savings", balanceCents: 100000, updatedAt: "2026-11-01T00:00:00.000Z" },
    { id: "m2", name: "BluPeak", kind: "checking", balanceCents: 123456, updatedAt: "2026-11-01T00:00:00.000Z" },
  ] });
  const st = stateOf([acct("c", 1234.56, 1100), acct("s", 5000, 4000, { subtype: "savings" }), acct("o", -42.1, -42.1), acct("x", null, null)]);

  it("counts nothing until included, and only the current balance (never available)", () => {
    expect(bankToAccounts(st, { version: 1, included: [], excludedManual: [] })).toEqual([]);
    const got = bankToAccounts(st, inc("c", "s"));
    expect(got.map((a) => [a.kind, a.balanceCents])).toEqual([["checking", 123456], ["savings", 500000]]);
    expect(got[0]).toMatchObject({ id: "plaid:production:c", source: "plaid", institution: "BluPeak", stale: false, fetchedAt: FETCHED });
  });
  it("subtracts an overdraft exactly once, as a debt", () => {
    const got = bankToAccounts(st, inc("c", "o"));
    expect(got[1]).toMatchObject({ kind: "debt", balanceCents: 4210, name: "Synthetic (overdrawn)" });
    expect(summarize(got).netWorthCents).toBe(123456 - 4210);
    expect(summarize(got).debtsCents).toBe(4210);
  });
  it("never counts unavailable accounts, even if somehow marked included", () => {
    expect(bankToAccounts(st, inc("x"))).toEqual([]);
  });
  it("prevents doubling: a manual twin counts until it is left out, and is never deleted", () => {
    const prefs = inc("c");
    const both = [...markManual(manual, prefs), ...bankToAccounts(st, prefs)];
    expect(summarize(counted(both)).netWorthCents).toBe(100000 + 123456 + 123456);
    const fixed = { ...prefs, excludedManual: ["m2"] };
    const merged = [...markManual(manual, fixed), ...bankToAccounts(st, fixed)];
    expect(summarize(counted(merged)).netWorthCents).toBe(100000 + 123456);
    expect(merged.filter((a) => a.source === "manual")).toHaveLength(2);
  });
  it("warns about manual accounts named after BluPeak, and not about unrelated ones", () => {
    expect(possibleDuplicates({ institution: "BluPeak" }, manual, [])).toEqual(["m2"]);
  });
  it("keeps stale values counted but marked; no snapshot means nothing, not zero", () => {
    expect(bankToAccounts(stateOf([acct("c", 10, 10)], true), inc("c"))[0]).toMatchObject({ balanceCents: 1000, stale: true });
    expect(bankToAccounts(null, inc("c"))).toEqual([]);
    expect(bankToAccounts({ ...st, snapshot: null }, inc("c"))).toEqual([]);
  });
  it("sandbox data never counts, even when its ids are included, and never touches the real total", () => {
    const sb = stateOf([acct("c", 99999, 99999)], false, "sandbox");
    const sandboxIds: BrokeragePrefs = { version: 1, included: [bankPrefId("sandbox", "c"), bankPrefId("production", "c")], excludedManual: [] };
    expect(bankToAccounts(sb, sandboxIds)).toEqual([]);
    const real = [...markManual(manual, sandboxIds), ...bankToAccounts(sb, sandboxIds)];
    expect(summarize(counted(real)).netWorthCents).toBe(100000 + 123456); // manual only
  });
  it("never mixes a snapshot from one environment into another's state", () => {
    const mixed: BankState = { ...stateOf([acct("c", 10, 10)], false, "production"), environment: "sandbox" };
    expect(bankToAccounts(mixed, inc("c"))).toEqual([]);
    const other: BankState = { ...stateOf([acct("c", 10, 10)], false, "sandbox"), environment: "production" };
    expect(bankToAccounts(other, inc("c"))).toEqual([]);
  });
  it("namespaces preference ids by environment", () => {
    expect(bankPrefId("sandbox", "x")).toBe("plaid:sandbox:x");
    expect(bankPrefId("sandbox", "x")).not.toBe(bankPrefId("production", "x"));
    expect(bankPrefEnvironment("plaid:production:x")).toBe("production");
    expect(bankPrefEnvironment("plaid:x")).toBeNull();
    expect(bankPrefEnvironment("abc")).toBeNull();
    // an id saved for production does not count a sandbox account that happens to share the account id
    expect(bankToAccounts(stateOf([acct("c", 5, 5)], false, "fixtures"), inc("c"))).toEqual([]);
  });
  it("keeps provider data out of manual exports", () => {
    const text = serializeBackup({ version: 1, accounts: [{ id: "m1", name: "Everyday", kind: "savings", balanceCents: 1, updatedAt: "2026-11-01T00:00:00.000Z" }] }, () => "2026-11-01T00:00:00.000Z");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["accounts", "exportedAt", "format", "version"]);
    expect(text).not.toMatch(/plaid|bluepeak|access|token|included|asOf|fetchedAt/i);
  });
});
