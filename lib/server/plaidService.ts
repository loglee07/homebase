// Plaid link, exchange and balance logic, with the Plaid API and the token vault injected so it can be tested with
// fakes. READ-ONLY: Link is created with the Transactions product only (Balance is never listed in products), restricted
// to checking and savings. No Auth, Identity, Transfer, Signal or payment products. Transaction history is read only in plaidActivity.ts.
import type { CountryCode, LinkTokenCreateRequest, Products } from "plaid";
import type { RawSyncPage } from "../bankActivity";
import { BLUPEAK_INSTITUTION_ID, BLUPEAK_NAME, type BankErrorCode, type PlaidEnvironment, type RawPlaidAccount, type VaultStatus } from "../plaid";
import type { TokenVault } from "./vault";

export type ServiceErrorCode =
  | BankErrorCode
  | "already_linked"
  | "institution_mismatch"
  | "institution_unverified"
  | "vault_write_failed"
  | "environment_mismatch"
  | "bad_request";

/** The only Plaid facts kept from a failure: which call, HTTP status and Plaid's own error identifiers. No message text, bodies or headers. */
export interface PlaidDiag {
  stage: string;
  status: number | null;
  errorType: string | null;
  errorCode: string | null;
  requestId: string | null;
}

export class PlaidServiceError extends Error {
  constructor(readonly code: ServiceErrorCode, readonly diag?: PlaidDiag) {
    super(code); // the code is the whole message: Plaid text and bodies are never kept
  }
}

const ident = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(v) ? v : null);

export function plaidDiag(stage: string, e: unknown): PlaidDiag {
  const r = e as { response?: { status?: unknown; data?: { error_type?: unknown; error_code?: unknown; request_id?: unknown } }; code?: unknown } | null;
  const d = r?.response?.data;
  return {
    stage,
    status: typeof r?.response?.status === "number" ? r.response.status : null,
    errorType: ident(d?.error_type) ?? ident(r?.code),
    errorCode: ident(d?.error_code),
    requestId: ident(d?.request_id),
  };
}

/** The subset of Plaid's API this app may call. Nothing else is reachable through the service. */
export interface PlaidApiLike {
  linkTokenCreate(req: LinkTokenCreateRequest): Promise<{ data: { link_token: string } }>;
  itemPublicTokenExchange(req: { public_token: string }): Promise<{ data: { access_token: string; item_id: string } }>;
  itemGet(req: { access_token: string }): Promise<{ data: { item: { institution_id?: string | null } } }>;
  itemRemove(req: { access_token: string }): Promise<unknown>;
  institutionsGetById(req: { institution_id: string; country_codes: CountryCode[] }): Promise<{ data: { institution: { institution_id: string; name: string; products: string[] } } }>;
  accountsBalanceGet(req: { access_token: string }): Promise<{ data: { accounts: RawPlaidAccount[] } }>;
  /** Read-only transaction history, used only by plaidActivity.ts. */
  transactionsSync(req: { access_token: string; cursor?: string; count?: number }): Promise<{ data: RawSyncPage }>;
}

export interface PlaidServiceOptions {
  api: PlaidApiLike;
  vault: TokenVault;
  clientUserId: string;
  /** The environment this service talks to. A stored token from any other environment is rejected. */
  environment: PlaidEnvironment;
  /** Production: the exact institution must be BluPeak. Sandbox has no BluPeak, so the identity check is skipped there. */
  verifyIdentity: boolean;
  now?: () => Date;
}

const US = "US" as CountryCode;
const TRANSACTIONS = "transactions" as Products;

export function plaidErrorCode(e: unknown): ServiceErrorCode {
  if (e instanceof PlaidServiceError) return e.code;
  const r = e as { response?: { status?: unknown; data?: { error_code?: unknown } }; code?: unknown } | null;
  const plaid = typeof r?.response?.data?.error_code === "string" ? r.response.data.error_code : "";
  const status = typeof r?.response?.status === "number" ? r.response.status : 0;
  if (plaid === "ITEM_LOGIN_REQUIRED" || plaid === "PENDING_EXPIRATION" || plaid === "USER_PERMISSION_REVOKED") return "reconnect_required";
  if (plaid === "RATE_LIMIT" || plaid === "RATE_LIMIT_EXCEEDED" || status === 429) return "rate_limited";
  if (["INVALID_API_KEYS", "INVALID_CLIENT_ID", "INVALID_SECRET", "UNAUTHORIZED_ENVIRONMENT", "INVALID_ACCESS_TOKEN"].includes(plaid) || status === 401 || status === 403) return "auth_failed";
  const code = typeof r?.code === "string" ? r.code : "";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return "timeout";
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ERR_NETWORK"].includes(code)) return "network";
  return "unknown";
}

