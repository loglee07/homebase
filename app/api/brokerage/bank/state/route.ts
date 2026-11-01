import { guard, json } from "@/lib/server/guard";
import { publicBankState } from "@/lib/server/bankStore";
import { getBank } from "@/lib/server/bankProvider";
import { cooldownMs } from "@/lib/server/provider";

/** Cached BluPeak state. Never calls Plaid. Requires the local session. */
export async function GET(req: Request) {
  const denied = guard(req, { session: true });
  if (denied) return denied;
  const bank = getBank();
  if (!bank.service) return json({ provider: "none", missing: bank.missing });
  const vault = await bank.service.vaultStatus();
  return json({ provider: bank.kind, env: bank.env, state: publicBankState(bank.env!, Date.now(), vault, cooldownMs()) });
}
