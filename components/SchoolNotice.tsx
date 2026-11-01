"use client";

import { useEffect, useMemo, useState } from "react";
import { SCHOOL_LABEL, addDays, localDayKey, startDay, timeLabel, townNotice, type SchoolEvent, type SchoolState } from "@/lib/school";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function when(e: SchoolEvent, today: string): string {
  const day = startDay(e);
  const dayText =
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${dayText}, ${timeLabel(e, fmtTime)}`;
}

/**
 * Town screen summary of the calendars already in memory. It never fetches: with the session locked or nothing loaded it
 * shows no calendar data at all. Counts are calendar items; submission status is unknown, so it never says "due" or "unfinished".
 */
export function SchoolNotice({ states, unlocked, onOpen }: { states: SchoolState[]; unlocked: boolean; onOpen: () => void }) {
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
  const notice = useMemo(() => (now ? townNotice(unlocked ? states : [], now) : null), [states, unlocked, now]);
  if (!now || !notice) return null;
  const today = localDayKey(now);

  let line: string;
  let sub: string | null = null;
  if (!unlocked || notice.status === "unavailable" || notice.status === "none") {
    line = !unlocked ? "Calendars locked or not loaded" : notice.status === "none" ? "No calendars set up" : "Calendars unavailable";
    sub = "Open School";
  } else {
    line = `${notice.count} calendar ${notice.count === 1 ? "item" : "items"} today`;
    sub = notice.next ? `Next: ${notice.next.title} · ${SCHOOL_LABEL[notice.next.school]} · ${when(notice.next, today)}` : "Nothing coming up";
  }
  const stale = unlocked && notice.status !== "none" && notice.stale;
  return (
    <button className="ft-notice" onClick={onOpen} aria-label={`School calendar. ${line}.${sub ? ` ${sub}.` : ""}${stale ? " Some data is stale." : ""} Opens School.`}>
      <span aria-hidden>🎓</span>
      <span className="ft-notice-text">
        <b>{line}</b>
        {sub && <small>{sub}</small>}
      </span>
      {stale && <span className="ft-notice-stale">{notice.status === "unavailable" ? "unavailable" : "stale"}</span>}
    </button>
  );
}
