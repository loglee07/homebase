import { guard, json } from "@/lib/server/guard";
import { accessCode, readCookie, SESSION_COOKIE, validSession } from "@/lib/server/session";
import { getProvider } from "@/lib/server/provider";

/** Reveals only whether live data is set up and whether this browser is unlocked. Never any financial data. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const { kind } = getProvider();
  const unlocked = validSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  return json({
    provider: kind,
    access: !accessCode() ? "not_configured" : unlocked ? "unlocked" : "locked",
  });
}
