// Request checks for every financial endpoint. Order: loopback host, same-origin, access code configured, session.
// Each failure returns a fixed small body; nothing about the data or the credentials leaks through an error.
import { SESSION_COOKIE, accessCode, readCookie, validSession } from "./session";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export const isLoopbackHost = (host: string | null): boolean => {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOOPBACK_HOSTS.has(name.toLowerCase());
};

export interface GuardOptions {
  /** POST/DELETE: require a matching Origin header. */
  mutating?: boolean;
  /** Require the access code to be configured and a valid session. */
  session?: boolean;
}

/** Returns an error Response, or null when the request may proceed. */
export function guard(req: Request, opts: GuardOptions = {}, env: NodeJS.ProcessEnv = process.env): Response | null {
  const host = req.headers.get("host");
  if (!isLoopbackHost(host)) return json({ error: "loopback_only" }, 403);

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return json({ error: "cross_site" }, 403);
  if (opts.mutating) {
    const origin = req.headers.get("origin");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== host) return json({ error: "cross_site" }, 403);
  }

  if (opts.session) {
    if (!accessCode(env)) return json({ error: "not_configured" }, 503);
    if (!validSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) return json({ error: "unauthorized" }, 401);
  }
  return null;
}

export const isSecureRequest = (req: Request): boolean => new URL(req.url).protocol === "https:";
export const sessionToken = (req: Request) => readCookie(req.headers.get("cookie"), SESSION_COOKIE);
