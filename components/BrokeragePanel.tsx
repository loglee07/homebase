"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ERROR_TEXT,
  STATUS_TEXT,
  possibleDuplicates,
  type BrokerageAccount,
  type BrokeragePrefs,
} from "@/lib/brokerage";
import type { Account } from "@/lib/finance";
import { createLocalStore } from "@/lib/localStore";
import { formatCents } from "@/lib/money";
import type { BankClient } from "./useBank";
import type { AssetKind } from "@/lib/brokerage";
import { CategoryPicker } from "./CategoryPicker";
import type { BrokerageClient } from "./useBrokerage";

export interface BrokerageControls {
  client: BrokerageClient;
  bank: BankClient;
  prefs: BrokeragePrefs;
  /** Included accounts exist but no snapshot is loaded yet, so net worth is missing them. */
  pending: boolean;
  onToggleInclude: (brokerageId: string) => void;
  onToggleManualExcluded: (manualId: string) => void;
  /** Display category for a connected account. null goes back to the provider default. */
  onSetCategory: (accountId: string, kind: AssetKind | null) => void;
}

// Per-viewer convenience only: whether the panel is minimized. Holds no financial data.
const collapsedStore = createLocalStore("finance-town:brokerage-collapsed:v1");

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface Props {
  controls: BrokerageControls;
  /** Manual accounts (with their excluded flags), used to warn about duplicates. */
  manual: Account[];
}

/** The local access-code form. Shared by the brokerage and BluPeak panels (one session unlocks both). */
export function UnlockForm({ client, purpose = "load connected balances" }: { client: BrokerageClient; purpose?: string }) {
  const [code, setCode] = useState("");
  const { busy, message } = client;
  return (
    <form
      className="bk-unlock"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await client.unlock(code)) setCode("");
      }}
    >
      <p>Enter your local access code to {purpose}. It is checked by this computer&apos;s server and never stored in the page.</p>
      <label className="bk-field">
        <span>Access code</span>
        <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
      </label>
      <div className="bk-actions">
        <button className="ft-btn ft-btn-save" type="submit" disabled={busy || code.length === 0}>Unlock</button>
      </div>
      {message && <p className="bk-error" role="alert">{message}</p>}
    </form>
  );
}

