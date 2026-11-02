import { describe, expect, it } from "vitest";
import { ACTIVITY_THROTTLE_MS, createActivityReporter, endedMessage, nextCheckDelayMs, throttleFor, type Timers } from "@/lib/sessionClock";

/** A controlled clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  let id = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    now: () => now,
    setTimer: (fn, ms) => {
      pending.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (i) => void pending.delete(i as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= end);
      if (!next) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { timers, advance, pending: () => pending.size };
}

describe("activity reporter", () => {
  it("reports the first interaction at once and folds a burst into one trailing report", () => {
    const c = fakeClock();
    const sent: number[] = [];
    const r = createActivityReporter(() => sent.push(c.timers.now()), c.timers);
    r.note();
    expect(sent).toEqual([0]);
    for (let i = 0; i < 500; i++) {
      c.advance(100); // 50 seconds of constant typing
      r.note();
    }
    c.advance(ACTIVITY_THROTTLE_MS);
    expect(sent.length).toBeLessThanOrEqual(1 + Math.ceil(50_000 / ACTIVITY_THROTTLE_MS) + 1);
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(ACTIVITY_THROTTLE_MS);
  });
  it("sends nothing without interaction, however long the tab stays open", () => {
    const c = fakeClock();
    const sent: number[] = [];
    createActivityReporter(() => sent.push(1), c.timers);
    c.advance(10 * 60 * 60 * 1000);
    expect(sent).toEqual([]);
    expect(c.pending()).toBe(0);
  });
  it("a later interaction after a quiet spell is reported straight away", () => {
    const c = fakeClock();
    const sent: number[] = [];
    const r = createActivityReporter(() => sent.push(c.timers.now()), c.timers);
    r.note();
    c.advance(5 * 60_000);
    r.note();
    expect(sent).toEqual([0, 5 * 60_000]);
  });
  it("dispose cancels a pending report (for example when the app locks)", () => {
    const c = fakeClock();
    const sent: number[] = [];
    const r = createActivityReporter(() => sent.push(1), c.timers);
    r.note();
    r.note();
    r.dispose();
    c.advance(ACTIVITY_THROTTLE_MS * 2);
    expect(sent).toEqual([1]);
  });
});

describe("deadline timer and messages", () => {
  it("asks again just after the earlier limit", () => {
    expect(nextCheckDelayMs({ idleMsLeft: 30 * 60_000, absoluteMsLeft: 8 * 3600_000 })).toBe(30 * 60_000 + 750);
    expect(nextCheckDelayMs({ idleMsLeft: 30 * 60_000, absoluteMsLeft: 5_000 })).toBe(5_750);
    expect(nextCheckDelayMs({ idleMsLeft: -5, absoluteMsLeft: 100 })).toBe(750);
    expect(nextCheckDelayMs({})).toBeNull();
    expect(nextCheckDelayMs({ idleMsLeft: 1e15, absoluteMsLeft: 1e15 })).toBeLessThanOrEqual(2 ** 31 - 1);
  });
  it("throttles to a minute for the real 30 minute window and tighter for a short test window", () => {
    expect(throttleFor(30 * 60_000)).toBe(60_000);
    expect(throttleFor(12_000)).toBe(2_000);
    expect(throttleFor(100)).toBe(1_000);
  });
  it("says why the session ended", () => {
    expect(endedMessage("idle")).toMatch(/30 minutes/);
    expect(endedMessage("absolute")).toMatch(/8 hour/);
    expect(endedMessage("unknown")).toMatch(/restarted/);
    expect(endedMessage(undefined)).toMatch(/restarted/);
  });
});
