// SAMPLE DATA ONLY. No real accounts. Future connections must be read-only.
import type { Account, Transaction } from "./finance";

export type Scenario = "below" | "above";

const debts: Account[] = [
  { id: "student", name: "Student Loan", kind: "debt", institution: "Sample Loan Servicer", balanceCents: 1_412_066, aprBasisPoints: 450 },
  { id: "card", name: "Rewards Credit Card", kind: "debt", institution: "Sample Card Co.", balanceCents: 128_419, aprBasisPoints: 2199 },
];

export function sampleAccounts(scenario: Scenario): Account[] {
  const above = scenario === "above";
  return [
    { id: "checking", name: "Everyday Checking", kind: "checking", institution: "Sample Bank", balanceCents: 421_837 },
    { id: "savings", name: "Rainy Day Savings", kind: "savings", institution: "Sample Bank", balanceCents: above ? 2_100_000 : 1_850_000 },
    { id: "brokerage", name: "Brokerage", kind: "investment", institution: "Sample Brokerage", balanceCents: above ? 4_011_562 : 2_264_080 },
    { id: "retirement", name: "Retirement IRA", kind: "investment", institution: "Sample Brokerage", balanceCents: above ? 5_874_230 : 4_131_025 },
    ...debts,
  ];
}

export const sampleTransactions: Transaction[] = [
  { id: "t1", date: "2026-10-31", description: "Corner Market", category: "Groceries", accountId: "checking", amountCents: -6_432, kind: "spending" },
  { id: "t2", date: "2026-10-30", description: "Paycheck", category: "Income", accountId: "checking", amountCents: 242_015, kind: "income" },
  { id: "t3", date: "2026-10-29", description: "Transfer to Savings", category: "Transfer", accountId: "savings", amountCents: 50_000, kind: "transfer" },
  { id: "t4", date: "2026-10-28", description: "Bean There Coffee", category: "Dining", accountId: "card", amountCents: -675, kind: "spending" },
  { id: "t5", date: "2026-10-27", description: "Power & Water", category: "Utilities", accountId: "checking", amountCents: -11_890, kind: "spending" },
  { id: "t6", date: "2026-10-25", description: "Student Loan Payment", category: "Debt", accountId: "student", amountCents: -32_000, kind: "debt_payment" },
  { id: "t7", date: "2026-10-24", description: "Index Fund Purchase", category: "Investing", accountId: "brokerage", amountCents: 75_000, kind: "investment" },
  { id: "t8", date: "2026-10-22", description: "Bookshop", category: "Shopping", accountId: "card", amountCents: -3_418, kind: "spending" },
  { id: "t9", date: "2026-10-20", description: "Savings Interest", category: "Income", accountId: "savings", amountCents: 3_127, kind: "income" },
  { id: "t10", date: "2026-10-18", description: "Rent Share", category: "Housing", accountId: "checking", amountCents: -95_000, kind: "spending" },
];
