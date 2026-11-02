"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createLocalStore } from "@/lib/localStore";
import { NO_FILTER, directionOf, filterTxns, type ActivityFilter } from "@/lib/bankActivity";
import { formatCents } from "@/lib/money";
import { BANK_ERROR_TEXT, type BankAccount } from "@/lib/plaid";
import { fmtDateTime } from "./BrokeragePanel";
import type { BankClient } from "./useBank";

// Per-viewer convenience only: whether the card is minimized. Holds no financial data.
const collapsedStore = createLocalStore("finance-town:transactions-collapsed:v1");
const PAGE = 50;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Read-only transaction history for the connected bank. Shown for reference: it is never added to balances, net worth or
 * the home tier. "Money in" is not "income": a refund or a transfer from your own account also arrives as money in.
 */
export function BankActivity({ bank, accounts }: { bank: BankClient; accounts: BankAccount[] }) {
  const { activity, activityBusy, activityMessage } = bank;
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.getSnapshot, collapsedStore.getServerSnapshot) === "1";
  const [filter, setFilter] = useState<ActivityFilter>(NO_FILTER);
  const [shown, setShown] = useState(PAGE);
  const [now, setNow] = useState(() => Date.now());
  const cooldownUntil = activity?.cooldownUntil ? Date.parse(activity.cooldownUntil) : 0;
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const wait = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const names = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const nameOf = (id: string) => names.get(id) ?? "Account";
  const rows = useMemo(() => (activity ? filterTxns(activity.transactions, filter) : []), [activity, filter]);
  const accountIds = useMemo(() => [...new Set((activity?.transactions ?? []).map((t) => t.accountId))], [activity]);
  const set = (patch: Partial<ActivityFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };

  const head = (
    <h3 className="bk-fold">
      <button className="bk-fold-btn" title={collapsed ? "Expand" : "Minimize"} aria-expanded={!collapsed} onClick={() => collapsedStore.write(collapsed ? "0" : "1")}>
        <span aria-hidden>{collapsed ? "▸" : "▾"}</span> Transactions
      </button>
    </h3>
  );
  if (collapsed) {
    const line = !activity || activity.status === "not_synced" ? "Not synced yet." : activity.status === "preparing" ? "BluPeak is still preparing the history." : `${activity.transactions.length} saved${activity.stale ? " (stale)" : ""}.`;
    return <article className="ft-card bk-notice">{head}<p className="bk-note">{line}</p></article>;
  }

  return (
    <article className="ft-card bk-notice bk-activity" aria-label="BluPeak transactions">
      {head}
      <div className="bk-actions">
        <span className="bk-badge">BluPeak</span>
        <button className="ft-btn" onClick={() => void bank.syncActivity()} disabled={activityBusy || wait > 0}>
          {activityBusy ? "Syncing…" : wait > 0 ? `Sync activity in ${wait}s` : "Sync activity"}
        </button>
      </div>
      <p className="bk-note">History for reference only. It is never added to your balances, net worth or home.</p>
      {activityMessage && <p className="bk-error" role="alert">{activityMessage}</p>}
      {activity?.unreadable && <p className="bk-error" role="alert">The saved transactions could not be read (the key is missing or wrong). Nothing was changed or overwritten.</p>}
      {activity?.lastError && !activityMessage && <p className="bk-error" role="alert">{BANK_ERROR_TEXT[activity.lastError]} {activity.status === "ready" ? `Showing the history saved ${activity.syncedAt ? fmtDateTime(activity.syncedAt) : "earlier"}. It is stale.` : ""}</p>}
      {activity?.stale && !activity.lastError && <p className="bk-error">This history is more than a day old. It is stale; sync to update it.</p>}

      {(!activity || activity.status === "not_synced") && !activity?.unreadable && <p className="bk-note">No transactions loaded yet. Press Sync activity.</p>}
      {activity?.status === "preparing" && <p className="bk-note" role="status">BluPeak is still preparing your history with Plaid. This is not an empty history. Try Sync activity again in a few minutes.</p>}
      {activity?.status === "ready" && (
        <>
          <p className="bk-note">
            Synced {activity.syncedAt ? fmtDateTime(activity.syncedAt) : "earlier"}.{" "}
            {!activity.complete && "Older history may still be loading. "}
            {activity.skipped > 0 && `${activity.skipped} in another currency not shown.`}
          </p>
          <div className="bk-filters">
            <label>Account
              <select value={filter.accountId} onChange={(e) => set({ accountId: e.target.value })}>
                <option value="all">All accounts</option>
                {accountIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
              </select>
            </label>
            <label>From <input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
            <label>To <input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
            {(filter.accountId !== "all" || filter.from || filter.to) && <button className="bk-link" onClick={() => { setFilter(NO_FILTER); setShown(PAGE); }}>Clear filters</button>}
          </div>
          {activity.transactions.length === 0 && <p className="bk-note">Loaded successfully: this account has no transactions in the period Plaid covers.</p>}
          {activity.transactions.length > 0 && rows.length === 0 && <p className="bk-note">No transactions match these filters.</p>}
          {rows.length > 0 && (
            <table className="bk-txns">
              <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Status</th><th className="amt">Amount</th></tr></thead>
              <tbody>
                {rows.slice(0, shown).map((t) => {
                  const dir = directionOf(t);
                  return (
                    <tr key={t.id}>
                      <td>{dayLabel(t.date)}</td>
                      <td>{t.description}</td>
                      <td>{nameOf(t.accountId)}</td>
                      <td>{t.pending ? "Pending" : "Posted"}</td>
                      <td className={`amt ${dir === "in" ? "txn-in" : ""}`} title={dir === "in" ? "Money in" : dir === "out" ? "Money out" : undefined}>
                        {formatCents(t.amountCents, { signed: true })}
                        <span className="sr-only">{dir === "in" ? " money in" : dir === "out" ? " money out" : ""}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.length > shown && <button className="ft-btn" onClick={() => setShown((n) => n + PAGE)}>{`Show more (${rows.length - shown} left)`}</button>}
        </>
      )}
    </article>
  );
}
