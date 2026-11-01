import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/finance";
import { MAX_MANUAL_CENTS, parseDollarsToCents } from "@/lib/money";
import {
  EMPTY_MANUAL,
  addAccount,
  deleteAccount,
  loadManual,
  parseMode,
  toAccounts,
  updateAccount,
  validateAccountInput,
} from "@/lib/manualAccounts";
import { HOME_UPGRADE_THRESHOLD_CENTS as T, INITIAL_MILESTONES, applyMilestones } from "@/lib/milestones";
import { sampleAccounts } from "@/lib/sampleData";

const cents = (s: string) => {
  const r = parseDollarsToCents(s);
  return r.ok ? r.cents : r.error;
};
const at = (n: number) => () => `2026-11-0${n}T10:00:00.000Z`;
const ids = (...v: string[]) => { let i = 0; return () => v[i++]; };

describe("parseDollarsToCents", () => {
  it("parses plain, grouped, and symbol amounts exactly", () => {
    expect(cents("0")).toBe(0);
    expect(cents("1234")).toBe(123_400);
    expect(cents("1,234.5")).toBe(123_450);
    expect(cents("$1,234.56")).toBe(123_456);
    expect(cents(" 0.07 ")).toBe(7);
    expect(cents(".5")).toBe(50);
    expect(cents("19.99")).toBe(1_999); // float math would give 1998.9999999999998
  });

  it("rejects bad input", () => {
    for (const bad of ["", "  ", "abc", "1e5", "12.345", "1.234,5", "-5", "+5", "1,23", "12.", "$", ".", "1 000", "NaN", "Infinity"]) {
      expect(parseDollarsToCents(bad).ok, bad).toBe(false);
    }
    expect(cents("12.345")).toBe("Use at most two decimal places.");
    expect(cents("-5")).toMatch(/positive/);
  });

  it("caps the maximum", () => {
    expect(cents("999,999,999,999.99")).toBe(MAX_MANUAL_CENTS);
    expect(parseDollarsToCents("1,000,000,000,000").ok).toBe(false);
    expect(parseDollarsToCents("9999999999999999").ok).toBe(false);
  });
});

