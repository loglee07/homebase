import "server-only";
import path from "node:path";
import type { PlaidEnvironment } from "../plaid";
import { createFixtureBankApi } from "./fixtureBank";
import { createPlaidApi } from "./plaid";
import { clientUserId, plaidConfig } from "./plaidConfig";
import { createPlaidService, type PlaidService } from "./plaidService";
import { createActivityService, type ActivityService } from "./plaidActivity";
import { createActivityFileVault, createFileVault, createMemoryActivityVault, createMemoryVault, parseDataKey } from "./vault";
import { cooldownMs } from "./provider";

export type BankKind = "none" | "plaid" | "fixtures";
export interface BankRuntime {
  kind: BankKind;
  env: PlaidEnvironment | null;
  service: PlaidService | null;
  /** Read-only transaction history for the same Item. */
  activity: ActivityService | null;
  /** Names (never values) of the settings that are still missing. */
  missing: string[];
}
// The runtime is cached on globalThis so it survives hot reloads. Bump this whenever BankRuntime gains a member: a runtime
// built by older code (for example one without `activity`) is then rebuilt instead of reused, which would otherwise make
// every route answer "not set up" until the server restarted.
const RUNTIME_VERSION = 2;
const g = globalThis as unknown as { __ftBankRuntime?: BankRuntime & { version?: number } };

const fixturesOn = (env: NodeJS.ProcessEnv) => env.FINANCE_TOWN_BROKERAGE_FIXTURES === "1" && env.NODE_ENV !== "production";
const hosted = (env: NodeJS.ProcessEnv) => Boolean(env.VERCEL || env.NETLIFY || env.RENDER || env.FLY_APP_NAME);

export function getBank(env: NodeJS.ProcessEnv = process.env): BankRuntime {
  if (g.__ftBankRuntime?.version === RUNTIME_VERSION) return g.__ftBankRuntime;
  let rt: BankRuntime = { kind: "none", env: null, service: null, activity: null, missing: [] };
  if (fixturesOn(env)) {
    const api = createFixtureBankApi({ failAfterFirst: env.FINANCE_TOWN_FIXTURE_FAIL_AFTER_FIRST === "1" });
    const vault = createMemoryVault();
    rt = {
      kind: "fixtures",
      env: "fixtures",
      missing: [],
      activity: createActivityService({ api, token: vault, activity: createMemoryActivityVault(), environment: "fixtures", cooldownMs: cooldownMs(env) }),
      service: createPlaidService({
        environment: "fixtures",
        api,
        vault,
        clientUserId: "fixture-user",
        verifyIdentity: true,
      }),
    };
  } else if (!hosted(env)) {
    const cfg = plaidConfig(env);
    const key = parseDataKey(env.FINANCE_TOWN_DATA_KEY);
    const missing = [!cfg ? "PLAID_CLIENT_ID, a secret (PLAID_SECRET or PLAID_SECRET_SANDBOX / PLAID_SECRET_PRODUCTION) and PLAID_ENV (sandbox or production)" : "", !key ? "FINANCE_TOWN_DATA_KEY" : ""].filter(Boolean);
    if (cfg && key) {
      const dir = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
      const api = createPlaidApi(cfg);
      const vault = createFileVault(dir, key, cfg.env);
      rt = {
        kind: "plaid",
        env: cfg.env,
        missing: [],
        activity: createActivityService({ api, token: vault, activity: createActivityFileVault(dir, key, cfg.env), environment: cfg.env }),
        service: createPlaidService({
          environment: cfg.env,
          api,
          vault,
          clientUserId: clientUserId(cfg.clientId),
          verifyIdentity: cfg.env === "production",
        }),
      };
    } else {
      rt = { kind: "none", env: null, service: null, activity: null, missing };
    }
  }
  g.__ftBankRuntime = { ...rt, version: RUNTIME_VERSION };
  return rt;
}
