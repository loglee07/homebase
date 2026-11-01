import { guard, json } from "@/lib/server/guard";
import { getBank } from "@/lib/server/bankProvider";
import { PlaidServiceError } from "@/lib/server/plaidService";
import { logPlaidFailure } from "@/lib/server/plaidLog";

/** Creates a Link token. reconnect=true only ever updates the stored Item; a second Item is refused. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const bank = getBank();
  if (!bank.service) return json({ error: "bank_not_configured" }, 503);
  let reconnect = false;
  try {
    reconnect = ((await req.json()) as { reconnect?: unknown } | null)?.reconnect === true;
  } catch {
    // an empty body means a new connection
  }
  try {
    const r = await bank.service.prepareLink(reconnect);
    return json({ linkToken: r.linkToken, mode: r.mode, fixture: bank.kind === "fixtures" });
  } catch (e) {
    logPlaidFailure("link-token", e);
    const code = e instanceof PlaidServiceError ? e.code : "unknown";
    return json({ error: code }, code === "already_linked" || code === "not_linked" ? 409 : 502);
  }
}
