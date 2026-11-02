// Personal School checklist: "Marked done by you", "Ignored by you" and optional ignore rules. Pure logic, no I/O.
// These choices are the user's own notes. They are never sent to Canvas, never change feed data, and say nothing about
// submission status, grades or points. They are kept apart from the fetched calendars: a refresh (or a failed refresh)
// never touches them, and they are keyed only by stable ids, never by title or list position.
import type { SchoolEvent, SchoolId } from "./school";

export const MARKS_VERSION = 1;
/** Far above any real use; the oldest choices are dropped beyond it so the saved value stays small. */
export const MAX_MARKED = 5000;

/** An ignore rule scoped to one school and one course. Only the built-in "labs-and-w-programming" pattern exists. */
export interface IgnoreRule {
  id: string;
  preset: "labs-and-w-programming";
  school: SchoolId;
  /** Stable course identity (see courseKeyOf). Never a title match across courses. */
  courseKey: string;
  /** The course name as shown when the rule was made, for display only. */
  courseLabel: string;
  enabled: boolean;
}

export interface SchoolMarks {
  v: typeof MARKS_VERSION;
  /** Event ids (`<school>:<feed uid>` plus `@<occurrence>` for a repeating event) marked done by the user. */
  done: string[];
  /** Event ids ignored by the user. */
  ignored: string[];
  rules: IgnoreRule[];
}
export const emptyMarks = (): SchoolMarks => ({ v: MARKS_VERSION, done: [], ignored: [], rules: [] });

export type ParsedMarks = { status: "ok"; marks: SchoolMarks } | { status: "unreadable" };

/** "" (nothing saved) is an empty list. Anything else must parse exactly, or it is "unreadable" and is never overwritten. */
export function parseMarks(raw: string): ParsedMarks {
  if (!raw) return { status: "ok", marks: emptyMarks() };
  try {
    const o = JSON.parse(raw) as Partial<SchoolMarks> | null;
    const strs = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === "string" && x.length > 0 && x.length < 600);
    const rule = (r: unknown): r is IgnoreRule => {
      const x = r as Partial<IgnoreRule> | null;
      return !!x && typeof x.id === "string" && x.preset === "labs-and-w-programming" && (x.school === "sdsu" || x.school === "sdccd") && typeof x.courseKey === "string" && x.courseKey.length > 0 && typeof x.courseLabel === "string" && typeof x.enabled === "boolean";
    };
    if (!o || o.v !== MARKS_VERSION || !strs(o.done) || !strs(o.ignored) || !Array.isArray(o.rules) || !o.rules.every(rule)) return { status: "unreadable" };
    return { status: "ok", marks: { v: MARKS_VERSION, done: o.done, ignored: o.ignored, rules: o.rules } };
  } catch {
    return { status: "unreadable" };
  }
}
export const serializeMarks = (m: SchoolMarks): string => JSON.stringify({ ...m, done: m.done.slice(-MAX_MARKED), ignored: m.ignored.slice(-MAX_MARKED) });

/** Toggles one id in a list (adds at the end, or removes). Never touches the other list. */
export const toggleId = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// ---- course identity ----

/**
 * The stable course a calendar item belongs to. Canvas puts `include_contexts=course_<number>` in each item's link, so
 * that number is the identity when present. Without it the course name from the feed is used (weaker: a renamed course
 * would no longer match, so the rule would simply stop applying). Always namespaced by school.
 */
export function courseKeyOf(e: Pick<SchoolEvent, "school" | "courseId" | "course">): string | null {
  if (e.courseId) return `${e.school}:${e.courseId}`;
  const label = e.course?.trim().toLowerCase();
  return label ? `${e.school}:label:${label}` : null;
}

// ---- the CS210 rule ----

/** "Lab 3", "Lab03", "Lab 1: Intro". Not "Labs", not "Lab" with no number, and not a normal "Assignment 01". */
const LAB = /^lab\s*\d+\b/i;
/** "W3 Programming Assignment", "W 04 Programming Assignment". */
const W_PROGRAMMING = /^w\s*\d+\b.*\bprogramming assignment\b/i;
export const matchesRuleTitle = (title: string): boolean => LAB.test(title.trim()) || W_PROGRAMMING.test(title.trim());

export function ruleMatches(rule: Pick<IgnoreRule, "school" | "courseKey">, e: SchoolEvent): boolean {
  return e.school === rule.school && courseKeyOf(e) === rule.courseKey && matchesRuleTitle(e.title);
}

/** Courses found in the loaded calendars that look like SDSU CS 210, one per stable course identity. */
export function findCs210Courses(events: readonly SchoolEvent[]): { school: SchoolId; courseKey: string; label: string }[] {
  const out = new Map<string, { school: SchoolId; courseKey: string; label: string }>();
  for (const e of events) {
    if (e.school !== "sdsu" || !e.course || !/\bcs\s*-?\s*210\b/i.test(e.course)) continue;
    const key = courseKeyOf(e);
    if (key && !out.has(key)) out.set(key, { school: e.school, courseKey: key, label: e.course });
  }
  return [...out.values()];
}

/** What a rule would hide right now, for the preview. Ignores whether the rule is enabled. */
export const previewRule = (rule: Pick<IgnoreRule, "school" | "courseKey">, events: readonly SchoolEvent[]): SchoolEvent[] => events.filter((e) => ruleMatches(rule, e));

// ---- status ----

export type MarkStatus = "done" | "ignored" | "rule" | null;

/** "done" wins over ignoring. A rule only applies when enabled. */
export function markStatus(e: SchoolEvent, m: SchoolMarks): MarkStatus {
  if (m.done.includes(e.id)) return "done";
  if (m.ignored.includes(e.id)) return "ignored";
  if (m.rules.some((r) => r.enabled && ruleMatches(r, e))) return "rule";
  return null;
}

export interface ShowOptions {
  showDone: boolean;
  showIgnored: boolean;
}
/** Whether a row appears in Upcoming. */
export function isVisible(e: SchoolEvent, m: SchoolMarks, o: ShowOptions): boolean {
  const s = markStatus(e, m);
  return s === null || (s === "done" ? o.showDone : o.showIgnored);
}
/** For the town notice: only unmarked items count. */
export const countsForReminder = (e: SchoolEvent, m: SchoolMarks): boolean => markStatus(e, m) === null;

export const STATUS_TEXT: Record<Exclude<MarkStatus, null>, string> = {
  done: "Marked done by you",
  ignored: "Ignored by you",
  rule: "Ignored by you (rule)",
};
