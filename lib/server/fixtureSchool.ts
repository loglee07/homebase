// Synthetic school calendars for tests and the browser pass (FINANCE_TOWN_BROKERAGE_FIXTURES=1). No real feed, no network.
import type { SchoolId } from "../school";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const ymd = (d: Date) => stamp(d).slice(0, 8);
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
const H = 3_600_000;
const D = 24 * H;

export function fixtureFeed(school: SchoolId, now: Date): string {
  const host = school === "sdsu" ? "sdsu.instructure.com" : "sdccd.instructure.com";
  const noon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0)); // 1pm Pacific-ish, today
  const ev = (lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
  const link = (n: number) => `URL;VALUE=URI:https://${host}/calendar?event_id=${n}&include_contexts=course_${n}`;
  const events =
    school === "sdsu"
      ? [
          ev(["UID:event-assignment-1", `DTSTART:${stamp(addMs(noon, 2 * H))}`, `DTEND:${stamp(addMs(noon, 2 * H))}`, "SUMMARY:Synthetic essay due [SYN 101 - Writing]", link(1)]),
          ev(["UID:event-assignment-2", `DTSTART:${stamp(addMs(noon, 2 * D))}`, `DTEND:${stamp(addMs(noon, 2 * D + H))}`, "SUMMARY:Synthetic lab report [SYN 210 - Lab]", link(2), "LOCATION:Synthetic Hall 101"]),
          ev(["UID:shared-1", `DTSTART;VALUE=DATE:${ymd(addMs(noon, 3 * D))}`, `DTEND;VALUE=DATE:${ymd(addMs(noon, 4 * D))}`, "SUMMARY:Synthetic campus closure [SYN 101 - Writing]"]),
          ev(["UID:cancelled-1", `DTSTART:${stamp(addMs(noon, 4 * D))}`, "STATUS:CANCELLED", "SUMMARY:Synthetic cancelled quiz [SYN 210 - Lab]"]),
          ev(["UID:event-assignment-9", `DTSTART;VALUE=DATE:${ymd(addMs(noon, D))}`, "SUMMARY:Synthetic date-only assignment [SYN 101 - Writing]", link(9)]),
          ev(["UID:weekly-1", `DTSTART:${stamp(addMs(noon, D))}`, `DTEND:${stamp(addMs(noon, D + H))}`, "RRULE:FREQ=WEEKLY;COUNT=6", "SUMMARY:Synthetic weekly lecture [SYN 101 - Writing]"]),
        ]
      : [
          ev(["UID:event-assignment-1", `DTSTART:${stamp(addMs(noon, 5 * H))}`, "SUMMARY:Synthetic discussion post [SYN 50 - Intro]", link(7)]),
          ev(["UID:shared-1", `DTSTART:${stamp(addMs(noon, 3 * D))}`, `DTEND:${stamp(addMs(noon, 3 * D + H))}`, "SUMMARY:Synthetic midterm [SYN 50 - Intro]", link(8)]),
          ev(["UID:event-assignment-8", `DTSTART;VALUE=DATE:${ymd(noon)}`, "SUMMARY:Synthetic date-only quiz [SYN 50 - Intro]", link(10)]),
          ev(["UID:event-assignment-3", `DTSTART:${stamp(addMs(noon, 6 * D))}`, "SUMMARY:Synthetic project milestone [SYN 60 - Studio]"]),
        ];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Finance Town//Synthetic//EN", ...events, "END:VCALENDAR"].join("\r\n");
}
