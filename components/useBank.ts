"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BankActivityState } from "@/lib/bankActivity";
import { BANK_ERROR_TEXT, type BankErrorCode, type BankState, type PlaidEnvironment } from "@/lib/plaid";
import { apiCall } from "./apiCall";

export type BankProviderKind = "none" | "plaid" | "fixtures";
export interface BankInfo {
  provider: BankProviderKind;
  env: PlaidEnvironment | null;
  /** Names of settings still missing, when provider is "none". */
  missing: string[];
}
export interface LinkLaunch {
  token: string;
  mode: "new" | "update";
  fixture: boolean;
}

export interface BankClient {
  info: BankInfo | null;
  state: BankState | null;
  busy: boolean;
  message: string | null;
  /** Set while Plaid Link (or the synthetic stand-in) is open. */
  launch: LinkLaunch | null;
  connect: (reconnect: boolean) => Promise<void>;
  onLinkSuccess: (publicToken: string) => Promise<void>;
  onLinkExit: () => void;
  refresh: () => Promise<void>;
  /** Saved transaction history (read-only). Never part of balances or net worth. Null until loaded, and after a lock. */
  activity: BankActivityState | null;
  activityBusy: boolean;
  activityMessage: string | null;
  syncActivity: () => Promise<void>;
}

const ERRORS: Record<string, string> = {
  already_linked: "BluPeak is already connected. Use Reconnect instead of linking again.",
  not_linked: "BluPeak is not connected yet.",
  vault_unreadable: "The saved connection could not be read, so nothing was changed.",
  environment_mismatch: "The saved connection belongs to a different Plaid environment, so nothing was changed.",
  institution_mismatch: "That was not BluPeak. The connection was removed and nothing was saved.",
  institution_unverified: "Could not confirm BluPeak with Plaid, so nothing was started.",
  vault_write_failed: "Could not save the connection on this computer. It was removed from Plaid.",
  bank_not_configured: "BluPeak is not set up on the server.",
  unauthorized: "The local session expired (the server restarted). Lock and unlock again, then retry.",
  auth_failed: "Plaid rejected the credentials. Check that the secret in .env.local belongs to the same environment as PLAID_ENV.",
  rate_limited: "Plaid is rate limiting requests. Try again soon.",
  network: "Could not reach Plaid.",
  timeout: "Plaid took too long to answer.",
};
const say = (d: unknown) => ERRORS[(d as { error?: string } | null)?.error ?? ""] ?? "That did not work. Nothing was saved.";

/** BluPeak (Plaid) state for the browser. Held in React state only; never written to localStorage or logged. Pass unlocked=false to drop it. */
export function useBank(unlocked: boolean): BankClient {
  const [info, setInfo] = useState<BankInfo | null>(null);
  const [raw, setRaw] = useState<BankState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LinkLaunch | null>(null);
  const [activityRaw, setActivityRaw] = useState<BankActivityState | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const launchMode = useRef<"new" | "update">("new");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiCall("brokerage/bank/state", "GET");
      if (!alive.current || r.status !== 200) return;
      const d = r.data as { provider: BankProviderKind; env?: BankInfo["env"]; missing?: string[]; state?: BankState };
      setInfo({ provider: d.provider, env: d.env ?? null, missing: d.missing ?? [] });
      setRaw(d.state ?? null);
      if (d.provider !== "none" && d.state?.vault === "linked") {
        const a = await apiCall("brokerage/bank/activity", "GET"); // saved history only: this never contacts Plaid
        if (alive.current && a.status === 200) setActivityRaw((a.data as { state: BankActivityState | null }).state);
      }
    } catch {
      // stays hidden; the panel shows its checking state
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [unlocked, load]);

  // Locking or expiry removes BluPeak data from memory, not just from view. Saved connections stay on the server.
  useEffect(() => {
    if (unlocked) return;
    const t = setTimeout(() => {
      setRaw(null);
      setMessage(null);
      setLaunch(null);
      setActivityRaw(null);
      setActivityMessage(null);
    }, 0);
    return () => clearTimeout(t);
  }, [unlocked]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiCall("brokerage/bank/refresh", "POST");
      if (!alive.current) return;
      const d = r.data as { state?: BankState } | null;
      if (d?.state) setRaw(d.state);
      if (r.status === 429) setMessage("Refreshed a moment ago. Wait for the cooldown.");
      else if (r.status !== 200) setMessage(say(r.data));
    } catch {
      if (alive.current) setMessage("Could not reach the local server.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const syncActivity = useCallback(async () => {
    setActivityBusy(true);
    setActivityMessage(null);
    try {
      const r = await apiCall("brokerage/bank/activity/sync", "POST");
      if (!alive.current) return;
      const d = r.data as { outcome?: string; state?: BankActivityState | null } | null;
      if (d?.state) setActivityRaw(d.state);
      if (r.status === 429) setActivityMessage("Synced a moment ago. Wait for the cooldown.");
      else if (r.status !== 200) setActivityMessage(say(r.data));
      else if (d?.outcome === "failed" && d.state?.lastError) setActivityMessage(`${BANK_ERROR_TEXT[d.state.lastError]} The saved history was kept.`);
    } catch {
      if (alive.current) setActivityMessage("Could not reach the local server.");
    } finally {
      if (alive.current) setActivityBusy(false);
    }
  }, []);

  const connect = useCallback(async (reconnect: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiCall("brokerage/bank/link-token", "POST", { reconnect });
      if (!alive.current) return;
      if (r.status !== 200) return void setMessage(say(r.data));
      const d = r.data as { linkToken: string; mode: "new" | "update"; fixture: boolean };
      launchMode.current = d.mode;
      setLaunch({ token: d.linkToken, mode: d.mode, fixture: d.fixture });
    } catch {
      if (alive.current) setMessage("Could not reach the local server.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const onLinkSuccess = useCallback(
    async (publicToken: string) => {
      setLaunch(null);
      setBusy(true);
      setMessage(null);
      try {
        // Only the public token goes to the server. Browser-side institution metadata is deliberately ignored.
        const r = launchMode.current === "update" ? await apiCall("brokerage/bank/reconnected", "POST") : await apiCall("brokerage/bank/exchange", "POST", { publicToken });
        if (!alive.current) return;
        if (r.status !== 200) return void setMessage(say(r.data));
        const d = r.data as { state?: BankState } | null;
        if (d?.state) setRaw(d.state);
        if (launchMode.current === "new") await refresh();
        else setMessage("Reconnected.");
      } catch {
        if (alive.current) setMessage("Could not reach the local server.");
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [refresh],
  );

  const onLinkExit = useCallback(() => {
    setLaunch(null);
    setMessage("Connection cancelled. Nothing was saved.");
  }, []);

  return { info, state: unlocked ? raw : null, busy, message, launch, connect, onLinkSuccess, onLinkExit, refresh, activity: unlocked ? activityRaw : null, activityBusy, activityMessage, syncActivity };
}

export type { BankErrorCode };
