import { guard, json } from "@/lib/server/guard";
import { publicState } from "@/lib/server/brokerageStore";
import { cooldownMs, getProvider } from "@/lib/server/provider";

/** The cached snapshot only. This never calls the provider. */
export async function GET(req: Request) {
  const denied = guard(req, { session: true });
  if (denied) return denied;
  if (!getProvider().provider) return json({ error: "brokerage_not_configured" }, 503);
  return json(publicState(Date.now(), cooldownMs()));
}
