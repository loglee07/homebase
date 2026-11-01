import { describe, expect, it } from "vitest";
import { TRANSACTION_KIND, type TransactionKind } from "@/lib/finance";
import { sampleAccounts, sampleTransactions } from "@/lib/sampleData";

describe("transaction classification", () => {
  it("gives every fixture an explicit, known kind", () => {
    for (const t of sampleTransactions) expect(Object.keys(TRANSACTION_KIND)).toContain(t.kind);
  });

  it("keeps transfers, investment purchases and debt payments neutral, never income", () => {
    const neutral: TransactionKind[] = ["transfer", "investment", "debt_payment"];
    for (const k of neutral) expect(TRANSACTION_KIND[k].tone).toBe("neutral");
    expect(TRANSACTION_KIND.income.tone).toBe("income");
    expect(TRANSACTION_KIND.spending.tone).toBe("spending");
    const earned = sampleTransactions.filter((t) => TRANSACTION_KIND[t.kind].tone === "income");
    expect(earned.map((t) => t.description).sort()).toEqual(["Paycheck", "Savings Interest"]);
    expect(earned.every((t) => t.amountCents > 0)).toBe(true);
  });

  it("classifies the transfer, purchase and loan payment fixtures explicitly", () => {
    const byId = Object.fromEntries(sampleTransactions.map((t) => [t.id, t]));
    expect(byId.t3.kind).toBe("transfer");
    expect(byId.t7.kind).toBe("investment");
    expect(byId.t6.kind).toBe("debt_payment");
  });

  it("only references real accounts and keeps account-level signs", () => {
    const ids = new Set(sampleAccounts("below").map((a) => a.id));
    for (const t of sampleTransactions) expect(ids.has(t.accountId)).toBe(true);
    const byId = Object.fromEntries(sampleTransactions.map((t) => [t.id, t.amountCents]));
    expect(byId.t3).toBe(50_000);
    expect(byId.t7).toBe(75_000);
    expect(byId.t6).toBe(-32_000);
  });
});
