import { describe, expect, it } from "vitest";
import { MAX_ACCOUNTS, addAccount, loadManual, EMPTY_MANUAL, type ManualState } from "@/lib/manualAccounts";
import { BACKUP_FORMAT, BACKUP_MAX_BYTES, backupFilename, parseBackup, serializeBackup } from "@/lib/manualBackup";
import { MAX_MANUAL_CENTS } from "@/lib/money";

const stamp = () => "2026-11-01T12:00:00.000Z";
const ids = (...v: string[]) => { let i = 0; return () => v[i++]; };

function sample(): ManualState {
  let s = addAccount(EMPTY_MANUAL, { name: "Daily", kind: "checking", balanceCents: 250_075 }, () => "2026-10-01T09:00:00.000Z", ids("a"));
  s = addAccount(s, { name: "Nest egg", kind: "investment", balanceCents: 1_000_000 }, () => "2026-10-15T09:00:00.000Z", ids("b"));
  s = addAccount(s, { name: "Card", kind: "debt", balanceCents: 40_025 }, () => "2026-10-20T09:00:00.000Z", ids("c"));
  return s;
}

const file = (accounts: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: stamp(), accounts, ...over });
const good = { id: "x", name: "Ok", kind: "savings", balanceCents: 100, updatedAt: "2026-10-01T00:00:00.000Z" };
const rejects = (text: string, match?: RegExp) => {
  const r = parseBackup(text);
  expect(r.ok).toBe(false);
  if (!r.ok && match) expect(r.error).toMatch(match);
};

describe("backup export", () => {
  it("holds only manual-account fields, with a format and version", () => {
    const obj = JSON.parse(serializeBackup(sample(), stamp));
    expect(Object.keys(obj).sort()).toEqual(["accounts", "exportedAt", "format", "version"]);
    expect(obj).toMatchObject({ format: BACKUP_FORMAT, version: 1, exportedAt: stamp() });
    expect(Object.keys(obj.accounts[0]).sort()).toEqual(["balanceCents", "id", "kind", "name", "updatedAt"]);
    const text = JSON.stringify(obj).toLowerCase();
    for (const banned of ["hometier", "milestone", "scenario", "transaction", "demo"]) expect(text).not.toContain(banned);
  });

  it("names files by local date", () => {
    expect(backupFilename(new Date(2026, 10, 1))).toBe("finance-town-accounts-2026-11-01.json");
  });
});

describe("backup round trip", () => {
  it("restores ids, nicknames, types, integer cents and update dates exactly", () => {
    const original = sample();
    const r = parseBackup(serializeBackup(original, stamp));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.state).toEqual(original);
    expect(r.preview.accountCount).toBe(3);
    expect(r.preview.netWorthCents).toBe(250_075 + 1_000_000 - 40_025);
    // and what gets saved reads back as valid saved data
    expect(loadManual(JSON.stringify(r.preview.state))).toEqual({ status: "ok", state: original });
  });

  it("accepts an empty backup", () => {
    const r = parseBackup(serializeBackup(EMPTY_MANUAL, stamp));
    expect(r.ok && r.preview.accountCount).toBe(0);
  });

  it("drops unknown fields instead of carrying them into saved data", () => {
    const r = parseBackup(file([{ ...good, secret: "x", accountNumber: "123456789" }], { extra: 1 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.preview.state.accounts[0]).sort()).toEqual(["balanceCents", "id", "kind", "name", "updatedAt"]);
  });
});

describe("backup rejection", () => {
  it("rejects malformed or wrongly-shaped files", () => {
    rejects("", /not valid JSON/);
    rejects("{nope", /not valid JSON/);
    rejects("null", /not a Homebase/);
    rejects("[]", /not a Homebase/);
    rejects(JSON.stringify({ version: 1, accounts: [] }), /not a Homebase/);
    rejects(JSON.stringify({ format: "other", version: 1, accounts: [] }), /not a Homebase/);
    rejects(file({ not: "a list" }), /list is missing/);
  });

  it("rejects unsupported versions", () => {
    rejects(file([], { version: 2 }), /unsupported version/);
    rejects(file([], { version: "1" }), /unsupported version/);
    rejects(JSON.stringify({ format: BACKUP_FORMAT, accounts: [] }), /unsupported version/);
  });

  it("rejects duplicate ids", () => {
    rejects(file([good, { ...good, name: "Other" }]), /repeats an id/);
  });

  it("rejects invalid account types", () => {
    for (const kind of ["crypto", "", null, 3, "Checking"]) rejects(file([{ ...good, kind }]), /invalid account type/);
  });

  it("rejects invalid or unsafe money", () => {
    const bad: unknown[] = [-1, 1.5, "100", null, NaN, Infinity, 2 ** 53, Number.MAX_SAFE_INTEGER, MAX_MANUAL_CENTS + 1];
    for (const balanceCents of bad) rejects(file([{ ...good, balanceCents }]), /invalid balance/);
    // JSON has no NaN/Infinity literals; a hand-edited file with one is simply invalid JSON
    rejects('{"format":"finance-town-manual-accounts","version":1,"accounts":[{"balanceCents":NaN}]}', /not valid JSON/);
    expect(parseBackup(file([{ ...good, balanceCents: MAX_MANUAL_CENTS }])).ok).toBe(true);
    expect(parseBackup(file([{ ...good, balanceCents: 0 }])).ok).toBe(true);
  });

  it("rejects bad nicknames, ids, dates and entries", () => {
    rejects(file([{ ...good, name: "" }]), /nickname/);
    rejects(file([{ ...good, name: "x".repeat(41) }]), /40 characters/);
    rejects(file([{ ...good, name: "1234 5678 9012" }]), /account number/);
    rejects(file([{ ...good, name: "bad\u0007name" }]), /control characters/);
    rejects(file([{ ...good, id: "" }]), /valid id/);
    rejects(file([{ ...good, updatedAt: "yesterday" }]), /update date/);
    rejects(file([{ ...good, updatedAt: 5 }]), /update date/);
    rejects(file([null]), /not valid/);
    rejects(file(["x"]), /not valid/);
  });

  it("rejects too many accounts and oversized files", () => {
    const many = Array.from({ length: MAX_ACCOUNTS + 1 }, (_, i) => ({ ...good, id: `i${i}` }));
    rejects(file(many), /more than/);
    rejects(" ".repeat(BACKUP_MAX_BYTES + 1), /too large/);
  });

  it("one bad account rejects the whole file", () => {
    rejects(file([good, { ...good, id: "y", balanceCents: -5 }]), /Account 2/);
  });
});
