"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TownBridge, type InteractableId } from "@/game/bridge";
import { summarize } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import {
  HOME_UPGRADE_THRESHOLD_CENTS,
  MILESTONE_STORAGE_KEY,
  applyMilestones,
  loadMilestones,
  saveMilestones,
  type HomeTier,
} from "@/lib/milestones";
import { sampleAccounts, sampleTransactions, type Scenario } from "@/lib/sampleData";
import { BankDashboard } from "./BankDashboard";

const TownGame = dynamic(() => import("./TownGame"), {
  ssr: false,
  loading: () => <div className="ft-loading">Waking up the town…</div>,
});

const milestoneListeners = new Set<() => void>();
const subscribeMilestones = (cb: () => void) => {
  milestoneListeners.add(cb);
  return () => void milestoneListeners.delete(cb);
};
const notifyMilestones = () => milestoneListeners.forEach((cb) => cb());
const readRaw = () => {
  try {
    return window.localStorage.getItem(MILESTONE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const LABELS: Record<InteractableId, string> = { bank: "enter the Bank", home: "check your Home" };

export function FinanceTown() {
  const bridge = useMemo(() => new TownBridge(), []);
  const [scenario, setScenario] = useState<Scenario>("below");
  const [bankOpen, setBankOpen] = useState(false);
  const [prompt, setPrompt] = useState<InteractableId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const appliedTier = useRef<HomeTier | null>(null);

  const accounts = useMemo(() => sampleAccounts(scenario), [scenario]);
  const summary = useMemo(() => summarize(accounts), [accounts]);

  // Saved milestones live in localStorage; read through an external-store hook so SSR stays stable.
  const raw = useSyncExternalStore(subscribeMilestones, readRaw, () => "");
  const stored = useMemo(() => loadMilestones({ getItem: () => raw || null }), [raw]);
  // Automatic milestone: pure derivation. Upgrades only; a later decrease never lowers the tier.
  const { state: milestones, upgraded } = applyMilestones(stored, summary.netWorthCents);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    if (upgraded) {
      saveMilestones(window.localStorage, milestones);
      notifyMilestones();
      // one-shot announcement of an external event (the milestone), not derived state
      // eslint-disable-next-line react-hooks/set-state-in-effect
      showToast("Net worth passed $100,000. Your home was upgraded!");
    }
    if (appliedTier.current !== milestones.homeTier) {
      // celebrate only for a live upgrade, not when restoring a saved one on load
      bridge.setHomeTier(milestones.homeTier, upgraded);
      appliedTier.current = milestones.homeTier;
    }
  }, [upgraded, milestones, bridge, showToast]);

  useEffect(() => {
    bridge.setPaused(bankOpen);
  }, [bankOpen, bridge]);

  const homeTier = milestones.homeTier;
  useEffect(() => {
    bridge.setHandlers({
      onPrompt: setPrompt,
      onInteract: (id) => {
        if (id === "bank") setBankOpen(true);
        else showToast(`Your ${homeTier === 2 ? "manor" : "cottage"}. Reach ${formatCents(HOME_UPGRADE_THRESHOLD_CENTS)} net worth to upgrade it.`);
      },
    });
  }, [bridge, homeTier, showToast]);

  const closeBank = useCallback(() => setBankOpen(false), []);

  return (
    <main className="ft-app">
      <header className="ft-bar">
        <h1>Finance Town</h1>
        <div className="ft-chip" title="Net worth from sample data">
          <span className="ft-label">Net worth</span> <b>{formatCents(summary.netWorthCents)}</b>
        </div>
        <div className="ft-chip">
          <span className="ft-label">Home</span> <b>{milestones.homeTier === 2 ? "Manor" : "Cottage"}</b>
        </div>
        <button className="ft-btn ft-btn-primary" onClick={() => setBankOpen(true)} disabled={bankOpen}>
          🏦 Bank
        </button>
        <fieldset className="ft-demo">
          <legend>Demo control · sample net worth</legend>
          <label>
            <input type="radio" name="scenario" checked={scenario === "below"} onChange={() => setScenario("below")} />
            Below $100k
          </label>
          <label>
            <input type="radio" name="scenario" checked={scenario === "above"} onChange={() => setScenario("above")} />
            Above $100k
          </label>
        </fieldset>
      </header>

      <div className="ft-stage">
        <TownGame bridge={bridge} />
        {prompt && !bankOpen && (
          <button className="ft-prompt" onClick={() => bridge.onInteract(prompt)}>
            <kbd>E</kbd> {LABELS[prompt]}
          </button>
        )}
        {toast && <div className="ft-toast" role="status">{toast}</div>}
        <p className="ft-help">Move: WASD / arrows · Interact: E · Sample data only</p>
      </div>

      {bankOpen && <BankDashboard accounts={accounts} summary={summary} transactions={sampleTransactions} onClose={closeBank} />}
    </main>
  );
}
