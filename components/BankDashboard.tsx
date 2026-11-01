"use client";

import { useEffect, useRef, useState } from "react";
import { TRANSACTION_KIND, summarize, type Account, type FinanceSummary, type Transaction } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import { HOME_UPGRADE_THRESHOLD_CENTS, milestoneStatus, type HomeTier } from "@/lib/milestones";
import type { ManualAccount, ManualLoad, Mode, ValidAccount } from "@/lib/manualAccounts";
import { AccountForm } from "./AccountForm";
import { BackupPanel, type BackupStatus } from "./BackupPanel";
import { BluPeakPanel } from "./BluPeakPanel";
import { BrokeragePanel, fmtDateTime, type BrokerageControls } from "./BrokeragePanel";
import type { BackupPreview } from "@/lib/manualBackup";

export interface ManualControls {
  load: ManualLoad;
  saveFailed: boolean;
  onAdd: (v: ValidAccount) => void;
  onUpdate: (id: string, v: ValidAccount) => void;
  onDelete: (id: string) => void;
  /** Saves a validated backup over all manual accounts; true only once it is saved. */
  onReplaceAll: (preview: BackupPreview) => boolean;
  onExport: () => void;
  /** Copies unreadable saved data to a backup key, then starts fresh. */
  onResetUnreadable: () => void;
}

interface Props {
  mode: Mode;
  accounts: Account[];
  summary: FinanceSummary;
  /** Demo mode only. My accounts mode never shows sample transactions. */
  transactions: Transaction[];
  homeTier: HomeTier;
  manual?: ManualControls;
  /** My accounts only: read-only brokerage balances and the include/exclude choices. */
  brokerage?: BrokerageControls;
  onClose: () => void;
}

type FormState = { kind: "add" } | { kind: "edit"; id: string } | null;

