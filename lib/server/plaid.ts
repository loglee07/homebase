import "server-only";
// The real Plaid client. Server-only: the secret and the access token never reach the browser.
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { type PlaidEnvName } from "./plaidConfig";
import type { PlaidApiLike } from "./plaidService";

const BALANCE_TIMEOUT_MS = 60_000;

export function createPlaidApi(cfg: { clientId: string; secret: string; env: PlaidEnvName }): PlaidApiLike {
  const api = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[cfg.env],
      baseOptions: { timeout: 20_000, headers: { "PLAID-CLIENT-ID": cfg.clientId, "PLAID-SECRET": cfg.secret, "Plaid-Version": "2020-09-14" } },
    }),
  );
  // Only the seven calls the service is allowed to make are exposed.
  return {
    linkTokenCreate: (r) => api.linkTokenCreate(r),
    itemPublicTokenExchange: (r) => api.itemPublicTokenExchange(r),
    itemGet: (r) => api.itemGet(r),
    itemRemove: (r) => api.itemRemove(r),
    institutionsGetById: (r) => api.institutionsGetById(r),
    // Real-time balance asks the bank itself and can take well over 20 seconds, so it gets a longer limit than the other calls.
    // Read-only history. The page size is fixed here; the cursor and the access token are the only other inputs.
    transactionsSync: (r) => api.transactionsSync({ access_token: r.access_token, cursor: r.cursor, count: 500 }),
    accountsBalanceGet: (r) => api.accountsBalanceGet(r, { timeout: BALANCE_TIMEOUT_MS }),
  };
}
