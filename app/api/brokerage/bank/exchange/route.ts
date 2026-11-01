import { guard, json } from "@/lib/server/guard";
import { publicBankState } from "@/lib/server/bankStore";
import { getBank } from "@/lib/server/bankProvider";
import { cooldownMs } from "@/lib/server/provider";
import { PlaidServiceError } from "@/lib/server/plaidService";
import { logPlaidFailure } from "@/lib/server/plaidLog";


/** Exchanges the public token on the server. The institution is verified there; browser metadata is never sent or trusted. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const bank = getBank();
  if (!bank.service) return json({ error: "bank_not_configured" }, 503);
  let token: unknown;
  try {
    token = ((await req.json()) as { publicToken?: unknown } | null)?.publicToken;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  try {
    await bank.service.complete(token);
    return json({ ok: true, state: publicBankState(bank.env!, Date.now(), await bank.service.vaultStatus(), cooldownMs()) });
  } catch (e) {
    logPlaidFailure("exchange", e);
    const code = e instanceof PlaidServiceError ? e.code : "unknown";
    return json({ error: code }, code === "bad_request" ? 400 : code === "already_linked" ? 409 : 502);
  }
}
