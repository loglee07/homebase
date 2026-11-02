// School calendar (Canvas feeds). Pure logic shared by the server parser and the browser: no env, no I/O, no feed URLs.
// Events come only from the calendar feeds. Nothing here knows about grades, submissions or completion.

export const SCHOOL_IDS = ["sdsu", "sdccd"] as const;
export type SchoolId = (typeof SCHOOL_IDS)[number];
export const SCHOOL_LABEL: Record<SchoolId, string> = { sdsu: "SDSU", sdccd: "SDCCD" };

export const SCHOOL_REFRESH_COOLDOWN_MS = 60_000;
export const SCHOOL_COOLDOWN_DEFAULT = SCHOOL_REFRESH_COOLDOWN_MS;
export const SCHOOL_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface SchoolEvent {
  /** Unique across both schools: `<school>:<feed uid>` plus the occurrence for repeating events. */
  id: string;
  school: SchoolId;
  title: string;
  /** Canvas puts the course name in square brackets at the end of the title. Null when the feed gives none. */
  course: string | null;
  /** All-day: `YYYY-MM-DD`. Timed: an ISO instant (`...Z`), or a floating local time (`YYYY-MM-DDTHH:mm:ss`) shown as written. */
  start: string;
  /** All-day: the exclusive end date. Timed: an ISO instant or floating time. Null when the feed has none. */
  end: string | null;
  allDay: boolean;
  /** Canvas assignments carry the feed's `event-assignment` ids; everything else is a calendar event. */
  kind: "assignment" | "event";
  /**
   * An assignment whose feed entry has a date but no time. Canvas gives no due time for it (it may be end of day or
   * unset), so the time is never guessed: the interface says to check Canvas.
   */
  dueTimeUnknown: boolean;
  location: string | null;
  /** Canvas course number from the feed link (`course_<n>`), a stable course identity. Null when the link has none. */
  courseId?: string | null;
  /** The original Canvas link, only when it is an https link on this school's own host. */
  url: string | null;
  cancelled: boolean;
}

export type SchoolErrorCode =
  | "not_configured"
  | "feed_host_rejected"
  | "redirect_rejected"
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "too_large"
  | "not_a_calendar"
  | "timeout"
  | "network"
  | "unknown";

export const SCHOOL_ERROR_TEXT: Record<SchoolErrorCode, string> = {
  not_configured: "No feed link is set for this school.",
  feed_host_rejected: "The saved feed link is not on this school's Canvas site, so it was not used.",
  redirect_rejected: "The feed tried to send us to another site, so it was not followed.",
  auth_failed: "Canvas rejected the feed link. Copy a fresh one from Canvas.",
  not_found: "Canvas could not find that feed. Copy a fresh link from Canvas.",
  rate_limited: "Canvas is rate limiting requests. Try again soon.",
  too_large: "The feed was too large to read.",
  not_a_calendar: "That link did not return a calendar.",
  timeout: "Canvas took too long to answer.",
  network: "Could not reach Canvas.",
  unknown: "Canvas returned an unexpected result.",
};

/** What the server tells the browser about one school. Never contains the feed link. */
export interface SchoolState {
  school: SchoolId;
  configured: boolean;
  events: SchoolEvent[];
  /** When Homebase last fetched this feed successfully (ISO). */
  updatedAt: string | null;
  /** The last refresh failed or the data is old: events are the last successful ones. */
  stale: boolean;
  lastError: SchoolErrorCode | null;
  lastAttemptAt: string | null;
  cooldownUntil: string | null;
}

// ---- dates (the browser's own local calendar) ----

const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split("-").map(Number);
  return localDayKey(new Date(y, m - 1, d + n));
};

/** The local calendar day an event starts on. */
export const startDay = (e: Pick<SchoolEvent, "start" | "allDay">): string => (e.allDay ? e.start.slice(0, 10) : localDayKey(new Date(e.start)));

/** Whether the event is on this local day. All-day events cover every day up to their exclusive end. */
export function occursOn(e: SchoolEvent, day: string): boolean {
  const first = startDay(e);
  if (!e.allDay) return first === day;
  const lastExclusive = e.end && e.end.slice(0, 10) > first ? e.end.slice(0, 10) : addDays(first, 1);
  return day >= first && day < lastExclusive;
}

/** Within one day: all-day events, then timed events by time, then assignments with no due time. */
const rank = (e: SchoolEvent) => (e.dueTimeUnknown ? 2 : e.allDay ? 0 : 1);
export function sortEvents(events: readonly SchoolEvent[]): SchoolEvent[] {
  return [...events].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 1 ? new Date(a.start).getTime() - new Date(b.start).getTime() : a.start.localeCompare(b.start)) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

/** What to print in the time column. Never invents a deadline: an assignment with a date but no time prints nothing. */
export const timeLabel = (e: SchoolEvent, fmt: (iso: string) => string): string =>
  e.dueTimeUnknown ? "" : e.allDay ? "All day" : fmt(e.start);

