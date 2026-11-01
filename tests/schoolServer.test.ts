import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SCHOOL_REFRESH_COOLDOWN_MS, type SchoolEvent } from "@/lib/school";
import { fixtureFeed } from "@/lib/server/fixtureSchool";
import { parseFeed } from "@/lib/server/ics";
import { MAX_FEED_BYTES, SchoolFeedError, feedConfigured, fetchFeedText, type FetchLike } from "@/lib/server/schoolFeed";
import { publicSchoolState, refreshSchool, resetSchoolForTest, type SchoolLoader } from "@/lib/server/schoolStore";

const SECRET_URL = "https://sdsu.instructure.com/feeds/calendars/user_SECRETTOKEN123.ics";
const ENV = { CANVAS_SDSU_FEED_URL: SECRET_URL, CANVAS_SDCCD_FEED_URL: "https://sdccd.instructure.com/feeds/calendars/user_OTHERTOKEN456.ics" } as unknown as NodeJS.ProcessEnv;
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";
const res = (status: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status, headers });
const feed = (...responses: (Response | Error)[]): { fetch: FetchLike; urls: string[] } => {
  const urls: string[] = [];
  let i = 0;
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
};
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as SchoolFeedError | null)?.code;

describe("feed fetching", () => {
  it("returns the calendar text and sends no credentials", async () => {
    const f = feed(res(200, ICS));
    expect(await fetchFeedText("sdsu", ENV, f.fetch)).toContain("BEGIN:VCALENDAR");
    expect(f.urls).toEqual([SECRET_URL]);
  });
  it("needs a configured link and never fetches without one", async () => {
    const f = feed(res(200, ICS));
    expect(await code(fetchFeedText("sdsu", {} as NodeJS.ProcessEnv, f.fetch))).toBe("not_configured");
    expect(await code(fetchFeedText("sdsu", { CANVAS_SDSU_FEED_URL: "  " } as unknown as NodeJS.ProcessEnv, f.fetch))).toBe("not_configured");
    expect(f.urls).toEqual([]);
    expect(feedConfigured("sdsu", ENV)).toBe(true);
    expect(feedConfigured("sdsu", {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it("refuses a link on the wrong school's host without fetching", async () => {
    const f = feed(res(200, ICS));
    const wrong = { CANVAS_SDSU_FEED_URL: "https://sdccd.instructure.com/feeds/calendars/x.ics" } as unknown as NodeJS.ProcessEnv;
    expect(await code(fetchFeedText("sdsu", wrong, f.fetch))).toBe("feed_host_rejected");
    expect(f.urls).toEqual([]);
  });
  it("follows a redirect that stays on the school's host and rejects any other", async () => {
    const ok = feed(res(302, "", { location: "https://ilearn.sdsu.edu/feeds/calendars/user_x.ics" }), res(200, ICS));
    expect(await fetchFeedText("sdsu", ENV, ok.fetch)).toContain("VCALENDAR");
    expect(ok.urls[1]).toBe("https://ilearn.sdsu.edu/feeds/calendars/user_x.ics");
    for (const loc of ["https://evil.example/x.ics", "http://sdsu.instructure.com/x.ics", "//evil.example/x", "https://sdccd.instructure.com/x.ics"]) {
      const bad = feed(res(302, "", { location: loc }), res(200, ICS));
      expect(await code(fetchFeedText("sdsu", ENV, bad.fetch))).toBe("redirect_rejected");
      expect(bad.urls).toHaveLength(1); // the rejected hop was never requested
    }
    expect(await code(fetchFeedText("sdsu", ENV, feed(res(302, "")).fetch))).toBe("redirect_rejected"); // redirect without a target
  });
  it("stops redirect loops", async () => {
    const loop = feed(res(302, "", { location: "https://sdsu.instructure.com/feeds/calendars/user_x.ics" }));
    expect(await code(fetchFeedText("sdsu", ENV, loop.fetch))).toBe("redirect_rejected");
    expect(loop.urls.length).toBeLessThanOrEqual(5);
  });
  it("maps failures to fixed codes", async () => {
    const cases: [Response | Error, string][] = [
      [res(401), "auth_failed"],
      [res(403), "auth_failed"],
      [res(404), "not_found"],
      [res(429), "rate_limited"],
      [res(500), "unknown"],
      [res(200, "<html>login</html>"), "not_a_calendar"],
      [Object.assign(new Error("boom"), { name: "TimeoutError" }), "timeout"],
      [Object.assign(new Error("boom"), { name: "AbortError" }), "timeout"],
      [new TypeError("fetch failed"), "network"],
    ];
    for (const [r, want] of cases) expect(await code(fetchFeedText("sdsu", ENV, feed(r).fetch))).toBe(want);
  });
  it("rejects oversized feeds, declared or streamed", async () => {
    expect(await code(fetchFeedText("sdsu", ENV, feed(res(200, ICS, { "content-length": String(MAX_FEED_BYTES + 1) })).fetch))).toBe("too_large");
    const big = "BEGIN:VCALENDAR\r\n" + "X".repeat(MAX_FEED_BYTES + 10);
    expect(await code(fetchFeedText("sdsu", ENV, feed(res(200, big)).fetch))).toBe("too_large");
  });
  it("never puts the feed link in an error", async () => {
    for (const r of [res(404), new TypeError(`fetch failed ${SECRET_URL}`)]) {
      const e = (await fetchFeedText("sdsu", ENV, feed(r).fetch).then(() => null, (x) => x)) as SchoolFeedError;
      expect(e.message).not.toMatch(/SECRET|instructure/);
      expect(JSON.stringify(e)).not.toMatch(/SECRET|instructure/);
    }
  });
});

describe("per-school state", () => {
  beforeEach(() => resetSchoolForTest());
  const ev = (id: string): SchoolEvent => ({ id, school: "sdsu", title: id, course: null, start: "2026-11-05T17:00:00.000Z", end: null, allDay: false, kind: "event", dueTimeUnknown: false, location: null, url: null, cancelled: false });
  const loader = (events: SchoolEvent[] | Error, configured = true): SchoolLoader => ({
    configured,
    load: async () => {
      if (events instanceof Error) throw events;
      return events;
    },
  });
  it("refreshes one school without touching the other", async () => {
    const r = await refreshSchool("sdsu", loader([ev("a")]), () => 1_000);
    expect(r.outcome).toBe("refreshed");
    expect(r.state.events.map((e) => e.id)).toEqual(["a"]);
    const other = publicSchoolState("sdccd", true, 1_000);
    expect(other).toMatchObject({ events: [], updatedAt: null, lastAttemptAt: null, lastError: null });
  });
  it("keeps the previous events and marks them stale when a refresh fails", async () => {
    await refreshSchool("sdsu", loader([ev("a")]), () => 0, 1000);
    const failed = await refreshSchool("sdsu", loader(new SchoolFeedError("network")), () => 5_000, 1000);
    expect(failed.outcome).toBe("failed");
    expect(failed.state).toMatchObject({ stale: true, lastError: "network", updatedAt: new Date(0).toISOString() });
    expect(failed.state.events.map((e) => e.id)).toEqual(["a"]);
    const healed = await refreshSchool("sdsu", loader([ev("b")]), () => 10_000, 1000);
    expect(healed.state).toMatchObject({ stale: false, lastError: null });
    expect(healed.state.events.map((e) => e.id)).toEqual(["b"]);
  });
  it("one school failing never affects the other", async () => {
    await refreshSchool("sdsu", loader([ev("a")]), () => 0);
    await refreshSchool("sdccd", loader(new SchoolFeedError("auth_failed")), () => 0);
    expect(publicSchoolState("sdsu", true, 10)).toMatchObject({ stale: false, lastError: null });
    expect(publicSchoolState("sdccd", true, 10)).toMatchObject({ lastError: "auth_failed", events: [], stale: false });
  });
  it("applies a cooldown per school, counted from the last attempt, even after a failure", async () => {
    await refreshSchool("sdsu", loader(new SchoolFeedError("network")), () => 0);
    const again = await refreshSchool("sdsu", loader([ev("a")]), () => SCHOOL_REFRESH_COOLDOWN_MS - 1);
    expect(again.outcome).toBe("cooldown");
    expect(again.state.cooldownUntil).toBe(new Date(SCHOOL_REFRESH_COOLDOWN_MS).toISOString());
    const sdccd = await refreshSchool("sdccd", loader([ev("c")]), () => SCHOOL_REFRESH_COOLDOWN_MS - 1);
    expect(sdccd.outcome).toBe("refreshed"); // the other school has its own cooldown
    expect((await refreshSchool("sdsu", loader([ev("a")]), () => SCHOOL_REFRESH_COOLDOWN_MS)).outcome).toBe("refreshed");
  });
  it("does nothing for a school without a feed link", async () => {
    let called = false;
    const r = await refreshSchool("sdsu", { configured: false, load: async () => ((called = true), []) }, () => 0);
    expect(r.outcome).toBe("not_configured");
    expect(called).toBe(false);
    expect(r.state.configured).toBe(false);
  });
  it("marks old data stale even when the last refresh worked", async () => {
    await refreshSchool("sdsu", loader([ev("a")]), () => 0);
    expect(publicSchoolState("sdsu", true, 25 * 3600_000).stale).toBe(true);
  });
  it("collapses concurrent refreshes into one load", async () => {
    let loads = 0;
    const slow: SchoolLoader = { configured: true, load: async () => ((loads += 1), await new Promise((r) => setTimeout(r, 20)), [ev("a")]) };
    await Promise.all([refreshSchool("sdsu", slow, () => 0), refreshSchool("sdsu", slow, () => 0)]);
    expect(loads).toBe(1);
  });
  it("keeps a failure from exposing anything but a fixed code", async () => {
    const r = await refreshSchool("sdsu", loader(new Error(`boom ${SECRET_URL}`)), () => 0);
    expect(r.state.lastError).toBe("unknown");
    expect(JSON.stringify(r.state)).not.toMatch(/SECRET|instructure|boom/);
  });
});

describe("synthetic fixtures", () => {
  const now = new Date("2026-11-04T18:00:00Z");
  it("parse for both schools, with recurrence, all-day, cancelled and a shared UID that stays separate", () => {
    const a = parseFeed(fixtureFeed("sdsu", now), "sdsu", now);
    const b = parseFeed(fixtureFeed("sdccd", now), "sdccd", now);
    expect(a.length).toBeGreaterThan(5);
    expect(a.some((e) => e.allDay)).toBe(true);
    expect(a.some((e) => e.cancelled)).toBe(true);
    expect(a.filter((e) => e.id.startsWith("sdsu:weekly-1@")).length).toBeGreaterThan(1);
    const shared = [...a, ...b].filter((e) => e.id.endsWith(":shared-1"));
    expect(shared.map((e) => e.id).sort()).toEqual(["sdccd:shared-1", "sdsu:shared-1"]);
    expect(a.every((e) => e.school === "sdsu") && b.every((e) => e.school === "sdccd")).toBe(true);
  });
});

describe("route and source boundaries", () => {
  const root = path.resolve(__dirname, "..");
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");
  const walk = (dir: string): string[] => readdirSync(path.join(root, dir)).flatMap((f) => (statSync(path.join(root, dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));

  it("keeps the school routes under /api/brokerage so the session cookie reaches them", () => {
    const routes = walk("app/api").filter((f) => f.endsWith("route.ts") && /school/.test(f));
    expect(routes.sort()).toEqual(["app/api/brokerage/school/refresh/route.ts", "app/api/brokerage/school/state/route.ts"]);
    expect(read("lib/server/session.ts")).toMatch(/Path=\/api\/brokerage[;\s"`]/);
    const hook = read("components/useSchool.ts");
    expect(hook).toMatch(/apiCall\(`brokerage\/school\/\$\{path\}`/);
    expect(hook).toMatch(/call\("state"/);
    expect(hook).toMatch(/call\("refresh"/);
  });
  it("guards every school route with the session, and the refresh with the origin check", () => {
    expect(read("app/api/brokerage/school/state/route.ts")).toMatch(/guard\(req, \{ session: true \}\)/);
    expect(read("app/api/brokerage/school/refresh/route.ts")).toMatch(/guard\(req, \{ mutating: true, session: true \}\)/);
  });
  it("only reads the feed links on the server and never returns or logs them", () => {
    const offenders = walk("components").concat(walk("app"), walk("game"), walk("lib")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("lib/server/") && !f.startsWith("tests"));
    for (const f of offenders) expect(read(f), f).not.toMatch(/process\.env|FEED_ENV|instructure\.com\/feeds/);
    const serverFiles = walk("lib/server").filter((f) => /school|ics/i.test(f));
    for (const f of serverFiles) expect(read(f), f).not.toMatch(/console\.(log|error|warn|info)\([^)]*(url|raw|env)/i);
    expect(read(".env.example")).toMatch(/^CANVAS_SDSU_FEED_URL=$/m);
    expect(read(".env.example")).toMatch(/^CANVAS_SDCCD_FEED_URL=$/m);
    expect(read(".env.example")).not.toMatch(/NEXT_PUBLIC_.*CANVAS/);
  });
  it("keeps the parser out of browser code", () => {
    for (const f of walk("components")) expect(read(f), f).not.toMatch(/ical\.js|server\/ics|schoolFeed/);
    expect(read("package.json")).toMatch(/"ical\.js"/);
  });
});
