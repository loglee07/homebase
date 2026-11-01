// Synthetic brokerage data for tests and local demos. Contains no real balances and never contacts SnapTrade.
import type { RawAccount, RawConnection } from "../brokerage";
import { BrokerageError, type BrokerageProvider } from "./brokerageStore";

const connections: RawConnection[] = [
  { id: "conn-read-a", type: "read", disabled: false },
  { id: "conn-read-b", type: "read", disabled: false },
  { id: "conn-trade", type: "trade", disabled: false },
  { id: "conn-broken", type: "read", disabled: true },
];
const acct = (id: string, conn: string, inst: string, name: string, amount: number | null, currency = "USD", sync = "2026-10-31T21:00:00Z"): RawAccount => ({
  id,
  brokerage_authorization: conn,
  institution_name: inst,
  name,
  status: "open",
  balance: { total: amount === null ? null : { amount, currency } },
  sync_status: { holdings: { last_successful_sync: sync } },
});
const accounts: RawAccount[] = [
  acct("fx-1", "conn-read-a", "Fidelity", "Synthetic brokerage", 12345.67),
  acct("fx-2", "conn-read-a", "Fidelity", "Synthetic retirement 88112233", 80000.5, "USD", "2026-10-30T20:00:00Z"),
  acct("fx-3", "conn-read-b", "Robinhood", "Synthetic individual", 2500),
  acct("fx-4", "conn-read-b", "Robinhood", "Synthetic foreign", 4000, "CAD"),
  acct("fx-5", "conn-read-b", "Robinhood", "Synthetic pending", null),
  acct("fx-6", "conn-trade", "Robinhood", "Synthetic trade-enabled", 999.99),
  acct("fx-7", "conn-broken", "Fidelity", "Synthetic needs repair", 50),
];

/** failAfterFirst: the first load succeeds, every later one fails, to exercise the stale snapshot path. */
export function createFixtureProvider(opts: { failAfterFirst?: boolean } = {}): BrokerageProvider {
  let calls = 0;
  return {
    async load() {
      calls += 1;
      if (opts.failAfterFirst && calls > 1) throw new BrokerageError("network");
      return { connections: structuredClone(connections), accounts: structuredClone(accounts) };
    },
  };
}
