import { assertCents, sumCents, type Cents } from "./money";

export type AccountKind = "checking" | "savings" | "investment" | "debt";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  institution: string;
  /** Always non-negative. For debts this is the amount owed. */
  balanceCents: Cents;
  /** Debts only, in basis points (1999 = 19.99%). */
  aprBasisPoints?: number;
}

export interface Transaction {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  description: string;
  category: string;
  accountId: string;
  /** Negative = money out, positive = money in. */
  amountCents: Cents;
}

export interface FinanceSummary {
  checkingCents: Cents;
  savingsCents: Cents;
  investmentsCents: Cents;
  debtsCents: Cents;
  assetsCents: Cents;
  netWorthCents: Cents;
}

function totalFor(accounts: readonly Account[], kind: AccountKind): Cents {
  return sumCents(
    accounts.filter((a) => a.kind === kind).map((a) => {
      if (assertCents(a.balanceCents, a.name) < 0) {
        throw new RangeError(`${a.name}: balances are stored non-negative`);
      }
      return a.balanceCents;
    }),
  );
}

export function summarize(accounts: readonly Account[]): FinanceSummary {
  const checkingCents = totalFor(accounts, "checking");
  const savingsCents = totalFor(accounts, "savings");
  const investmentsCents = totalFor(accounts, "investment");
  const debtsCents = totalFor(accounts, "debt");
  const assetsCents = checkingCents + savingsCents + investmentsCents;
  return {
    checkingCents,
    savingsCents,
    investmentsCents,
    debtsCents,
    assetsCents,
    netWorthCents: assetsCents - debtsCents,
  };
}
