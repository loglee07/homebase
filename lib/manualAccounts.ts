// Manual "My accounts" mode. Only nicknames, account types and USD balances are collected:
// no credentials, no account numbers. Values live in this browser's localStorage (not encrypted).
import type { Account, AccountKind } from "./finance";
import { parseDollarsToCents, type Cents } from "./money";

export const MANUAL_STORAGE_KEY = "finance-town:manual-accounts:v1";
/** Where unreadable saved data is copied before an explicit reset, so it is never silently lost. */
export const MANUAL_BACKUP_KEY = "finance-town:manual-accounts:v1:unreadable-backup";
export const MODE_STORAGE_KEY = "finance-town:mode:v1";

export type Mode = "demo" | "manual";
export const parseMode = (raw: string): Mode => (raw === "manual" ? "manual" : "demo");

export const MANUAL_KINDS: readonly AccountKind[] = ["checking", "savings", "investment", "debt"];
export const NAME_MAX = 40;

export interface ManualAccount {
  id: string;
  name: string;
  kind: AccountKind;
  /** Always non-negative. For debts this is the amount owed. */
  balanceCents: Cents;
  /** ISO timestamp of the last manual balance entry. */
  updatedAt: string;
}

export interface ManualState {
  version: 1;
  accounts: ManualAccount[];
}

export const EMPTY_MANUAL: ManualState = { version: 1, accounts: [] };

export type ManualLoad =
  | { status: "ok"; state: ManualState }
  | { status: "invalid"; reason: string };

const isKind = (k: unknown): k is AccountKind => MANUAL_KINDS.includes(k as AccountKind);

/** Strict: any malformed or unknown-version data is "invalid" (never partially accepted or overwritten). */
export function loadManual(raw: string | null | undefined): ManualLoad {
  if (!raw) return { status: "ok", state: EMPTY_MANUAL };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "The saved data is not readable." };
  }
  const obj = data as { version?: unknown; accounts?: unknown } | null;
  if (!obj || typeof obj !== "object" || obj.version !== 1) {
    return { status: "invalid", reason: "The saved data is from a different version of the app." };
  }
  if (!Array.isArray(obj.accounts)) return { status: "invalid", reason: "The saved account list is missing." };
  const seen = new Set<string>();
  const accounts: ManualAccount[] = [];
  for (const a of obj.accounts as Partial<ManualAccount>[]) {
    const ok =
      a &&
      typeof a.id === "string" && a.id !== "" && !seen.has(a.id) &&
      typeof a.name === "string" && a.name.trim() !== "" && a.name.length <= NAME_MAX &&
      isKind(a.kind) &&
      typeof a.balanceCents === "number" && Number.isSafeInteger(a.balanceCents) && a.balanceCents >= 0 &&
      typeof a.updatedAt === "string" && !Number.isNaN(Date.parse(a.updatedAt));
    if (!ok) return { status: "invalid", reason: "One or more saved accounts have invalid values." };
    seen.add(a.id!);
    accounts.push({ id: a.id!, name: a.name!, kind: a.kind!, balanceCents: a.balanceCents!, updatedAt: a.updatedAt! });
  }
  return { status: "ok", state: { version: 1, accounts } };
}

export interface AccountInput {
  name: string;
  kind: AccountKind | "";
  amountText: string;
}
export interface ValidAccount {
  name: string;
  kind: AccountKind;
  balanceCents: Cents;
}
export interface AccountErrors {
  name?: string;
  kind?: string;
  amount?: string;
}

export function validateAccountInput(input: AccountInput): { ok: true; value: ValidAccount } | { ok: false; errors: AccountErrors } {
  const errors: AccountErrors = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Give the account a nickname.";
  else if (name.length > NAME_MAX) errors.name = `Keep the nickname to ${NAME_MAX} characters.`;
  else if (/\d{6,}/.test(name.replace(/[\s-]/g, ""))) errors.name = "Use a nickname, not an account number.";
  if (!isKind(input.kind)) errors.kind = "Choose an account type.";
  const money = parseDollarsToCents(input.amountText);
  if (!money.ok) errors.amount = money.error;
  if (errors.name || errors.kind || errors.amount || !money.ok || !isKind(input.kind)) return { ok: false, errors };
  return { ok: true, value: { name, kind: input.kind, balanceCents: money.cents } };
}

const nowIso = () => new Date().toISOString();
const randomId = () => globalThis.crypto.randomUUID();

export function addAccount(state: ManualState, v: ValidAccount, now: () => string = nowIso, newId: () => string = randomId): ManualState {
  return { ...state, accounts: [...state.accounts, { id: newId(), ...v, updatedAt: now() }] };
}

/** The "last updated" time moves only when the balance changes; renaming or retyping keeps it. */
export function updateAccount(state: ManualState, id: string, v: ValidAccount, now: () => string = nowIso): ManualState {
  return {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id !== id ? a : { ...a, ...v, updatedAt: v.balanceCents !== a.balanceCents ? now() : a.updatedAt },
    ),
  };
}

export function deleteAccount(state: ManualState, id: string): ManualState {
  return { ...state, accounts: state.accounts.filter((a) => a.id !== id) };
}

/** Same shape the calculators already use. Debts stay positive amounts owed; summarize() subtracts them once. */
export function toAccounts(state: ManualState): Account[] {
  return state.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    institution: "Entered by you",
    balanceCents: a.balanceCents,
    updatedAt: a.updatedAt,
  }));
}
