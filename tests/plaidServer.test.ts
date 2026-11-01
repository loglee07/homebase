import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LinkTokenCreateRequest } from "plaid";
import { REFRESH_COOLDOWN_MS } from "@/lib/brokerage";
import { BLUPEAK_INSTITUTION_ID, type PlaidEnvironment } from "@/lib/plaid";
import { plaidConfig } from "@/lib/server/plaidConfig";
import { markReconnected, publicBankState, refreshBank, resetBankForTest } from "@/lib/server/bankStore";
import { FIXTURE_BANK_ACCOUNTS, createFixtureBankApi } from "@/lib/server/fixtureBank";
import { PlaidServiceError, createPlaidService, plaidErrorCode, type PlaidApiLike } from "@/lib/server/plaidService";
import { createFileVault, createMemoryVault, decryptItem, encryptItem, parseDataKey, type StoredItem } from "@/lib/server/vault";
import { addPlaceholders, ensureDataKey, envKeys, switchPlaidEnv } from "../scripts/env-lib.mjs";

const ITEM: StoredItem = { environment: "production", itemId: "item-1", accessToken: "access-secret-token-xyz", institutionId: BLUPEAK_INSTITUTION_ID, institutionName: "BluPeak", linkedAt: "2026-11-01T00:00:00.000Z" };
const PUBLIC = "public-fixture-000000";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ft-vault-"));
  resetBankForTest();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const key = () => randomBytes(32);

describe("vault", () => {
  it("accepts only a 32-byte base64 key", () => {
    expect(parseDataKey(key().toString("base64"))).toHaveLength(32);
    for (const bad of [undefined, "", "short", randomBytes(16).toString("base64"), randomBytes(64).toString("base64")]) expect(parseDataKey(bad)).toBeNull();
  });
  it("round-trips, and never stores the token in plaintext", async () => {
    const k = key();
    const v = createFileVault(dir, k, "production");
    expect(await v.read()).toEqual({ status: "empty" });
    await v.write(ITEM);
    const file = readFileSync(path.join(dir, "plaid-item.production.enc"), "utf8");
    expect(file).not.toContain(ITEM.accessToken);
    expect(file).not.toContain("BluPeak");
    expect(await v.read()).toEqual({ status: "ok", item: ITEM });
  });
  it("persists across a restart (a fresh vault object on the same file and key)", async () => {
    const k = key();
    await createFileVault(dir, k, "production").write(ITEM);
    expect(await createFileVault(dir, k, "production").read()).toEqual({ status: "ok", item: ITEM });
  });
  it("is unreadable (never silently replaced) with the wrong key, tampering or garbage", async () => {
    const k = key();
    await createFileVault(dir, k, "production").write(ITEM);
    expect(await createFileVault(dir, key(), "production").read()).toEqual({ status: "unreadable" });
    const file = path.join(dir, "plaid-item.production.enc");
    const env = JSON.parse(readFileSync(file, "utf8"));
    env.data = Buffer.from("tampered").toString("base64");
    writeFileSync(file, JSON.stringify(env));
    expect(await createFileVault(dir, k, "production").read()).toEqual({ status: "unreadable" });
    writeFileSync(file, "not json");
    expect(await createFileVault(dir, k, "production").read()).toEqual({ status: "unreadable" });
    expect(decryptItem(encryptItem(ITEM, k), key(), "production")).toBeNull();
  });
  it("writes atomically: private modes, no temp files left, replacement is whole", async () => {
    const k = key();
    const v = createFileVault(dir, k, "production");
    await v.write(ITEM);
    await v.write({ ...ITEM, itemId: "item-2" });
    expect(readdirSync(dir)).toEqual(["plaid-item.production.enc"]);
    expect(statSync(path.join(dir, "plaid-item.production.enc")).mode & 0o777).toBe(0o600);
    expect(((await v.read()) as { item: StoredItem }).item.itemId).toBe("item-2");
  });
  it("a failed write throws, and leaves no temp file behind", async () => {
    const v = createFileVault(dir, key(), "production");
    mkdirSync(path.join(dir, "plaid-item.production.enc")); // the rename target cannot be replaced by a file
    await expect(v.write(ITEM)).rejects.toBeTruthy();
    expect(readdirSync(dir)).toEqual(["plaid-item.production.enc"]);
  });
});

