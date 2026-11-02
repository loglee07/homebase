"use client";

import { useEffect, useMemo, useState } from "react";
import { SCHOOL_LABEL, addDays, localDayKey, noticeKind, startDay, timeLabel, type NoticeInput, type SchoolEvent } from "@/lib/school";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function when(e: SchoolEvent, today: string): string {
  const day = startDay(e);
  const dayText =
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${dayText}, ${timeLabel(e, fmtTime)}`;
}

/**
 * Town screen summary of the calendars already in memory. It never fetches, and shows no calendar data while locked.
 * Counts are calendar items; submission status is unknown, so it never says "due" or "unfinished". Every reason there is
 * no count has its own message (see noticeKind), so "No calendars set up" appears only when no feed link is configured.
 */
export function SchoolNotice({ input, onOpen }: { input: NoticeInput; onOpen: () => void }) {
  // The clock is read after mount (not during prerender) and re-read each minute so "next" moves on and the day rolls over.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const { states, access, loaded, loadFailed, busy } = input;
  const resolved = useMemo(() => (now ? noticeKind({ states, access, loaded, loadFailed, busy }, now) : null), [states, access, loaded, loadFailed, busy, now]);
  if (!now || !resolved) return null;
  const { kind, notice } = resolved;
  const today = localDayKey(now);

  const text: Record<Exclude<typeof kind, "ok">, [string, string]> = {
    checking: ["Checking your session…", "Calendars"],
    off: ["Calendars are off", "No access code is set on the server"],
    locked: ["Calendars locked", "Unlock in School to see them"],
    load_failed: ["Could not read calendars", "The local server did not answer. Open School"],
    loading: ["Loading calendars…", "Reading what the server has saved"],
    none: ["No calendars set up", "No feed link is set. See docs/school.md"],
    not_loaded: ["Calendars not loaded yet", "Open School to load them"],
    refreshing: ["Loading calendars…", "Fetching from Canvas"],
    unavailable: ["Calendars unavailable", "The last load failed. Open School"],
  };
  let line: string;
  let sub: string;
  if (kind === "ok" && notice) {
    line = `${notice.count} calendar ${notice.count === 1 ? "item" : "items"} today`;
    sub = notice.next ? `Next: ${notice.next.title} · ${SCHOOL_LABEL[notice.next.school]} · ${when(notice.next, today)}` : "Nothing coming up";
  } else {
    [line, sub] = text[kind as Exclude<typeof kind, "ok">];
  }
  const tag = notice && (kind === "ok" ? notice.stale : kind === "unavailable") ? (kind === "ok" ? "stale" : "failed") : null;
  return (
    <button className="ft-notice" onClick={onOpen} aria-busy={kind === "loading" || kind === "refreshing" || kind === "checking"} aria-label={`School calendar. ${line}. ${sub}.${tag ? ` ${tag === "stale" ? "Some data is stale." : "Last load failed."}` : ""} Opens School.`}>
      <span aria-hidden>🎓</span>
      <span className="ft-notice-text">
        <b>{line}</b>
        <small>{sub}</small>
      </span>
      {tag && <span className="ft-notice-stale">{tag}</span>}
    </button>
  );
}