describe("validateAccountInput", () => {
  it("accepts a good entry and normalizes the nickname", () => {
    expect(validateAccountInput({ name: "  Main   checking ", kind: "checking", amountText: "$2,500.10" })).toEqual({
      ok: true,
      value: { name: "Main checking", kind: "checking", balanceCents: 250_010 },
    });
  });

  it("reports each field error", () => {
    const r = validateAccountInput({ name: "", kind: "", amountText: "1.234" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amount", "kind", "name"]);
  });

  it("refuses account-number-like nicknames and over-long names", () => {
    expect(validateAccountInput({ name: "1234 5678 9012", kind: "savings", amountText: "1" }).ok).toBe(false);
    expect(validateAccountInput({ name: "x".repeat(41), kind: "savings", amountText: "1" }).ok).toBe(false);
    expect(validateAccountInput({ name: "Rainy day 2026", kind: "savings", amountText: "1" }).ok).toBe(true);
  });
});

describe("manual account state", () => {
  it("adds, edits and deletes; last-updated moves only when the balance changes", () => {
    let s = addAccount(EMPTY_MANUAL, { name: "Checking", kind: "checking", balanceCents: 100 }, at(1), ids("a"));
    expect(s.accounts[0]).toMatchObject({ id: "a", updatedAt: at(1)() });
    s = updateAccount(s, "a", { name: "Daily", kind: "checking", balanceCents: 100 }, at(2));
    expect(s.accounts[0]).toMatchObject({ name: "Daily", updatedAt: at(1)() });
    s = updateAccount(s, "a", { name: "Daily", kind: "checking", balanceCents: 250 }, at(3));
    expect(s.accounts[0]).toMatchObject({ balanceCents: 250, updatedAt: at(3)() });
    expect(deleteAccount(s, "a").accounts).toEqual([]);
  });

  it("subtracts debts exactly once in net worth", () => {
    let s = addAccount(EMPTY_MANUAL, { name: "Save", kind: "savings", balanceCents: 100_000 }, at(1), ids("a"));
    s = addAccount(s, { name: "Card", kind: "debt", balanceCents: 30_000 }, at(1), ids("b"));
    const sum = summarize(toAccounts(s));
    expect(sum.debtsCents).toBe(30_000);
    expect(sum.netWorthCents).toBe(70_000);
    expect(toAccounts(s).find((a) => a.id === "b")?.balanceCents).toBe(30_000); // stays a positive amount owed
  });
});

describe("loading saved manual data", () => {
  it("treats missing data as an empty, valid start", () => {
    expect(loadManual(null)).toEqual({ status: "ok", state: EMPTY_MANUAL });
    expect(loadManual("")).toEqual({ status: "ok", state: EMPTY_MANUAL });
  });

  it("round-trips saved data", () => {
    const s = addAccount(EMPTY_MANUAL, { name: "A", kind: "debt", balanceCents: 5 }, at(1), ids("a"));
    expect(loadManual(JSON.stringify(s))).toEqual({ status: "ok", state: s });
  });

  it("flags unreadable or invalid data instead of accepting or discarding it", () => {
    const bad = [
      "{nope",
      "null",
      '{"version":2,"accounts":[]}',
      '{"version":1}',
      '{"version":1,"accounts":[{"id":"a","name":"x","kind":"crypto","balanceCents":1,"updatedAt":"2026-11-01T00:00:00Z"}]}',
      '{"version":1,"accounts":[{"id":"a","name":"x","kind":"debt","balanceCents":-1,"updatedAt":"2026-11-01T00:00:00Z"}]}',
      '{"version":1,"accounts":[{"id":"a","name":"x","kind":"debt","balanceCents":1.5,"updatedAt":"2026-11-01T00:00:00Z"}]}',
      '{"version":1,"accounts":[{"id":"a","name":"x","kind":"debt","balanceCents":1,"updatedAt":"yesterday"}]}',
    ];
    for (const raw of bad) expect(loadManual(raw).status, raw).toBe("invalid");
  });

  it("rejects a list with a duplicate id", () => {
    const a = { id: "a", name: "x", kind: "debt", balanceCents: 1, updatedAt: "2026-11-01T00:00:00Z" };
    expect(loadManual(JSON.stringify({ version: 1, accounts: [a, a] })).status).toBe("invalid");
  });
});

describe("modes stay separate", () => {
  it("parses the saved mode, defaulting to demo", () => {
    expect(parseMode("manual")).toBe("manual");
    expect(parseMode("")).toBe("demo");
    expect(parseMode("garbage")).toBe("demo");
  });

  it("computes manual and demo net worth independently", () => {
    const demo = summarize(sampleAccounts("above")).netWorthCents;
    const manual = summarize(toAccounts(EMPTY_MANUAL)).netWorthCents;
    expect(demo).toBeGreaterThanOrEqual(T);
    expect(manual).toBe(0);
    expect(sampleAccounts("above")).toEqual(sampleAccounts("above")); // fixtures are never mutated by manual state
  });

  it("upgrades and reverts the home tier from manual balances", () => {
    let s = addAccount(EMPTY_MANUAL, { name: "Big", kind: "investment", balanceCents: T }, at(1), ids("a"));
    const up = applyMilestones(INITIAL_MILESTONES, summarize(toAccounts(s)).netWorthCents, at(1));
    expect(up.upgraded).toBe(true);
    s = updateAccount(s, "a", { name: "Big", kind: "investment", balanceCents: T - 1 }, at(2));
    const down = applyMilestones(up.state, summarize(toAccounts(s)).netWorthCents, at(2));
    expect(down.downgraded).toBe(true);
    expect(down.state.homeTier).toBe(1);
  });
});