/** A recording fake of the Plaid API. */
function fake(over: Partial<PlaidApiLike> = {}) {
  const calls: string[] = [];
  const tokens: LinkTokenCreateRequest[] = [];
  const base = createFixtureBankApi();
  const api: PlaidApiLike = {
    linkTokenCreate: async (r) => (calls.push("linkTokenCreate"), tokens.push(r), base.linkTokenCreate(r)),
    itemPublicTokenExchange: async (r) => (calls.push("exchange"), base.itemPublicTokenExchange(r)),
    itemGet: async (r) => (calls.push("itemGet"), base.itemGet(r)),
    itemRemove: async (r) => (calls.push("itemRemove"), base.itemRemove(r)),
    institutionsGetById: async (r) => (calls.push("institutionsGetById"), base.institutionsGetById(r)),
    accountsBalanceGet: async (r) => (calls.push("balance"), base.accountsBalanceGet(r)),
    ...over,
  };
  return { api, calls, tokens };
}
const svc = (api: PlaidApiLike, vault = createMemoryVault(), verifyIdentity = true, environment: PlaidEnvironment = "production") => ({ vault, s: createPlaidService({ api, vault, clientUserId: "u", verifyIdentity, environment }) });
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof PlaidServiceError ? e.code : "other"));

describe("link token", () => {
  it("asks for Transactions only (Balance is not a product), checking and savings only, and no redirect uri", async () => {
    const { api, tokens } = fake();
    const { s } = svc(api);
    expect(await s.prepareLink(false)).toEqual({ linkToken: "link-fixture-token", mode: "new" });
    const t = tokens[0];
    expect(t.products).toEqual(["transactions"]);
    expect(JSON.stringify(t)).not.toMatch(/balance|"auth"|identity|transfer|payment|signal|investments|liabilities/i);
    expect(t.redirect_uri).toBeUndefined();
    expect(t.access_token).toBeUndefined();
    expect(t.account_filters).toEqual({ depository: { account_subtypes: ["checking", "savings"] } });
    expect(t.user).toEqual({ client_user_id: "u" });
  });
  it("verifies BluPeak's published id and Transactions coverage before starting", async () => {
    const wrongName = fake({ institutionsGetById: async (r) => ({ data: { institution: { institution_id: r.institution_id, name: "Someone Else", products: ["transactions"] } } }) });
    expect(await codeOf(svc(wrongName.api).s.prepareLink(false))).toBe("institution_unverified");
    expect(wrongName.tokens).toHaveLength(0);
    const noCoverage = fake({ institutionsGetById: async (r) => ({ data: { institution: { institution_id: r.institution_id, name: "BluPeak", products: ["auth"] } } }) });
    expect(await codeOf(svc(noCoverage.api).s.prepareLink(false))).toBe("institution_unverified");
    const wrongId = fake({ institutionsGetById: async () => ({ data: { institution: { institution_id: "ins_other", name: "BluPeak", products: ["transactions"] } } }) });
    expect(await codeOf(svc(wrongId.api).s.prepareLink(false))).toBe("institution_unverified");
    const sandbox = fake();
    await svc(sandbox.api, createMemoryVault(), false).s.prepareLink(false);
    expect(sandbox.calls).toEqual(["linkTokenCreate"]); // sandbox: identity check skipped (sandbox has no BluPeak)
  });
  it("cancelling Link changes nothing: no exchange, nothing stored", async () => {
    const { api, calls } = fake();
    const { s, vault } = svc(api);
    await s.prepareLink(false); // the browser then closes Link and never calls complete()
    expect(calls).not.toContain("exchange");
    expect(await vault.read()).toEqual({ status: "empty" });
  });
});

