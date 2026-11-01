"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePlaidLink } from "react-plaid-link";
import { possibleDuplicates } from "@/lib/brokerage";
import { createLocalStore } from "@/lib/localStore";
import { formatCents } from "@/lib/money";
import { BANK_ERROR_TEXT, BANK_STATUS_TEXT, bankPrefId, countsTowardNetWorth, type BankAccount } from "@/lib/plaid";
import type { Account } from "@/lib/finance";
import { UnlockForm, fmtDateTime, type BrokerageControls } from "./BrokeragePanel";
import type { LinkLaunch } from "./useBank";

// Per-viewer convenience only: whether the panel is minimized. Holds no financial data.
const collapsedStore = createLocalStore("finance-town:bank-collapsed:v1");

/** Opens Plaid Link (a popup for bank sign-in; no redirect URL). Only the public token leaves this component. */
function PlaidLauncher({ token, onSuccess, onExit }: { token: string; onSuccess: (publicToken: string) => void; onExit: () => void }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => publicToken && onSuccess(publicToken),
    onExit: () => onExit(),
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return <p className="bk-note" role="status">Opening the bank sign-in window. If nothing appears, allow pop-ups for this page.</p>;
}

/** Stand-in for Link when running on synthetic fixtures: nothing leaves this computer. */
function FixtureLauncher({ onSuccess, onExit }: { onSuccess: (publicToken: string) => void; onExit: () => void }) {
  return (
    <div className="bk-dupe" role="group" aria-label="Synthetic test connection">
      <span>Synthetic test mode: Plaid Link is replaced by these two buttons.</span>
      <div className="bk-actions">
        <button className="ft-btn" onClick={() => onSuccess("public-fixture-000000")}>Simulate a successful link</button>
        <button className="ft-btn" onClick={onExit}>Simulate closing the window</button>
      </div>
    </div>
  );
}

function Launcher({ launch, onSuccess, onExit }: { launch: LinkLaunch; onSuccess: (t: string) => void; onExit: () => void }) {
  return launch.fixture ? <FixtureLauncher onSuccess={onSuccess} onExit={onExit} /> : <PlaidLauncher token={launch.token} onSuccess={onSuccess} onExit={onExit} />;
}

interface Props {
  controls: BrokerageControls;
  manual: Account[];
}

