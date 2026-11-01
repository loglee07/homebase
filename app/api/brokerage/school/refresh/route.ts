import { guard, json } from "@/lib/server/guard";
import { cooldownMs } from "@/lib/server/provider";
import { SCHOOL_IDS, type SchoolId } from "@/lib/school";
import { getSchoolLoaders } from "@/lib/server/schoolProvider";
import { refreshSchool } from "@/lib/server/schoolStore";

/** Refreshes one school's feed. Each school has its own cooldown and failure state. */
export async function POST(req: Request) {
  const denied = guard(req, { mutating: true, session: true });
  if (denied) return denied;
  let school: unknown;
  try {
    school = ((await req.json()) as { school?: unknown } | null)?.school;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof school !== "string" || !(SCHOOL_IDS as readonly string[]).includes(school)) return json({ error: "bad_request" }, 400);
  const r = await refreshSchool(school as SchoolId, getSchoolLoaders()[school as SchoolId], Date.now, cooldownMs());
  return json({ outcome: r.outcome, state: r.state });
}
