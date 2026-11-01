import { guard, json } from "@/lib/server/guard";
import { markReconnected, refreshBank } from "@/lib/server/bankStore";
import { getBank } from "@/lib/server/bankProvider";
import { cooldownMs } from "@/lib/server/provider";

/** After update-mode Link succeeds: release the failure state and read balances again right away. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const { service, env } = getBank();
  if (!service || !env) return json({ error: "bank_not_configured" }, 503);
  markReconnected(env);
  const { outcome, state } = await refreshBank(env, { load: () => service.loadBalances() }, () => service.vaultStatus(), Date.now, cooldownMs());
  return json({ outcome, state });
}