describe("exchange and duplicate prevention", () => {
  it("exchanges server-side, verifies the institution, stores the token", async () => {
    const { api, calls } = fake();
    const { s, vault } = svc(api);
    expect(await s.complete(PUBLIC)).toEqual({ institution: "BluPeak" });
    expect(calls).toEqual(["exchange", "itemGet"]);
    const r = await vault.read();
    expect(r.status).toBe("ok");
    expect(await s.vaultStatus()).toBe("linked");
  });
  it("rejects a wrong institution (whatever the browser says), removes that Item and stores nothing", async () => {
    const { api, calls } = fake({ itemGet: async () => ({ data: { item: { institution_id: "ins_999" } } }) });
    const { s, vault } = svc(api);
    expect(await codeOf(s.complete(PUBLIC))).toBe("institution_mismatch");
    expect(calls).toContain("itemRemove");
    expect(await vault.read()).toEqual({ status: "empty" });
  });
  it("refuses a second link: no new Item survives and the stored one is untouched", async () => {
    const { api, calls } = fake();
    const { s, vault } = svc(api);
    await s.complete(PUBLIC);
    const first = await vault.read();
    expect(await codeOf(s.prepareLink(false))).toBe("already_linked");
    calls.length = 0;
    expect(await codeOf(s.complete("public-fixture-111111"))).toBe("already_linked");
    expect(calls).toContain("itemRemove");
    expect(await vault.read()).toEqual(first);
  });
  it("serializes two simultaneous completions into one stored Item", async () => {
    const { api, calls } = fake();
    const { s } = svc(api);
    const results = await Promise.all([codeOf(s.complete(PUBLIC)), codeOf(s.complete("public-fixture-222222"))]);
    expect(results.sort()).toEqual(["already_linked", "ok"]);
    expect(calls.filter((c) => c === "itemRemove")).toHaveLength(1);
  });
  it("removes the Item when it cannot be saved", async () => {
    const { api, calls } = fake();
    const vault = { read: async () => ({ status: "empty" as const }), write: async () => { throw new Error("disk full"); } };
    expect(await codeOf(svc(api, vault).s.complete(PUBLIC))).toBe("vault_write_failed");
    expect(calls).toContain("itemRemove");
  });
  it("never overwrites an unreadable vault", async () => {
    const { api, calls } = fake();
    const vault = { read: async () => ({ status: "unreadable" as const }), write: async () => { throw new Error("must not write"); } };
    const { s } = svc(api, vault);
    expect(await codeOf(s.prepareLink(false))).toBe("vault_unreadable");
    expect(await codeOf(s.complete(PUBLIC))).toBe("vault_unreadable");
    expect(calls).toContain("itemRemove");
  });
  it("rejects malformed public tokens before calling Plaid", async () => {
    const { api, calls } = fake();
    for (const bad of [undefined, 5, "", "access-sandbox-abc", "public-", "public-x y"]) expect(await codeOf(svc(api).s.complete(bad))).toBe("bad_request");
    expect(calls).toEqual([]);
  });
  it("reconnect uses update mode on the stored Item (no products, no second Item)", async () => {
    const { api, tokens } = fake();
    const { s } = svc(api);
    expect(await codeOf(s.prepareLink(true))).toBe("not_linked");
    await s.complete(PUBLIC);
    expect(await s.prepareLink(true)).toMatchObject({ mode: "update" });
    const upd = tokens.at(-1)!;
    expect(upd.access_token).toMatch(/^access-fixture-/);
    expect(upd.products).toBeUndefined();
  });
});