export function createPlaidService(opts: PlaidServiceOptions) {
  const { api, vault } = opts;
  const now = opts.now ?? (() => new Date());
  // One link operation at a time, so two tabs or a double click cannot create two Items.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  const removeQuietly = async (accessToken: string) => {
    try {
      await api.itemRemove({ access_token: accessToken });
    } catch {
      // best effort: the orphan Item is reported to the caller through the original error
    }
  };
  const wrap = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw new PlaidServiceError(plaidErrorCode(e), plaidDiag(stage, e));
    }
  };

  /** Confirms the published BluPeak id resolves to BluPeak and that it covers Transactions. */
  async function verifyCoverage() {
    if (!opts.verifyIdentity) return;
    const res = await wrap("institutionsGetById", () => api.institutionsGetById({ institution_id: BLUPEAK_INSTITUTION_ID, country_codes: [US] }));
    const inst = res.data.institution;
    if (inst.institution_id !== BLUPEAK_INSTITUTION_ID || !new RegExp(BLUPEAK_NAME, "i").test(inst.name)) throw new PlaidServiceError("institution_unverified");
    if (!inst.products.includes(TRANSACTIONS)) throw new PlaidServiceError("institution_unverified");
  }

  return {
    async vaultStatus(): Promise<VaultStatus> {
      const r = await vault.read();
      return r.status === "ok" ? "linked" : r.status;
    },
    environment: opts.environment,

    /** New Item: only when nothing is stored. Reconnect: update mode on the stored Item (never a second Item). */
    prepareLink(reconnect: boolean): Promise<{ linkToken: string; mode: "new" | "update" }> {
      return exclusive(async () => {
        const stored = await vault.read();
        if (stored.status === "unreadable") throw new PlaidServiceError("vault_unreadable");
        if (stored.status === "ok" && stored.item.environment !== opts.environment) throw new PlaidServiceError("environment_mismatch");
        if (reconnect && stored.status !== "ok") throw new PlaidServiceError("not_linked");
        if (!reconnect && stored.status === "ok") throw new PlaidServiceError("already_linked");
        await verifyCoverage();
        const base = { client_name: "Homebase", language: "en", country_codes: [US], user: { client_user_id: opts.clientUserId } };
        const req: LinkTokenCreateRequest =
          reconnect && stored.status === "ok"
            ? { ...base, access_token: stored.item.accessToken } // update mode: no products
            : {
                ...base,
                // Transactions for the personal-finance use case. Balance is initialized automatically and must not be listed.
                products: [TRANSACTIONS],
                account_filters: { depository: { account_subtypes: ["checking", "savings"] } } as LinkTokenCreateRequest["account_filters"],
              };
        // No redirect_uri: on desktop Link opens the bank's OAuth page in a popup, so no public URL or tunnel is needed.
        const res = await wrap("linkTokenCreate", () => api.linkTokenCreate(req));
        return { linkToken: res.data.link_token, mode: reconnect ? "update" : "new" };
      });
    },

    /** Exchanges the public token on the server and trusts only what Plaid says about the Item, not the browser. */
    complete(publicToken: unknown): Promise<{ institution: string }> {
      return exclusive(async () => {
        if (typeof publicToken !== "string" || !/^public-[A-Za-z0-9-]{8,200}$/.test(publicToken)) throw new PlaidServiceError("bad_request");
        const ex = await wrap("itemPublicTokenExchange", () => api.itemPublicTokenExchange({ public_token: publicToken }));
        const { access_token: accessToken, item_id: itemId } = ex.data;
        try {
          const existing = await vault.read();
          if (existing.status !== "empty") throw new PlaidServiceError(existing.status === "ok" ? "already_linked" : "vault_unreadable");
          const item = await wrap("itemGet", () => api.itemGet({ access_token: accessToken }));
          const institutionId = item.data.item.institution_id ?? "";
          if (opts.verifyIdentity && institutionId !== BLUPEAK_INSTITUTION_ID) throw new PlaidServiceError("institution_mismatch");
          try {
            await vault.write({ environment: opts.environment, itemId, accessToken, institutionId, institutionName: BLUPEAK_NAME, linkedAt: now().toISOString() });
          } catch {
            throw new PlaidServiceError("vault_write_failed");
          }
          return { institution: BLUPEAK_NAME };
        } catch (e) {
          await removeQuietly(accessToken); // never leave a second or wrong Item behind
          throw e;
        }
      });
    },

    /** Current balances of the stored Item. Throws a PlaidServiceError code; never returns partial data. */
    async loadBalances(): Promise<{ institution: string; accounts: RawPlaidAccount[] }> {
      const stored = await vault.read();
      if (stored.status === "empty") throw new PlaidServiceError("not_linked");
      if (stored.status === "unreadable") throw new PlaidServiceError("vault_unreadable");
      if (stored.item.environment !== opts.environment) throw new PlaidServiceError("environment_mismatch");
      const res = await wrap("accountsBalanceGet", () => api.accountsBalanceGet({ access_token: stored.item.accessToken }));
      return { institution: stored.item.institutionName, accounts: res.data.accounts };
    },
  };
}
export type PlaidService = ReturnType<typeof createPlaidService>;
