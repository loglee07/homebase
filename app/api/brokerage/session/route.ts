import { guard, isSecureRequest, json, sessionToken } from "@/lib/server/guard";
import { clearedCookie, login, logout, sessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  const denied = guard(req, { mutating: true });
  if (denied) return denied;
  let code: unknown;
  try {
    code = ((await req.json()) as { code?: unknown } | null)?.code;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const result = login(code);
  if (!result.ok) {
    const status = result.reason === "not_configured" ? 503 : result.reason === "locked" ? 429 : 401;
    return json({ error: result.reason, retryAfterSeconds: result.retryAfterSeconds }, status);
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(result.token, result.maxAgeSeconds, isSecureRequest(req)) });
}

export async function DELETE(req: Request) {
  const denied = guard(req, { mutating: true });
  if (denied) return denied;
  logout(sessionToken(req));
  return json({ ok: true }, 200, { "Set-Cookie": clearedCookie(isSecureRequest(req)) });
}
