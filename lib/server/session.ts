// Local access session for live brokerage data. In-memory only: restarting the server signs everyone out.
// Pure Node (no Next imports) so it can be tested directly.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ft_session";
/** Hard limit from sign-in. Nothing extends it: not activity, not polling, not reloads. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** Signs out after this long without a reported interaction (see touchSession). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** The idle limit. Only the synthetic fixture server (never production) may shorten it, so browser tests need not wait 30 minutes. */
function idleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.FINANCE_TOWN_IDLE_TIMEOUT_MS);
  return env.FINANCE_TOWN_BROKERAGE_FIXTURES === "1" && env.NODE_ENV !== "production" && Number.isFinite(raw) && raw >= 3000 ? raw : IDLE_TIMEOUT_MS;
}
export const MIN_ACCESS_CODE_LENGTH = 12;
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

interface Session {
  expiresAt: number; // absolute limit (ms), fixed at sign-in
  lastActivity: number; // last reported interaction (ms), recorded on the server
}
export type EndedReason = "idle" | "absolute";
interface Store {
  sessions: Map<string, Session>; // sha256(token) -> session
  ended: Map<string, EndedReason>; // why recently expired sessions ended (hashes only), so the page can say so
  failures: number[]; // timestamps (ms)
}
const g = globalThis as unknown as { __ftSessions?: Store };
const store = (): Store => (g.__ftSessions ??= { sessions: new Map(), ended: new Map(), failures: [] });

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
  s.sessions.set(sha256hex(token), { expiresAt: now + SESSION_TTL_MS, lastActivity: now });
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

export type SessionCheck =
  | { valid: true; idleMsLeft: number; absoluteMsLeft: number }
  /** "unknown": no such session (never existed, signed out, or the server restarted). */
  | { valid: false; reason: "none" | "unknown" | EndedReason };

/**
 * Read-only: whichever limit comes first ends the session, and an ended session is forgotten so it cannot come back.
 * Calling this (status checks, protected routes, reloads) never moves either deadline.
 */
export function checkSession(token: string | null, now = Date.now()): SessionCheck {
  if (!token) return { valid: false, reason: "none" };
  const s = store();
  const key = sha256hex(token);
  const sess = s.sessions.get(key);
  if (!sess) return { valid: false, reason: s.ended.get(key) ?? "unknown" };
  const reason: EndedReason | null = sess.expiresAt <= now ? "absolute" : sess.lastActivity + idleLimit() <= now ? "idle" : null;
  if (reason) {
    s.sessions.delete(key);
    s.ended.set(key, reason);
    if (s.ended.size > 50) s.ended.delete(s.ended.keys().next().value as string);
    return { valid: false, reason };
  }
  return { valid: true, idleMsLeft: sess.lastActivity + idleLimit() - now, absoluteMsLeft: sess.expiresAt - now };
}

export const validSession = (token: string | null, now = Date.now()): boolean => checkSession(token, now).valid;

/**
 * The only thing besides sign-in that moves the idle deadline: a reported user interaction. It never touches the absolute
 * limit, and an ended session is refused (it needs the code again).
 */
export function touchSession(token: string | null, now = Date.now()): SessionCheck {
  const c = checkSession(token, now);
  if (!c.valid || !token) return c;
  const sess = store().sessions.get(sha256hex(token))!;
  sess.lastActivity = now;
  return { valid: true, idleMsLeft: idleLimit(), absoluteMsLeft: sess.expiresAt - now };
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
