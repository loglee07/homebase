// Plaid settings from the environment. No SDK and no server-only import, so it can be tested directly.
import { createHash } from "node:crypto";

export type PlaidEnvName = "sandbox" | "production";

/** Credentials or null. PLAID_ENV must be exactly "sandbox" or "production" (no default, no legacy "development"). */
export function plaidConfig(env: NodeJS.ProcessEnv = process.env): { clientId: string; secret: string; env: PlaidEnvName } | null {
  const clientId = env.PLAID_CLIENT_ID?.trim();
  const name = env.PLAID_ENV?.trim();
  if (!clientId || (name !== "sandbox" && name !== "production")) return null;
  // Plaid issues a different secret per environment. A per-environment variable wins, so switching PLAID_ENV alone is enough
  // and the other environment's secret is never sent to the wrong host.
  const secret = (name === "sandbox" ? env.PLAID_SECRET_SANDBOX : env.PLAID_SECRET_PRODUCTION)?.trim() || env.PLAID_SECRET?.trim();
  if (!secret) return null;
  return { clientId, secret, env: name };
}

/** Stable, non-identifying id for Link's user field: derived from the client id, contains no personal data. */
export const clientUserId = (clientId: string) => createHash("sha256").update(`finance-town:${clientId}`).digest("hex").slice(0, 32);

