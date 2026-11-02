"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrokerageState } from "@/lib/brokerage";
import { SESSION_ENDED_EVENT, apiCall } from "./apiCall";
import { ACTIVITY_THROTTLE_MS, SLEEP_GAP_MS, TICK_MS, VERIFY_EVERY_MS, createActivityReporter, endedMessage, nextCheckDelayMs, throttleFor } from "@/lib/sessionClock";

/** Interactions that count as activity: walking and typing (keys), clicking and touching, scrolling. Never mere movement or timers. */
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "touchstart", "wheel", "scroll"] as const;
/** Tells other tabs of this browser about a lock or an unlock. A signal only: it carries no data and is never trusted as authentication. */
const CHANNEL = "finance-town-session";

export type Access = "checking" | "not_configured" | "locked" | "unlocked";
export type ProviderKind = "none" | "snaptrade" | "fixtures";

export interface BrokerageClient {
  provider: ProviderKind | null;
  access: Access;
  /** The last successful snapshot (kept in memory only), or null. */
  state: BrokerageState | null;
  busy: boolean;
  /** Plain-language result of the last action, or null. */
  message: string | null;
  unlock: (code: string) => Promise<boolean>;
  lock: () => Promise<void>;
  refresh: () => Promise<void>;
}

const call = (path: string, method: "GET" | "POST" | "DELETE", body?: unknown) => apiCall(`brokerage/${path}`, method, body);

/**
 * Talks only to this app's own loopback API. Financial data is held in React state, never written to
 * localStorage or the console. It never refreshes on its own: only the Refresh button contacts the provider.
 */
