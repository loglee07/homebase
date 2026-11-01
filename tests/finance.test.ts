import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/finance";
import { assertCents, formatCents, sumCents } from "@/lib/money";
import { sampleAccounts } from "@/lib/sampleData";
import { HOME_UPGRADE_THRESHOLD_CENTS } from "@/lib/milestones";

describe("money", () => {
  it("formats integer cents", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
    expect(formatCents(-6_432)).toBe("-$64.32");
    expect(formatCents(3_127, { signed: true })).toBe("+$31.27");
  });

  it("rejects fractional or unsafe cents", () => {
    expect(() => assertCents(10.5)).toThrow(RangeError);
    expect(() => assertCents(NaN)).toThrow(RangeError);
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it("sums without float drift", () => {
    // 0.1 + 0.2 in dollars would drift; in cents it is exact.
    expect(sumCents([10, 20])).toBe(30);
  });
});

describe("summarize", () => {
  it("computes the below-threshold sample exactly", () => {
    const s = summarize(sampleAccounts("below"));
    expect(s.checkingCents).toBe(421_837);
    expect(s.savingsCents).toBe(1_850_000);
    expect(s.investmentsCents).toBe(6_395_105);
    expect(s.debtsCents).toBe(1_540_485);
    expect(s.assetsCents).toBe(8_666_942);
    expect(s.netWorthCents).toBe(7_126_457);
    expect(s.netWorthCents).toBeLessThan(HOME_UPGRADE_THRESHOLD_CENTS);
  });

  it("computes the above-threshold sample exactly", () => {
    const s = summarize(sampleAccounts("above"));
    expect(s.netWorthCents).toBe(10_867_144);
    expect(s.netWorthCents).toBeGreaterThanOrEqual(HOME_UPGRADE_THRESHOLD_CENTS);
  });

  it("subtracts debts and allows negative net worth", () => {
    const s = summarize([
      { id: "a", name: "A", kind: "checking", institution: "x", balanceCents: 100 },
      { id: "d", name: "D", kind: "debt", institution: "x", balanceCents: 250 },
    ]);
    expect(s.netWorthCents).toBe(-150);
  });

  it("rejects negative or fractional balances", () => {
    const bad = (balanceCents: number) =>
      summarize([{ id: "a", name: "A", kind: "savings", institution: "x", balanceCents }]);
    expect(() => bad(-1)).toThrow(RangeError);
    expect(() => bad(1.5)).toThrow(RangeError);
  });
});
