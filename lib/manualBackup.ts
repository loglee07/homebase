// Backup and restore for manual accounts only. The file holds exactly what the user entered (ids, nicknames,
// types, integer-cent balances, update dates): no demo data and no derived home-tier state.
// It is a plain, unencrypted JSON file. Keep it private; it is gitignored by name.
import { summarize } from "./finance";
import { parseManualState, toAccounts, type ManualState } from "./manualAccounts";
import type { Cents } from "./money";

export const BACKUP_FORMAT = "finance-town-manual-accounts";
export const BACKUP_VERSION = 1;
/** A real backup is a few KB; refuse anything absurd before reading it. */
export const BACKUP_MAX_BYTES = 1_000_000;

export interface BackupPreview {
  state: ManualState;
  accountCount: number;
  netWorthCents: Cents;
}

export type BackupParse = { ok: true; preview: BackupPreview } | { ok: false; error: string };

export function serializeBackup(state: ManualState, now: () => string = () => new Date().toISOString()): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now(),
      accounts: state.accounts.map(({ id, name, kind, balanceCents, updatedAt }) => ({ id, name, kind, balanceCents, updatedAt })),
    },
    null,
    2,
  );
}

export const backupFilename = (now: Date = new Date()) =>
  `finance-town-accounts-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.json`;

/** Validates the whole file; nothing is applied here. */
export function parseBackup(text: string): BackupParse {
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: "That file is too large to be a backup." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON, so it can't be a backup." };
  }
  const obj = data as { format?: unknown; version?: unknown; accounts?: unknown } | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: "That file is not a Homebase accounts backup." };
  }
  if (obj.version !== BACKUP_VERSION) return { ok: false, error: "That backup is from an unsupported version." };
  const parsed = parseManualState({ version: 1, accounts: obj.accounts });
  if (parsed.status === "invalid") return { ok: false, error: parsed.reason };
  const state = parsed.state;
  return {
    ok: true,
    preview: { state, accountCount: state.accounts.length, netWorthCents: summarize(toAccounts(state)).netWorthCents },
  };
}
