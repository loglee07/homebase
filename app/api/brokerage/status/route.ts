import { guard, json } from "@/lib/server/guard";
import { accessCode, checkSession, readCookie, SESSION_COOKIE } from "@/lib/server/session";
import { getProvider } from "@/lib/server/provider";

/**
 * Reveals only whether live data is set up and whether this browser is unlocked, plus how long the session has left.
 * Read-only: asking never extends either session limit. Never any financial data.
 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { kind } = getProvider();
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const check = checkSession(token);
  const configured = !!accessCode();
  return json({
    provider: kind,
    access: !configured ? "not_configured" : check.valid ? "unlocked" : "locked",
    // Only when this browser holds a cookie the server no longer accepts: why it ended.
    ended: configured && !check.valid && check.reason !== "none" ? check.reason : undefined,
    idleMsLeft: check.valid ? check.idleMsLeft : undefined,
    absoluteMsLeft: check.valid ? check.absoluteMsLeft : undefined,
  });
}
