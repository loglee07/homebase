"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrokerageState } from "@/lib/brokerage";
import { apiCall } from "./apiCall";

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
      const d = r.data as { provider: ProviderKind; access: Access };
      setProvider(d.provider);
      setAccess(d.access);
      if (d.access === "unlocked" && d.provider !== "none") await loadCached();
    } catch {
      if (alive.current) {
        setProvider("none");
        setAccess("not_configured");
      }
    }
  }, [loadCached]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void check(), 0);
    return () => clearTimeout(t);
  }, [active, check]);

  const unlock = useCallback(
    async (code: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const r = await call("session", "POST", { code });
        if (!alive.current) return false;
        if (r.status === 200) {
          setAccess("unlocked");
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
    setAccess("locked");
    setState(null);
    setMessage(null);
  }, []);

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
