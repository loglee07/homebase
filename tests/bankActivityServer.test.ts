import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawPlaidTxn, RawSyncPage } from "@/lib/bankActivity";
import { BLUPEAK_INSTITUTION_ID, type PlaidEnvironment } from "@/lib/plaid";
import { FIXTURE_PAGES, createFixtureBankApi } from "@/lib/server/fixtureBank";
import { createActivityService, resetActivityForTest } from "@/lib/server/plaidActivity";
import { PlaidServiceError, type PlaidApiLike } from "@/lib/server/plaidService";
import { createActivityFileVault, createFileVault, createMemoryActivityVault, createMemoryVault, type ActivityVault, type StoredItem, type TokenVault } from "@/lib/server/vault";

const item = (environment: PlaidEnvironment = "production", itemId = "item-1"): StoredItem => ({ environment, itemId, accessToken: "access-secret-token-xyz", institutionId: BLUPEAK_INSTITUTION_ID, institutionName: "BluPeak", linkedAt: "2026-11-01T00:00:00.000Z" });
const tx = (id: string, amount: number, o: Partial<RawPlaidTxn> = {}): RawPlaidTxn => ({ transaction_id: id, account_id: "a1", amount, date: "2026-10-10", name: "Synthetic Merchant Zed", pending: false, iso_currency_code: "USD", ...o });
const pg = (o: Partial<RawSyncPage>, cursor: string, more = false): RawSyncPage => ({ added: [], modified: [], removed: [], next_cursor: cursor, has_more: more, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE", ...o });
const mutation = () => new PlaidServiceError("unknown", { stage: "transactionsSync", status: 400, errorType: "TRANSACTIONS_ERROR", errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", requestId: null });

/** A scripted sync endpoint: `script(cursor, callNumber)` returns a page or throws. Records every cursor it was asked for. */
function scripted(script: (cursor: string, n: number) => RawSyncPage) {
  const cursors: string[] = [];
  const api = { ...createFixtureBankApi(), transactionsSync: async (r: { cursor?: string }) => (cursors.push(r.cursor ?? ""), { data: script(r.cursor ?? "", cursors.length) }) } as PlaidApiLike;
  return { api, cursors };
}
let dir: string;
let now = 1_000_000;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ft-activity-"));
  resetActivityForTest();
  now = 1_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const key = () => randomBytes(32);
async function setup(api: PlaidApiLike, o: { env?: PlaidEnvironment; token?: TokenVault; activity?: ActivityVault; itemId?: string } = {}) {
  const env = o.env ?? "production";
  const token = o.token ?? createMemoryVault();
  if (!o.token) await token.write(item(env, o.itemId ?? "item-1"));
  const activity = o.activity ?? createMemoryActivityVault();
  return { token, activity, svc: createActivityService({ api, token, activity, environment: env, now: () => now, cooldownMs: 60_000 }) };
}
const ids = (s: Awaited<ReturnType<ReturnType<typeof createActivityService>["read"]>>) => s?.transactions.map((t) => t.id);
const later = () => (now += 61_000);

describe("sync", () => {
  it("reads every page, saves them with the final cursor, and shows newest first", async () => {
    const { api, cursors } = scripted((c) => ({ "": pg({ added: [tx("a", 5, { date: "2026-10-01" })] }, "c1", true), c1: pg({ added: [tx("b", 6, { date: "2026-10-05" })] }, "c2", true), c2: pg({ added: [tx("c", 7, { date: "2026-10-03" })] }, "c3") })[c]!);
    const { svc, activity } = await setup(api);
    const r = await svc.sync();
    expect(r.outcome).toBe("synced");
    expect(cursors).toEqual(["", "c1", "c2"]);
    expect(ids(r.state)).toEqual(["b", "c", "a"]);
    expect(await activity.read("item-1")).toMatchObject({ status: "ok", data: { cursor: "c3", ready: true } });
  });
  it("commits nothing when a later page fails: history, cursor and status stay as they were, shown as stale", async () => {
    let fail = false;
    const { api } = scripted((c) => {
      if (!fail) return c === "" ? pg({ added: [tx("a", 5)] }, "c1") : pg({}, c);
      if (c === "c1") return pg({ added: [tx("b", 6)] }, "c2", true);
      throw Object.assign(new Error("x"), { code: "ECONNRESET" });
    });
    const { svc, activity } = await setup(api);
    await svc.sync();
    const before = await activity.read("item-1");
    fail = true;
    later();
    const r = await svc.sync();
    expect(r.outcome).toBe("failed");
    expect(await activity.read("item-1")).toEqual(before); // byte-for-byte the same history and cursor
    expect(r.state).toMatchObject({ status: "ready", stale: true, lastError: "network" });
    expect(ids(r.state)).toEqual(["a"]);
  });
  it("a failed save commits nothing and the next sync repeats the same changes from the same cursor", async () => {
    const { api, cursors } = scripted((c) => (c === "" ? pg({ added: [tx("a", 5)] }, "c1") : pg({ added: [tx("b", 6)] }, "c2")));
    const activity = createMemoryActivityVault();
    const { svc } = await setup(api, { activity });
    activity.failNextWrite = true;
    const bad = await svc.sync();
    expect(bad.state).toMatchObject({ status: "not_synced", lastError: "storage_failed", transactions: [] });
    expect((await activity.read("item-1")).status).toBe("empty");
    later();
    const good = await svc.sync();
    expect(cursors).toEqual(["", ""]); // the cursor never advanced
    expect(ids(good.state)).toEqual(["a"]);
  });
  it("a repeat sync adds nothing twice and does not move the cursor back", async () => {
    const { api, cursors } = scripted((c) => (c === "" ? pg({ added: [tx("a", 5)] }, "c1") : pg({}, c)));
    const { svc } = await setup(api);
    await svc.sync();
    later();
    const r = await svc.sync();
    expect(cursors).toEqual(["", "c1"]);
    expect(ids(r.state)).toEqual(["a"]);
    expect(r.state?.lastError).toBeNull();
  });
  it("applies modifications, removals and the pending-to-posted replacement from the scripted history", async () => {
    const api = createFixtureBankApi();
    const { svc } = await setup(api, { env: "fixtures" });
    let s = (await svc.sync()).state!;
    expect(s.transactions.map((t) => [t.id, t.pending])).toContainEqual(["t4", true]);
    expect(s.transactions).toHaveLength(5);
    later();
    s = (await svc.sync()).state!;
    expect(ids(s)!.sort()).toEqual(["t1", "t2", "t3", "t4b"]); // t4 replaced by t4b, t5 removed
    expect(s.transactions.find((t) => t.id === "t4b")!.pending).toBe(false);
    expect(s.transactions.find((t) => t.id === "t1")!.amountCents).toBe(-1350); // modified
    expect(s.transactions.find((t) => t.id === "t2")!.amountCents).toBe(200000); // money in
    expect(Object.keys(FIXTURE_PAGES)).toContain("c2");
  });
  it("restarts the whole loop from the first cursor when the data changes mid-pagination, with no double counting", async () => {
    let boom = 1;
    const { api, cursors } = scripted((c) => {
      if (c === "") return pg({ added: [tx("a", 5)] }, "c1", true);
      if (boom-- > 0) throw mutation(); // the 2nd page fails once
      return c === "c1" ? pg({ added: [tx("b", 6)] }, "c2") : pg({ added: [tx("a", 5), tx("b", 6)] }, "c2");
    });
    const { svc } = await setup(api);
    const r = await svc.sync();
    expect(cursors).toEqual(["", "c1", "", "c1"]); // not just the failed request: from the top
    expect(ids(r.state)).toEqual(["a", "b"]);
    expect(r.state?.lastError).toBeNull();
  });
  it("gives up with a clear error when the data keeps changing, and saves nothing", async () => {
    const { api } = scripted((c) => {
      if (c === "") return pg({ added: [tx("a", 5)] }, "c1", true);
      throw mutation();
    });
    const { svc, activity } = await setup(api);
    const r = await svc.sync();
    expect(r.state).toMatchObject({ lastError: "sync_changed", status: "not_synced" });
    expect((await activity.read("item-1")).status).toBe("empty");
  });
  it("two simultaneous syncs share one run and one cursor", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cursors: string[] = [];
    const api = { ...createFixtureBankApi(), transactionsSync: async (r: { cursor?: string }) => (cursors.push(r.cursor ?? ""), await gate, { data: pg({ added: [tx("a", 5)] }, "c1") }) } as PlaidApiLike;
    const { svc } = await setup(api);
    const both = Promise.all([svc.sync(), svc.sync()]);
    release();
    const [x, y] = await both;
    expect(cursors).toEqual([""]);
    expect([x.outcome, y.outcome]).toEqual(["synced", "synced"]);
  });
  it("enforces the cooldown on the server and does not call Plaid during it", async () => {
    const { api, cursors } = scripted((c) => pg({}, c || "c1"));
    const { svc } = await setup(api);
    await svc.sync();
    now += 5_000;
    const r = await svc.sync();
    expect(r.outcome).toBe("cooldown");
    expect(cursors).toHaveLength(1);
    expect(Date.parse(r.state!.cooldownUntil!)).toBe(1_000_000 + 60_000);
  });
});

describe("initial history", () => {
  it("'still preparing' is not saved as an empty history; a later ready-and-empty history is shown as loaded", async () => {
    let ready = false;
    const { api, cursors } = scripted(() => (ready ? pg({}, "c1") : pg({}, "", false)));
    const { svc, activity } = await setup(api);
    expect((await svc.sync()).state).toMatchObject({ status: "preparing", transactions: [], syncedAt: null });
    expect((await activity.read("item-1")).status).toBe("empty");
    expect((await svc.read())!.status).toBe("preparing");
    ready = true;
    later();
    const r = await svc.sync();
    expect(cursors).toEqual(["", ""]);
    expect(r.state).toMatchObject({ status: "ready", transactions: [], lastError: null });
    expect(r.state!.syncedAt).not.toBeNull();
  });
  it("the NOT_READY status also counts as preparing, even with a cursor", async () => {
    const { api } = scripted(() => pg({}, "c1", false) && { ...pg({}, "c1"), transactions_update_status: "TRANSACTIONS_UPDATE_STATUS_NOT_READY" });
    const { svc } = await setup(api);
    expect((await svc.sync()).state!.status).toBe("preparing");
  });
  it("never swaps real saved history for 'preparing'", async () => {
    let first = true;
    const { api } = scripted(() => (first ? pg({ added: [tx("a", 5)] }, "c1") : pg({}, "")));
    const { svc } = await setup(api);
    await svc.sync();
    first = false;
    later();
    const r = await svc.sync();
    expect(r.state).toMatchObject({ status: "ready", stale: true });
    expect(ids(r.state)).toEqual(["a"]);
  });
});

describe("encrypted storage", () => {
  const files = () => readdirSync(dir).filter((f) => !f.startsWith("."));
  it("survives a restart: a fresh service on the same files resumes from the saved cursor", async () => {
    const k = key();
    const token = createFileVault(dir, k, "production");
    await token.write(item());
    const a1 = scripted((c) => (c === "" ? pg({ added: [tx("a", 5)] }, "c1") : pg({}, c)));
    const s1 = await setup(a1.api, { token, activity: createActivityFileVault(dir, k, "production") });
    await s1.svc.sync();
    resetActivityForTest(); // as if the server restarted
    const a2 = scripted((c) => pg({}, c));
    const s2 = await setup(a2.api, { token: createFileVault(dir, k, "production"), activity: createActivityFileVault(dir, k, "production") });
    expect(ids(await s2.svc.read())).toEqual(["a"]);
    await s2.svc.sync();
    expect(a2.cursors).toEqual(["c1"]);
  });
  it("keeps financial data out of plaintext, with private modes and no temp files", async () => {
    const k = key();
    const token = createFileVault(dir, k, "production");
    await token.write(item());
    const { api } = scripted(() => pg({ added: [tx("txn-visible-id", 5)] }, "c1"));
    const { svc } = await setup(api, { token, activity: createActivityFileVault(dir, k, "production") });
    await svc.sync();
    expect(files().sort()).toEqual(["plaid-activity.production.item-1.enc", "plaid-item.production.enc"]);
    const f = path.join(dir, "plaid-activity.production.item-1.enc");
    expect(statSync(f).mode & 0o777).toBe(0o600);
    const text = readFileSync(f, "utf8");
    expect(text).not.toMatch(/Synthetic Merchant|txn-visible-id|access-secret|cursor/);
    expect(readdirSync(dir).filter((x) => x.endsWith(".tmp"))).toEqual([]);
  });
  it("separates environments and Items: other files are never read, and a copied file cannot be decrypted elsewhere", async () => {
    const k = key();
    const prod = createActivityFileVault(dir, k, "production");
    const data = { cursor: "c1", ready: true, complete: true, syncedAt: "2026-11-01T00:00:00.000Z", transactions: [], skippedIds: [] };
    await prod.write("item-1", data);
    expect(await createActivityFileVault(dir, k, "sandbox").read("item-1")).toEqual({ status: "empty" });
    expect(await prod.read("item-2")).toEqual({ status: "empty" });
    copyFileSync(path.join(dir, "plaid-activity.production.item-1.enc"), path.join(dir, "plaid-activity.sandbox.item-1.enc"));
    expect(await createActivityFileVault(dir, k, "sandbox").read("item-1")).toEqual({ status: "unreadable" });
    copyFileSync(path.join(dir, "plaid-activity.production.item-1.enc"), path.join(dir, "plaid-activity.production.item-2.enc"));
    expect(await prod.read("item-2")).toEqual({ status: "unreadable" });
  });
  it("an unreadable history (wrong key or tampering) is reported and never overwritten", async () => {
    const k = key();
    const token = createFileVault(dir, k, "production");
    await token.write(item());
    const act = createActivityFileVault(dir, k, "production");
    await act.write("item-1", { cursor: "c1", ready: true, complete: true, syncedAt: "2026-11-01T00:00:00.000Z", transactions: [], skippedIds: [] });
    const f = path.join(dir, "plaid-activity.production.item-1.enc");
    const good = readFileSync(f, "utf8");
    writeFileSync(f, good.replace(/"tag":"[^"]+"/, '"tag":"AAAAAAAAAAAAAAAAAAAAAA=="'));
    const tampered = readFileSync(f, "utf8");
    const { api, cursors } = scripted((c) => pg({ added: [tx("x", 1)] }, c || "c9"));
    const { svc } = await setup(api, { token, activity: createActivityFileVault(dir, k, "production") });
    expect((await svc.read())!.unreadable).toBe(true);
    const r = await svc.sync();
    expect(r.state).toMatchObject({ lastError: "vault_unreadable", unreadable: true });
    expect(cursors).toEqual([]); // not even asked
    expect(readFileSync(f, "utf8")).toBe(tampered);
  });
  it("a sandbox service never sees or touches a production history", async () => {
    const k = key();
    const prodToken = createFileVault(dir, k, "production");
    await prodToken.write(item("production"));
    const a = scripted((c) => (c === "" ? pg({ added: [tx("prod", 5)] }, "c1") : pg({}, c)));
    await (await setup(a.api, { token: prodToken, activity: createActivityFileVault(dir, k, "production") })).svc.sync();
    resetActivityForTest();
    const b = scripted((c) => pg({ added: [tx("sand", 1)] }, c || "s1"));
    const sbToken = createFileVault(dir, k, "sandbox");
    await sbToken.write(item("sandbox", "item-1"));
    const sb = await setup(b.api, { env: "sandbox", token: sbToken, activity: createActivityFileVault(dir, k, "sandbox") });
    expect(await sb.svc.read()).toMatchObject({ environment: "sandbox", status: "not_synced", transactions: [] });
    await sb.svc.sync();
    expect(files()).toContain("plaid-activity.production.item-1.enc");
    expect(files()).toContain("plaid-activity.sandbox.item-1.enc");
    expect(await createActivityFileVault(dir, k, "production").read("item-1")).toMatchObject({ status: "ok", data: { cursor: "c1" } });
  });
  it("refuses to run when the stored connection belongs to another environment, or is missing", async () => {
    const { api, cursors } = scripted((c) => pg({}, c));
    const wrong = await setup(api, { token: Object.assign(createMemoryVault(), {}) });
    expect(await wrong.svc.read()).toBeNull();
    expect((await wrong.svc.sync()).state).toBeNull();
    expect(cursors).toEqual([]);
  });
});
