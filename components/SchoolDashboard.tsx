"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createLocalStore } from "@/lib/localStore";
import {
  SCHOOL_ERROR_TEXT, SCHOOL_LABEL, SCHOOL_IDS, combine, eventsOn, localDayKey, monthCells, timeLabel, upcoming,
  startDay, type SchoolEvent, type SchoolState,
} from "@/lib/school";
import { STATUS_TEXT, findCs210Courses, isVisible, markStatus, previewRule, type MarkStatus } from "@/lib/schoolMarks";
import { UnlockForm, fmtDateTime } from "./BrokeragePanel";
import type { SchoolMarksClient } from "./useSchoolMarks";
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

/** Keys typed in the checklist controls belong to the form, never to the game (Escape still closes the school). */
const keepKeys = (e: React.KeyboardEvent) => e.key !== "Escape" && e.stopPropagation();

function EventRow({ e, status, marks }: { e: SchoolEvent; status: MarkStatus; marks: SchoolMarksClient }) {
  const off = marks.unreadable;
  return (
    <li className={`sc-event sc-${e.school}${e.cancelled ? " sc-cancelled" : ""}${status ? " sc-marked" : ""}`} data-evid={e.id}>
      <label className="sc-donebox" onKeyDown={keepKeys}>
        <input type="checkbox" className="sc-check" checked={status === "done"} disabled={off} onChange={() => marks.toggleDone(e.id)} aria-label={`Mark done: ${e.title}`} />
        <span aria-hidden>Done</span>
      </label>
      {timeText(e) && <span className="sc-time">{timeText(e)}</span>}
      <span className="sc-main">
        <strong>{e.title}</strong>
        <small>
          <span className={`sc-badge sc-badge-${e.school}`}>{SCHOOL_LABEL[e.school]}</span>
          {e.course && <span className="sc-course">{e.course}</span>}
          {e.location && <span>{e.location}</span>}
          {e.cancelled && <span className="sc-flag">Cancelled</span>}
          {status && <span className="sc-mark">{STATUS_TEXT[status]}</span>}
        </small>
      </span>
      {status !== "rule" && (
        <button className="bk-link" onKeyDown={keepKeys} disabled={off} onClick={() => marks.toggleIgnored(e.id)} aria-label={`${status === "ignored" ? "Stop ignoring" : "Ignore"}: ${e.title}`}>
          {status === "ignored" ? "Stop ignoring" : "Ignore"}
        </button>
      )}
      {e.url && (
        <a className="bk-link" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${e.title} in the Canvas calendar (new tab)`}>
          Canvas calendar
        </a>
      )}
    </li>
  );
}

function EventList({ events, empty, marks }: { events: SchoolEvent[]; empty: string; marks: SchoolMarksClient }) {
  if (events.length === 0) return <p className="bk-note bk-empty">{empty}</p>;
  return <ul className="sc-list">{events.map((e) => <EventRow key={e.id} e={e} status={markStatus(e, marks.marks)} marks={marks} />)}</ul>;
}

/** Optional rule: hides SDSU CS 210 labs and "W# Programming Assignment" items. Shows exactly what it would hide before saving. */
function RulesCard({ events, marks }: { events: SchoolEvent[]; marks: SchoolMarksClient }) {
  const [pending, setPending] = useState<string | null>(null);
  const courses = useMemo(() => findCs210Courses(events), [events]);
  const choice = courses.find((c) => c.courseKey === pending) ?? null;
  const hits = choice ? previewRule(choice, events) : [];
  const saved = marks.marks.rules;
  return (
    <article className="ft-card sc-rules" aria-labelledby="sc-rules-h">
      <h3 id="sc-rules-h">Ignore rules</h3>
      <p className="bk-note">
        Optional. A rule hides matching items from Upcoming and the town reminder as “Ignored by you”. It does not mean they are done, submitted or worth zero points, and nothing changes in Canvas. Rules apply only to the course they were made for.
      </p>
      {saved.map((r) => (
        <div key={r.id} className="sc-rule" onKeyDown={keepKeys}>
          <label>
            <input type="checkbox" checked={r.enabled} disabled={marks.unreadable} onChange={(e) => marks.setRuleEnabled(r.id, e.target.checked)} />{" "}
            <strong>{SCHOOL_LABEL[r.school]} {r.courseLabel}</strong>: ignore “Lab #” and “W# Programming Assignment”
          </label>
          <small>{previewRule(r, events).length} matching now. {r.enabled ? "On." : "Off: these items are shown again."}</small>
          <button className="bk-link" disabled={marks.unreadable} onClick={() => marks.removeRule(r.id)}>Remove rule</button>
        </div>
      ))}
      {courses.filter((c) => !saved.some((r) => r.courseKey === c.courseKey)).map((c) => (
        <div key={c.courseKey} className="sc-rule" onKeyDown={keepKeys}>
          <span>Found {SCHOOL_LABEL[c.school]} course <strong>{c.label}</strong>.</span>
          <button className="ft-btn" disabled={marks.unreadable} aria-expanded={pending === c.courseKey} onClick={() => setPending(pending === c.courseKey ? null : c.courseKey)}>
            {pending === c.courseKey ? "Cancel" : "Preview rule"}
          </button>
        </div>
      ))}
      {courses.length === 0 && saved.length === 0 && <p className="bk-note">No SDSU CS 210 course found in the loaded calendars yet.</p>}
      {choice && (
        <div className="sc-preview" role="region" aria-label="Rule preview" onKeyDown={keepKeys}>
          <p><strong>{hits.length}</strong> {hits.length === 1 ? "item" : "items"} in {choice.label} would be ignored. “Assignment 01”, “Assignment 02” and other titles stay visible.</p>
          {hits.length > 0 && <ul className="sc-list">{hits.map((e) => <li key={e.id} className="sc-event"><span className="sc-main"><strong>{e.title}</strong><small>{startDay(e)}</small></span></li>)}</ul>}
          <button className="ft-btn ft-btn-save" onClick={() => { marks.addRule({ preset: "labs-and-w-programming", school: choice.school, courseKey: choice.courseKey, courseLabel: choice.label }); setPending(null); }}>
            Save rule
          </button>
        </div>
      )}
    </article>
  );
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

function CalendarView({ events, today, marks }: { events: SchoolEvent[]; today: string; marks: SchoolMarksClient }) {
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
      <EventList events={eventsOn(events, picked)} empty="Nothing on the calendar this day." marks={marks} />
    </div>
  );
}

interface Props {
  access: BrokerageClient;
  school: SchoolClient;
  marks: SchoolMarksClient;
  onClose: () => void;
}

/** The School building: Canvas calendar feeds for SDSU and SDCCD, read-only. Calendar data only: no grades, submissions or completion. */
export function SchoolDashboard({ access, school, marks, onClose }: Props) {
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
  const [showDone, setShowDone] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const opts = { showDone, showIgnored };
  const days = useMemo(() => soon.days.map((d) => ({ ...d, events: d.events.filter((e) => isVisible(e, marks.marks, opts)) })).filter((d) => d.events.length > 0), [soon, marks.marks, showDone, showIgnored]); // eslint-disable-line react-hooks/exhaustive-deps
  const allUpcoming = soon.days.flatMap((d) => d.events);
  const nDone = allUpcoming.filter((e) => markStatus(e, marks.marks) === "done").length;
  const nIgnored = allUpcoming.filter((e) => ["ignored", "rule"].includes(markStatus(e, marks.marks) ?? "")).length;

  // When a checked or ignored row leaves the list, focus moves to the next row (else the previous one, else the heading).
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<{ gone: string; next: string | null } | null>(null);
  const withFocus = (id: string, act: () => void) => {
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-evid]") ?? [])].map((r) => r.dataset.evid!);
    const i = rows.indexOf(id);
    focusAfter.current = { gone: id, next: rows[i + 1] ?? rows[i - 1] ?? null };
    act();
  };
  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const stillThere = panelRef.current?.querySelector(`[data-evid="${CSS.escape(f.gone)}"]`);
    if (stillThere) return; // the row stayed (its own control keeps focus)
    const target = f.next && panelRef.current?.querySelector<HTMLElement>(`[data-evid="${CSS.escape(f.next)}"] .sc-check`);
    (target || headingRef.current)?.focus();
  });
  const view_marks: SchoolMarksClient = useMemo(
    () => ({ ...marks, toggleDone: (id) => withFocus(id, () => marks.toggleDone(id)), toggleIgnored: (id) => withFocus(id, () => marks.toggleIgnored(id)) }),
    [marks],
  );
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
                    <button className="bk-fold-btn" title={collapsed ? "Expand" : "Minimize"} aria-expanded={!collapsed} aria-controls="school-feeds-body" onClick={() => collapsedStore.write(collapsed ? "0" : "1")}>
                      <span aria-hidden>{collapsed ? "▸" : "▾"}</span> Calendars
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
              <article className="ft-card" id="sc-panel" role="tabpanel" ref={panelRef} aria-labelledby={`sc-tab-${view}`}>
                {nothingLoaded && <p className="bk-note bk-empty">Nothing loaded yet. Press Refresh above.</p>}
                {view === "upcoming" && (
                  <>
                    <h3 ref={headingRef} tabIndex={-1}>Upcoming</h3>
                    <p className="bk-note">
                      “Done” is your own checklist. It does not confirm or change anything in Canvas, and Canvas’s submission status is never read. Counts here are unchecked calendar items, not verified unfinished work.
                    </p>
                    {marks.unreadable && (
                      <p className="sc-error" role="alert">
                        Your saved checklist could not be read, so changes are paused and nothing was overwritten. <button className="bk-link" onClick={marks.startFresh}>Start a fresh checklist</button> (the old data is copied to a backup key first).
                      </p>
                    )}
                    {marks.saveError && <p className="sc-error" role="alert">{marks.saveError}</p>}
                    {(nDone > 0 || nIgnored > 0) && (
                      <p className="sc-toggles">
                        {nDone > 0 && <label><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show marked-done items ({nDone})</label>}
                        {nIgnored > 0 && <label><input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> Show ignored ({nIgnored})</label>}
                      </p>
                    )}
                    {days.length === 0 && <p className="bk-note bk-empty">{events.length ? (soon.days.length ? "Everything coming up is marked done or ignored." : "Nothing due today or in the next 7 days.") : "No events loaded."}</p>}
                    {days.map((d) => (
                      <section key={d.day} className="sc-day">
                        <h4>{d.day === todayKey ? "Today · " : ""}{fmtDay(d.day, { weekday: "long", month: "short", day: "numeric" })}</h4>
                        <EventList events={d.events} empty="" marks={view_marks} />
                      </section>
                    ))}
                    {days.length > 0 && soon.emptyDays.length > 0 && (
                      <p className="bk-note">Nothing on {soon.emptyDays.map((d) => fmtDay(d, { weekday: "short", month: "short", day: "numeric" })).join(", ")}.</p>
                    )}
                  </>
                )}
                {view === "calendar" && (
                  <>
                    <h3>Calendar</h3>
                    <CalendarView events={events} today={todayKey} marks={view_marks} />
                  </>
                )}
              </article>
              <RulesCard events={events} marks={marks} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
