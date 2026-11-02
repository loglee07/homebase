import { guard, json } from "@/lib/server/guard";
import { getBank } from "@/lib/server/bankProvider";

/** Saved BluPeak transaction history. Never calls Plaid. Requires the local session. */
export async function GET(req: Request) {
  const denied = guard(req, { session: true });
  if (denied) return denied;
  const { activity } = getBank();
  if (!activity) return json({ error: "bank_not_configured" }, 503);
  return json({ state: await activity.read() });
}
