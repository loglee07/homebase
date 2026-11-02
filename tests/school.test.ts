import { describe, expect, it } from "vitest";
import { parseFeed, splitTitle, wallToInstant } from "@/lib/server/ics";
import { hostAllowed, parseFeedUrl, redirectAllowed, safeEventUrl } from "@/lib/server/schoolHosts";
import { addDays, combine, eventsOn, monthCells, nextSevenDays, occursOn, sortEvents, startDay, timeLabel, noticeKind, townNotice, upcoming, type SchoolEvent, type SchoolState } from "@/lib/school";

const NOW = new Date("2026-11-04T18:00:00Z");
const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const parse = (text: string, school: "sdsu" | "sdccd" = "sdsu") => parseFeed(text, school, NOW);

describe("titles and courses", () => {
  it("splits the trailing [course] Canvas adds", () => {
    expect(splitTitle("Homework 3 [MATH 150 - Calculus]")).toEqual({ title: "Homework 3", course: "MATH 150 - Calculus" });
    expect(splitTitle("Plain title")).toEqual({ title: "Plain title", course: null });
    expect(splitTitle("[Only course]")).toEqual({ title: "[Only course]", course: null });
    expect(splitTitle("")).toEqual({ title: "Untitled event", course: null });
    expect(splitTitle("A\u0000b\n[X]")).toEqual({ title: "A b", course: "X" });
  });
});

