// Synthetic Plaid API for tests and local demos: no real balances, never contacts Plaid, never touches the real token file.
import type { RawPlaidAccount } from "../plaid";
import { BLUPEAK_INSTITUTION_ID } from "../plaid";
import type { PlaidApiLike } from "./plaidService";

const acct = (id: string, name: string, subtype: string, current: number | null, available: number | null, currency: string | null = "USD", type = "depository"): RawPlaidAccount => ({
  account_id: id,
  name,
  type,
  subtype,
  balances: { current, available, iso_currency_code: currency, unofficial_currency_code: null, last_updated_datetime: "2026-11-01T15:00:00Z" },
});

export const FIXTURE_BANK_ACCOUNTS: RawPlaidAccount[] = [
  acct("bk-1", "Synthetic checking", "checking", 1234.56, 1100),
  acct("bk-2", "Synthetic savings", "savings", 5000, 5000),
  acct("bk-3", "Synthetic overdrawn", "checking", -42.1, -42.1),
  acct("bk-4", "Synthetic pending", "checking", null, null),
  acct("bk-5", "Synthetic foreign", "savings", 300, 300, "CAD"),
  acct("bk-6", "Synthetic money market", "money market", 800, 800),
];

/** failAfterFirst: balance loads fail after the first success, to exercise the stale path. */
export function createFixtureBankApi(opts: { failAfterFirst?: boolean; institutionId?: string } = {}): PlaidApiLike {
  let balanceCalls = 0;
  const removed: string[] = [];
  return {
    async linkTokenCreate() {
      return { data: { link_token: "link-fixture-token" } };
    },
    async itemPublicTokenExchange(req) {
      return { data: { access_token: `access-fixture-${req.public_token.slice(-6)}`, item_id: "item-fixture" } };
    },
    async itemGet() {
      return { data: { item: { institution_id: opts.institutionId ?? BLUPEAK_INSTITUTION_ID } } };
    },
    async itemRemove(req) {
      removed.push(req.access_token);
      return {};
    },
    async institutionsGetById(req) {
      return { data: { institution: { institution_id: req.institution_id, name: "BluPeak Credit Union (synthetic)", products: ["transactions", "auth"] } } };
    },
    async accountsBalanceGet() {
      balanceCalls += 1;
      if (opts.failAfterFirst && balanceCalls > 1) throw Object.assign(new Error("x"), { code: "ECONNRESET" });
      return { data: { accounts: structuredClone(FIXTURE_BANK_ACCOUNTS) } };
    },
  };
}
