import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_FILTER, applyChanges, directionOf, emptyActivity, filterTxns, normalizeTxn, sortNewest, type RawPlaidTxn } from "@/lib/bankActivity";

const raw = (o: Partial<RawPlaidTxn> = {}): RawPlaidTxn => ({ transaction_id: "t1", account_id: "a1", amount: 12.34, date: "2026-10-01", name: "Synthetic shop", pending: false, iso_currency_code: "USD", ...o });
const ok = (o?: Partial<RawPlaidTxn>) => {
  const n = normalizeTxn(raw(o));
  if (n.kind !== "ok") throw new Error(n.kind);
  return n.txn;
};
const none = { added: [], modified: [], removed: [] };

describe("signs and cents", () => {
  it("Plaid's positive amount (money out) becomes negative, and a negative amount (money in) becomes positive", () => {
    expect(ok({ amount: 12.34 }).amountCents).toBe(-1234);
    expect(ok({ amount: -2000 }).amountCents).toBe(200000);
    expect(directionOf(ok({ amount: 12.34 }))).toBe("out");
    expect(directionOf(ok({ amount: -5 }))).toBe("in");
    expect(directionOf(ok({ amount: 0 }))).toBe("none");
  });
  it("converts floats to exact integer cents", () => {
    for (const [amt, cents] of [[0.1 + 0.2, -30], [19.99, -1999], [1.005, -101], [-0.01, 1], [1234567.89, -123456789]] as const) {
      const c = ok({ amount: amt }).amountCents;
      expect(Number.isInteger(c)).toBe(true);
      expect(Math.abs(c - cents)).toBeLessThanOrEqual(1);
    }
    expect(Object.is(ok({ amount: 0 }).amountCents, 0)).toBe(true); // never -0
    expect(Object.is(ok({ amount: -0 }).amountCents, 0)).toBe(true);
  });
  it("rejects junk instead of guessing", () => {
    for (const bad of [{ amount: NaN }, { amount: Infinity }, { amount: "5" as unknown as number }, { amount: 1e13 }, { date: "10/01/2026" }, { date: "2026-13-45" }, { transaction_id: "" }, { account_id: "" }]) expect(normalizeTxn(raw(bad)).kind).toBe("invalid");
  });
  it("sets aside other currencies instead of showing them as dollars", () => {
    expect(normalizeTxn(raw({ iso_currency_code: "CAD" })).kind).toBe("skipped");
    expect(normalizeTxn(raw({ iso_currency_code: null, unofficial_currency_code: "BTC" })).kind).toBe("skipped");
  });
  it("masks long digit runs in descriptions and prefers the merchant name", () => {
    expect(ok({ name: "ACH 123456789012 PAYROLL" }).description).not.toMatch(/\d{4}/);
    expect(ok({ name: "RAW BANK TEXT", merchant_name: "Nice Cafe" }).description).toBe("Nice Cafe");
  });
});

describe("applying changes", () => {
  it("adds, modifies and removes by id, and never duplicates a repeated add", () => {
    let d = applyChanges(emptyActivity(), [{ ...none, added: [raw({ transaction_id: "a" }), raw({ transaction_id: "b", date: "2026-10-02" })] }]);
    expect(d.transactions.map((t) => t.id)).toEqual(["b", "a"]);
    d = applyChanges(d, [{ ...none, added: [raw({ transaction_id: "a" })] }]);
    expect(d.transactions).toHaveLength(2);
    d = applyChanges(d, [{ ...none, modified: [raw({ transaction_id: "a", amount: 99 })] }]);
    expect(d.transactions.find((t) => t.id === "a")!.amountCents).toBe(-9900);
    d = applyChanges(d, [{ ...none, removed: [{ transaction_id: "a" }, { transaction_id: "missing" }, {}] }]);
    expect(d.transactions.map((t) => t.id)).toEqual(["b"]);
  });
  it("a posted transaction replaces the pending one it names, in either order of arrival", () => {
    const pending = raw({ transaction_id: "p", pending: true });
    const posted = raw({ transaction_id: "q", pending_transaction_id: "p", date: "2026-10-03" });
    let d = applyChanges(emptyActivity(), [{ ...none, added: [pending] }]);
    d = applyChanges(d, [{ ...none, added: [posted] }]);
    expect(d.transactions.map((t) => [t.id, t.pending])).toEqual([["q", false]]);
    const same = applyChanges(emptyActivity(), [{ ...none, added: [pending, posted] }]);
    expect(same.transactions.map((t) => t.id)).toEqual(["q"]);
    // Plaid also sends the pending id as removed: that must not hurt
    expect(applyChanges(d, [{ ...none, removed: [{ transaction_id: "p" }] }]).transactions.map((t) => t.id)).toEqual(["q"]);
  });
  it("tracks skipped ids and lets a later USD version clear them", () => {
    let d = applyChanges(emptyActivity(), [{ ...none, added: [raw({ iso_currency_code: "CAD" })] }]);
    expect(d.skippedIds).toEqual(["t1"]);
    expect(d.transactions).toHaveLength(0);
    d = applyChanges(d, [{ ...none, modified: [raw()] }]);
    expect(d.skippedIds).toEqual([]);
    expect(d.transactions).toHaveLength(1);
  });
  it("does not change the input", () => {
    const base = emptyActivity();
    applyChanges(base, [{ ...none, added: [raw()] }]);
    expect(base.transactions).toEqual([]);
  });
});

describe("order and filters", () => {
  const set = [ok({ transaction_id: "a", date: "2026-10-01" }), ok({ transaction_id: "b", date: "2026-10-03", account_id: "a2" }), ok({ transaction_id: "c", date: "2026-10-03", pending: true }), ok({ transaction_id: "d", date: "2026-09-01" })];
  it("newest first, pending first within a day, stable", () => {
    expect(sortNewest(set).map((t) => t.id)).toEqual(["c", "b", "a", "d"]);
  });
  it("filters by account and an inclusive date range", () => {
    expect(filterTxns(set, NO_FILTER)).toHaveLength(4);
    expect(filterTxns(set, { ...NO_FILTER, accountId: "a2" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTxns(set, { accountId: "all", from: "2026-10-01", to: "2026-10-03" }).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    expect(filterTxns(set, { accountId: "all", from: "2026-10-04", to: "" })).toEqual([]);
  });
});

describe("boundaries", () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, "..", p), "utf8");
  it("history never reaches balances, net worth, milestones, manual data or backups", () => {
    for (const f of ["lib/plaid.ts", "lib/finance.ts", "lib/brokerage.ts", "lib/milestones.ts", "lib/manualAccounts.ts", "lib/manualBackup.ts", "lib/netWorthHistory.ts", "game/bridge.ts"]) {
      expect(read(f), f).not.toMatch(/bankActivity|BankActivity|BankTxn/);
    }
    expect(read("components/FinanceTown.tsx")).not.toMatch(/activity/i);
    expect(read("components/BankDashboard.tsx")).not.toMatch(/summarize\([^)]*activity/i);
  });
  it("the activity screen never calls an incoming payment income, and keeps nothing in browser storage", () => {
    const src = read("components/BankActivity.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/income|localStorage|sessionStorage/i);
    expect(read("components/useBank.ts").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/localStorage|sessionStorage|\.setItem\(/);
  });
});
