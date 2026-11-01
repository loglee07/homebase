// The last good calendar for each school lives in server memory only. Each school refreshes on its own: a failure keeps
// that school's previous events (marked stale) and never touches the other school. The cooldown counts from the last attempt.
import { SCHOOL_COOLDOWN_DEFAULT, type SchoolErrorCode, type SchoolEvent, type SchoolId, type SchoolState, SCHOOL_IDS, SCHOOL_STALE_AFTER_MS } from "../school";

export interface SchoolLoader {
  configured: boolean;
  load(): Promise<SchoolEvent[]>;
}

const KNOWN: SchoolErrorCode[] = [
  "not_configured", "feed_host_rejected", "redirect_rejected", "auth_failed", "not_found", "rate_limited", "too_large", "not_a_calendar", "timeout", "network", "unknown",
];
const asError = (code: unknown): SchoolErrorCode => (KNOWN.includes(code as SchoolErrorCode) ? (code as SchoolErrorCode) : "unknown");

interface Internal {
  events: SchoolEvent[] | null;
  updatedAt: number | null;
  lastError: SchoolErrorCode | null;
  lastAttemptAt: number | null;
  inFlight: Promise<void> | null;
}
const g = globalThis as unknown as { __ftSchool?: Partial<Record<SchoolId, Internal>> };
const slot = (s: SchoolId): Internal => ((g.__ftSchool ??= {})[s] ??= { events: null, updatedAt: null, lastError: null, lastAttemptAt: null, inFlight: null });
export const resetSchoolForTest = () => {
  g.__ftSchool = undefined;
};

export function publicSchoolState(school: SchoolId, configured: boolean, now: number, cooldownMs = SCHOOL_COOLDOWN_DEFAULT): SchoolState {
  const s = slot(school);
  const age = s.updatedAt !== null ? now - s.updatedAt : 0;
  return {
    school,
    configured,
    events: s.events ?? [],
    updatedAt: s.updatedAt !== null ? new Date(s.updatedAt).toISOString() : null,
    stale: s.events !== null && (s.lastError !== null || age > SCHOOL_STALE_AFTER_MS),
    lastError: s.lastError,
    lastAttemptAt: s.lastAttemptAt !== null ? new Date(s.lastAttemptAt).toISOString() : null,
    cooldownUntil: s.lastAttemptAt !== null && now - s.lastAttemptAt < cooldownMs ? new Date(s.lastAttemptAt + cooldownMs).toISOString() : null,
  };
}
export const allSchoolStates = (loaders: Record<SchoolId, SchoolLoader>, now: number, cooldownMs?: number): SchoolState[] =>
  SCHOOL_IDS.map((id) => publicSchoolState(id, loaders[id].configured, now, cooldownMs));

export type SchoolRefreshOutcome = "refreshed" | "failed" | "cooldown" | "not_configured";

export async function refreshSchool(
  school: SchoolId,
  loader: SchoolLoader,
  now: () => number = Date.now,
  cooldownMs = SCHOOL_COOLDOWN_DEFAULT,
): Promise<{ outcome: SchoolRefreshOutcome; state: SchoolState }> {
  const s = slot(school);
  const done = (outcome: SchoolRefreshOutcome) => ({ outcome, state: publicSchoolState(school, loader.configured, now(), cooldownMs) });
  if (!loader.configured) return done("not_configured");
  if (s.inFlight) {
    await s.inFlight;
    return done(s.lastError ? "failed" : "refreshed");
  }
  if (s.lastAttemptAt !== null && now() - s.lastAttemptAt < cooldownMs) return done("cooldown");
  s.lastAttemptAt = now();
  s.inFlight = (async () => {
    try {
      s.events = await loader.load();
      s.updatedAt = now();
      s.lastError = null;
    } catch (e) {
      s.lastError = asError((e as { code?: unknown } | null)?.code);
      console.error(`[school] ${school} refresh failed: code=${s.lastError}`); // the code only: never the feed link or the response
    }
  })();
  try {
    await s.inFlight;
  } finally {
    s.inFlight = null;
  }
  return done(s.lastError ? "failed" : "refreshed");
}
