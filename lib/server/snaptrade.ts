import "server-only";
// SnapTrade Personal API key client. Server-only: the consumer key never reaches the browser.
// READ-ONLY by construction: this file may call exactly the two read endpoints below (enforced by a test).
// No registration, no userId/userSecret (Personal keys do not use them), no connection portal, no refresh,
// no orders, no trades, no connection changes.
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import { BrokerageError, type BrokerageProvider } from "./brokerageStore";

const TIMEOUT_MS = 20_000;

export function snaptradeCredentials(env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.SNAPTRADE_CLIENT_ID?.trim();
  const consumerKey = env.SNAPTRADE_CONSUMER_KEY?.trim();
  return clientId && consumerKey ? { clientId, consumerKey } : null;
}

const num = (v: unknown) => (typeof v === "number" ? v : undefined);
/** Maps any SDK/network failure to a fixed code. The error text and response body are dropped on purpose. */
function toCode(e: unknown): BrokerageError {
  if (e instanceof BrokerageError) return e;
  const r = e as { status?: unknown; response?: { status?: unknown }; code?: unknown } | null;
  const status = num(r?.response?.status) ?? num(r?.status);
  if (status === 401 || status === 403) return new BrokerageError("auth_failed");
  if (status === 429) return new BrokerageError("rate_limited");
  const code = typeof r?.code === "string" ? r.code : "";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") return new BrokerageError("timeout");
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "ERR_NETWORK"].includes(code)) return new BrokerageError("network");
  return new BrokerageError("unknown");
}

export function createSnaptradeProvider(creds: { clientId: string; consumerKey: string }): BrokerageProvider {
  const client = new Snaptrade({ auth: SnaptradeAuth.personalApiKey(creds) });
  return {
    async load() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BrokerageError("timeout")), TIMEOUT_MS);
      });
      try {
        const work = (async () => {
          // Permissions first: connections report whether each is "read" or "trade".
          const connections = await client.connections.listBrokerageAuthorizations({});
          const accounts = await client.accountInformation.listUserAccounts({});
          return { connections: connections.data, accounts: accounts.data };
        })();
        return await Promise.race([work, timeout]);
      } catch (e) {
        throw toCode(e);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
