"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TownBridge, type InteractableId } from "@/game/bridge";
import { summarize, type Account } from "@/lib/finance";
import { bankPrefEnvironment, bankToAccounts, countsTowardNetWorth } from "@/lib/plaid";
import {
  BROKERAGE_PREFS_KEY,
  needsAutoLoad,
  brokerageToAccounts,
  counted,
  markManual,
  parsePrefs,
  setCategory,
  toggleId,
} from "@/lib/brokerage";
import { createLocalStore } from "@/lib/localStore";
import { HISTORY_KEY, canRecord, hasConnected, parseHistory, recordSnapshot, serializeHistory } from "@/lib/netWorthHistory";
import { formatCents } from "@/lib/money";
import {
  HOME_UPGRADE_THRESHOLD_CENTS,
  MANUAL_MILESTONE_STORAGE_KEY,
  MILESTONE_STORAGE_KEY,
  applyMilestones,
  loadMilestones,
  saveMilestones,
  type HomeTier,
} from "@/lib/milestones";
import {
  MANUAL_BACKUP_KEY,
  MANUAL_STORAGE_KEY,
  MODE_STORAGE_KEY,
  addAccount,
  deleteAccount,
  loadManual,
  parseMode,
  toAccounts,
  updateAccount,
  type Mode,
  type ValidAccount,
} from "@/lib/manualAccounts";
import { backupFilename, serializeBackup } from "@/lib/manualBackup";
import { sampleAccounts, sampleTransactions, type Scenario } from "@/lib/sampleData";
import { BankDashboard, type ManualControls } from "./BankDashboard";
import type { BrokerageControls } from "./BrokeragePanel";
import { useBank } from "./useBank";
import { useBrokerage } from "./useBrokerage";
import { SchoolDashboard } from "./SchoolDashboard";
import { Hud } from "./Hud";
import { Nameplates } from "./Nameplates";
import { SchoolNotice } from "./SchoolNotice";
import { useSchool } from "./useSchool";

const TownGame = dynamic(() => import("./TownGame"), {
  ssr: false,
  loading: () => <div className="ft-loading">Waking up the town…</div>,
});

// Each key is its own external store. Demo and My accounts never share a save.
const modeStore = createLocalStore(MODE_STORAGE_KEY);
const manualStore = createLocalStore(MANUAL_STORAGE_KEY);
// Only ids and on/off choices live here (never balances). It is not part of manual backups.
const prefsStore = createLocalStore(BROKERAGE_PREFS_KEY);
// Net worth history: integer-cent totals per day (My accounts only). Browser-local, not encrypted, not in backups.
const historyStore = createLocalStore(HISTORY_KEY);
const milestoneStores: Record<Mode, ReturnType<typeof createLocalStore>> = {
  demo: createLocalStore(MILESTONE_STORAGE_KEY),
  manual: createLocalStore(MANUAL_MILESTONE_STORAGE_KEY),
};

const LABELS: Record<InteractableId, string> = { bank: "enter the Bank", home: "check your Home", school: "enter the School", kitchen: "visit the Kitchen" };

