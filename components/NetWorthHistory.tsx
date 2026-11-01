"use client";

import { useMemo } from "react";
import { formatCents } from "@/lib/money";
import type { HistoryEntry, HistoryLoad } from "@/lib/netWorthHistory";

export interface HistoryControls {
  load: HistoryLoad;
  /** The local access-code session is unlocked. History that includes connected balances stays hidden until then. */
  unlocked: boolean;
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const W = 640;
const H = 200;
const PAD = { l: 12, r: 12, t: 14, b: 14 };

function Chart({ entries }: { entries: HistoryEntry[] }) {
  const geo = useMemo(() => {
    const first = dayNumber(entries[0].day);
    const span = Math.max(1, dayNumber(entries[entries.length - 1].day) - first);
    const values = entries.map((e) => e.netWorthCents);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = Math.max(1, hi - lo);
    const x = (e: HistoryEntry) => PAD.l + ((dayNumber(e.day) - first) / span) * (W - PAD.l - PAD.r);
    const y = (e: HistoryEntry) => PAD.t + (1 - (e.netWorthCents - lo) / range) * (H - PAD.t - PAD.b);
    return { pts: entries.map((e) => ({ e, x: x(e), y: y(e) })), lo, hi };
  }, [entries]);
  const line = geo.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const base = H - PAD.b;
  const area = `${PAD.l},${base} ${line} ${geo.pts[geo.pts.length - 1].x.toFixed(1)},${base}`;
  const last = entries[entries.length - 1];
  return (
    <figure className="bk-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Net worth from ${fmtDay(entries[0].day)} to ${fmtDay(last.day)}: ${formatCents(entries[0].netWorthCents)} to ${formatCents(last.netWorthCents)}`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} className="bk-chart-axis" />
        <polygon points={area} className="bk-chart-area" />
        <polyline points={line} className="bk-chart-line" fill="none" />
        {geo.pts.map((p) => (
          <circle key={p.e.day} cx={p.x} cy={p.y} r={geo.pts.length > 60 ? 2 : 4} className="bk-chart-dot">
            <title>{`${fmtDay(p.e.day)}: ${formatCents(p.e.netWorthCents)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="bk-chart-scale">
        <span>{fmtShort(entries[0].day)}</span>
        <span>
          Low {formatCents(geo.lo)} · High {formatCents(geo.hi)}
        </span>
        <span>{fmtShort(last.day)}</span>
      </figcaption>
    </figure>
  );
}

/** Net worth history from snapshots already saved in this browser. Opening it never calls a provider. */
export function NetWorthHistory({ controls }: { controls: HistoryControls }) {
  const { load, unlocked } = controls;
  if (load.status === "unreadable") {
    return (
      <article className="ft-card bk-notice" aria-labelledby="nwh-title">
        <h3 id="nwh-title">Net worth history</h3>
        <p>The saved history could not be read, so nothing was recorded and nothing was overwritten.</p>
      </article>
    );
  }
  const { entries } = load;
  if (!unlocked && entries.some((e) => e.connected)) {
    return (
      <article className="ft-card bk-notice" aria-labelledby="nwh-title">
        <h3 id="nwh-title">Net worth history</h3>
        <p>This history includes connected balances. Unlock connected brokerages above to see it.</p>
      </article>
    );
  }
  const recent = [...entries].reverse().slice(0, 14);
  return (
    <article className="ft-card bk-history" aria-labelledby="nwh-title">
      <h3 id="nwh-title">Net worth history</h3>
      {entries.length === 0 && <p className="bk-note bk-empty">History starts now. A snapshot is saved once your accounts are fully loaded, one per day.</p>}
      {entries.length === 1 && (
        <p className="bk-note bk-empty">
          History starts today. Today’s snapshot is saved: {formatCents(entries[0].netWorthCents)} on {fmtDay(entries[0].day)}. The line appears after a second day.
        </p>
      )}
      {entries.length >= 2 && <Chart entries={entries} />}
      {entries.length >= 1 && (
        <table className="bk-hist-table">
          <caption className="bk-note">
            {entries.length >= 15 ? "Latest 14 days. " : ""}One snapshot per day, updated while your accounts are loaded. Changing which accounts are included also changes these totals.
          </caption>
          <thead>
            <tr>
              <th>Date</th>
              <th className="amt">Net worth</th>
              <th className="amt">Assets</th>
              <th className="amt">Debts</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.day}>
                <td>{fmtDay(e.day)}</td>
                <td className="amt">{formatCents(e.netWorthCents)}</td>
                <td className="amt">{formatCents(e.assetsCents)}</td>
                <td className="amt">{formatCents(e.debtsCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
