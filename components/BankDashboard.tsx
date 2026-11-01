"use client";

import { useEffect, useRef } from "react";
import type { Account, FinanceSummary, Transaction } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import { HOME_UPGRADE_THRESHOLD_CENTS } from "@/lib/milestones";

interface Props {
  accounts: Account[];
  summary: FinanceSummary;
  transactions: Transaction[];
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

export function BankDashboard({ accounts, summary, transactions, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const totals: Record<Account["kind"], number> = {
    checking: summary.checkingCents,
    savings: summary.savingsCents,
    investment: summary.investmentsCents,
    debt: summary.debtsCents,
  };
  const progress = Math.max(0, Math.min(100, Math.round((summary.netWorthCents / HOME_UPGRADE_THRESHOLD_CENTS) * 100)));

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
          <div className="ft-networth">
            <div>
              <div className="ft-label">Net worth</div>
              <div className="ft-big" data-testid="net-worth">{formatCents(summary.netWorthCents)}</div>
              <div className="ft-sub">
                {formatCents(summary.assetsCents)} assets − {formatCents(summary.debtsCents)} debts
              </div>
            </div>
            <div className="ft-goal">
              <div className="ft-label">Home upgrade at {formatCents(HOME_UPGRADE_THRESHOLD_CENTS)}</div>
              <div className="ft-meter" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="ft-sub">{progress}% of the way</div>
            </div>
          </div>

          <div className="ft-grid">
            {GROUPS.map((grp) => (
              <article key={grp.kind} className="ft-card">
                <h3>
                  <span aria-hidden>{grp.icon}</span> {grp.title}
                  <b className={grp.kind === "debt" ? "neg" : ""}>
                    {grp.kind === "debt" ? "−" : ""}
                    {formatCents(totals[grp.kind])}
                  </b>
                </h3>
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
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.date)}</td>
                    <td>{t.description}<small>{t.category}</small></td>
                    <td>{names[t.accountId] ?? t.accountId}</td>
                    <td className={`amt ${t.amountCents < 0 ? "neg" : "pos"}`}>{formatCents(t.amountCents, { signed: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      </section>
    </div>
  );
}