describe("balances and refresh", () => {
  const linked = async (opts?: Parameters<typeof createFixtureBankApi>[0]) => {
    const api = createFixtureBankApi(opts);
    const { s } = svc(api);
    await s.complete(PUBLIC);
    return s;
  };
  const provider = (s: Awaited<ReturnType<typeof linked>>) => ({ load: () => s.loadBalances() });
  const vs = (s: Awaited<ReturnType<typeof linked>>) => () => s.vaultStatus();

  it("loads, normalizes, then refuses inside the cooldown without calling Plaid", async () => {
    const s = await linked();
    let t = 1_000_000;
    const a = await refreshBank("production", provider(s), vs(s), () => t);
    expect(a.outcome).toBe("refreshed");
    expect(a.state.snapshot?.accounts).toHaveLength(FIXTURE_BANK_ACCOUNTS.length);
    expect(a.state.vault).toBe("linked");
    t += REFRESH_COOLDOWN_MS - 1;
    expect((await refreshBank("production", provider(s), vs(s), () => t)).outcome).toBe("cooldown");
    t += 2;
    expect((await refreshBank("production", provider(s), vs(s), () => t)).outcome).toBe("refreshed");
  });
  it("keeps the last good snapshot when a refresh fails and marks it stale", async () => {
    const s = await linked({ failAfterFirst: true });
    let t = 0;
    const ok = await refreshBank("production", provider(s), vs(s), () => t);
    t += REFRESH_COOLDOWN_MS + 1;
    const bad = await refreshBank("production", provider(s), vs(s), () => t);
    expect(bad.outcome).toBe("failed");
    expect(bad.state.snapshot).toEqual(ok.state.snapshot);
    expect(bad.state).toMatchObject({ stale: true, lastError: "network" });
    expect((await refreshBank("production", provider(s), vs(s), () => t + 1)).outcome).toBe("cooldown"); // failures start the cooldown too
  });
  it("a first failure leaves no snapshot and no zeros", async () => {
    const r = await refreshBank("production", { load: async () => { throw new PlaidServiceError("auth_failed"); } }, async () => "linked", () => 1);
    expect(r.state).toMatchObject({ snapshot: null, stale: false, lastError: "auth_failed" });
  });
  it("login-required marks the snapshot stale, and reconnecting releases the cooldown", async () => {
    let t = 0;
    let mode: "ok" | "login" = "ok";
    const p = { load: async () => { if (mode === "login") throw new PlaidServiceError("reconnect_required"); return { institution: "BluPeak", accounts: FIXTURE_BANK_ACCOUNTS }; } };
    await refreshBank("production", p, async () => "linked", () => t);
    mode = "login";
    t += REFRESH_COOLDOWN_MS + 1;
    const bad = await refreshBank("production", p, async () => "linked", () => t);
    expect(bad.state).toMatchObject({ stale: true, lastError: "reconnect_required" });
    markReconnected("production");
    mode = "ok";
    const again = await refreshBank("production", p, async () => "linked", () => t + 1); // same instant, no cooldown wait
    expect(again.outcome).toBe("refreshed");
    expect(again.state).toMatchObject({ stale: false, lastError: null });
  });
  it("never leaks provider text or tokens through errors", async () => {
    const p = { load: async () => { throw new Error("access-secret-token-xyz raw body"); } };
    const r = await refreshBank("production", p, async () => "linked", () => 1);
    expect(r.state.lastError).toBe("unknown");
    expect(JSON.stringify(r.state)).not.toMatch(/secret|raw body/);
  });
  it("reports not linked before any connection", async () => {
    const { s } = svc(createFixtureBankApi());
    expect(await codeOf(s.loadBalances())).toBe("not_linked");
    expect(publicBankState("production", 0, "empty")).toMatchObject({ vault: "empty", snapshot: null });
  });
});

describe("error mapping", () => {
  const plaid = (error_code: string, status = 400) => ({ response: { status, data: { error_code, error_message: "secret details" } } });
  it("maps provider errors to fixed codes", () => {
    expect(plaidErrorCode(plaid("ITEM_LOGIN_REQUIRED"))).toBe("reconnect_required");
    expect(plaidErrorCode(plaid("RATE_LIMIT", 429))).toBe("rate_limited");
    expect(plaidErrorCode(plaid("INVALID_API_KEYS", 400))).toBe("auth_failed");
    expect(plaidErrorCode({ code: "ECONNABORTED" })).toBe("timeout");
    expect(plaidErrorCode({ code: "ENOTFOUND" })).toBe("network");
    expect(plaidErrorCode(new Error("boom"))).toBe("unknown");
    expect(plaidErrorCode(null)).toBe("unknown");
  });
});

