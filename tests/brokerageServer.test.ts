import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guard, isLoopbackHost } from "@/lib/server/guard";
import { IDLE_TIMEOUT_MS, LOCKOUT_MS, MAX_FAILURES, SESSION_TTL_MS, checkSession, login, resetSessionsForTest, sessionCookie, touchSession, validSession, logout } from "@/lib/server/session";
import { BrokerageError, publicState, refresh, resetBrokerageForTest, type BrokerageProvider } from "@/lib/server/brokerageStore";
import { createFixtureProvider } from "@/lib/server/fixtures";
import { REFRESH_COOLDOWN_MS, STALE_AFTER_MS } from "@/lib/brokerage";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/provider", () => ({ getProvider: () => ({ kind: "none" }) }));

const CODE = "synthetic-access-code-123";
const env = { FINANCE_TOWN_ACCESS_CODE: CODE } as unknown as NodeJS.ProcessEnv;
const req = (headers: Record<string, string>, method = "GET") => new Request("http://localhost:3000/api/brokerage/x", { method, headers });
const BASE = { host: "localhost:3000" };

beforeEach(() => {
  resetSessionsForTest();
  resetBrokerageForTest();
});

describe("guard", () => {
  it("accepts only loopback hosts (DNS rebinding and LAN access are refused)", () => {
    expect(isLoopbackHost("localhost:3000")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:3000")).toBe(true);
    expect(isLoopbackHost("[::1]:3000")).toBe(true);
    for (const h of ["192.168.1.5:3000", "evil.example", "localhost.evil.example", "0.0.0.0:3000", null]) expect(isLoopbackHost(h)).toBe(false);
    expect(guard(req({ host: "192.168.1.5:3000" }), {}, env)?.status).toBe(403);
  });
  it("fails closed when no access code is configured (or it is too short)", () => {
    expect(guard(req(BASE), { session: true }, {} as NodeJS.ProcessEnv)?.status).toBe(503);
    expect(guard(req(BASE), { session: true }, { FINANCE_TOWN_ACCESS_CODE: "short" } as unknown as NodeJS.ProcessEnv)?.status).toBe(503);
  });
  it("requires a valid session cookie", () => {
    expect(guard(req(BASE), { session: true }, env)?.status).toBe(401);
    expect(guard(req({ ...BASE, cookie: "ft_session=forged" }), { session: true }, env)?.status).toBe(401);
    const r = login(CODE, Date.now(), env);
    if (!r.ok) throw new Error("login failed");
    expect(guard(req({ ...BASE, cookie: `ft_session=${r.token}` }), { session: true }, env)).toBeNull();
  });
  it("same-origin: mutating requests need a matching Origin; cross-site fetch metadata is refused", () => {
    expect(guard(req(BASE, "POST"), { mutating: true }, env)?.status).toBe(403);
    expect(guard(req({ ...BASE, origin: "http://evil.example" }, "POST"), { mutating: true }, env)?.status).toBe(403);
    expect(guard(req({ ...BASE, origin: "null" }, "POST"), { mutating: true }, env)?.status).toBe(403);
    expect(guard(req({ ...BASE, origin: "http://localhost:3000" }, "POST"), { mutating: true }, env)).toBeNull();
    expect(guard(req({ ...BASE, "sec-fetch-site": "cross-site" }), {}, env)?.status).toBe(403);
    expect(guard(req({ ...BASE, "sec-fetch-site": "same-site" }), {}, env)?.status).toBe(403);
    expect(guard(req({ ...BASE, "sec-fetch-site": "same-origin" }), {}, env)).toBeNull();
  });
});

describe("session", () => {
  it("rejects a wrong code, accepts the right one, expires and logs out", () => {
    expect(login("wrong", 0, env)).toMatchObject({ ok: false, reason: "wrong_code" });
    expect(login(undefined, 0, env)).toMatchObject({ ok: false, reason: "wrong_code" });
    const ok = login(CODE, 1000, env);
    if (!ok.ok) throw new Error("expected login");
    expect(validSession(ok.token, 2000)).toBe(true);
    expect(validSession(ok.token, 1000 + 9 * 3600 * 1000)).toBe(false); // past the 8 hour lifetime
    const again = login(CODE, 5000, env);
    if (!again.ok) throw new Error("expected login");
    logout(again.token);
    expect(validSession(again.token, 5001)).toBe(false);
  });
  it("locks out after repeated failures, even for the right code, then recovers", () => {
    for (let i = 0; i < MAX_FAILURES; i++) login("nope", 1000 + i, env);
    expect(login(CODE, 2000, env)).toMatchObject({ ok: false, reason: "locked" });
    expect(login(CODE, 1000 + LOCKOUT_MS + 10, env).ok).toBe(true);
  });
  it("sets HttpOnly, SameSite=Strict cookies scoped to the brokerage API; Secure over HTTPS", () => {
    const c = sessionCookie("tok", 60, false);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/api/brokerage");
    expect(c).not.toContain("Secure");
    expect(sessionCookie("tok", 60, true)).toContain("Secure");
  });
});

const failing: BrokerageProvider = { load: async () => { throw new BrokerageError("network"); } };

describe("refresh and snapshot", () => {
  it("starts empty: no snapshot, no cooldown", () => {
    expect(publicState(0)).toEqual({ snapshot: null, stale: false, lastError: null, lastAttemptAt: null, cooldownUntil: null });
  });
  it("refreshes, then refuses inside the cooldown without calling the provider", async () => {
    let calls = 0;
    const p: BrokerageProvider = { load: async () => { calls++; return createFixtureProvider().load(); } };
    let t = 1_000_000;
    const first = await refresh(p, () => t);
    expect(first.outcome).toBe("refreshed");
    expect(first.state.snapshot?.fetchedAt).toBe(new Date(t).toISOString());
    t += REFRESH_COOLDOWN_MS - 1;
    expect((await refresh(p, () => t)).outcome).toBe("cooldown");
    expect(calls).toBe(1);
    t += 2;
    expect((await refresh(p, () => t)).outcome).toBe("refreshed");
    expect(calls).toBe(2);
  });
  it("keeps the last good snapshot on failure and marks it stale", async () => {
    let t = 0;
    const ok = await refresh(createFixtureProvider(), () => t);
    const before = ok.state.snapshot;
    t += REFRESH_COOLDOWN_MS + 1;
    const bad = await refresh(failing, () => t);
    expect(bad.outcome).toBe("failed");
    expect(bad.state.snapshot).toEqual(before);
    expect(bad.state).toMatchObject({ stale: true, lastError: "network" });
    // a failed attempt also starts the cooldown, so errors cannot be hammered
    expect((await refresh(failing, () => t + 1)).outcome).toBe("cooldown");
    t += REFRESH_COOLDOWN_MS + 1;
    const good = await refresh(createFixtureProvider(), () => t);
    expect(good.state).toMatchObject({ stale: false, lastError: null });
  });
  it("a first failure leaves no snapshot (nothing invented, nothing zero)", async () => {
    const r = await refresh(failing, () => 5);
    expect(r.state.snapshot).toBeNull();
    expect(r.state.stale).toBe(false);
    expect(r.state.lastError).toBe("network");
  });
  it("maps unknown errors to a fixed code and never keeps provider text", async () => {
    const leaky: BrokerageProvider = { load: async () => { throw new Error("secret-body 123456789"); } };
    const r = await refresh(leaky, () => 1);
    expect(r.state.lastError).toBe("unknown");
    expect(JSON.stringify(r.state)).not.toMatch(/secret-body|123456789/);
  });
  it("marks an old snapshot stale even without an error", async () => {
    await refresh(createFixtureProvider(), () => 0);
    expect(publicState(STALE_AFTER_MS + 1).stale).toBe(true);
    expect(publicState(STALE_AFTER_MS - 1).stale).toBe(false);
  });
  it("shares one in-flight refresh between concurrent calls", async () => {
    let calls = 0;
    const slow: BrokerageProvider = { load: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return createFixtureProvider().load(); } };
    const [a, b] = await Promise.all([refresh(slow, () => 1), refresh(slow, () => 1)]);
    expect(calls).toBe(1);
    expect(a.outcome).toBe("refreshed");
    expect(b.outcome).toBe("refreshed");
  });
  it("fixture data is clearly synthetic and covers every status", async () => {
    const { state } = await refresh(createFixtureProvider(), () => 1);
    const statuses = new Set(state.snapshot?.accounts.map((a) => a.status));
    expect(statuses).toEqual(new Set(["ok", "unsupported_currency", "unavailable", "connection_not_read_only", "connection_disabled"]));
    expect(JSON.stringify(state)).not.toMatch(/88112233/);
  });
});

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(path.join(root, dir)).flatMap((f) => {
    const rel = path.join(dir, f);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

describe("static boundaries", () => {
  it("the SnapTrade client calls only the two read endpoints", () => {
    const src = read("lib/server/snaptrade.ts").replace(/^\s*\/\/.*$/gm, "");
    const calls = [...src.matchAll(/client\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(calls.sort()).toEqual(["accountInformation.listUserAccounts", "connections.listBrokerageAuthorizations"]);
    expect(src).not.toMatch(/userSecret|userId|registerSnapTradeUser|loginSnapTradeUser|trading|placeOrder|refreshBrokerageAuthorization|deleteConnection|commercialApiKey/i);
  });
  it("the SDK, credentials, process.env and server modules stay out of browser code (the access code's variable name may appear as setup text only)", () => {
    const clientFiles = [...walk("components"), ...walk("game"), "lib/brokerage.ts", "lib/finance.ts", "lib/manualAccounts.ts", "lib/milestones.ts"];
    for (const f of clientFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/snaptrade-typescript-sdk|lib\/server|SNAPTRADE_|consumerKey|process\.env/);
    }
  });
  it("no secret is exposed through NEXT_PUBLIC_ variables", () => {
    for (const f of [".env.example", ...walk("lib"), ...walk("app"), ...walk("components")]) expect(read(f), f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SNAPTRADE|ACCESS|KEY|SECRET)/);
  });
  it(".env.example holds only empty placeholders", () => {
    const values = read(".env.example").split("\n").filter((l) => /^[A-Z_]+=/.test(l));
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const l of values) expect(l.split("=")[1], l).toBe("");
  });
  it("every brokerage route runs the guard first", () => {
    for (const r of ["status", "session", "snapshot", "refresh"]) {
      const src = read(`app/api/brokerage/${r}/route.ts`);
      expect(src, r).toContain("guard(req");
      expect(src.indexOf("guard(req"), r).toBeLessThan(src.search(/getProvider\(\)|login\(|refresh\(provider/));
    }
  });
  it("the dev and start scripts bind to loopback", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts.dev).toContain("-H 127.0.0.1");
    expect(scripts.start).toContain("-H 127.0.0.1");
  });
});

describe("one session for every building", () => {
  const routes = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : [];
    });
  const root = path.join(process.cwd(), "app/api/brokerage");

  it("every protected route checks the session on the server (only status and session do not)", () => {
    const found = routes(root).map((p) => path.relative(root, path.dirname(p)));
    expect(found.length).toBeGreaterThan(5);
    for (const r of found) {
      const src = readFileSync(path.join(root, r, "route.ts"), "utf8");
      if (r === "status" || r === "session") continue;
      expect(src, r).toMatch(/session:\s*true/);
    }
  });
  it("one login opens the guard for bank and school routes alike; one logout closes both", () => {
    const ok = login(CODE, Date.now(), env);
    if (!ok.ok) throw new Error("login failed");
    const withCookie = { ...BASE, cookie: `ft_session=${ok.token}` };
    for (const p of ["bank/state", "school/state", "snapshot"]) {
      expect(guard(new Request(`http://localhost:3000/api/brokerage/${p}`, { headers: withCookie }), { session: true }, env), p).toBeNull();
    }
    logout(ok.token);
    for (const p of ["bank/state", "school/state", "snapshot"]) {
      expect(guard(new Request(`http://localhost:3000/api/brokerage/${p}`, { headers: withCookie }), { session: true }, env)?.status, p).toBe(401);
    }
  });
  it("the session expires after 8 hours, for every route at once", () => {
    const ok = login(CODE, 1_000, env);
    if (!ok.ok) throw new Error("login failed");
    // keep it active every 10 minutes so only the absolute limit can end it
    for (let t = 1_000; t < 1_000 + SESSION_TTL_MS - 600_000; t += 600_000) expect(touchSession(ok.token, t).valid).toBe(true);
    expect(validSession(ok.token, 1_000 + SESSION_TTL_MS - 1)).toBe(true);
    expect(validSession(ok.token, 1_000 + SESSION_TTL_MS)).toBe(false);
  });
  it("the page keeps one access client, one Lock button, no stored unlocked flag, and locks on any 401", () => {
    const town = read("components/FinanceTown.tsx");
    expect(town.match(/useBrokerage\(/g)).toHaveLength(1);
    expect(read("components/apiCall.ts")).toContain("SESSION_ENDED_EVENT");
    expect(read("components/BrokeragePanel.tsx")).not.toContain("client.lock()");
    for (const f of ["components/FinanceTown.tsx", "components/useBrokerage.ts", "components/apiCall.ts"]) {
      expect(read(f), f).not.toMatch(/(local|session)Storage[^\n]*(unlock|access|session)/i);
    }
  });
});


