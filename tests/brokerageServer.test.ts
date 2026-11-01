import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { guard, isLoopbackHost } from "@/lib/server/guard";
import { LOCKOUT_MS, MAX_FAILURES, login, resetSessionsForTest, sessionCookie, validSession, logout } from "@/lib/server/session";
import { BrokerageError, publicState, refresh, resetBrokerageForTest, type BrokerageProvider } from "@/lib/server/brokerageStore";
import { createFixtureProvider } from "@/lib/server/fixtures";
import { REFRESH_COOLDOWN_MS, STALE_AFTER_MS } from "@/lib/brokerage";

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
