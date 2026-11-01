// Local access session for live brokerage data. In-memory only: restarting the server signs everyone out.
// Pure Node (no Next imports) so it can be tested directly.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ft_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MIN_ACCESS_CODE_LENGTH = 12;
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

interface Store {
  sessions: Map<string, number>; // sha256(token) -> expiry (ms)
  failures: number[]; // timestamps (ms)
}
const g = globalThis as unknown as { __ftSessions?: Store };
const store = (): Store => (g.__ftSessions ??= { sessions: new Map(), failures: [] });

const sha = (s: string) => createHash("sha256").update(s).digest();
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** The configured access code, or null when missing or too short (fails closed). */
export function accessCode(env: NodeJS.ProcessEnv = process.env): string | null {
  const code = env.FINANCE_TOWN_ACCESS_CODE;
  return code && code.length >= MIN_ACCESS_CODE_LENGTH ? code : null;
}

export function resetSessionsForTest() {
  g.__ftSessions = undefined;
}

export type LoginResult =
  | { ok: true; token: string; maxAgeSeconds: number }
  | { ok: false; reason: "not_configured" | "locked" | "wrong_code"; retryAfterSeconds?: number };

export function login(candidate: unknown, now = Date.now(), env: NodeJS.ProcessEnv = process.env): LoginResult {
  const code = accessCode(env);
  if (!code) return { ok: false, reason: "not_configured" };
  const s = store();
  s.failures = s.failures.filter((t) => now - t < LOCKOUT_MS);
  if (s.failures.length >= MAX_FAILURES) {
    const retry = Math.ceil((s.failures[0] + LOCKOUT_MS - now) / 1000);
    return { ok: false, reason: "locked", retryAfterSeconds: Math.max(retry, 1) };
  }
  const given = typeof candidate === "string" ? candidate : "";
  if (!timingSafeEqual(sha(given), sha(code))) {
    s.failures.push(now);
    return { ok: false, reason: "wrong_code" };
  }
  s.failures = [];
  const token = randomBytes(32).toString("base64url");
  s.sessions.set(sha256hex(token), now + SESSION_TTL_MS);
  return { ok: true, token, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function validSession(token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  const s = store();
  const key = sha256hex(token);
  const expiry = s.sessions.get(key);
  if (expiry === undefined) return false;
  if (expiry <= now) {
    s.sessions.delete(key);
    return false;
  }
  return true;
}

export function logout(token: string | null) {
  if (token) store().sessions.delete(sha256hex(token));
}

/** Set-Cookie value. HttpOnly + SameSite=Strict, scoped to the brokerage API; Secure whenever the request was HTTPS. */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/api/brokerage",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
export const clearedCookie = (secure: boolean) => sessionCookie("", 0, secure);
