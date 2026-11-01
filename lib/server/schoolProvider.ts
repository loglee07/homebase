import "server-only";
import { SCHOOL_IDS, type SchoolId } from "../school";
import { fixtureFeed } from "./fixtureSchool";
import { parseFeed } from "./ics";
import { SchoolFeedError, feedConfigured, fetchFeedText } from "./schoolFeed";
import type { SchoolLoader } from "./schoolStore";

const fixturesOn = (env: NodeJS.ProcessEnv) => env.FINANCE_TOWN_BROKERAGE_FIXTURES === "1" && env.NODE_ENV !== "production";
const g = globalThis as unknown as { __ftSchoolFixtureLoads?: Partial<Record<SchoolId, number>> };

export const isSchoolFixtures = (env: NodeJS.ProcessEnv = process.env) => fixturesOn(env);

export function getSchoolLoaders(env: NodeJS.ProcessEnv = process.env): Record<SchoolId, SchoolLoader> {
  const out = {} as Record<SchoolId, SchoolLoader>;
  for (const school of SCHOOL_IDS) {
    if (fixturesOn(env)) {
      out[school] = {
        configured: true,
        async load() {
          const loads = ((g.__ftSchoolFixtureLoads ??= {})[school] = (g.__ftSchoolFixtureLoads[school] ?? 0) + 1);
          // test switch: this school fails from its second load on, so stale handling can be seen without a real feed
          if (loads > 1 && env.FINANCE_TOWN_FIXTURE_SCHOOL_FAIL === school) throw new SchoolFeedError("network");
          return parseFeed(fixtureFeed(school, new Date()), school, new Date());
        },
      };
    } else {
      out[school] = {
        configured: feedConfigured(school, env),
        async load() {
          try {
            return parseFeed(await fetchFeedText(school, env), school, new Date());
          } catch (e) {
            if (e instanceof SchoolFeedError) throw e;
            throw new SchoolFeedError("not_a_calendar"); // the text was not parseable as iCalendar; nothing from it is kept
          }
        },
      };
    }
  }
  return out;
}
