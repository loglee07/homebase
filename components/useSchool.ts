"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCHOOL_IDS, type SchoolId, type SchoolState } from "@/lib/school";
import { apiCall } from "./apiCall";

export interface SchoolClient {
  /** Cached calendars from the server (never the feed links). Empty until unlocked. */
  states: SchoolState[];
  fixtures: boolean;
  loaded: boolean;
  busy: Partial<Record<SchoolId, boolean>>;
  message: string | null;
  refresh: (school: SchoolId) => Promise<void>;
  refreshAll: () => Promise<void>;
}

const call = (path: string, method: "GET" | "POST", body?: unknown) => apiCall(`brokerage/school/${path}`, method, body);

/**
 * Talks only to this app's own loopback API. Calendars are held in React state, never in localStorage or the console.
 * Opening the school reads the server's cached copy; only a refresh (or the first open with nothing cached) fetches a feed.
 */
export function useSchool(unlocked: boolean): SchoolClient {
  const [states, setStates] = useState<SchoolState[]>([]);
  const [fixtures, setFixtures] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<SchoolId, boolean>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const merge = useCallback((next: SchoolState) => setStates((cur) => SCHOOL_IDS.map((id) => (next.school === id ? next : (cur.find((s) => s.school === id) ?? next)))), []);

  const refresh = useCallback(
    async (school: SchoolId) => {
      setBusy((b) => ({ ...b, [school]: true }));
      setMessage(null);
      try {
        const r = await call("refresh", "POST", { school });
        if (!alive.current) return;
        if (r.status === 200) merge((r.data as { state: SchoolState }).state);
        else if (r.status === 401) setMessage("The local session expired. Lock and unlock again, then retry.");
        else setMessage("That did not work. Nothing was changed.");
      } catch {
        if (alive.current) setMessage("Could not reach the local server.");
      } finally {
        if (alive.current) setBusy((b) => ({ ...b, [school]: false }));
      }
    },
    [merge],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all(SCHOOL_IDS.map((s) => refresh(s))); // each school has its own cooldown and failure
  }, [refresh]);

  useEffect(() => {
    if (!unlocked) {
      const t = setTimeout(() => {
        setStates([]);
        setLoaded(false);
      }, 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await call("state", "GET");
        if (cancelled || !alive.current) return;
        if (r.status === 401) return void setMessage("The local session expired. Lock and unlock again, then retry.");
        if (r.status !== 200) return;
        const d = r.data as { fixtures: boolean; schools: SchoolState[] };
        setStates(d.schools);
        setFixtures(d.fixtures);
        setLoaded(true);
        // First open with nothing cached: load each configured school once. After that only the Refresh buttons fetch.
        for (const s of d.schools) if (s.configured && s.lastAttemptAt === null) void refresh(s.school);
      } catch {
        if (alive.current) setMessage("Could not reach the local server.");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [unlocked, refresh]);

  return { states, fixtures, loaded, busy, message, refresh, refreshAll };
}