export function useBrokerage(active: boolean): BrokerageClient {
  const [provider, setProvider] = useState<ProviderKind | null>(null);
  const [access, setAccess] = useState<Access>("checking");
  const [state, setState] = useState<BrokerageState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The server is the only authority. Everything below only asks it; it never extends a limit except real interaction (activity).
  const channel = useRef<BroadcastChannel | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyRef = useRef<() => Promise<void>>(async () => {});

  /** Lock this page. `tell` also locks the page's other tabs at once. */
  const endSession = useCallback((text: string | null, tell = true) => {
    setAccess((a) => (a === "unlocked" ? "locked" : a));
    setState(null);
    setMessage(text);
    if (deadline.current) clearTimeout(deadline.current);
    if (tell) channel.current?.postMessage("locked");
  }, []);

  /** Ask again just after the earlier limit, as the server last reported it. */
  const idleWindow = useRef(Number.POSITIVE_INFINITY); // the longest idle time left the server has reported: the idle window
  const setDeadlines = useCallback((d: { idleMsLeft?: number; absoluteMsLeft?: number }) => {
    if (typeof d.idleMsLeft === "number") idleWindow.current = Math.max(Number.isFinite(idleWindow.current) ? idleWindow.current : 0, d.idleMsLeft);
    if (deadline.current) clearTimeout(deadline.current);
    const ms = nextCheckDelayMs(d);
    deadline.current = ms === null ? null : setTimeout(() => void verifyRef.current(), ms);
  }, []);

  const loadCached = useCallback(async () => {
    const r = await call("snapshot", "GET");
    if (!alive.current) return;
    if (r.status === 401) setAccess("locked");
    else if (r.status === 200) setState(r.data as BrokerageState);
  }, []);

  const check = useCallback(async () => {
    try {
      const r = await call("status", "GET");
      if (!alive.current || r.status !== 200) {
        if (alive.current) {
          setProvider("none");
          setAccess("not_configured");
        }
        return;
      }
      const d = r.data as { provider: ProviderKind; access: Access; ended?: string; idleMsLeft?: number; absoluteMsLeft?: number };
      setProvider(d.provider);
      setAccess(d.access);
      if (d.access === "unlocked") setDeadlines(d);
      else if (d.access === "locked" && d.ended) setMessage(endedMessage(d.ended));
      if (d.access === "unlocked" && d.provider !== "none") await loadCached();
    } catch {
      if (alive.current) {
        setProvider("none");
        setAccess("not_configured");
      }
    }
  }, [loadCached, setDeadlines]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void check(), 0);
    return () => clearTimeout(t);
  }, [active, check]);

  useEffect(() => {
    verifyRef.current = async () => {
      try {
        const r = await call("status", "GET");
        if (!alive.current || r.status !== 200) return;
        const d = r.data as { access?: Access; ended?: string; idleMsLeft?: number; absoluteMsLeft?: number };
        if (d.access === "unlocked") setDeadlines(d);
        else endSession(endedMessage(d.ended));
      } catch {
        // offline: the next call decides
      }
    };
  }, [endSession, setDeadlines]);

  useEffect(() => {
    const onEnded = (e: Event) => endSession(endedMessage((e as CustomEvent<string | undefined>).detail));
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, [endSession]);

  // Other tabs: a lock signal locks this page now; an unlock signal makes it ask the server (never trusted by itself).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (e) => {
      if (e.data === "locked") endSession("Locked from another tab of this browser.", false);
      else if (e.data === "unlocked") void check();
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [endSession, check]);

  // While unlocked: re-verify on a timer, on return to the tab, after sleep, and exactly at the reported deadline.
  useEffect(() => {
    if (access !== "unlocked") return;
    const verify = () => void verifyRef.current();
    const poll = setInterval(verify, VERIFY_EVERY_MS);
    let lastTick = Date.now();
    const tick = setInterval(() => {
      const t = Date.now();
      if (t - lastTick > SLEEP_GAP_MS) verify(); // the computer slept
      lastTick = t;
    }, TICK_MS);
    const onVisible = () => document.visibilityState === "visible" && verify();
    const onShow = (e: PageTransitionEvent) => e.persisted && verify();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", verify);
    window.addEventListener("pageshow", onShow);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", verify);
      window.removeEventListener("pageshow", onShow);
    };
  }, [access]);

  // Real interaction anywhere in the app is reported (throttled). Nothing else is: not polling, fetches, reloads or an idle open tab.
  useEffect(() => {
    if (access !== "unlocked") return;
    const reporter = createActivityReporter(
      () =>
        void call("activity", "POST").then((r) => {
          if (!alive.current) return;
          if (r.status === 200) setDeadlines(r.data as { idleMsLeft: number; absoluteMsLeft: number });
          else if (r.status === 401) endSession(endedMessage((r.data as { reason?: string } | null)?.reason));
        }),
      { now: Date.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
      () => (Number.isFinite(idleWindow.current) ? throttleFor(idleWindow.current) : ACTIVITY_THROTTLE_MS),
    );
    const note = () => reporter.note();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, note, { capture: true, passive: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, note, { capture: true });
      reporter.dispose();
    };
  }, [access, endSession, setDeadlines]);

  const unlock = useCallback(
    async (code: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await call("session", "POST", { code });
        if (!alive.current) return false;
        if (r.status === 200) {
          setAccess("unlocked");
          channel.current?.postMessage("unlocked");
          void verifyRef.current(); // learn the real deadlines from the server
          await loadCached();
          return true;
        }
        const d = r.data as { error?: string; retryAfterSeconds?: number } | null;
        setMessage(
          d?.error === "locked"
            ? `Too many wrong codes. Try again in ${Math.ceil((d.retryAfterSeconds ?? 900) / 60)} minutes.`
            : d?.error === "not_configured"
              ? "No access code is set on the server."
              : "That access code was not accepted.",
        );
        return false;
      } catch {
        if (alive.current) setMessage("Could not reach the local server.");
        return false;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [loadCached],
  );

  const lock = useCallback(async () => {
    try {
      await call("session", "DELETE");
    } catch {
      // the cookie may stay; the server session still expires on its own
    }
    if (!alive.current) return;
    endSession(null); // clears this page and locks the other tabs too
  }, [endSession]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await call("refresh", "POST");
      if (!alive.current) return;
      if (r.status === 401) {
        setAccess("locked");
        setState(null);
        return;
      }
      const d = r.data as { outcome?: string; state?: BrokerageState } | null;
      if (d?.state) setState(d.state);
      if (r.status === 429) setMessage("Refreshed a moment ago. Wait for the cooldown.");
      else if (r.status !== 200) setMessage("Could not refresh.");
    } catch {
      if (alive.current) setMessage("Could not reach the local server.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  return { provider, access, state, busy, message, unlock, lock, refresh };
}
