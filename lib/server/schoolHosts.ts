// Which hosts may serve (or be linked from) each school's Canvas feed. Pure, so it is tested directly.
import type { SchoolId } from "../school";

const EXACT: Record<SchoolId, string> = { sdsu: "sdsu.instructure.com", sdccd: "sdccd.instructure.com" };
const SUFFIX: Record<SchoolId, string> = { sdsu: "sdsu.edu", sdccd: "sdccd.edu" };

export function hostAllowed(school: SchoolId, hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === EXACT[school] || h === SUFFIX[school] || h.endsWith(`.${SUFFIX[school]}`);
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** A feed link must be https on this school's host, with no embedded credentials or odd port, and end in .ics. */
export function parseFeedUrl(school: SchoolId, raw: string | undefined): URL | null {
  if (!raw || !raw.trim()) return null;
  const u = parse(raw);
  if (!u || u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!hostAllowed(school, u.hostname) || !u.pathname.toLowerCase().endsWith(".ics")) return null;
  return u;
}

/** A redirect target: https on the same school's host. The path is not restricted. */
export function redirectAllowed(school: SchoolId, target: URL): boolean {
  return target.protocol === "https:" && !target.username && !target.password && (!target.port || target.port === "443") && hostAllowed(school, target.hostname);
}

/** An event link we may show: https on the school's own host. Anything else is dropped. */
export function safeEventUrl(school: SchoolId, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = parse(raw);
  if (!u || !redirectAllowed(school, u) || raw.length > 2000) return null;
  return u.toString();
}