describe("setup scripts", () => {
  it("add empty placeholders without touching existing values, and report names only", () => {
    const example = path.join(dir, ".env.example");
    const target = path.join(dir, ".env.local");
    writeFileSync(example, "# a\nA_KEY=\n\n# b\nB_KEY=\nC_KEY=\n");
    writeFileSync(target, "A_KEY=keep-this-value\n");
    const r = addPlaceholders(example, target);
    expect(r).toEqual({ created: false, added: ["B_KEY", "C_KEY"] });
    const text = readFileSync(target, "utf8");
    expect(text.startsWith("A_KEY=keep-this-value\n")).toBe(true);
    expect(text).toContain("B_KEY=\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(addPlaceholders(example, target)).toEqual({ created: false, added: [] });
    expect(readFileSync(target, "utf8")).toBe(text);
    rmSync(target);
    expect(addPlaceholders(example, target).created).toBe(true);
  });
  it("generate the data key once, fill an empty slot, never replace a set one", () => {
    const target = path.join(dir, ".env.local");
    writeFileSync(target, "OTHER=1\nFINANCE_TOWN_DATA_KEY=\nLAST=2\n");
    expect(ensureDataKey(target)).toBe("filled");
    const first = readFileSync(target, "utf8");
    expect(parseDataKey(/FINANCE_TOWN_DATA_KEY=(.*)/.exec(first)![1])).toHaveLength(32);
    expect(first).toContain("OTHER=1\n");
    expect(first).toContain("LAST=2");
    expect(ensureDataKey(target)).toBe("exists");
    expect(readFileSync(target, "utf8")).toBe(first);
    rmSync(target);
    expect(ensureDataKey(target)).toBe("added");
    expect(envKeys(readFileSync(target, "utf8")).get("FINANCE_TOWN_DATA_KEY")).toBe(true);
  });
});


describe("failure diagnostics", () => {
  it("maps Plaid's 400 INVALID_API_KEYS to auth_failed and keeps only identifiers", async () => {
    const { api } = fake();
    const err = Object.assign(new Error("secret-ish message must not survive"), {
      response: { status: 400, data: { error_type: "INVALID_INPUT", error_code: "INVALID_API_KEYS", request_id: "req123", error_message: "leak me not" } },
    });
    api.linkTokenCreate = async () => { throw err; };
    const { s } = svc(api, createMemoryVault(), false, "sandbox");
    const e = await s.prepareLink(false).catch((x) => x);
    expect(e).toBeInstanceOf(PlaidServiceError);
    expect(e.code).toBe("auth_failed");
    expect(e.diag).toEqual({ stage: "linkTokenCreate", status: 400, errorType: "INVALID_INPUT", errorCode: "INVALID_API_KEYS", requestId: "req123" });
    expect(JSON.stringify(e.diag)).not.toMatch(/leak|message/);
  });
});

describe("environment separation", () => {
  const fx = (over: Partial<StoredItem> = {}): StoredItem => ({ ...ITEM, ...over });

  it("keeps one encrypted file per environment, so each one is independent", async () => {
    const k = key();
    const prod = createFileVault(dir, k, "production");
    const sand = createFileVault(dir, k, "sandbox");
    await prod.write(fx());
    const prodFile = readFileSync(path.join(dir, "plaid-item.production.enc"), "utf8");
    expect(await sand.read()).toEqual({ status: "empty" }); // sandbox sees nothing of production
    await sand.write(fx({ environment: "sandbox", accessToken: "access-sandbox-token" }));
    expect(readdirSync(dir).sort()).toEqual(["plaid-item.production.enc", "plaid-item.sandbox.enc"]);
    expect(readFileSync(path.join(dir, "plaid-item.production.enc"), "utf8")).toBe(prodFile); // production file untouched
    expect(((await prod.read()) as { item: StoredItem }).item.accessToken).toBe(ITEM.accessToken);
  });
  it("rejects a token file moved between environments (the environment is part of the encryption)", async () => {
    const k = key();
    await createFileVault(dir, k, "production").write(fx());
    writeFileSync(path.join(dir, "plaid-item.sandbox.enc"), readFileSync(path.join(dir, "plaid-item.production.enc"), "utf8"));
    expect(await createFileVault(dir, k, "sandbox").read()).toEqual({ status: "unreadable" });
    expect(decryptItem(encryptItem(fx(), k), k, "sandbox")).toBeNull();
    expect(decryptItem(encryptItem(fx({ environment: "sandbox" }), k), k, "sandbox")).not.toBeNull();
  });
  it("a service never uses or replaces a token stored for another environment", async () => {
    const wrong = { read: async () => ({ status: "ok" as const, item: fx({ environment: "production" }) }), write: async () => { throw new Error("must not write"); } };
    const { api, calls } = fake();
    const sandboxSvc = createPlaidService({ api, vault: wrong, clientUserId: "u", verifyIdentity: false, environment: "sandbox" });
    expect(await codeOf(sandboxSvc.prepareLink(true))).toBe("environment_mismatch");
    expect(await codeOf(sandboxSvc.prepareLink(false))).toBe("environment_mismatch");
    expect(await codeOf(sandboxSvc.loadBalances())).toBe("environment_mismatch");
    expect(calls).not.toContain("balance");
  });
  it("records the environment on the stored token", async () => {
    const { api } = fake();
    const { s, vault } = svc(api, createMemoryVault(), false, "sandbox");
    await s.complete(PUBLIC);
    expect(((await vault.read()) as { item: StoredItem }).item.environment).toBe("sandbox");
    expect(s.environment).toBe("sandbox");
  });
  it("keeps cached snapshots, cooldowns and errors apart per environment", async () => {
    const ok = { load: async () => ({ institution: "BluPeak", accounts: FIXTURE_BANK_ACCOUNTS }) };
    const bad = { load: async () => { throw new PlaidServiceError("network"); } };
    await refreshBank("sandbox", ok, async () => "linked", () => 0);
    const prod = await refreshBank("production", bad, async () => "linked", () => 1); // not blocked by the sandbox cooldown
    expect(prod.outcome).toBe("failed");
    expect(prod.state).toMatchObject({ environment: "production", snapshot: null, lastError: "network" });
    const sand = publicBankState("sandbox", 2, "linked");
    expect(sand).toMatchObject({ environment: "sandbox", lastError: null });
    expect(sand.snapshot?.environment).toBe("sandbox");
    expect(publicBankState("fixtures", 2, "empty").snapshot).toBeNull();
  });
  it("picks the secret that matches PLAID_ENV and never the other one", () => {
    const base = { PLAID_CLIENT_ID: "c" };
    const env = (o: Record<string, string>) => ({ ...base, ...o }) as unknown as NodeJS.ProcessEnv;
    expect(plaidConfig(env({ PLAID_ENV: "sandbox", PLAID_SECRET_SANDBOX: "sb", PLAID_SECRET_PRODUCTION: "pr" }))).toMatchObject({ env: "sandbox", secret: "sb" });
    expect(plaidConfig(env({ PLAID_ENV: "production", PLAID_SECRET_SANDBOX: "sb", PLAID_SECRET_PRODUCTION: "pr" }))).toMatchObject({ env: "production", secret: "pr" });
    expect(plaidConfig(env({ PLAID_ENV: "sandbox", PLAID_SECRET_PRODUCTION: "pr", PLAID_SECRET: "shared" }))?.secret).toBe("shared"); // never the production one
    expect(plaidConfig(env({ PLAID_ENV: "sandbox", PLAID_SECRET_PRODUCTION: "pr" }))).toBeNull();
    for (const bad of ["development", "Sandbox", "", undefined]) expect(plaidConfig(env({ PLAID_ENV: bad as string, PLAID_SECRET: "s" }))).toBeNull();
    expect(plaidConfig({ PLAID_ENV: "sandbox", PLAID_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("plaid:env switch script", () => {
  const setup = (envText: string) => {
    const base = mkdtempSync(path.join(dir, "sw-"));
    const target = path.join(base, ".env.local");
    const data = path.join(base, ".data");
    mkdirSync(data);
    writeFileSync(path.join(data, "plaid-item.production.enc"), "PRODUCTION-CIPHERTEXT");
    writeFileSync(target, envText);
    return { target, data };
  };
  const BASE = "# keep me\nSNAPTRADE_CLIENT_ID=abc\nPLAID_CLIENT_ID=cid\nPLAID_SECRET_PRODUCTION=prod-secret\nPLAID_SECRET_SANDBOX=sand-secret\nPLAID_ENV=production\nFINANCE_TOWN_DATA_KEY=keykeykey\n";

  it("changes only PLAID_ENV and preserves every other byte, every secret and every saved connection", () => {
    const { target, data } = setup(BASE);
    const r = switchPlaidEnv(target, data, "sandbox");
    expect(r).toMatchObject({ ok: true, env: "sandbox", secretVar: "PLAID_SECRET_SANDBOX", warnSharedSecret: false, connections: { sandbox: false, production: true } });
    expect(readFileSync(target, "utf8")).toBe(BASE.replace("PLAID_ENV=production", "PLAID_ENV=sandbox"));
    expect(readFileSync(path.join(data, "plaid-item.production.enc"), "utf8")).toBe("PRODUCTION-CIPHERTEXT");
    expect(JSON.stringify(r)).not.toMatch(/prod-secret|sand-secret|keykey|"cid"/);
    expect(switchPlaidEnv(target, data, "production")).toMatchObject({ ok: true, env: "production" });
    expect(readFileSync(target, "utf8")).toBe(BASE);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
  it("refuses unknown environments and a missing secret, changing nothing", () => {
    const { target, data } = setup("PLAID_CLIENT_ID=cid\nPLAID_SECRET_PRODUCTION=p\nPLAID_ENV=production\n");
    const before = readFileSync(target, "utf8");
    expect(switchPlaidEnv(target, data, "development").ok).toBe(false);
    expect(switchPlaidEnv(target, data, "sandbox").ok).toBe(false); // no sandbox secret
    expect(readFileSync(target, "utf8")).toBe(before);
    const noClient = setup("PLAID_SECRET_SANDBOX=s\n");
    expect(switchPlaidEnv(noClient.target, noClient.data, "sandbox").ok).toBe(false);
  });
  it("warns when only the shared PLAID_SECRET exists", () => {
    const { target, data } = setup("PLAID_CLIENT_ID=cid\nPLAID_SECRET=shared\nPLAID_ENV=production\n");
    expect(switchPlaidEnv(target, data, "sandbox")).toMatchObject({ ok: true, secretVar: "PLAID_SECRET", warnSharedSecret: true });
  });
});

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const walk = (d: string): string[] =>
  readdirSync(path.join(root, d)).flatMap((f) => {
    const rel = path.join(d, f);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

describe("static boundaries", () => {
  it("the real Plaid client exposes exactly the six allowed calls", () => {
    const src = read("lib/server/plaid.ts").replace(/^\s*\/\/.*$/gm, "");
    const calls = [...src.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
    expect(calls.sort()).toEqual(["accountsBalanceGet", "institutionsGetById", "itemGet", "itemPublicTokenExchange", "itemRemove", "linkTokenCreate"]);
    const service = read("lib/server/plaidService.ts").replace(/^\s*\/\/.*$/gm, "");
    expect(service).not.toMatch(/transactionsSync|transactionsGet|authGet|identityGet|transfer|paymentInitiation|signalEvaluate|accountsGet\b|linkTokenCreate\(\{[^}]*products:\s*\[[^\]]*(auth|identity|balance)/i);
    expect(service.match(/products:\s*\[([^\]]*)\]/g)).toEqual(["products: [TRANSACTIONS]"]);
  });
  it("every bank route runs the guard with a session before doing anything", () => {
    for (const r of ["state", "link-token", "exchange", "refresh", "reconnected"]) {
      const src = read(`app/api/brokerage/bank/${r}/route.ts`);
      expect(src, r).toContain("session: true");
      expect(src.indexOf("guard(req"), r).toBeLessThan(src.search(/getBank\(\)/));
      if (r !== "state") expect(src, r).toContain("mutating: true");
    }
  });
  it("the Plaid SDK, secrets, token vault and server modules stay out of browser code", () => {
    const client = [...walk("components"), ...walk("game"), "lib/plaid.ts", "lib/brokerage.ts", "lib/finance.ts"];
    for (const f of client) {
      const src = read(f);
      expect(src, f).not.toMatch(/from "plaid"|PLAID_SECRET|PLAID_CLIENT_ID|process\.env|lib\/server|FINANCE_TOWN_DATA_KEY|accessToken|access_token/);
    }
  });
  it("the saved token directory is gitignored and outside public/", () => {
    expect(read(".gitignore")).toMatch(/^\/\.data\/$/m);
    expect(read("lib/server/bankProvider.ts")).toMatch(/path\.join\([^)]*process\.cwd\(\), "\.data"\)/);
    expect(read("lib/server/bankProvider.ts")).not.toMatch(/public/);
  });
  it("sandbox and production are the only accepted environments", () => {
    expect(read("lib/server/plaidConfig.ts")).toMatch(/name !== "sandbox" && name !== "production"/);
  });
});
