import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStore } from "@/lib/localStore";
import { combine, noticeKind, townNotice, type SchoolEvent, type SchoolState } from "@/lib/school";
import { courseIdOf, parseFeed } from "@/lib/server/ics";
import {
  countsForReminder, courseKeyOf, emptyMarks, findCs210Courses, isVisible, markStatus, matchesRuleTitle, parseMarks, previewRule, serializeMarks, toggleId, type IgnoreRule, type SchoolMarks,
} from "@/lib/schoolMarks";

const NOW = new Date("2026-11-04T18:00:00Z");
const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const link = (n: number) => `URL;VALUE=URI:https://sdsu.instructure.com/calendar?include_contexts=course_${n}#month`;

const mk = (id: string, title: string, over: Partial<SchoolEvent> = {}): SchoolEvent => ({
  id, school: "sdsu", title, course: "CS 210", courseId: "course_100", start: "2026-11-05", end: null, allDay: true, kind: "assignment", dueTimeUnknown: true, location: null, url: null, cancelled: false, ...over,
});
const none = (): SchoolMarks => emptyMarks();
const rule = (over: Partial<IgnoreRule> = {}): IgnoreRule => ({ id: "r1", preset: "labs-and-w-programming", school: "sdsu", courseKey: "sdsu:course_100", courseLabel: "CS 210", enabled: true, ...over });

describe("identity", () => {
  it("reuses the feed's school-namespaced uid, with the occurrence for repeating events", () => {
    const text = cal(ev("UID:event-assignment-1", "DTSTART;VALUE=DATE:20261105", "SUMMARY:HW [CS 1]"), ev("UID:rep", "DTSTART:20261105T170000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Lecture [CS 1]"));
    const sdsu = parseFeed(text, "sdsu", NOW);
    const sdccd = parseFeed(text, "sdccd", NOW);
    const ids = [...sdsu, ...sdccd].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // identical uids at two schools never collide
    expect(sdsu.find((e) => e.title === "HW")!.id).toBe("sdsu:event-assignment-1");
    expect(sdccd.find((e) => e.title === "HW")!.id).toBe("sdccd:event-assignment-1");
    expect(sdsu.filter((e) => e.title === "Lecture").every((e) => /^sdsu:rep@/.test(e.id))).toBe(true);
  });
  it("marking one occurrence does not mark the series", () => {
    const occ = parseFeed(cal(ev("UID:rep", "DTSTART:20261105T170000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Lecture")), "sdsu", NOW);
    const m: SchoolMarks = { ...none(), done: [occ[1].id] };
    expect(occ.map((e) => markStatus(e, m))).toEqual([null, "done", null]);
  });
  it("the same uid at another school is a different item", () => {
    const m: SchoolMarks = { ...none(), done: ["sdsu:x"] };
    expect(markStatus(mk("sdsu:x", "A"), m)).toBe("done");
    expect(markStatus(mk("sdccd:x", "A", { school: "sdccd" }), m)).toBeNull();
  });
  it("is not matched by title or position: a different id with the same title is unmarked", () => {
    const m: SchoolMarks = { ...none(), done: ["sdsu:a"] };
    expect(markStatus(mk("sdsu:b", "Same title"), m)).toBeNull();
    expect(markStatus(mk("sdsu:a", "Renamed title"), m)).toBe("done");
  });
  it("reads the course number from the Canvas link, only", () => {
    expect(courseIdOf("https://x.instructure.com/calendar?include_contexts=course_123#m")).toBe("course_123");
    expect(courseIdOf("https://x/calendar?a=1&include_contexts=user_5,course_77&b=2")).toBe("course_77");
    expect(courseIdOf("https://x/calendar?include_contexts=course_%")).toBeNull();
    expect(courseIdOf("https://x/calendar")).toBeNull();
    expect(courseIdOf(undefined)).toBeNull();
    const [e] = parseFeed(cal(ev("UID:a", "DTSTART;VALUE=DATE:20261105", link(4242), "SUMMARY:Lab 1 [CS 210]")), "sdsu", NOW);
    expect(e.courseId).toBe("course_4242");
    expect(courseKeyOf(e)).toBe("sdsu:course_4242");
  });
  it("falls back to the course name when the link has no course, still per school", () => {
    expect(courseKeyOf({ school: "sdsu", courseId: null, course: " CS 210 " })).toBe("sdsu:label:cs 210");
    expect(courseKeyOf({ school: "sdccd", courseId: null, course: "CS 210" })).toBe("sdccd:label:cs 210");
    expect(courseKeyOf({ school: "sdsu", courseId: null, course: null })).toBeNull();
  });
});

