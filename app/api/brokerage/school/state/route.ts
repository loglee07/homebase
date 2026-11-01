import { guard, json } from "@/lib/server/guard";
import { cooldownMs } from "@/lib/server/provider";
import { getSchoolLoaders, isSchoolFixtures } from "@/lib/server/schoolProvider";
import { allSchoolStates } from "@/lib/server/schoolStore";

/** Cached school calendars. Never fetches a feed. Requires the local session. Feed links are never in the response. */
export async function GET(req: Request) {
  const denied = guard(req, { session: true });
  if (denied) return denied;
  return json({ fixtures: isSchoolFixtures(), schools: allSchoolStates(getSchoolLoaders(), Date.now(), cooldownMs()) });
}
