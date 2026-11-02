// Browser-side helpers for the session timers. Pure and injectable so tests use controlled clocks, never real waiting.
// The server is the only authority for the session; these only decide when to report activity and when to ask again.
import type { EndedReason } from "./server/session";

/** A reported interaction goes to the server at most this often. The idle limit is 30 minutes, so a minute is plenty fine. */
export const ACTIVITY_THROTTLE_MS = 60_000;
/** While unlocked, ask the server whether the session still stands this often (it never extends anything). */
export const VERIFY_EVERY_MS = 60_000;
/** A gap this long between two ticks of a short timer means the computer slept: ask the server right away. */
export const SLEEP_GAP_MS = 3 * 15_000;
export const TICK_MS = 15_000;
/** Ask a little after a deadline so the server has certainly ended the session by then. */
const GRACE_MS = 750;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface Timers {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
}

/**
 * Leading + trailing throttle. The first interaction is reported at once; further ones inside the window are folded into
 * one report when the window ends. Nothing is sent without an interaction, so a tab left open reports nothing.
 */
export function createActivityReporter(send: () => void, t: Timers, throttleMs: number | (() => number) = ACTIVITY_THROTTLE_MS) {
  let lastSent = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  const fire = () => {
    timer = null;
    lastSent = t.now();
    send();
  };
  return {
    note() {
      if (timer !== null) return; // a trailing report is already scheduled
      const wait = lastSent + (typeof throttleMs === "function" ? throttleMs() : throttleMs) - t.now();
      if (wait <= 0) fire();
      else timer = t.setTimer(fire, wait);
    },
    dispose() {
      if (timer !== null) t.clearTimer(timer);
      timer = null;
    },
  };
}

/** Never wait longer than a sixth of the idle window between reports (30 minutes gives the full minute; a short test window shrinks it). */
export const throttleFor = (idleWindowMs: number): number => Math.min(ACTIVITY_THROTTLE_MS, Math.max(1000, Math.floor(idleWindowMs / 6)));

/** When to ask the server again: just after the earlier of the two limits, as the server last reported them. */
export const nextCheckDelayMs = (s: { idleMsLeft?: number; absoluteMsLeft?: number }): number | null => {
  if (typeof s.idleMsLeft !== "number" || typeof s.absoluteMsLeft !== "number") return null;
  return Math.min(MAX_TIMER_MS, Math.max(0, Math.min(s.idleMsLeft, s.absoluteMsLeft)) + GRACE_MS);
};

/** What to tell the person when the server no longer accepts their session. */
export function endedMessage(reason: unknown): string {
  const r = reason as EndedReason | "unknown" | undefined;
  if (r === "idle") return "Locked after 30 minutes without activity. Enter your code to continue.";
  if (r === "absolute") return "The 8 hour session limit was reached. Enter your code to continue.";
  return "The local session is gone (the server restarted, it ended, or you locked in another tab). Enter your code to continue.";
}
