// iCalendar (.ics) feed to a small, safe event list. Uses ical.js for parsing and recurrence. Only titles, times, a course
// label, a location and a validated Canvas link are kept: descriptions and attendees are dropped on purpose.
import ICAL from "ical.js";
import type { SchoolEvent, SchoolId } from "../school";
import { safeEventUrl } from "./schoolHosts";

/** Events from this long before now to this long after it. Repeating events are expanded inside the same window. */
export const WINDOW_PAST_DAYS = 14;
export const WINDOW_FUTURE_DAYS = 120;
const MAX_EVENTS = 2000;
const MAX_ITERATIONS = 5000;
const DAY_MS = 86_400_000;

const clean = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Canvas ends titles with the course in square brackets: "Homework 3 [MATH 150 - Calculus]". */
export function splitTitle(summary: unknown): { title: string; course: string | null } {
  const text = clean(summary, 300);
  const m = text.match(/^(.*?)\s*\[([^\]]{1,120})\]$/);
  if (!m || !m[1]) return { title: text || "Untitled event", course: null };
  return { title: m[1].trim().slice(0, 200), course: m[2].trim() };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** The UTC instant of a wall-clock time in an IANA zone, found by checking the zone's own offset. Null for an unknown zone. */
export function wallToInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, tzid: string): Date | null {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tzid, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return null;
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const seen = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    guess += wall - seen;
  }
  return new Date(guess);
}

interface When {
  /** All-day: `YYYY-MM-DD`. Timed: ISO instant, or floating `YYYY-MM-DDTHH:mm:ss`. */
  text: string;
  /** Absolute time for windowing. Floating times are compared as if they were UTC. */
  ms: number;
}

function whenOf(t: ICAL.Time, tzid: string | null): When {
  if (t.isDate) return { text: `${t.year}-${p2(t.month)}-${p2(t.day)}`, ms: Date.UTC(t.year, t.month - 1, t.day) };
  const zone = t.zone?.tzid;
  if (zone === "UTC" || zone === "Z") {
    const d = t.toJSDate();
    return { text: d.toISOString(), ms: d.getTime() };
  }
  if (zone && zone !== "floating") {
    const d = t.toJSDate(); // a VTIMEZONE shipped in the feed
    return { text: d.toISOString(), ms: d.getTime() };
  }
  if (tzid) {
    const d = wallToInstant(t.year, t.month, t.day, t.hour, t.minute, t.second, tzid);
    if (d) return { text: d.toISOString(), ms: d.getTime() };
  }
  return { text: `${t.year}-${p2(t.month)}-${p2(t.day)}T${p2(t.hour)}:${p2(t.minute)}:${p2(t.second)}`, ms: Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) };
}

const tzidOf = (comp: ICAL.Component, name: string): string | null => {
  const v = comp.getFirstProperty(name)?.getParameter("tzid");
  return typeof v === "string" && v ? v : null;
};

export function parseFeed(text: string, school: SchoolId, now: Date): SchoolEvent[] {
  ICAL.TimezoneService.reset();
  const root = new ICAL.Component(ICAL.parse(text));
  for (const vtz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(new ICAL.Timezone(vtz));

  const from = now.getTime() - WINDOW_PAST_DAYS * DAY_MS;
  const to = now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS;
  const byUid = new Map<string, { master: ICAL.Component[]; exceptions: ICAL.Component[] }>();
  let anon = 0;
  for (const comp of root.getAllSubcomponents("vevent")) {
    const uid = clean(comp.getFirstPropertyValue("uid"), 300) || `anon-${anon++}`;
    const slot = byUid.get(uid) ?? { master: [], exceptions: [] };
    (comp.hasProperty("recurrence-id") ? slot.exceptions : slot.master).push(comp);
    byUid.set(uid, slot);
  }

  const out: SchoolEvent[] = [];
  const build = (uid: string, suffix: string, vevent: ICAL.Component, start: When, end: When | null, allDay: boolean): SchoolEvent => {
    const { title, course } = splitTitle(vevent.getFirstPropertyValue("summary"));
    const status = String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase();
    const loc = clean(vevent.getFirstPropertyValue("location"), 120);
    const kind = /^event-assignment/i.test(uid) ? "assignment" : "event";
    return {
      id: `${school}:${uid}${suffix}`,
      school,
      title,
      course,
      start: start.text,
      end: end ? end.text : null,
      allDay,
      kind,
      dueTimeUnknown: allDay && kind === "assignment",
      location: loc || null,
      url: safeEventUrl(school, vevent.getFirstPropertyValue("url")),
      cancelled: status === "CANCELLED",
    };
  };
  const overlaps = (start: When, end: When | null) => (end ?? start).ms >= from && start.ms <= to;

  for (const [uid, { master, exceptions }] of byUid) {
    // duplicate UIDs inside one feed: keep the revision with the highest SEQUENCE, then the last one listed
    const best = master.reduce<ICAL.Component | null>((acc, c) => {
      if (!acc) return c;
      return Number(c.getFirstPropertyValue("sequence") ?? 0) >= Number(acc.getFirstPropertyValue("sequence") ?? 0) ? c : acc;
    }, null);
    if (!best) {
      for (const ex of exceptions) {
        const ev = new ICAL.Event(ex);
        if (!ev.startDate) continue;
        const s = whenOf(ev.startDate, tzidOf(ex, "dtstart"));
        const e = ev.endDate ? whenOf(ev.endDate, tzidOf(ex, "dtend")) : null;
        if (overlaps(s, e)) out.push(build(uid, `@${s.text}`, ex, s, e, ev.startDate.isDate));
      }
      continue;
    }
    const ev = new ICAL.Event(best);
    if (!ev.startDate) continue;
    const startTz = tzidOf(best, "dtstart");
    const endTz = tzidOf(best, "dtend");
    if (!ev.isRecurring()) {
      const s = whenOf(ev.startDate, startTz);
      const e = ev.endDate ? whenOf(ev.endDate, endTz) : null;
      if (overlaps(s, e)) out.push(build(uid, "", best, s, e, ev.startDate.isDate));
      continue;
    }
    for (const ex of exceptions) ev.relateException(new ICAL.Event(ex) as unknown as ICAL.Component);
    const it = ev.iterator();
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const next = it.next();
      if (!next) break;
      const details = ev.getOccurrenceDetails(next);
      const s = whenOf(details.startDate, startTz);
      if (s.ms > to) break;
      const e = whenOf(details.endDate, endTz);
      if (!overlaps(s, e)) continue;
      const item = details.item as unknown as { component: ICAL.Component };
      out.push(build(uid, `@${s.text}`, item.component ?? best, s, e, details.startDate.isDate));
      if (out.length >= MAX_EVENTS) break;
    }
  }
  return out.slice(0, MAX_EVENTS);
}