describe("parsing: times", () => {
  it("reads UTC times as instants", () => {
    const [e] = parse(cal(ev("UID:a", "DTSTART:20261105T170000Z", "DTEND:20261105T180000Z", "SUMMARY:Quiz [BIO 1]")));
    expect(e).toMatchObject({ id: "sdsu:a", school: "sdsu", title: "Quiz", course: "BIO 1", start: "2026-11-05T17:00:00.000Z", end: "2026-11-05T18:00:00.000Z", allDay: false, cancelled: false });
  });
  it("converts a TZID with a shipped VTIMEZONE", () => {
    const vtz = ["BEGIN:VTIMEZONE", "TZID:America/Los_Angeles", "BEGIN:STANDARD", "DTSTART:19701101T020000", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
      "BEGIN:DAYLIGHT", "DTSTART:19700308T020000", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT", "END:VTIMEZONE"].join("\r\n");
    const [e] = parse(cal(vtz, ev("UID:b", "DTSTART;TZID=America/Los_Angeles:20261105T090000", "SUMMARY:Class")));
    expect(e.start).toBe("2026-11-05T17:00:00.000Z"); // 9am PST (UTC-8)
  });
  it("converts a TZID the feed does not define, using the IANA zone, across daylight saving", () => {
    const [summer] = parseFeed(cal(ev("UID:c", "DTSTART;TZID=America/Los_Angeles:20260715T090000", "SUMMARY:Class")), "sdsu", new Date("2026-07-10T00:00:00Z"));
    expect(summer.start).toBe("2026-07-15T16:00:00.000Z"); // PDT, UTC-7
    const [winter] = parse(cal(ev("UID:d", "DTSTART;TZID=America/Los_Angeles:20261105T090000", "SUMMARY:Class")));
    expect(winter.start).toBe("2026-11-05T17:00:00.000Z");
  });
  it("keeps floating times as written wall-clock time", () => {
    const [e] = parse(cal(ev("UID:f", "DTSTART:20261105T090000", "SUMMARY:Floating")));
    expect(e.start).toBe("2026-11-05T09:00:00");
    expect(e.allDay).toBe(false);
  });
  it("reads all-day events as dates with an exclusive end", () => {
    const [e] = parse(cal(ev("UID:g", "DTSTART;VALUE=DATE:20261106", "DTEND;VALUE=DATE:20261108", "SUMMARY:Break")));
    expect(e).toMatchObject({ allDay: true, start: "2026-11-06", end: "2026-11-08" });
  });
  it("wallToInstant handles the spring-forward and fall-back days and rejects bad zones", () => {
    expect(wallToInstant(2026, 3, 8, 12, 0, 0, "America/Los_Angeles")?.toISOString()).toBe("2026-03-08T19:00:00.000Z");
    expect(wallToInstant(2026, 11, 1, 12, 0, 0, "America/Los_Angeles")?.toISOString()).toBe("2026-11-01T20:00:00.000Z");
    expect(wallToInstant(2026, 1, 1, 0, 0, 0, "Not/AZone")).toBeNull();
  });
});

describe("parsing: recurrence, cancellations, duplicates", () => {
  it("expands a weekly event inside the window and honours EXDATE", () => {
    const text = cal(ev("UID:w", "DTSTART:20261104T170000Z", "DTEND:20261104T180000Z", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20261111T170000Z", "SUMMARY:Lecture [CS 1]"));
    const out = parse(text);
    expect(out.map((e) => e.start)).toEqual(["2026-11-04T17:00:00.000Z", "2026-11-18T17:00:00.000Z", "2026-11-25T17:00:00.000Z"]);
    expect(new Set(out.map((e) => e.id)).size).toBe(3); // each occurrence has its own id
    expect(out.every((e) => e.id.startsWith("sdsu:w@"))).toBe(true);
  });
  it("applies a moved or cancelled occurrence (RECURRENCE-ID)", () => {
    const text = cal(
      ev("UID:r", "DTSTART:20261104T170000Z", "DTEND:20261104T180000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Lab"),
      ev("UID:r", "RECURRENCE-ID:20261111T170000Z", "DTSTART:20261112T190000Z", "DTEND:20261112T200000Z", "SUMMARY:Lab (moved)"),
      ev("UID:r", "RECURRENCE-ID:20261118T170000Z", "DTSTART:20261118T170000Z", "STATUS:CANCELLED", "SUMMARY:Lab"),
    );
    const out = parse(text).sort((a, b) => a.start.localeCompare(b.start));
    expect(out.map((e) => [e.start, e.title, e.cancelled])).toEqual([
      ["2026-11-04T17:00:00.000Z", "Lab", false],
      ["2026-11-12T19:00:00.000Z", "Lab (moved)", false],
      ["2026-11-18T17:00:00.000Z", "Lab", true],
    ]);
  });
  it("marks cancelled events instead of dropping them", () => {
    expect(parse(cal(ev("UID:x", "DTSTART:20261105T170000Z", "STATUS:CANCELLED", "SUMMARY:Quiz")))[0].cancelled).toBe(true);
  });
  it("keeps the highest SEQUENCE when a UID repeats in one feed", () => {
    const text = cal(ev("UID:d", "SEQUENCE:1", "DTSTART:20261105T170000Z", "SUMMARY:Old"), ev("UID:d", "SEQUENCE:3", "DTSTART:20261105T190000Z", "SUMMARY:New"), ev("UID:d", "SEQUENCE:2", "DTSTART:20261105T180000Z", "SUMMARY:Mid"));
    const out = parse(text);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("New");
  });
  it("never collides IDs across schools that reuse a UID", () => {
    const text = cal(ev("UID:same", "DTSTART:20261105T170000Z", "SUMMARY:Item"));
    const a = parse(text, "sdsu");
    const b = parse(text, "sdccd");
    expect(a[0].id).not.toBe(b[0].id);
    expect(combine([{ events: a }, { events: b }]).map((e) => e.id)).toEqual(["sdsu:same", "sdccd:same"]);
  });
  it("drops events outside the window and survives junk", () => {
    expect(parse(cal(ev("UID:old", "DTSTART:20200101T170000Z", "SUMMARY:Ancient"), ev("UID:far", "DTSTART:20300101T170000Z", "SUMMARY:Far")))).toEqual([]);
    expect(parse(cal(ev("UID:nodate", "SUMMARY:No start")))).toEqual([]);
    expect(() => parse("not a calendar")).toThrow();
  });
  it("keeps only safe fields: no description, and links only on the school's own host", () => {
    const text = cal(
      ev("UID:l1", "DTSTART:20261105T170000Z", "SUMMARY:A", "DESCRIPTION:secret notes https://evil.example/x", "URL;VALUE=URI:https://sdsu.instructure.com/calendar?event_id=1"),
      ev("UID:l2", "DTSTART:20261105T180000Z", "SUMMARY:B", "URL;VALUE=URI:https://evil.example/phish"),
      ev("UID:l3", "DTSTART:20261105T190000Z", "SUMMARY:C", "URL;VALUE=URI:http://sdsu.instructure.com/insecure", "LOCATION:Room 1\\, Hall"),
    );
    const out = parse(text).sort((a, b) => a.start.localeCompare(b.start));
    expect(out.map((e) => e.url)).toEqual(["https://sdsu.instructure.com/calendar?event_id=1", null, null]);
    expect(JSON.stringify(out)).not.toMatch(/secret notes|evil/);
    expect(out[2].location).toBe("Room 1, Hall");
  });
});

describe("feed hosts and links", () => {
  it("accepts only each school's own hosts", () => {
    expect(hostAllowed("sdsu", "sdsu.instructure.com")).toBe(true);
    expect(hostAllowed("sdsu", "ilearn.sdsu.edu")).toBe(true);
    expect(hostAllowed("sdsu", "sdccd.instructure.com")).toBe(false);
    expect(hostAllowed("sdccd", "SDCCD.instructure.com")).toBe(true);
    for (const bad of ["evilsdsu.edu", "sdsu.edu.evil.com", "sdsu.instructure.com.evil.com", "instructure.com"]) expect(hostAllowed("sdsu", bad)).toBe(false);
  });
  it("accepts a normal https feed link and rejects unsafe ones", () => {
    expect(parseFeedUrl("sdsu", "https://sdsu.instructure.com/feeds/calendars/user_abc.ics")?.hostname).toBe("sdsu.instructure.com");
    for (const bad of [
      "http://sdsu.instructure.com/feeds/calendars/user_abc.ics",
      "https://user:pw@sdsu.instructure.com/feeds/calendars/user_abc.ics",
      "https://sdsu.instructure.com:8443/feeds/calendars/user_abc.ics",
      "https://sdccd.instructure.com/feeds/calendars/user_abc.ics",
      "https://sdsu.instructure.com/feeds/calendars/user_abc",
      "webcal://sdsu.instructure.com/feeds/calendars/user_abc.ics",
      "not a url",
      "",
    ])
      expect(parseFeedUrl("sdsu", bad)).toBeNull();
    expect(parseFeedUrl("sdsu", undefined)).toBeNull();
  });
  it("checks redirect targets and event links the same way", () => {
    expect(redirectAllowed("sdsu", new URL("https://ilearn.sdsu.edu/x"))).toBe(true);
    expect(redirectAllowed("sdsu", new URL("https://evil.example/x"))).toBe(false);
    expect(redirectAllowed("sdsu", new URL("http://sdsu.instructure.com/x"))).toBe(false);
    expect(safeEventUrl("sdccd", "https://sdccd.instructure.com/courses/1")).toBe("https://sdccd.instructure.com/courses/1");
    expect(safeEventUrl("sdccd", "javascript:alert(1)")).toBeNull();
    expect(safeEventUrl("sdccd", 5)).toBeNull();
  });
});

describe("Today, next 7 days and the calendar", () => {
  const e = (id: string, start: string, allDay = false, end: string | null = null): SchoolEvent => ({ id, school: "sdsu", title: id, course: null, start, end, allDay, kind: "event", dueTimeUnknown: false, location: null, url: null, cancelled: false });
  const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();
  it("places timed events on the viewer's local day", () => {
    expect(startDay(e("a", local(2026, 11, 4, 23)))).toBe("2026-11-04");
    expect(startDay(e("a", local(2026, 11, 5, 0)))).toBe("2026-11-05");
    expect(startDay(e("a", "2026-11-05T09:00:00"))).toBe("2026-11-05"); // floating
  });
  it("spans multi-day all-day events up to the exclusive end only", () => {
    const x = e("brk", "2026-11-06", true, "2026-11-08");
    expect([5, 6, 7, 8].map((d) => occursOn(x, `2026-11-0${d}`))).toEqual([false, true, true, false]);
    expect(occursOn(e("one", "2026-11-06", true), "2026-11-06")).toBe(true);
    expect(occursOn(e("one", "2026-11-06", true), "2026-11-07")).toBe(false);
  });
  it("sorts all-day first, then by time", () => {
    const list = [e("late", local(2026, 11, 4, 15)), e("allday", "2026-11-04", true), e("early", local(2026, 11, 4, 9))];
    expect(sortEvents(list).map((x) => x.id)).toEqual(["allday", "early", "late"]);
  });
  it("builds the seven days after today, keeping empty days, across a month end", () => {
    const events = [e("t", local(2026, 11, 29, 9)), e("n", local(2026, 12, 3, 9)), e("today", local(2026, 11, 28, 9)), e("out", local(2026, 12, 6, 9))];
    const week = nextSevenDays(events, "2026-11-28");
    expect(week.map((d) => d.day)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
    expect(week.filter((d) => d.events.length).map((d) => d.events[0].id)).toEqual(["t", "n"]);
    expect(eventsOn(events, "2026-11-28").map((x) => x.id)).toEqual(["today"]);
  });
  it("adds days and lays out a month grid", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    const cells = monthCells(2026, 10); // November 2026 starts on a Sunday
    expect(cells[0]).toBe("2026-11-01");
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.length % 7).toBe(0);
  });
});

describe("all-day versus an unknown due time", () => {
  const text = cal(
    ev("UID:event-assignment-1", "DTSTART;VALUE=DATE:20261105", "SUMMARY:Date-only assignment [A 1]"),
    ev("UID:event-assignment-2", "DTSTART:20261105T180000Z", "DTEND:20261105T180000Z", "SUMMARY:Timed assignment [A 1]"),
    ev("UID:event-calendar-event-3", "DTSTART;VALUE=DATE:20261105", "SUMMARY:Campus holiday"),
  );
  const out = Object.fromEntries(parse(text).map((e) => [e.id.split(":")[1], e]));
  it("flags an assignment that has only a date, and never turns it into a time", () => {
    expect(out["event-assignment-1"]).toMatchObject({ kind: "assignment", allDay: true, dueTimeUnknown: true, start: "2026-11-05" });
  });
  it("keeps exact times on assignments that have one", () => {
    expect(out["event-assignment-2"]).toMatchObject({ kind: "assignment", allDay: false, dueTimeUnknown: false, start: "2026-11-05T18:00:00.000Z" });
  });
  it("keeps genuine all-day calendar events as all-day", () => {
    expect(out["event-calendar-event-3"]).toMatchObject({ kind: "event", allDay: true, dueTimeUnknown: false });
  });
  it("labels each honestly", () => {
    const fmt = () => "TIME";
    expect(timeLabel(out["event-assignment-1"], fmt)).toBe("Check Canvas for due time");
    expect(timeLabel(out["event-assignment-2"], fmt)).toBe("TIME");
    expect(timeLabel(out["event-calendar-event-3"], fmt)).toBe("All day");
  });
  it("sorts a day: all-day events, then timed by time, then assignments with no due time", () => {
    const order = sortEvents(Object.values(out)).map((e) => e.id.split(":")[1]);
    expect(order).toEqual(["event-calendar-event-3", "event-assignment-2", "event-assignment-1"]);
  });
});

describe("upcoming", () => {
  const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();
  const e = (id: string, start: string, over: Partial<SchoolEvent> = {}): SchoolEvent => ({ id, school: "sdsu", title: id, course: null, start, end: null, allDay: false, kind: "event", dueTimeUnknown: false, location: null, url: null, cancelled: false, ...over });
  it("covers today and the next seven days in deadline order, collapsing empty days", () => {
    const events = [e("late", local(2026, 11, 4, 18)), e("early", local(2026, 11, 4, 8)), e("d3", local(2026, 11, 7, 9)), e("out", local(2026, 11, 12, 9)), e("nodue", "2026-11-04", { allDay: true, kind: "assignment", dueTimeUnknown: true })];
    const u = upcoming(events, "2026-11-04");
    expect(u.days.map((d) => d.day)).toEqual(["2026-11-04", "2026-11-07"]);
    expect(u.days[0].events.map((x) => x.id)).toEqual(["early", "late", "nodue"]);
    expect(u.emptyDays).toEqual(["2026-11-05", "2026-11-06", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(u.days.length + u.emptyDays.length).toBe(8);
  });
});

describe("town notice", () => {
  const e = (id: string, school: "sdsu" | "sdccd", start: string, allDay: boolean, extra: Partial<SchoolEvent> = {}): SchoolEvent => ({
    id: `${school}:${id}`, school, title: id, course: null, start, end: null, allDay, kind: "event", dueTimeUnknown: false, location: null, url: null, cancelled: false, ...extra,
  });
  const st = (school: "sdsu" | "sdccd", events: SchoolEvent[], extra: Partial<SchoolState> = {}): SchoolState => ({
    school, configured: true, events, updatedAt: "2026-11-04T10:00:00.000Z", stale: false, lastError: null, lastAttemptAt: null, cooldownUntil: null, ...extra,
  });
  const now = new Date(2026, 10, 4, 12, 0, 0); // local noon
  const at = (h: number) => new Date(2026, 10, 4, h, 0, 0).toISOString();

  it("counts today's items across both schools and picks the next one still ahead", () => {
    const n = townNotice(
      [st("sdsu", [e("past", "sdsu", at(9), false), e("later", "sdsu", at(15), false)]), st("sdccd", [e("dateonly", "sdccd", "2026-11-04", true, { kind: "assignment", dueTimeUnknown: true }), e("tomorrow", "sdccd", "2026-11-05", true)])],
      now,
    );
    expect(n).toMatchObject({ status: "ok", count: 3, stale: false });
    expect(n.next?.id).toBe("sdsu:later");
  });
  it("leaves cancelled items out and has no next when nothing is ahead", () => {
    const n = townNotice([st("sdsu", [e("gone", "sdsu", at(15), false, { cancelled: true }), e("past", "sdsu", at(9), false)])], now);
    expect(n).toMatchObject({ status: "ok", count: 1, next: null });
  });
  it("marks stale data and unavailable or unconfigured schools", () => {
    expect(townNotice([st("sdsu", [], { stale: true, lastError: "network" })], now)).toMatchObject({ status: "ok", stale: true });
    expect(townNotice([st("sdsu", [], { updatedAt: null, lastError: "timeout" })], now)).toMatchObject({ status: "unavailable", stale: true, count: 0 });
    expect(townNotice([st("sdsu", [], { updatedAt: null })], now)).toMatchObject({ status: "not_loaded", stale: false });
    expect(townNotice([st("sdsu", [], { configured: false, updatedAt: null })], now).status).toBe("none");
    expect(townNotice([], now).status).toBe("none");
  });
  it("uses a school's last good copy while the other is unavailable", () => {
    const n = townNotice([st("sdsu", [e("a", "sdsu", at(15), false)]), st("sdccd", [], { updatedAt: null, lastError: "network" })], now);
    expect(n).toMatchObject({ status: "ok", count: 1, stale: true });
  });
});

describe("nameplates", () => {
  it("anchor above each roof with a gap and follow the home tier", async () => {
    const { nameplatesFor } = await import("@/game/nameplates");
    const [c, m] = [nameplatesFor(1), nameplatesFor(2)];
    expect(c.map((p) => p.id)).toEqual(["home", "bank", "school"]);
    expect(c[0].roofY).toBeGreaterThan(m[0].roofY); // the manor is taller, so its plaque sits higher
    expect(c[1]).toEqual(m[1]);
  });
});

describe("notice states", () => {
  const base = { access: "unlocked", loaded: true, loadFailed: false, busy: false } as const;
  const cfg = (extra: Partial<SchoolState> = {}) => ({ school: "sdsu", configured: true, events: [], updatedAt: null, stale: false, lastError: null, lastAttemptAt: null, cooldownUntil: null, ...extra }) as SchoolState;
  const now = new Date(2026, 10, 4, 12);
  const kind = (i: Partial<Parameters<typeof noticeKind>[0]>) => noticeKind({ ...base, states: [], ...i }, now).kind;

  it("never says 'not set up' before the server has answered", () => {
    expect(kind({ loaded: false, states: [] })).toBe("loading");
    expect(kind({ loaded: false, loadFailed: true })).toBe("load_failed");
    expect(kind({ access: "checking", loaded: false })).toBe("checking");
  });
  it("separates locked, off, not configured, not loaded, refreshing, failed and ok", () => {
    expect(kind({ access: "locked" })).toBe("locked");
    expect(kind({ access: "not_configured" })).toBe("off");
    expect(kind({ states: [cfg({ configured: false }), cfg({ school: "sdccd", configured: false })] })).toBe("none");
    expect(kind({ states: [cfg(), cfg({ school: "sdccd" })] })).toBe("not_loaded");
    expect(kind({ states: [cfg()], busy: true })).toBe("refreshing");
    expect(kind({ states: [cfg({ lastError: "timeout" })] })).toBe("unavailable");
    expect(kind({ states: [cfg({ updatedAt: "2026-11-04T10:00:00.000Z" })] })).toBe("ok");
  });
  it("one configured school is enough to avoid 'not set up'", () => {
    expect(kind({ states: [cfg({ configured: false }), cfg({ school: "sdccd" })] })).toBe("not_loaded");
  });
});
