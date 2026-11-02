import { guard, json } from "@/lib/server/guard";
import { getBank } from "@/lib/server/bankProvider";

/** The only route that reads transactions from Plaid, with a server-enforced cooldown. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const { activity } = getBank();
  if (!activity) return json({ error: "bank_not_configured" }, 503);
  const { outcome, state } = await activity.sync();
  return json({ outcome, state }, outcome === "cooldown" ? 429 : 200);
}