const GROUPS: { kind: Account["kind"]; title: string; icon: string }[] = [
  { kind: "checking", title: "Checking", icon: "🪙" },
  { kind: "savings", title: "Savings", icon: "🐷" },
  { kind: "investment", title: "Investments", icon: "🌱" },
  { kind: "debt", title: "Debts", icon: "📜" },
];

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtUpdated = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function BankDashboard({ mode, accounts, summary, transactions, homeTier, manual, brokerage, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupStatus>(null);
  const isManual = mode === "manual";
  const editable = isManual && manual?.load.status === "ok";
  // Backups and the "set up" prompt only concern accounts typed in by hand, never brokerage data.
  const manualList = accounts.filter((a) => a.source === "manual");
  const manualAccounts = isManual ? manualList.length : accounts.length;
  // Included brokerage accounts (or, while they load, the ones the user already chose) also make the dashboard non-empty.
  const connectedCount = isManual
    ? Math.max(accounts.filter((a) => a.source === "snaptrade" || a.source === "plaid").length, brokerage?.pending ? brokerage.prefs.included.length : 0)
    : 0;
  const manualNetWorthCents = summarize(manualList).netWorthCents;
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const totals: Record<Account["kind"], number> = {
    checking: summary.checkingCents,
    savings: summary.savingsCents,
    investment: summary.investmentsCents,
    debt: summary.debtsCents,
  };
  const status = milestoneStatus(homeTier, summary.netWorthCents);

  const openForm = (next: FormState) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setConfirmId(null);
    setBackup(null);
    setForm(next);
  };
  const closeForm = () => {
    setForm(null);
    // let the trigger re-render first (the edited row may have changed), then put focus back
    setTimeout(() => {
      const el = returnFocus.current;
      (el && el.isConnected ? el : closeRef.current)?.focus();
    }, 0);
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    // Esc backs out of the innermost thing first: form, then import message, then delete prompt, then the whole bank.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (form) closeForm();
      else if (backup) {
        setBackup(null);
        setTimeout(() => (document.querySelector(".bk-toolbar-group button:nth-of-type(2)") as HTMLElement | null)?.focus(), 0);
      } else if (confirmId) setConfirmId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, form, confirmId, backup]);

  const editing: ManualAccount | undefined =
    form?.kind === "edit" && manual?.load.status === "ok" ? manual.load.state.accounts.find((a) => a.id === form.id) : undefined;

  return (
    <div className="ft-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ft-bank" role="dialog" aria-modal="true" aria-labelledby="bank-title">
        <header className="ft-bank-head">
          <h2 id="bank-title">Town Bank</h2>
          <span className="ft-pill">{isManual ? "My accounts" : "Sample data · read-only"}</span>
          <button ref={closeRef} className="ft-btn" onClick={onClose}>
            Leave bank <kbd>Esc</kbd>
          </button>
        </header>

        <div className="ft-bank-body">
          <div className="bk-hero">
            <div className="bk-nw">
              <h3 className="bk-h">Net worth</h3>
              <p className="bk-figure" data-testid="net-worth">{formatCents(summary.netWorthCents)}</p>
              {brokerage?.pending && <p className="bk-note">Partial: included brokerage balances have not loaded yet.</p>}
              <dl className="bk-eq">
                <div>
                  <dt>Assets</dt>
                  <dd>{formatCents(summary.assetsCents)}</dd>
                  <dd className="bk-note">Checking, savings and investments</dd>
                </div>
                <div>
                  <dt>Debts</dt>
                  <dd className={summary.debtsCents > 0 ? "neg" : ""}>{summary.debtsCents > 0 ? "−" : ""}{formatCents(summary.debtsCents)}</dd>
                  <dd className="bk-note">Loans and credit cards</dd>
                </div>
              </dl>
            </div>

            <div className="bk-milestone">
              {status.unlocked ? (
                <p className="bk-unlocked">
                  <span aria-hidden>🏡</span> Home upgraded · milestone achieved
                </p>
              ) : (
                <>
                  <h3 className="bk-h">Home upgrade at {formatCents(HOME_UPGRADE_THRESHOLD_CENTS)}</h3>
                  <div
                    className="ft-meter"
                    role="progressbar"
                    aria-label="Progress toward the home upgrade"
                    aria-valuenow={status.progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${status.progressPercent}%` }} />
                  </div>
                  <p className="bk-note">
                    {status.progressPercent}% of the way · {formatCents(status.remainingCents)} to go
                  </p>
                </>
              )}
            </div>
          </div>

          {isManual && manual?.load.status === "invalid" && (
            <article className="ft-card bk-notice bk-notice-warn" role="alert">
              <h3>We could not read your saved accounts</h3>
              <p>{manual.load.reason} Nothing was changed or deleted, and editing is paused so your data is not overwritten.</p>
              <p>
                Starting fresh keeps a copy of the unreadable data in this browser under a backup key, then lets you add accounts again.
              </p>
              <div className="bk-actions">
                <button className="ft-btn" onClick={manual.onResetUnreadable}>Keep a backup and start fresh</button>
              </div>
            </article>
          )}

          {isManual && manual?.saveFailed && (
            <article className="ft-card bk-notice bk-notice-warn" role="alert">
              <p>This browser would not save your change. Your accounts may disappear when you reload. Storage might be blocked, for example in a private window.</p>
            </article>
          )}

          {editable && manualAccounts === 0 && connectedCount === 0 && !form && (
            <article className="ft-card bk-notice">
              <h3>Set up your accounts</h3>
              <p>
                Add the balances you want to track: a nickname, an account type and the current balance. You update manual balances by hand,
                and they are saved in this browser. You can also load read-only balances from SnapTrade (brokerages) and Plaid (BluPeak) below.
              </p>
              <div className="bk-actions">
                <button className="ft-btn ft-btn-save" onClick={() => openForm({ kind: "add" })}>Add your first account</button>
              </div>
            </article>
          )}

          {editable && form && (
            <AccountForm
              key={form.kind === "edit" ? form.id : "add"}
              initial={editing}
              onSave={(v) => {
                if (form.kind === "edit") manual!.onUpdate(form.id, v);
                else manual!.onAdd(v);
                closeForm();
              }}
              onCancel={closeForm}
            />
          )}

          {editable && !form && (
            <div className="bk-toolbar">
              {(manualAccounts > 0 || connectedCount > 0) && (
                <button className="ft-btn" onClick={() => openForm({ kind: "add" })}>{manualAccounts > 0 ? "Add account" : "Add a manual account"}</button>
              )}
              <BackupPanel
                status={backup}
                setStatus={setBackup}
                currentCount={manualAccounts}
                currentNetWorthCents={manualNetWorthCents}
                onReplace={manual!.onReplaceAll}
                onExport={() => {
                  manual!.onExport();
                  setBackup({ kind: "done", message: "Backup downloaded. It is a plain file with your balances, so keep it private." });
                }}
              />
            </div>
          )}

          {editable && !form && brokerage && <BrokeragePanel controls={brokerage} manual={manualList} />}
          {editable && !form && brokerage && <BluPeakPanel controls={brokerage} manual={manualList} />}

          {editable && accounts.length > 0 && (
            <p className="bk-note bk-sources">
              Manual balances are typed by you and saved in this browser. Connected balances are read-only: brokerage accounts come from SnapTrade and BluPeak comes from Plaid.
            </p>
          )}

          {(!isManual || (editable && accounts.length > 0)) && (
            <div className="ft-grid">
              {GROUPS.map((grp) => {
                const list = accounts.filter((a) => a.kind === grp.kind);
                return (
                  <article key={grp.kind} className="ft-card">
                    <h3>
                      <span aria-hidden>{grp.icon}</span> {grp.title}
                    </h3>
                    <p className={`bk-total ${grp.kind === "debt" && totals.debt > 0 ? "neg" : ""}`}>
                      {grp.kind === "debt" && totals.debt > 0 ? "−" : ""}
                      {formatCents(totals[grp.kind])}
                    </p>
                    {list.length === 0 ? (
                      <p className="bk-note bk-empty">None yet.</p>
                    ) : (
                      <ul>
                        {list.map((a) => (
                          <li key={a.id}>
                            <span>
                              {a.name}
                              <small>
                                {a.source === "snaptrade" || a.source === "plaid"
                                  ? `${a.source === "plaid" ? "Plaid" : "SnapTrade"} · ${a.institution} · ${a.asOf ? `${a.source === "plaid" ? "Bank" : "Brokerage"} data as of ${fmtDateTime(a.asOf)}` : "Update time unknown"} · Fetched ${fmtDateTime(a.fetchedAt ?? "")}${a.stale ? " · Stale" : ""}`
                                  : a.updatedAt
                                    ? `${isManual ? "Manual · " : ""}${grp.kind === "debt" ? "Amount owed · " : ""}Updated ${fmtUpdated(a.updatedAt)}${a.excluded ? " · Left out of net worth" : ""}`
                                    : a.institution}
                                {a.aprBasisPoints != null && ` · ${(a.aprBasisPoints / 100).toFixed(2)}% APR`}
                              </small>
                              {editable && (a.source === "snaptrade" || a.source === "plaid") && brokerage && (
                                <span className="bk-row-actions">
                                  <button className="bk-link" aria-label={`Stop counting ${a.name}`} onClick={() => brokerage.onToggleInclude(a.source === "snaptrade" ? a.id.replace(/^snaptrade:/, "") : a.id)}>Stop counting</button>
                                </span>
                              )}
                              {editable && a.source !== "snaptrade" && a.source !== "plaid" && (
                                <span className="bk-row-actions">
                                  {confirmId === a.id ? (
                                    <>
                                      <span className="bk-confirm">Delete {a.name}?</span>
                                      <button
                                        className="bk-link bk-danger"
                                        onClick={() => {
                                          manual!.onDelete(a.id);
                                          setConfirmId(null);
                                        }}
                                      >
                                        Delete
                                      </button>
                                      <button className="bk-link" onClick={() => setConfirmId(null)}>Keep</button>
                                    </>
                                  ) : (
                                    <>
                                      <button className="bk-link" aria-label={`Edit ${a.name}`} onClick={() => openForm({ kind: "edit", id: a.id })}>Edit</button>
                                      <button className="bk-link" aria-label={`Delete ${a.name}`} onClick={() => setConfirmId(a.id)}>Delete</button>
                                      {brokerage && (
                                        <button className="bk-link" aria-pressed={!!a.excluded} onClick={() => brokerage.onToggleManualExcluded(a.id)}>
                                          {a.excluded ? "Count in net worth" : "Leave out of net worth"}
                                        </button>
                                      )}
                                    </>
                                  )}
                                </span>
                              )}
                            </span>
                            <span className={`amt${a.excluded ? " excl" : ""}`}>{formatCents(a.balanceCents)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {isManual ? (
            <article className="ft-card bk-notice">
              <h3>Transactions</h3>
              <p>
                {connectedCount > 0
                  ? "Connected balances are read-only, and transaction syncing is not implemented yet."
                  : "Transactions are not available yet: transaction entry and syncing are not implemented."}{" "}
                The activity shown in demo mode is sample data and is never mixed into your accounts.
              </p>
            </article>
          ) : (
            <article className="ft-card ft-tx">
              <h3>Recent transactions</h3>
              <table>
                <thead>
                  <tr><th>Date</th><th>Description</th><th>Account</th><th className="amt">Amount</th></tr>
                </thead>
                <tbody>
                  {transactions.map((t) => {
                    const k = TRANSACTION_KIND[t.kind];
                    return (
                      <tr key={t.id}>
                        <td className="tx-date">{fmtDate(t.date)}</td>
                        <td>
                          {t.description}
                          <small>
                            <span className={`tx-badge tx-${k.tone}`}>{k.label}</span> {t.category}
                          </small>
                        </td>
                        <td>{names[t.accountId] ?? t.accountId}</td>
                        <td className={`amt tx-amt-${k.tone}`}>{formatCents(t.amountCents, { signed: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
