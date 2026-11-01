"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createLocalStore } from "@/lib/localStore";
import {
  SCHOOL_ERROR_TEXT, SCHOOL_LABEL, SCHOOL_IDS, combine, eventsOn, localDayKey, monthCells, timeLabel, upcoming,
  type SchoolEvent, type SchoolState,
} from "@/lib/school";
import { UnlockForm, fmtDateTime } from "./BrokeragePanel";
import type { BrokerageClient } from "./useBrokerage";
import type { SchoolClient } from "./useSchool";

// Per-viewer convenience only: whether the calendars card is minimized. Holds no calendar data.
const collapsedStore = createLocalStore("finance-town:school-collapsed:v1");

type View = "upcoming" | "calendar";
const VIEWS: { id: View; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "calendar", label: "Calendar" },
];

const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", opts);
const fmtTimeOnly = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const timeText = (e: SchoolEvent) => timeLabel(e, fmtTime);

function EventRow({ e }: { e: SchoolEvent }) {
  return (
    <li className={`sc-event sc-${e.school}${e.cancelled ? " sc-cancelled" : ""}`}>
      <span className={`sc-time${e.dueTimeUnknown ? " sc-time-unknown" : ""}`}>{timeText(e)}</span>
      <span className="sc-main">
        <strong>{e.title}</strong>
        <small>
          <span className={`sc-badge sc-badge-${e.school}`}>{SCHOOL_LABEL[e.school]}</span>
          {e.course && <span className="sc-course">{e.course}</span>}
          {e.location && <span>{e.location}</span>}
          {e.cancelled && <span className="sc-flag">Cancelled</span>}
        </small>
      </span>
      {e.url && (
        <a className="bk-link" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${e.title} in the Canvas calendar (new tab)`}>
          Canvas calendar
        </a>
      )}
    </li>
  );
}

function EventList({ events, empty }: { events: SchoolEvent[]; empty: string }) {
  if (events.length === 0) return <p className="bk-note bk-empty">{empty}</p>;
  return <ul className="sc-list">{events.map((e) => <EventRow key={e.id} e={e} />)}</ul>;
}

function SchoolStatus({ state, busy, nowMs, onRefresh }: { state: SchoolState; busy: boolean; nowMs: number; onRefresh: () => void }) {
  const label = SCHOOL_LABEL[state.school];
  const cooling = state.cooldownUntil !== null && Date.parse(state.cooldownUntil) > nowMs;
  return (
    <li className="sc-status">
      <span className={`sc-badge sc-badge-${state.school}`}>{label}</span>
      <span className="sc-status-text">
        {!state.configured
          ? "No feed link set."
          : state.updatedAt
            ? `Updated ${fmtDateTime(state.updatedAt)}.`
            : state.lastError
              ? "Not loaded."
              : "Not loaded yet."}
        {state.stale && state.updatedAt && <strong className="sc-flag"> Stale: showing the last good copy.</strong>}
        {state.lastError && <span className="sc-error" role="status"> {SCHOOL_ERROR_TEXT[state.lastError]}</span>}
      </span>
      {state.configured && (
        <button className="ft-btn" onClick={onRefresh} disabled={busy || cooling} aria-label={`Refresh ${label}`}>
          {busy ? "Refreshing…" : cooling ? "Refresh soon" : "Refresh"}
        </button>
      )}
    </li>
  );
}

function CalendarView({ events, today }: { events: SchoolEvent[]; today: string }) {
  const [shown, setShown] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [picked, setPicked] = useState(today);
  const cells = useMemo(() => monthCells(shown.y, shown.m), [shown]);
  const byDay = useMemo(() => {
    const map = new Map<string, SchoolEvent[]>();
    for (const c of cells) if (c) map.set(c, eventsOn(events, c));
    return map;
  }, [cells, events]);
  const move = (n: number) => setShown(({ y, m }) => ({ y: new Date(y, m + n, 1).getFullYear(), m: new Date(y, m + n, 1).getMonth() }));
  const title = new Date(shown.y, shown.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <div className="sc-cal">
      <div className="sc-cal-nav">
        <button className="ft-btn" onClick={() => move(-1)} aria-label="Previous month">‹</button>
        <h4 aria-live="polite">{title}</h4>
        <button className="ft-btn" onClick={() => move(1)} aria-label="Next month">›</button>
      </div>
      <div className="sc-grid" role="group" aria-label={title}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="sc-dow" aria-hidden>{d}</span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={`pad-${i}`} className="sc-cell sc-pad" aria-hidden />;
          const list = byDay.get(c) ?? [];
          const schools = SCHOOL_IDS.filter((s) => list.some((e) => e.school === s));
          return (
            <button
              key={c}
              className={`sc-cell${c === today ? " sc-today" : ""}${c === picked ? " sc-picked" : ""}`}
              aria-pressed={c === picked}
              aria-label={`${fmtDay(c, { weekday: "long", month: "long", day: "numeric" })}: ${list.length} ${list.length === 1 ? "event" : "events"}`}
              onClick={() => setPicked(c)}
            >
              <span className="sc-daynum">{Number(c.slice(8))}</span>
              <span className="sc-dots" aria-hidden>
                {schools.map((s) => <i key={s} className={`sc-dot sc-dot-${s}`} />)}
                {list.length > 0 && <b>{list.length}</b>}
              </span>
            </button>
          );
        })}
      </div>
      <h4 className="sc-day-h">{fmtDay(picked, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h4>
      <EventList events={eventsOn(events, picked)} empty="Nothing on the calendar this day." />
    </div>
  );
}

interface Props {
  access: BrokerageClient;
  school: SchoolClient;
  onClose: () => void;
}

/** The School building: Canvas calendar feeds for SDSU and SDCCD, read-only. Calendar data only: no grades, submissions or completion. */
export function SchoolDashboard({ access, school, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("upcoming");
  // ticks so a refresh button re-enables when its cooldown ends
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const unlocked = access.access === "unlocked";
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.getSnapshot, collapsedStore.getServerSnapshot) !== "0"; // compact by default: deadlines sit higher up
  const todayKey = localDayKey(new Date());
  const events = useMemo(() => combine(school.states), [school.states]);
  const configured = school.states.filter((s) => s.configured).length;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const soon = useMemo(() => upcoming(events, todayKey), [events, todayKey]);
  const nothingLoaded = unlocked && school.loaded && configured > 0 && !school.states.some((s) => s.updatedAt);

  return (
    <div className="ft-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ft-bank" role="dialog" aria-modal="true" aria-labelledby="school-title">
        <header className="ft-bank-head">
          <h2 id="school-title">Town School</h2>
          <span className="ft-pill">Canvas calendars · read-only</span>
          <button ref={closeRef} className="ft-btn" onClick={onClose}>
            Leave school <kbd>Esc</kbd>
          </button>
        </header>
        <div className="ft-bank-body">
          {!unlocked ? (
            <article className="ft-card bk-notice">
              <h3>Unlock your calendars</h3>
              {access.access === "checking" && <p>Checking the local session…</p>}
              {access.access === "not_configured" && <p>No local access code is set on the server, so calendar feeds stay off. Set FINANCE_TOWN_ACCESS_CODE as described in docs/school.md.</p>}
              {access.access === "locked" && (
                <>
                  <p>Your calendar feeds are private. Unlock with your local access code to read them.</p>
                  <UnlockForm client={access} purpose="read your school calendars" />
                </>
              )}
            </article>
          ) : (
            <>
              {school.fixtures && <p className="bk-note sc-synthetic">Synthetic test data</p>}
              <article className="ft-card sc-feeds" aria-labelledby="school-feeds">
                <div className="sc-feeds-bar">
                  <h3 id="school-feeds" className="bk-fold">
                    <button className="bk-fold-btn" aria-expanded={!collapsed} aria-controls="school-feeds-body" onClick={() => collapsedStore.write(collapsed ? "0" : "1")}>
                      <span aria-hidden>{collapsed ? "▸" : "▾"}</span> Calendars
                      <span className="bk-fold-hint">{collapsed ? "Show" : "Minimize"}</span>
                    </button>
                  </h3>
                  {collapsed && (
                    <p className="sc-chips" id="school-feeds-body">
                      {school.states.map((s) => (
                        <span key={s.school} className="sc-chip">
                          <span className={`sc-badge sc-badge-${s.school}`}>{SCHOOL_LABEL[s.school]}</span>
                          {!s.configured ? "no feed link" : s.lastError ? (s.stale ? "stale" : "error") : s.updatedAt ? `updated ${fmtTimeOnly(s.updatedAt)}` : "not loaded"}
                        </span>
                      ))}
                    </p>
                  )}
                  {collapsed && configured > 0 && (
                    <button className="ft-btn sc-small" onClick={() => void school.refreshAll()} disabled={Object.values(school.busy).some(Boolean) || school.states.filter((s) => s.configured).every((s) => s.cooldownUntil !== null && Date.parse(s.cooldownUntil) > nowMs)}>
                      Refresh
                    </button>
                  )}
                </div>
                {collapsed && school.states.some((s) => s.lastError) && (
                  <p className="sc-error" role="status">{school.states.filter((s) => s.lastError).map((s) => `${SCHOOL_LABEL[s.school]}: ${SCHOOL_ERROR_TEXT[s.lastError!]}`).join(" ")}</p>
                )}
                {collapsed && school.message && <p className="sc-error" role="status">{school.message}</p>}
                {!collapsed && (
                  <div id="school-feeds-body">
                    <ul className="sc-statuses">
                      {school.states.map((s) => (
                        <SchoolStatus key={s.school} state={s} busy={!!school.busy[s.school]} nowMs={nowMs} onRefresh={() => void school.refresh(s.school)} />
                      ))}
                    </ul>
                    {configured === 0 && school.loaded && (
                      <p className="bk-note">
                        No feed links are set. In Canvas, open Calendar, choose Calendar Feed, copy the link, and paste it into CANVAS_SDSU_FEED_URL or CANVAS_SDCCD_FEED_URL in .env.local. Then restart the app. Steps: docs/school.md.
                      </p>
                    )}
                    {school.message && <p className="sc-error" role="status">{school.message}</p>}
                    {configured > 1 && (
                      <p>
                        <button className="ft-btn" onClick={() => void school.refreshAll()} disabled={Object.values(school.busy).some(Boolean)}>Refresh both</button>
                      </p>
                    )}
                    <p className="bk-note">Dates come from the Canvas calendar feeds only. Grades, submission status and completion are not read or shown.</p>
                  </div>
                )}
              </article>

              <div className="sc-tabs" role="tablist" aria-label="School views">
                {VIEWS.map((v) => (
                  <button key={v.id} role="tab" id={`sc-tab-${v.id}`} aria-selected={view === v.id} aria-controls="sc-panel" className={`ft-btn${view === v.id ? " ft-btn-primary" : ""}`} onClick={() => setView(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
              <article className="ft-card" id="sc-panel" role="tabpanel" aria-labelledby={`sc-tab-${view}`}>
                {nothingLoaded && <p className="bk-note bk-empty">Nothing loaded yet. Press Refresh above.</p>}
                {view === "upcoming" && (
                  <>
                    <h3>Upcoming</h3>
                    {soon.days.length === 0 && <p className="bk-note bk-empty">{events.length ? "Nothing due today or in the next 7 days." : "No events loaded."}</p>}
                    {soon.days.map((d) => (
                      <section key={d.day} className="sc-day">
                        <h4>{d.day === todayKey ? "Today · " : ""}{fmtDay(d.day, { weekday: "long", month: "short", day: "numeric" })}</h4>
                        <EventList events={d.events} empty="" />
                      </section>
                    ))}
                    {soon.days.length > 0 && soon.emptyDays.length > 0 && (
                      <p className="bk-note">Nothing on {soon.emptyDays.map((d) => fmtDay(d, { weekday: "short", month: "short", day: "numeric" })).join(", ")}.</p>
                    )}
                  </>
                )}
                {view === "calendar" && (
                  <>
                    <h3>Calendar</h3>
                    <CalendarView events={events} today={todayKey} />
                  </>
                )}
              </article>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
