import { guard, json } from "@/lib/server/guard";
import { refresh } from "@/lib/server/brokerageStore";
import { cooldownMs, getProvider } from "@/lib/server/provider";

/** The only route that contacts the provider, and only through the read-only client. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const { provider } = getProvider();
  if (!provider) return json({ error: "brokerage_not_configured" }, 503);
  const { outcome, state } = await refresh(provider, Date.now, cooldownMs());
  return json({ outcome, state }, outcome === "cooldown" ? 429 : 200);
}
