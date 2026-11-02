import { guard, json, sessionToken } from "@/lib/server/guard";
import { touchSession } from "@/lib/server/session";

/**
 * The page reports a real interaction here (throttled). This is the only route that moves the 30 minute idle deadline;
 * it never extends the 8 hour limit, and an ended session gets 401 and must sign in again.
 */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  const r = touchSession(sessionToken(req));
  if (!r.valid) return json({ error: "unauthorized", reason: r.reason }, 401);
  return json({ ok: true, idleMsLeft: r.idleMsLeft, absoluteMsLeft: r.absoluteMsLeft });
}
