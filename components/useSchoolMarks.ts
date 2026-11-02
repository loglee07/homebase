"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createLocalStore } from "@/lib/localStore";
import { parseMarks, serializeMarks, toggleId, type IgnoreRule, type SchoolMarks } from "@/lib/schoolMarks";

// The user's own checklist: event ids, course ids and rules only. No titles, dates or feed data, and never sent anywhere.
const store = createLocalStore("finance-town:school-marks:v1");
const BACKUP_KEY = "finance-town:school-marks:v1:unreadable-backup";

export interface SchoolMarksClient {
  marks: SchoolMarks;
  /** Saved choices exist but cannot be read. Nothing is overwritten until the user starts fresh. */
  unreadable: boolean;
  /** Set when the browser refused to save: the choice was NOT saved. */
  saveError: string | null;
  toggleDone: (id: string) => void;
  toggleIgnored: (id: string) => void;
  addRule: (rule: Omit<IgnoreRule, "id" | "enabled">) => void;
  setRuleEnabled: (id: string, enabled: boolean) => void;
  removeRule: (id: string) => void;
  startFresh: () => void;
}

const FAIL = "Could not save that in this browser, so it was not saved. Free some browser storage or allow site data, then try again.";

/** Reads and writes the checklist. A change only shows once it is really saved; a failed save is reported and changes nothing. */
export function useSchoolMarks(): SchoolMarksClient {
  const raw = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const parsed = useMemo(() => parseMarks(raw), [raw]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const commit = useCallback(
    (change: (m: SchoolMarks) => SchoolMarks) => {
      // Always re-read the saved value, so two tabs (or two quick clicks) never overwrite each other.
      const now = parseMarks(store.getSnapshot());
      if (now.status !== "ok") return;
      setSaveError(store.write(serializeMarks(change(now.marks))) ? null : FAIL);
    },
    [],
  );

  return {
    marks: parsed.status === "ok" ? parsed.marks : { v: 1, done: [], ignored: [], rules: [] },
    unreadable: parsed.status === "unreadable",
    saveError,
    toggleDone: (id) => commit((m) => ({ ...m, done: toggleId(m.done, id) })),
    toggleIgnored: (id) => commit((m) => ({ ...m, ignored: toggleId(m.ignored, id) })),
    addRule: (r) =>
      commit((m) => (m.rules.some((x) => x.preset === r.preset && x.courseKey === r.courseKey) ? m : { ...m, rules: [...m.rules, { ...r, id: `rule-${Date.now().toString(36)}`, enabled: true }] })),
    setRuleEnabled: (id, enabled) => commit((m) => ({ ...m, rules: m.rules.map((r) => (r.id === id ? { ...r, enabled } : r)) })),
    removeRule: (id) => commit((m) => ({ ...m, rules: m.rules.filter((r) => r.id !== id) })),
    startFresh: () => {
      try {
        window.localStorage.setItem(BACKUP_KEY, store.getSnapshot()); // keep the unreadable copy first
      } catch {
        return void setSaveError(FAIL);
      }
      setSaveError(store.write(serializeMarks({ v: 1, done: [], ignored: [], rules: [] })) ? null : FAIL);
    },
  };
}
