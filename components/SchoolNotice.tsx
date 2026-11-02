"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createLocalStore } from "@/lib/localStore";
import { PixelIcon } from "./PixelIcon";
import { SCHOOL_LABEL, addDays, localDayKey, noticeKind, startDay, timeLabel, type NoticeInput, type SchoolEvent } from "@/lib/school";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function when(e: SchoolEvent, today: string): string {
  const day = startDay(e);
  const dayText =
    day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const t = timeLabel(e, fmtTime);
  return t ? `${dayText}, ${t}` : dayText;
}

// Per-viewer convenience only: whether the notice is minimized to its badge. Holds no calendar data.
const minimizedStore = createLocalStore("finance-town:notice-minimized:v1");

/** Badge face: the item count when there is one, otherwise a short mark for why there is none. */
function badgeMark(kind: string, count: number | undefined): string {
  if (kind === "ok") return String(count ?? 0);
  if (kind === "locked" || kind === "off") return "";
  if (kind === "unavailable" || kind === "load_failed") return "!";
  if (kind === "none" || kind === "not_loaded") return "–";
  return "…";
}

/**
 * Town screen summary of the calendars already in memory, top-right of the game area. It never fetches (hovering,
 * pinning and minimizing only change what is shown), and shows no calendar data while locked. Counts are calendar items;
 * submission status is unknown, so it never says "due" or "unfinished". Every reason there is no count has its own message
 * (see noticeKind). Minimized, it is a small badge: hover previews it, click or Enter/Space pins it open.
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

  const minimized = useSyncExternalStore(minimizedStore.subscribe, minimizedStore.getSnapshot, minimizedStore.getServerSnapshot) === "1";
  const [hover, setHover] = useState(false);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef<"badge" | "toggle" | null>(null);
  useEffect(() => {
    // Keyboard users keep their place when the control they used is replaced by its counterpart.
    if (moveFocus.current === "toggle") toggleRef.current?.focus();
    else if (moveFocus.current === "badge") badgeRef.current?.focus();
    moveFocus.current = null;
  }, [minimized]);

  const { states, access, loaded, loadFailed, busy, hide } = input;
  const resolved = useMemo(() => (now ? noticeKind({ states, access, loaded, loadFailed, busy, hide }, now) : null), [states, access, loaded, loadFailed, busy, hide, now]);
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
    line = `${notice.count} unchecked calendar ${notice.count === 1 ? "item" : "items"} today`;
    sub = notice.next ? `Next: ${notice.next.title} · ${SCHOOL_LABEL[notice.next.school]} · ${when(notice.next, today)}` : "Nothing coming up";
  } else {
    [line, sub] = text[kind as Exclude<typeof kind, "ok">];
  }
  const tag = notice && (kind === "ok" ? notice.stale : kind === "unavailable") ? (kind === "ok" ? "stale" : "failed") : null;
  const tagNote = tag ? (tag === "stale" ? " Some data is stale." : " The last load failed.") : "";
  const busyNow = kind === "loading" || kind === "refreshing" || kind === "checking";
  const mark = badgeMark(kind, notice?.count);

  const pin = () => {
    moveFocus.current = "toggle";
    minimizedStore.write("0");
    minimizedStore.notify();
    setHover(false);
  };
  const minimize = () => {
    moveFocus.current = "badge";
    minimizedStore.write("1");
    minimizedStore.notify();
  };

  // Hover previews only for a mouse; on touch the tap (click) pins it open instead.
  const preview = minimized && hover;
  const open = !minimized || preview;
  return (
    <div
      className={`ft-notice${open ? " ft-notice-open" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && minimized && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
    >
      {open ? (
        <section className="ft-notice-panel" aria-label="School calendar" aria-busy={busyNow}>
          <div className="ft-notice-head">
            <PixelIcon name="calendar" size={22} />
            <span className="ft-notice-text" role="status">
              <b>{line}</b>
              <small>{sub}</small>
            </span>
            {tag && <span className="ft-notice-stale">{tag}</span>}
            {minimized ? (
              <button ref={toggleRef} className="ft-notice-ico" onClick={pin} aria-label="Pin the calendar notice open" title="Pin open">
                <PixelIcon name="chevron" size={16} />
              </button>
            ) : (
              <button ref={toggleRef} className="ft-notice-ico" onClick={minimize} aria-label="Minimize the calendar notice" title="Minimize">
                <PixelIcon name="minus" size={16} />
              </button>
            )}
          </div>
          <button className="ft-notice-open-school" onClick={onOpen}>
            Open School
          </button>
        </section>
      ) : (
        <button
          ref={badgeRef}
          className="ft-notice-badge"
          onClick={pin}
          aria-expanded={false}
          aria-label={`School calendar. ${line}.${tagNote} Activate to pin the notice open.`}
          title={line}
        >
          <PixelIcon name="calendar" size={22} />
          {mark ? <span className="ft-notice-count">{mark}</span> : <PixelIcon name="lock" size={16} />}
          {tag && <span className="ft-notice-dot" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