export function FinanceTown() {
  const bridge = useMemo(() => new TownBridge(), []);
  const [scenario, setScenario] = useState<Scenario>("below");
  const [bankOpen, setBankOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [prompt, setPrompt] = useState<InteractableId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const appliedTier = useRef<HomeTier | null>(null);

  const mode = parseMode(useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot, modeStore.getServerSnapshot));
  const manualRaw = useSyncExternalStore(manualStore.subscribe, manualStore.getSnapshot, manualStore.getServerSnapshot);
  const manualLoad = useMemo(() => loadManual(manualRaw), [manualRaw]);
  const [saveFailed, setSaveFailed] = useState(false);

  const prefsRaw = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getServerSnapshot);
  const prefs = useMemo(() => parsePrefs(prefsRaw), [prefsRaw]);
  // One local access-code session for every protected building, in either mode. The server decides; the page asks on load.
  const brokerageClient = useBrokerage(true);
  const brokerageState = brokerageClient.state;
  // BluPeak (Plaid) rides on the same local session: locking drops its balances from the page too.
  const schoolClient = useSchool(brokerageClient.access === "unlocked", schoolOpen);
  const bankClient = useBank(mode === "manual" && brokerageClient.access === "unlocked");
  const bankState = bankClient.state;

  // Active mode decides the accounts. Demo controls only ever touch the demo scenario.
  // My accounts = manual accounts (minus any the user left out) + brokerage accounts the user included.
  const accounts = useMemo<Account[]>(
    () =>
      mode === "demo"
        ? sampleAccounts(scenario)
        : manualLoad.status === "ok"
          ? [...markManual(toAccounts(manualLoad.state), prefs), ...brokerageToAccounts(brokerageState, prefs), ...bankToAccounts(bankState, prefs)]
          : [],
    [mode, scenario, manualLoad, prefs, brokerageState, bankState],
  );
  const summary = useMemo(() => summarize(counted(accounts)), [accounts]);
  // Included brokerage accounts whose balances are not loaded yet: net worth is incomplete, so do not move the home tier.
  const brokeragePending =
    mode === "manual" &&
    ((prefs.included.some((id) => !id.startsWith("plaid:")) && !brokerageState?.snapshot) ||
      // Every Plaid environment with an included account must have its own counted snapshot loaded. A sandbox server
      // never satisfies a production inclusion, so running Sandbox freezes the tier instead of dropping it.
      prefs.included.some((id) => {
        const env = bankPrefEnvironment(id);
        return env !== null && !(bankState?.snapshot && bankState.snapshot.environment === env && countsTowardNetWorth(bankState.snapshot.environment));
      }));

  // Net worth history. Recorded only from complete, fresh My accounts totals, so a locked, partial, stale or Sandbox state adds nothing.
  const historyRaw = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot, historyStore.getServerSnapshot);
  const history = useMemo(() => parseHistory(historyRaw), [historyRaw]);
  const recordable = canRecord({ mode, manualOk: manualLoad.status === "ok", accounts, included: prefs.included, pending: brokeragePending });
  const recordedKey = useRef("");
  const connectedNow = hasConnected(accounts);
  useEffect(() => {
    if (!recordable) return;
    const key = JSON.stringify([summary.netWorthCents, summary.assetsCents, summary.debtsCents, connectedNow]);
    if (recordedKey.current === key) return;
    const saved = parseHistory(historyStore.getSnapshot()); // read fresh: never overwrite data that is unreadable
    if (saved.status !== "ok") return;
    if (historyStore.write(serializeHistory(recordSnapshot(saved.entries, new Date(), summary, connectedNow)))) recordedKey.current = key;
  }, [recordable, summary, connectedNow]);

  // Auto-load: once the session is unlocked, load included connected balances so the coin counter is complete without a
  // trip to the Bank. Read-only, once per unlock per provider, skipped when the server already holds a fresh copy (under an
  // hour old), and the server's cooldown still applies. Nothing is included by default, so nothing loads until you choose.
  const autoLoaded = useRef({ snaptrade: false, bank: false });
  const unlockedNow = brokerageClient.access === "unlocked";
  const brokerageRefresh = brokerageClient.refresh;
  const bankRefresh = bankClient.refresh;
  const snapFetched = brokerageState ? (brokerageState.snapshot?.fetchedAt ?? null) : undefined; // undefined: not read from the server yet
  const bankFetched = bankState ? (bankState.snapshot?.fetchedAt ?? null) : undefined;
  const bankEnv = bankClient.info?.env ?? null;
  const wantsSnap = prefs.included.some((id) => !id.startsWith("plaid:"));
  const wantsBank = bankEnv !== null && countsTowardNetWorth(bankEnv) && prefs.included.some((id) => bankPrefEnvironment(id) === bankEnv);
  const snapBusy = brokerageClient.busy;
  const bankBusy = bankClient.busy;
  const providerKind = brokerageClient.provider;
  useEffect(() => {
    if (!unlockedNow) {
      autoLoaded.current = { snaptrade: false, bank: false }; // a new unlock may load again
      return;
    }
    if (mode !== "manual") return;
    const now = Date.now();
    if (wantsSnap && providerKind !== null && providerKind !== "none" && snapFetched !== undefined && !snapBusy && !autoLoaded.current.snaptrade && needsAutoLoad(snapFetched, now)) {
      autoLoaded.current.snaptrade = true;
      void brokerageRefresh();
    }
    if (wantsBank && bankFetched !== undefined && !bankBusy && !autoLoaded.current.bank && needsAutoLoad(bankFetched, now)) {
      autoLoaded.current.bank = true;
      void bankRefresh();
    }
  }, [unlockedNow, mode, wantsSnap, wantsBank, providerKind, snapFetched, bankFetched, snapBusy, bankBusy, brokerageRefresh, bankRefresh]);

  const brokerage = useMemo<BrokerageControls>(
    () => ({
      client: brokerageClient,
      bank: bankClient,
      prefs,
      pending: brokeragePending,
      onToggleInclude: (id) => void prefsStore.write(JSON.stringify({ ...prefs, included: toggleId(prefs.included, id) })),
      onSetCategory: (id, kind) => void prefsStore.write(JSON.stringify(setCategory(prefs, id, kind))),
      onToggleManualExcluded: (id) => void prefsStore.write(JSON.stringify({ ...prefs, excludedManual: toggleId(prefs.excludedManual, id) })),
    }),
    [brokerageClient, bankClient, prefs, brokeragePending],
  );

  // Saved milestones live in localStorage (one save per mode); read through an external-store hook so SSR stays stable.
  const milestoneStore = milestoneStores[mode];
  const raw = useSyncExternalStore(milestoneStore.subscribe, milestoneStore.getSnapshot, milestoneStore.getServerSnapshot);
  const stored = useMemo(() => loadMilestones({ getItem: () => raw || null }), [raw]);
  // Automatic milestone: pure derivation. The tier follows the active mode's net worth up and down.
  const derived = applyMilestones(stored, summary.netWorthCents);
  const { state: milestones, upgraded, downgraded } = brokeragePending ? { state: stored, upgraded: false, downgraded: false } : derived;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const lastMode = useRef(mode);
  useEffect(() => {
    // Switching modes re-derives the tier from the other data; that is not a milestone event, so stay quiet.
    const switched = lastMode.current !== mode;
    lastMode.current = mode;
    if (upgraded || downgraded) {
      saveMilestones(window.localStorage, milestones, milestoneStore.key);
      milestoneStore.notify();
      if (!switched) {
        // one-shot announcement of an external event (the milestone), not derived state
        showToast(upgraded ? "Net worth passed $100,000. Your home was upgraded!" : "Net worth fell below $100,000. Your home is a cottage again.");
      }
    }
    if (appliedTier.current !== milestones.homeTier) {
      // celebrate only for a live upgrade, not when restoring a saved one on load or switching modes
      bridge.setHomeTier(milestones.homeTier, upgraded && !switched);
      appliedTier.current = milestones.homeTier;
    }
  }, [upgraded, downgraded, milestones, milestoneStore, mode, bridge, showToast]);

  const setMode = useCallback((next: Mode) => void modeStore.write(next), []);

  const manual = useMemo<ManualControls>(() => {
    const commit = (next: Parameters<typeof manualStore.write>[0]) => setSaveFailed(!manualStore.write(next));
    const current = () => {
      const l = loadManual(manualStore.getSnapshot());
      return l.status === "ok" ? l.state : null;
    };
    return {
      load: manualLoad,
      saveFailed,
      onAdd: (v: ValidAccount) => {
        const s = current();
        if (s) commit(JSON.stringify(addAccount(s, v)));
      },
      onUpdate: (id: string, v: ValidAccount) => {
        const s = current();
        if (s) commit(JSON.stringify(updateAccount(s, id, v)));
      },
      onDelete: (id: string) => {
        const s = current();
        if (s) commit(JSON.stringify(deleteAccount(s, id)));
      },
      onReplaceAll: (preview) => {
        // Save first; only report success if the new data is really stored, else put back exactly what was there.
        const previous = manualStore.getSnapshot();
        const text = JSON.stringify(preview.state);
        if (!manualStore.write(text)) return false;
        if (manualStore.getSnapshot() !== text) {
          if (previous) manualStore.write(previous);
          return false;
        }
        setSaveFailed(false);
        return true;
      },
      onExport: () => {
        if (manualLoad.status !== "ok") return;
        const url = URL.createObjectURL(new Blob([serializeBackup(manualLoad.state)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = backupFilename();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      onResetUnreadable: () => {
        try {
          const rawNow = window.localStorage.getItem(MANUAL_STORAGE_KEY);
          if (rawNow) window.localStorage.setItem(MANUAL_BACKUP_KEY, rawNow);
          window.localStorage.removeItem(MANUAL_STORAGE_KEY);
          setSaveFailed(false);
        } catch {
          setSaveFailed(true);
        }
        manualStore.notify();
      },
    };
  }, [manualLoad, saveFailed]);

  useEffect(() => {
    bridge.setPaused(bankOpen || schoolOpen);
  }, [bankOpen, schoolOpen, bridge]);

  const homeTier = milestones.homeTier;
  useEffect(() => {
    bridge.setHandlers({
      onPrompt: setPrompt,
      onInteract: (id) => {
        if (id === "bank") setBankOpen(true);
        else if (id === "school") setSchoolOpen(true);
        else if (id === "kitchen") showToast("The Kitchen will track what you eat and add up your macros. Coming soon.");
        else showToast(`Your ${homeTier === 2 ? "manor" : "cottage"}. Reach ${formatCents(HOME_UPGRADE_THRESHOLD_CENTS)} net worth to upgrade it.`);
      },
    });
  }, [bridge, homeTier, showToast]);

  const closeBank = useCallback(() => setBankOpen(false), []);
  const closeSchool = useCallback(() => setSchoolOpen(false), []);

  return (
    <main className="ft-app">
      <Hud
        netWorthText={formatCents(summary.netWorthCents)}
        pending={brokeragePending}
        homeTier={milestones.homeTier}
        mode={mode}
        onMode={setMode}
        scenario={scenario}
        onScenario={setScenario}
        access={brokerageClient.access}
        onLock={() => void brokerageClient.lock()}
        onBank={() => setBankOpen(true)}
        onSchool={() => setSchoolOpen(true)}
        dialogOpen={bankOpen || schoolOpen}
      />

      <div className="ft-stage">
        <TownGame bridge={bridge} />
        {prompt && !bankOpen && !schoolOpen && (
          <button className="ft-prompt" onClick={() => bridge.onInteract(prompt)}>
            <kbd>E</kbd> {LABELS[prompt]}
          </button>
        )}
        <Nameplates bridge={bridge} homeTier={milestones.homeTier} />
        {!bankOpen && !schoolOpen && <SchoolNotice input={{ access: brokerageClient.access, states: schoolClient.states, loaded: schoolClient.loaded, loadFailed: schoolClient.loadFailed, busy: Object.values(schoolClient.busy).some(Boolean) }} onOpen={() => setSchoolOpen(true)} />}
        {toast && <div className="ft-toast" role="status">{toast}</div>}
      </div>

      {bankOpen && <BankDashboard mode={mode} manual={manual} accounts={accounts} summary={summary} transactions={mode === "demo" ? sampleTransactions : []} homeTier={milestones.homeTier} brokerage={mode === "manual" ? brokerage : undefined} history={mode === "manual" ? { load: history, unlocked: brokerageClient.access === "unlocked" } : undefined} onClose={closeBank} />}
      {schoolOpen && <SchoolDashboard access={brokerageClient} school={schoolClient} onClose={closeSchool} />}
    </main>
  );
}