describe("idle timeout (controlled clock)", () => {
  const T0 = 1_000_000;
  const start = () => {
    const ok = login(CODE, T0, env);
    if (!ok.ok) throw new Error("login failed");
    return ok.token;
  };

  it("ends after 30 minutes without activity, at the exact boundary", () => {
    const token = start();
    expect(validSession(token, T0 + IDLE_TIMEOUT_MS - 1)).toBe(true);
    expect(checkSession(token, T0 + IDLE_TIMEOUT_MS)).toEqual({ valid: false, reason: "idle" });
  });
  it("reported activity moves the idle deadline, again and again", () => {
    const token = start();
    let t = T0;
    for (let i = 0; i < 15; i++) {
      t += IDLE_TIMEOUT_MS - 60_000; // always inside the window
      expect(touchSession(token, t)).toMatchObject({ valid: true, idleMsLeft: IDLE_TIMEOUT_MS });
    }
    expect(validSession(token, t + IDLE_TIMEOUT_MS - 1)).toBe(true);
    expect(validSession(token, t + IDLE_TIMEOUT_MS)).toBe(false);
  });
  it("checking, protected routes and reloads never move it", () => {
    vi.useFakeTimers();
    try {
      const token = start();
      for (let t = T0 + 60_000; t < T0 + IDLE_TIMEOUT_MS; t += 60_000) {
        vi.setSystemTime(t);
        const c = checkSession(token, t); // what status polling, a reload or any route does
        expect(c).toMatchObject({ valid: true });
        expect((c as { idleMsLeft: number }).idleMsLeft).toBe(IDLE_TIMEOUT_MS - (t - T0));
        expect(guard(req({ ...BASE, cookie: `ft_session=${token}` }), { session: true }, env)).toBeNull(); // a protected route
      }
      vi.setSystemTime(T0 + IDLE_TIMEOUT_MS);
      expect(guard(req({ ...BASE, cookie: `ft_session=${token}` }), { session: true }, env)?.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });
  it("activity never extends the 8 hour maximum", () => {
    const token = start();
    const last = T0 + SESSION_TTL_MS - 1000;
    for (let t = T0; t < last; t += 20 * 60_000) touchSession(token, t);
    const r = touchSession(token, last);
    expect(r).toMatchObject({ valid: true, absoluteMsLeft: 1000 });
    expect(touchSession(token, T0 + SESSION_TTL_MS)).toEqual({ valid: false, reason: "absolute" });
  });
  it("whichever limit comes first wins, and says which", () => {
    const a = start();
    expect(checkSession(a, T0 + IDLE_TIMEOUT_MS)).toMatchObject({ reason: "idle" });
    const b = login(CODE, T0, env);
    if (!b.ok) throw new Error("login failed");
    for (let t = T0; t < T0 + SESSION_TTL_MS - 1000; t += 20 * 60_000) touchSession(b.token, t); // stays active the whole time
    touchSession(b.token, T0 + SESSION_TTL_MS - 1000);
    expect(checkSession(b.token, T0 + SESSION_TTL_MS)).toMatchObject({ reason: "absolute" });
  });
  it("an ended session cannot be revived by activity, a cookie replay or time going backwards; only the code works", () => {
    const token = start();
    const late = T0 + IDLE_TIMEOUT_MS + 1;
    expect(touchSession(token, late)).toEqual({ valid: false, reason: "idle" });
    expect(touchSession(token, late + 1)).toEqual({ valid: false, reason: "idle" }); // still gone
    expect(validSession(token, T0 + 1)).toBe(false); // even if the clock is set back
    expect(login(CODE, late, env)).toMatchObject({ ok: true });
  });
  it("an unknown cookie (for example after a server restart) is reported as unknown, never as valid", () => {
    expect(checkSession("forged", T0)).toEqual({ valid: false, reason: "unknown" });
    expect(checkSession(null, T0)).toEqual({ valid: false, reason: "none" });
  });
  it("global locking: a logout in one place ends the session for every request", () => {
    const token = start();
    logout(token);
    expect(validSession(token, T0 + 1)).toBe(false);
  });
});

describe("activity and status routes (fake clock)", () => {
  const T0 = new Date("2026-11-01T12:00:00Z").getTime();
  const post = (token: string | null) =>
    new Request("http://localhost:3000/api/brokerage/activity", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", ...(token ? { cookie: `ft_session=${token}` } : {}) } });
  const statusReq = (token: string | null) => new Request("http://localhost:3000/api/brokerage/status", { headers: { host: "localhost:3000", ...(token ? { cookie: `ft_session=${token}` } : {}) } });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubEnv("FINANCE_TOWN_ACCESS_CODE", CODE);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("the activity route needs a session and a same-origin POST", async () => {
    const { POST } = await import("@/app/api/brokerage/activity/route");
    expect((await POST(post(null))).status).toBe(401);
    expect((await POST(new Request("http://localhost:3000/api/brokerage/activity", { method: "POST", headers: { host: "localhost:3000" } }))).status).toBe(403);
  });
  it("activity extends the idle deadline; status polling does not; the status page reports time left and why it ended", async () => {
    const { POST } = await import("@/app/api/brokerage/activity/route");
    const { GET } = await import("@/app/api/brokerage/status/route");
    const ok = login(CODE, Date.now(), env);
    if (!ok.ok) throw new Error("login failed");
    vi.setSystemTime(T0 + 20 * 60_000);
    const polled = (await (await GET(statusReq(ok.token))).json()) as { access: string; idleMsLeft: number };
    expect(polled).toMatchObject({ access: "unlocked", idleMsLeft: 10 * 60_000 }); // polling did not reset it
    expect((await POST(post(ok.token))).status).toBe(200);
    const after = (await (await GET(statusReq(ok.token))).json()) as { idleMsLeft: number; absoluteMsLeft: number };
    expect(after.idleMsLeft).toBe(IDLE_TIMEOUT_MS);
    expect(after.absoluteMsLeft).toBe(SESSION_TTL_MS - 20 * 60_000); // the 8 hour limit did not move
    vi.setSystemTime(T0 + 20 * 60_000 + IDLE_TIMEOUT_MS);
    const gone = (await (await GET(statusReq(ok.token))).json()) as { access: string; ended?: string };
    expect(gone).toMatchObject({ access: "locked", ended: "idle" });
    const denied = await POST(post(ok.token));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ reason: "idle" });
  });
  it("a cookie the server does not know reads as locked/unknown (the dev-server-restart case), never unlocked", async () => {
    const { GET } = await import("@/app/api/brokerage/status/route");
    const body = (await (await GET(statusReq("token-from-before-a-restart"))).json()) as { access: string; ended?: string };
    expect(body).toMatchObject({ access: "locked", ended: "unknown" });
    const none = (await (await GET(statusReq(null))).json()) as { access: string; ended?: string };
    expect(none.access).toBe("locked");
    expect(none.ended).toBeUndefined();
  });
});
