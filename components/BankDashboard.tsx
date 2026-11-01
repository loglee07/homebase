"use client";

import { useEffect, useRef } from "react";
import { TRANSACTION_KIND, type Account, type FinanceSummary, type Transaction } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import { HOME_UPGRADE_THRESHOLD_CENTS, milestoneStatus, type HomeTier } from "@/lib/milestones";

interface Props {
  accounts: Account[];
  summary: FinanceSummary;
  transactions: Transaction[];
  homeTier: HomeTier;
  onClose: () => void;
}

const GROUPS: { kind: Account["kind"]; title: string; icon: string }[] = [
  { kind: "checking", title: "Checking", icon: "🪙" },
  { kind: "savings", title: "Savings", icon: "🐷" },
  { kind: "investment", title: "Investments", icon: "🌱" },
  { kind: "debt", title: "Debts", icon: "📜" },
];

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function BankDashboard({ accounts, summary, transactions, homeTier, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const totals: Record<Account["kind"], number> = {
    checking: summary.checkingCents,
    savings: summary.savingsCents,
    investment: summary.investmentsCents,
    debt: summary.debtsCents,
  };
  const status = milestoneStatus(homeTier, summary.netWorthCents);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ft-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ft-bank" role="dialog" aria-modal="true" aria-labelledby="bank-title">
        <header className="ft-bank-head">
          <h2 id="bank-title">Town Bank</h2>
          <span className="ft-pill">Sample data · read-only</span>
          <button ref={closeRef} className="ft-btn" onClick={onClose}>
            Leave bank <kbd>Esc</kbd>
          </button>
        </header>

        <div className="ft-bank-body">
          <div className="bk-hero">
            <div className="bk-nw">
              <h3 className="bk-h">Net worth</h3>
              <p className="bk-figure" data-testid="net-worth">{formatCents(summary.netWorthCents)}</p>
              <dl className="bk-eq">
                <div>
                  <dt>Assets</dt>
                  <dd>{formatCents(summary.assetsCents)}</dd>
                  <dd className="bk-note">Checking, savings and investments</dd>
                </div>
                <div>
                  <dt>Debts</dt>
                  <dd className="neg">−{formatCents(summary.debtsCents)}</dd>
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

          <div className="ft-grid">
            {GROUPS.map((grp) => (
              <article key={grp.kind} className="ft-card">
                <h3>
                  <span aria-hidden>{grp.icon}</span> {grp.title}
                </h3>
                <p className={`bk-total ${grp.kind === "debt" ? "neg" : ""}`}>
                  {grp.kind === "debt" ? "−" : ""}
                  {formatCents(totals[grp.kind])}
                </p>
                <ul>
                  {accounts.filter((a) => a.kind === grp.kind).map((a) => (
                    <li key={a.id}>
                      <span>
                        {a.name}
                        <small>
                          {a.institution}
                          {a.aprBasisPoints != null && ` · ${(a.aprBasisPoints / 100).toFixed(2)}% APR`}
                        </small>
                      </span>
                      <span className="amt">{formatCents(a.balanceCents)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

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
        </div>
      </section>
    </div>
  );
}