describe("mark done, ignore and visibility", () => {
  const a = mk("sdsu:a", "Assignment 01");
  const none0 = { showDone: false, showIgnored: false };
  it("hides done and ignored from Upcoming by default and restores them on request or unmark", () => {
    const done: SchoolMarks = { ...none(), done: [a.id] };
    expect(isVisible(a, done, none0)).toBe(false);
    expect(isVisible(a, done, { ...none0, showDone: true })).toBe(true);
    expect(isVisible(a, done, { ...none0, showIgnored: true })).toBe(false); // the two switches are separate
    const ign: SchoolMarks = { ...none(), ignored: [a.id] };
    expect(markStatus(a, ign)).toBe("ignored");
    expect(isVisible(a, ign, { ...none0, showIgnored: true })).toBe(true);
    expect(isVisible(a, { ...done, done: toggleId(done.done, a.id) }, none0)).toBe(true); // unmarking brings it back
  });
  it("done and ignored are independent lists, and done wins when both are set", () => {
    const m: SchoolMarks = { ...none(), done: [a.id], ignored: [a.id] };
    expect(markStatus(a, m)).toBe("done");
    expect(toggleId(["x"], "y")).toEqual(["x", "y"]);
    expect(toggleId(["x", "y"], "y")).toEqual(["x"]);
  });
});

describe("saved choices", () => {
  it("round-trips and survives a refresh, because only ids are saved (feed data is separate)", () => {
    const m: SchoolMarks = { ...none(), done: ["sdsu:a"], ignored: ["sdsu:b"], rules: [rule()] };
    const raw = serializeMarks(m);
    expect(raw).not.toMatch(/title|start|Assignment/);
    expect(parseMarks(raw)).toEqual({ status: "ok", marks: m });
    const afterRefresh = [mk("sdsu:a", "Assignment 01"), mk("sdsu:b", "Assignment 02")]; // a fresh feed with the same ids
    expect(afterRefresh.map((e) => markStatus(e, m))).toEqual(["done", "ignored"]);
    // a failed refresh leaves marks untouched: they are a separate value
    expect(parseMarks(raw)).toEqual({ status: "ok", marks: m });
  });
  it("nothing saved is an empty list; damaged data is unreadable, never silently emptied", () => {
    expect(parseMarks("")).toEqual({ status: "ok", marks: none() });
    for (const bad of ["{", "null", '{"v":2,"done":[],"ignored":[],"rules":[]}', '{"v":1,"done":[1],"ignored":[],"rules":[]}', '{"v":1,"done":[],"ignored":[],"rules":[{"id":"x"}]}']) expect(parseMarks(bad).status).toBe("unreadable");
  });
});

describe("storage failure", () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => {
    delete g.window;
  });
  it("reports a refused write as false, so the page never claims it saved", () => {
    g.window = { localStorage: { getItem: () => null, setItem: () => { throw new Error("quota"); } }, addEventListener() {}, removeEventListener() {} };
    expect(createLocalStore("k").write("x")).toBe(false);
  });
  it("the hook only shows a choice once the write succeeded", () => {
    const src = readFileSync(path.resolve(__dirname, "../components/useSchoolMarks.ts"), "utf8");
    expect(src).toMatch(/store\.write\(serializeMarks\(change\(now\.marks\)\)\) \? null : FAIL/);
    expect(src).not.toMatch(/useState<SchoolMarks/); // the saved value is the only source of truth
  });
});