export function BrokeragePanel({ controls, manual }: Props) {
  const { client, prefs, onToggleInclude, onToggleManualExcluded, onSetCategory } = controls;
  const { access, provider, state, busy, message } = client;
  const [now, setNow] = useState(() => Date.now());

  const cooldownUntil = state?.cooldownUntil ? Date.parse(state.cooldownUntil) : 0;
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const wait = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.getSnapshot, collapsedStore.getServerSnapshot) === "1";
  const head = (
    <h3 className="bk-fold">
      <button className="bk-fold-btn" title={collapsed ? "Expand" : "Minimize"} aria-expanded={!collapsed} onClick={() => collapsedStore.write(collapsed ? "0" : "1")}>
        <span aria-hidden>{collapsed ? "▸" : "▾"}</span> <span aria-hidden>🏦</span> Connected brokerages
      </button>
    </h3>
  );
  if (collapsed) {
    const includedCount = state?.snapshot ? state.snapshot.accounts.filter((a) => a.status === "ok" && prefs.included.includes(a.id)).length : prefs.included.length;
    const summary =
      access === "locked" ? "Locked." : access !== "unlocked" ? "Not set up." : !state?.snapshot ? "No balances loaded." : `Fetched ${fmtDateTime(state.snapshot.fetchedAt)}${state.stale ? " (stale)" : ""}.`;
    return (
      <article className="ft-card bk-notice">
        {head}
        <p className="bk-note">{summary} {includedCount} included in net worth.</p>
      </article>
    );
  }

  if (access === "checking" || provider === null) {
    return <article className="ft-card bk-notice">{head}<p className="bk-note">Checking…</p></article>;
  }
  if (provider === "none") {
    return (
      <article className="ft-card bk-notice">
        {head}
        <p>
          Brokerage balances are off. They are read-only and need a SnapTrade Personal key in <code>.env.local</code>. Setup steps are in{" "}
          <code>docs/brokerage.md</code>.
        </p>
      </article>
    );
  }
  if (access === "not_configured") {
    return (
      <article className="ft-card bk-notice">
        {head}
        <p>
          Live data stays off until a local access code is set. Add <code>FINANCE_TOWN_ACCESS_CODE</code> (12 or more characters) to <code>.env.local</code>, then restart the dev server.
        </p>
      </article>
    );
  }
  if (access === "locked") {
    return (
      <article className="ft-card bk-notice">
        {head}
        <UnlockForm client={client} />
      </article>
    );
  }

  const snapshot = state?.snapshot ?? null;
  const dupes = (a: BrokerageAccount) => possibleDuplicates(a, manual).filter((id) => !prefs.excludedManual.includes(id));
  const nameOf = (id: string) => manual.find((m) => m.id === id)?.name ?? id;

  return (
    <article className="ft-card bk-notice" aria-busy={busy}>
      {head}
      <div className="bk-actions">
        <button className="ft-btn" onClick={() => void client.refresh()} disabled={busy || wait > 0}>
          {busy ? "Refreshing…" : wait > 0 ? `Refresh in ${wait}s` : snapshot ? "Refresh" : "Load balances"}
        </button>
        {provider === "fixtures" && <span className="bk-badge">Synthetic test data</span>}
      </div>
      {message && <p className="bk-error" role="alert">{message}</p>}

      {state?.lastError && (
        <p className="bk-error" role="alert">
          {ERROR_TEXT[state.lastError]}{" "}
          {snapshot ? `Showing the previous snapshot from ${fmtDateTime(snapshot.fetchedAt)}. It is stale.` : "No balances were loaded, so none are counted."}
        </p>
      )}
      {!state?.lastError && state?.stale && snapshot && <p className="bk-error">This snapshot is more than a day old. It is stale; refresh to update it.</p>}

      {!snapshot ? (
        <p className="bk-note">No balances loaded yet. Press Load balances to read them from SnapTrade. Nothing is counted until you include an account.</p>
      ) : (
        <>
          <p className="bk-note">
            Fetched by Homebase {fmtDateTime(snapshot.fetchedAt)} from SnapTrade. Each brokerage syncs on its own schedule (usually daily), shown as the data-as-of time on each account.
          </p>
          {snapshot.connections.blocked > 0 && (
            <p className="bk-error">
              {snapshot.connections.blocked} connection{snapshot.connections.blocked === 1 ? " is" : "s are"} not read-only. Homebase never reads them. Reconnect them as read-only in SnapTrade.
            </p>
          )}
          {snapshot.accounts.length === 0 ? (
            <p className="bk-note">SnapTrade returned no accounts.</p>
          ) : (
            <ul className="bk-brokers">
              {snapshot.accounts.map((a) => {
                const usable = a.status === "ok";
                const on = prefs.included.includes(a.id);
                const hits = on ? dupes(a) : [];
                return (
                  <li key={a.id}>
                    <label className="bk-check">
                      <input type="checkbox" checked={on && usable} disabled={!usable} onChange={() => onToggleInclude(a.id)} />
                      <span>
                        <strong>{a.institution}</strong> · {a.name}
                        <small>
                          {usable ? "Counts in net worth when checked. " : `${STATUS_TEXT[a.status as Exclude<typeof a.status, "ok">]} `}
                          {a.asOf ? `Brokerage data as of ${fmtDateTime(a.asOf)}.` : "Brokerage sync time unknown."}
                        </small>
                      </span>
                    </label>
                    <span className="amt">{usable && a.valueCents !== null ? formatCents(a.valueCents) : "Unavailable"}</span>
                    {usable && <CategoryPicker defaultKind="investment" override={prefs.categories[a.id]} label={`${a.institution} ${a.name}`} onChange={(k) => onSetCategory(a.id, k)} />}
                    {hits.length > 0 && (
                      <div className="bk-dupe" role="note">
                        <span>
                          Your manual {hits.length === 1 ? "account" : "accounts"} {hits.map((h) => `“${nameOf(h)}”`).join(", ")} may be the same money, so net worth could count it twice.
                        </span>
                        {hits.map((h) => (
                          <button key={h} className="bk-link" onClick={() => onToggleManualExcluded(h)}>
                            {`Leave “${nameOf(h)}” out of net worth`}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
