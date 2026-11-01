import "server-only";
import { createFixtureProvider } from "./fixtures";
import type { BrokerageProvider } from "./brokerageStore";
import { createSnaptradeProvider, snaptradeCredentials } from "./snaptrade";

export type ProviderKind = "none" | "snaptrade" | "fixtures";
const g = globalThis as unknown as { __ftProvider?: { kind: ProviderKind; provider: BrokerageProvider | null } };

const fixturesOn = (env: NodeJS.ProcessEnv) => env.FINANCE_TOWN_BROKERAGE_FIXTURES === "1" && env.NODE_ENV !== "production";

/** Live data only runs on a local machine: hosted platforms are refused even if credentials are present. */
const hosted = (env: NodeJS.ProcessEnv) => Boolean(env.VERCEL || env.NETLIFY || env.RENDER || env.FLY_APP_NAME);

export function getProvider(env: NodeJS.ProcessEnv = process.env): { kind: ProviderKind; provider: BrokerageProvider | null } {
  if (g.__ftProvider) return g.__ftProvider;
  let resolved: { kind: ProviderKind; provider: BrokerageProvider | null } = { kind: "none", provider: null };
  if (fixturesOn(env)) {
    resolved = { kind: "fixtures", provider: createFixtureProvider({ failAfterFirst: env.FINANCE_TOWN_FIXTURE_FAIL_AFTER_FIRST === "1" }) };
  } else if (!hosted(env)) {
    const creds = snaptradeCredentials(env);
    if (creds) resolved = { kind: "snaptrade", provider: createSnaptradeProvider(creds) };
  }
  g.__ftProvider = resolved;
  return resolved;
}

export function cooldownMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = Number(env.FINANCE_TOWN_REFRESH_COOLDOWN_MS);
  return fixturesOn(env) && Number.isFinite(raw) && raw >= 1000 ? raw : undefined;
}