export const eventsOn = (events: readonly SchoolEvent[], day: string): SchoolEvent[] => sortEvents(events.filter((e) => occursOn(e, day)));

/** Today and the seven days after it, in order. Days with nothing on them are listed apart so the list stays short. */
export function upcoming(events: readonly SchoolEvent[], today: string): { days: { day: string; events: SchoolEvent[] }[]; emptyDays: string[] } {
  const all = Array.from({ length: 8 }, (_, i) => {
    const day = addDays(today, i);
    return { day, events: eventsOn(events, day) };
  });
  return { days: all.filter((d) => d.events.length > 0), emptyDays: all.filter((d) => d.events.length === 0).map((d) => d.day) };
}

/** The seven days after today, each with its events (empty days kept so the week reads as a week). */
export function nextSevenDays(events: readonly SchoolEvent[], today: string): { day: string; events: SchoolEvent[] }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i + 1);
    return { day, events: eventsOn(events, day) };
  });
}

/** Month grid cells (Sunday first). `day` is null for padding cells. */
export function monthCells(year: number, month0: number): (string | null)[] {
  const first = new Date(year, month0, 1);
  const count = new Date(year, month0 + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${year}-${pad(month0 + 1)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Merged events from every school: ids are already school-prefixed, so two schools never collide. */
export const combine = (states: readonly Pick<SchoolState, "events">[]): SchoolEvent[] => states.flatMap((s) => s.events);

export interface TownNotice {
  /**
   * "none": no feed link is set for any school.
   * "not_loaded": links are set but no feed has been fetched yet (nothing failed).
   * "unavailable": links are set, nothing has loaded and the last attempt failed.
   * "ok": at least one school has calendar data.
   */
  status: "ok" | "not_loaded" | "unavailable" | "none";
  /** Calendar items today (cancelled ones left out). Not a count of unfinished work: submission status is unknown. */
  count: number;
  /** The first item still ahead: a timed item later today or after, or any date-only item from today on. */
  next: SchoolEvent | null;
  /** At least one school is showing its last good copy, or has none because its refresh failed. */
  stale: boolean;
}

/**
 * Summary for the town screen, from calendars already in memory. Never fetches. Pass only states the server has really
 * reported: an empty list means "not read yet", which the caller must treat as loading, never as "not set up".
 */
export function townNotice(states: readonly SchoolState[], now: Date, hide?: (e: SchoolEvent) => boolean): TownNotice {
  const configured = states.filter((s) => s.configured);
  if (configured.length === 0) return { status: "none", count: 0, next: null, stale: false };
  const loaded = configured.filter((s) => s.updatedAt);
  const stale = configured.some((s) => s.stale || s.lastError !== null);
  if (loaded.length === 0) return { status: stale ? "unavailable" : "not_loaded", count: 0, next: null, stale };
  const today = localDayKey(now);
  const live = combine(loaded).filter((e) => !e.cancelled && !hide?.(e)); // items the user marked or ignored are not counted
  const ahead = live.filter((e) => (e.allDay ? startDay(e) >= today : new Date(e.start).getTime() >= now.getTime()));
  const firstDay = ahead.map(startDay).sort()[0];
  const next = firstDay === undefined ? null : sortEvents(ahead.filter((e) => startDay(e) === firstDay))[0];
  return { status: "ok", count: live.filter((e) => occursOn(e, today)).length, next, stale };
}

export type NoticeKind = "checking" | "off" | "locked" | "loading" | "load_failed" | "none" | "not_loaded" | "refreshing" | "unavailable" | "ok";

export interface NoticeInput {
  /** The shared local session: "checking" until the server has answered. */
  access: "checking" | "not_configured" | "locked" | "unlocked";
  /** The server's calendar state has been read at least once this unlock. */
  loaded: boolean;
  /** Reading the server's calendar state failed (the local server, not Canvas). */
  loadFailed: boolean;
  /** A feed fetch is running for some school. */
  busy: boolean;
  states: readonly SchoolState[];
  /** Items the user marked done or ignored: left out of the count and "next". */
  hide?: (e: SchoolEvent) => boolean;
}

/** Which message the town notice shows. Distinguishes every reason there is no count, so "not set up" is never a guess. */
export function noticeKind(i: NoticeInput, now: Date): { kind: NoticeKind; notice: TownNotice | null } {
  if (i.access === "checking") return { kind: "checking", notice: null };
  if (i.access === "not_configured") return { kind: "off", notice: null };
  if (i.access === "locked") return { kind: "locked", notice: null };
  if (i.loadFailed && !i.loaded) return { kind: "load_failed", notice: null };
  if (!i.loaded) return { kind: "loading", notice: null };
  const notice = townNotice(i.states, now, i.hide);
  if (notice.status === "none") return { kind: "none", notice };
  if (notice.status === "ok") return { kind: "ok", notice };
  if (i.busy) return { kind: "refreshing", notice };
  return { kind: notice.status, notice };
}