export function BluPeakPanel({ controls, manual }: Props) {
  const { client, bank, prefs, onToggleInclude, onToggleManualExcluded } = controls;
  const { info, state, busy, message, launch } = bank;
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.getSnapshot, collapsedStore.getServerSnapshot) === "1";
  const [now, setNow] = useState(() => Date.now());
  const cooldownUntil = state?.cooldownUntil ? Date.parse(state.cooldownUntil) : 0;
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const wait = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const head = (
    <h3 className="bk-fold">
      <button className="bk-fold-btn" aria-expanded={!collapsed} onClick={() => collapsedStore.write(collapsed ? "0" : "1")}>
        <span aria-hidden>{collapsed ? "▸" : "▾"}</span> <span aria-hidden>🏔️</span> BluPeak
        <span className="bk-fold-hint">{collapsed ? "Show" : "Minimize"}</span>
      </button>
    </h3>
  );

  // The shared access session gates everything. With SnapTrade off there is no other unlock form, so show one here.
  if (client.access === "locked" && client.provider === "none") {
    return <article className="ft-card bk-notice">{head}{!collapsed && <UnlockForm client={client} />}</article>;
  }
  if (client.access !== "unlocked") return null;

  if (collapsed) {
    const n = state?.snapshot ? state.snapshot.accounts.filter((a) => a.status === "ok" && prefs.included.includes(bankPrefId(state.snapshot!.environment, a.id)) && countsTowardNetWorth(state.snapshot!.environment)).length : 0;
    const line = !info ? "Checking." : info.provider === "none" ? "Not set up." : state?.vault === "empty" ? "Not connected." : !state?.snapshot ? "No balances loaded." : `Fetched ${fmtDateTime(state.snapshot.fetchedAt)}${state.stale ? " (stale)" : ""}.`;
    return <article className="ft-card bk-notice">{head}<p className="bk-note">{line} {n} included in net worth.</p></article>;
  }

  if (!info) return <article className="ft-card bk-notice">{head}<p className="bk-note">Checking…</p></article>;
  if (info.provider === "none") {
    return (
      <article className="ft-card bk-notice">
        {head}
        <p>
          The BluPeak connection is off. It needs {info.missing.length ? info.missing.join(" and ") : "Plaid settings"} in <code>.env.local</code>. Setup steps are in <code>docs/plaid.md</code>.
        </p>
      </article>
    );
  }

  const snapshot = state?.snapshot ?? null;
  const vault = state?.vault ?? "empty";
  const reconnect = state?.lastError === "reconnect_required";
  const sandbox = info.env === "sandbox";
  const badge = info.provider === "fixtures" ? "Synthetic test data" : sandbox ? "Sandbox: fake banks, not counted" : "Plaid Production";
  const vaultFile = `plaid-item.${info.env ?? "production"}.enc`;
  const nameOf = (id: string) => manual.find((m) => m.id === id)?.name ?? id;
  const dupes = (a: BankAccount) => possibleDuplicates(a, manual, []).filter((id) => !prefs.excludedManual.includes(id));
  const money = (c: number | null) => (c === null ? "Not reported" : formatCents(c));

  return (
    <article className="ft-card bk-notice" aria-busy={busy}>
      {head}
      <div className="bk-actions">
        {vault === "empty" && !launch && (
          <button className="ft-btn ft-btn-save" onClick={() => void bank.connect(false)} disabled={busy}>Connect BluPeak</button>
        )}
        {vault === "linked" && (
          <>
            <button className="ft-btn" onClick={() => void bank.refresh()} disabled={busy || wait > 0}>
              {busy ? "Working…" : wait > 0 ? `Refresh in ${wait}s` : snapshot ? "Refresh" : "Load balances"}
            </button>
            {reconnect && !launch && <button className="ft-btn ft-btn-save" onClick={() => void bank.connect(true)} disabled={busy}>Reconnect BluPeak</button>}
          </>
        )}
        <span className="bk-badge">{badge}</span>
      </div>
      {sandbox && (
        <p className="bk-sandbox" role="note">
          Sandbox mode: Plaid&apos;s fake banks, for testing only. These balances are labeled as test data and never count toward your net worth or home tier. Your real BluPeak connection is stored separately and is not used or changed while this is on.
        </p>
      )}
      {launch && <Launcher launch={launch} onSuccess={(t) => void bank.onLinkSuccess(t)} onExit={bank.onLinkExit} />}
      {message && <p className="bk-error" role="alert">{message}</p>}

      {vault === "empty" && !launch && (
        <p className="bk-note">
          Read-only balances through Plaid. You sign in to BluPeak inside Plaid&apos;s own window; Finance Town never sees your bank password. It cannot move money.
        </p>
      )}
      {vault === "unreadable" && (
        <p className="bk-error" role="alert">
          A saved connection exists but could not be read (the key is missing or wrong). Nothing was changed or overwritten. Restore the key in <code>.env.local</code>, or move <code>.data/{vaultFile}</code> aside to connect again.
        </p>
      )}
      {state?.lastError && vault !== "unreadable" && (
        <p className="bk-error" role="alert">
          {BANK_ERROR_TEXT[state.lastError]}{" "}
          {snapshot ? `Showing the previous snapshot from ${fmtDateTime(snapshot.fetchedAt)}. It is stale.` : "No balances were loaded, so none are counted."}
        </p>
      )}
      {!state?.lastError && state?.stale && snapshot && <p className="bk-error">This snapshot is more than a day old. It is stale; refresh to update it.</p>}

      {vault === "linked" && !snapshot && <p className="bk-note">No balances loaded yet. Nothing is counted until you include an account.</p>}
      {snapshot && (
        <>
          <p className="bk-note">
            Fetched by Finance Town {fmtDateTime(snapshot.fetchedAt)} from Plaid. Net worth uses the <strong>current</strong> balance; the available balance (which already subtracts pending items) is shown for reference only.
          </p>
          {!sandbox && <p className="bk-note">Already track a BluPeak account by hand? After you include its connected twin, leave the manual one out of net worth so it is not counted twice.</p>}
          <ul className="bk-brokers">
            {snapshot.accounts.map((a) => {
              const usable = a.status === "ok" && !sandbox;
              const pid = bankPrefId(snapshot.environment, a.id);
              const on = prefs.included.includes(pid);
              const hits = on ? dupes(a) : [];
              return (
                <li key={a.id}>
                  <label className="bk-check">
                    <input type="checkbox" checked={on && usable} disabled={!usable} onChange={() => onToggleInclude(pid)} />
                    <span>
                      <strong>{a.institution}</strong> · {a.name}
                      <small>
                        {a.status === "ok" ? `${a.subtype === "savings" ? "Savings" : "Checking"}. ${sandbox ? "Sandbox test data. Never counted. " : ""}` : `${BANK_STATUS_TEXT[a.status as Exclude<typeof a.status, "ok">]} `}
                        {a.status === "ok" && `Available ${money(a.availableCents)}. `}
                        {a.status === "ok" && a.currentCents !== null && a.currentCents < 0 && !sandbox && "Overdrawn: counted as a debt. "}
                        {a.asOf ? `Bank data as of ${fmtDateTime(a.asOf)}.` : "Bank update time unknown."}
                      </small>
                    </span>
                  </label>
                  <span className="amt">{a.status === "ok" && a.currentCents !== null ? formatCents(a.currentCents) : "Unavailable"}</span>
                  {hits.length > 0 && (
                    <div className="bk-dupe" role="note">
                      <span>Your manual {hits.length === 1 ? "account" : "accounts"} {hits.map((h) => `“${nameOf(h)}”`).join(", ")} may be the same money, so net worth could count it twice.</span>
                      {hits.map((h) => (
                        <button key={h} className="bk-link" onClick={() => onToggleManualExcluded(h)}>{`Leave “${nameOf(h)}” out of net worth`}</button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}
