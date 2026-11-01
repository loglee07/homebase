import "server-only";
import path from "node:path";
import type { PlaidEnvironment } from "../plaid";
import { createFixtureBankApi } from "./fixtureBank";
import { createPlaidApi } from "./plaid";
import { clientUserId, plaidConfig } from "./plaidConfig";
import { createPlaidService, type PlaidService } from "./plaidService";
import { createFileVault, createMemoryVault, parseDataKey } from "./vault";

export type BankKind = "none" | "plaid" | "fixtures";
export interface BankRuntime {
  kind: BankKind;
  env: PlaidEnvironment | null;
  service: PlaidService | null;
  /** Names (never values) of the settings that are still missing. */
  missing: string[];
}
const g = globalThis as unknown as { __ftBankRuntime?: BankRuntime };

const fixturesOn = (env: NodeJS.ProcessEnv) => env.FINANCE_TOWN_BROKERAGE_FIXTURES === "1" && env.NODE_ENV !== "production";
const hosted = (env: NodeJS.ProcessEnv) => Boolean(env.VERCEL || env.NETLIFY || env.RENDER || env.FLY_APP_NAME);

export function getBank(env: NodeJS.ProcessEnv = process.env): BankRuntime {
  if (g.__ftBankRuntime) return g.__ftBankRuntime;
  let rt: BankRuntime = { kind: "none", env: null, service: null, missing: [] };
  if (fixturesOn(env)) {
    rt = {
      kind: "fixtures",
      env: "fixtures",
      missing: [],
      service: createPlaidService({
        environment: "fixtures",
        api: createFixtureBankApi({ failAfterFirst: env.FINANCE_TOWN_FIXTURE_FAIL_AFTER_FIRST === "1" }),
        vault: createMemoryVault(),
        clientUserId: "fixture-user",
        verifyIdentity: true,
      }),
    };
  } else if (!hosted(env)) {
    const cfg = plaidConfig(env);
    const key = parseDataKey(env.FINANCE_TOWN_DATA_KEY);
    const missing = [!cfg ? "PLAID_CLIENT_ID, a secret (PLAID_SECRET or PLAID_SECRET_SANDBOX / PLAID_SECRET_PRODUCTION) and PLAID_ENV (sandbox or production)" : "", !key ? "FINANCE_TOWN_DATA_KEY" : ""].filter(Boolean);
    if (cfg && key) {
      rt = {
        kind: "plaid",
        env: cfg.env,
        missing: [],
        service: createPlaidService({
          environment: cfg.env,
          api: createPlaidApi(cfg),
          vault: createFileVault(path.join(/* turbopackIgnore: true */ process.cwd(), ".data"), key, cfg.env),
          clientUserId: clientUserId(cfg.clientId),
          verifyIdentity: cfg.env === "production",
        }),
      };
    } else {
      rt = { kind: "none", env: null, service: null, missing };
    }
  }
  g.__ftBankRuntime = rt;
  return rt;
}
