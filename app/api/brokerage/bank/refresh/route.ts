import { guard, json } from "@/lib/server/guard";
import { refreshBank } from "@/lib/server/bankStore";
import { getBank } from "@/lib/server/bankProvider";
import { cooldownMs } from "@/lib/server/provider";

/** The only route that reads balances from Plaid, with a server-enforced cooldown. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const { service, env } = getBank();
  if (!service || !env) return json({ error: "bank_not_configured" }, 503);
  const { outcome, state } = await refreshBank(env, { load: () => service.loadBalances() }, () => service.vaultStatus(), Date.now, cooldownMs());
  return json({ outcome, state }, outcome === "cooldown" ? 429 : 200);
}