describe("CS210 rule", () => {
  const items = [
    mk("sdsu:l1", "Lab 1"), mk("sdsu:l2", "Lab03: Loops"), mk("sdsu:l3", "lab 12"),
    mk("sdsu:w1", "W3 Programming Assignment"), mk("sdsu:w2", "W 04 Programming Assignment (extra)"),
    mk("sdsu:a1", "Assignment 01"), mk("sdsu:a2", "Assignment 02"), mk("sdsu:x1", "Labs overview"), mk("sdsu:x2", "Lab"), mk("sdsu:x3", "W3 Quiz"), mk("sdsu:x4", "Final Programming Assignment"),
    // another course at the same school, and the same titles at another school
    mk("sdsu:o1", "Lab 1", { course: "MATH 100", courseId: "course_200" }),
    mk("sdccd:o2", "Lab 1", { school: "sdccd", courseId: "course_100", course: "CS 210" }),
  ];
  it("matches only Lab # and W# Programming Assignment titles", () => {
    expect(items.filter((e) => matchesRuleTitle(e.title)).map((e) => e.id)).toEqual(["sdsu:l1", "sdsu:l2", "sdsu:l3", "sdsu:w1", "sdsu:w2", "sdsu:o1", "sdccd:o2"]);
  });
  it("hides only the intended CS210 items; normal assignments and other courses or schools stay", () => {
    const m: SchoolMarks = { ...none(), rules: [rule()] };
    expect(items.filter((e) => markStatus(e, m) === "rule").map((e) => e.id)).toEqual(["sdsu:l1", "sdsu:l2", "sdsu:l3", "sdsu:w1", "sdsu:w2"]);
    for (const id of ["sdsu:a1", "sdsu:a2", "sdsu:o1", "sdccd:o2", "sdsu:x1", "sdsu:x3"]) expect(markStatus(items.find((e) => e.id === id)!, m)).toBeNull();
  });
  it("previews exactly what saving would hide, before any rule exists", () => {
    expect(previewRule({ school: "sdsu", courseKey: "sdsu:course_100" }, items).map((e) => e.id)).toEqual(["sdsu:l1", "sdsu:l2", "sdsu:l3", "sdsu:w1", "sdsu:w2"]);
  });
  it("finds the course by its name and keeps one entry per course identity", () => {
    expect(findCs210Courses(items)).toEqual([{ school: "sdsu", courseKey: "sdsu:course_100", label: "CS 210" }]);
    expect(findCs210Courses([mk("x", "A", { course: "CS 2100", courseId: "course_1" })])).toEqual([]);
  });
  it("turning the rule off restores the items; an explicit ignore still works alongside", () => {
    const off: SchoolMarks = { ...none(), rules: [rule({ enabled: false })] };
    expect(items.every((e) => markStatus(e, off) === null)).toBe(true);
    const on: SchoolMarks = { ...none(), rules: [rule()], done: ["sdsu:l1"] };
    expect(markStatus(items[0], on)).toBe("done");
  });
  it("a rule for another course's identity never touches this one", () => {
    expect(markStatus(items[0], { ...none(), rules: [rule({ courseKey: "sdsu:course_999" })] })).toBeNull();
  });
});

describe("town notice", () => {
  const day = (n: number) => new Date(2026, 10, n, 9).toISOString();
  const today = (id: string, title: string, over: Partial<SchoolEvent> = {}) => mk(id, title, { allDay: false, dueTimeUnknown: false, start: day(4), ...over });
  const st = (events: SchoolEvent[]): SchoolState => ({ school: "sdsu", configured: true, events, updatedAt: "2026-11-04T00:00:00.000Z", stale: false, lastError: null, lastAttemptAt: null, cooldownUntil: null });
  const now = new Date(2026, 10, 4, 8);
  const events = [today("sdsu:a", "Assignment 01"), today("sdsu:b", "Assignment 02"), today("sdsu:c", "Lab 1")];
  it("leaves done, ignored and rule-ignored items out of the count and the next item", () => {
    expect(townNotice([st(events)], now).count).toBe(3);
    const m: SchoolMarks = { ...none(), done: ["sdsu:a"], ignored: ["sdsu:b"], rules: [rule()] };
    const n = townNotice([st(events)], now, (e) => !countsForReminder(e, m));
    expect(n.count).toBe(0);
    expect(n.next).toBeNull();
    const only = townNotice([st(events)], now, (e) => !countsForReminder(e, { ...none(), done: ["sdsu:a"] }));
    expect(only.count).toBe(2);
    expect(only.next?.id).not.toBe("sdsu:a");
  });
  it("changes no other state: locked stays locked, and cancelled/stale handling is unchanged", () => {
    const hide = () => true;
    expect(noticeKind({ access: "locked", loaded: false, loadFailed: false, busy: false, states: [], hide }, now).kind).toBe("locked");
    expect(noticeKind({ access: "unlocked", loaded: true, loadFailed: false, busy: false, states: [{ ...st(events), stale: true }], hide }, now).notice).toMatchObject({ status: "ok", stale: true, count: 0 });
    expect(combine([st(events)])).toHaveLength(3); // the fetched data itself is never altered
  });
  it("the notice says unchecked calendar items, never verified unfinished work", () => {
    const src = readFileSync(path.resolve(__dirname, "../components/SchoolNotice.tsx"), "utf8");
    expect(src).toContain("unchecked calendar");
  });
});

describe("boundaries", () => {
  it("never writes to Canvas or touches feed credentials from the marks code", () => {
    for (const f of ["lib/schoolMarks.ts", "components/useSchoolMarks.ts"]) {
      const src = readFileSync(path.resolve(__dirname, "..", f), "utf8").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/fetch\(|apiCall|FEED_URL|process\.env|XMLHttpRequest/);
    }
  });
});
