// Encrypted, atomic, durable storage for the one Plaid access token. Server-only by usage (never imported by browser code).
// AES-256-GCM with a key that lives in .env.local (FINANCE_TOWN_DATA_KEY), never next to the ciphertext.
// The file lives in the gitignored .data/ directory, outside public/, mode 600. Pure Node so it can be tested directly.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PlaidEnvironment } from "../plaid";

export interface StoredItem {
  /** The Plaid environment that issued this token. Checked on every read. */
  environment: PlaidEnvironment;
  itemId: string;
  accessToken: string;
  institutionId: string;
  institutionName: string;
  linkedAt: string;
}

export type VaultRead = { status: "empty" } | { status: "ok"; item: StoredItem } | { status: "unreadable" };

export interface TokenVault {
  read(): Promise<VaultRead>;
  /** Throws if the item could not be durably stored. */
  write(item: StoredItem): Promise<void>;
}

/** The environment is bound into the encryption itself, so a sandbox file can never decrypt as production (or the reverse). */
const aad = (env: PlaidEnvironment) => Buffer.from(`finance-town:plaid-item:v2:${env}`);

/** A 32-byte key as base64, or null. Anything else (missing, short, long, not base64) fails closed. */
export function parseDataKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value.trim(), "base64");
  return key.length === 32 ? key : null;
}

export function encryptItem(item: StoredItem, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(item.environment));
  const data = Buffer.concat([cipher.update(JSON.stringify(item), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

export function decryptItem(text: string, key: Buffer, expected: PlaidEnvironment): StoredItem | null {
  try {
    const env = JSON.parse(text) as { v?: number; alg?: string; iv?: string; tag?: string; data?: string };
    if (env.v !== 1 || env.alg !== "aes-256-gcm" || !env.iv || !env.tag || !env.data) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    decipher.setAAD(aad(expected));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]).toString("utf8");
    const o = JSON.parse(plain) as Partial<StoredItem>;
    if (o.environment !== expected) return null;
    const ok = [o.itemId, o.accessToken, o.institutionId, o.institutionName, o.linkedAt].every((v) => typeof v === "string" && v.length > 0);
    return ok ? (o as StoredItem) : null;
  } catch {
    return null;
  }
}

/** Write to a temp file in the same directory, fsync it, rename over the target, fsync the directory. A crash leaves the old file or the new one, never half of one. */
export function createFileVault(dir: string, key: Buffer, env: PlaidEnvironment): TokenVault {
  // One file per environment: switching environments never reads, overwrites or deletes the other one.
  const file = `plaid-item.${env}.enc`;
  const target = path.join(/* turbopackIgnore: true */ dir, file);
  return {
    async read() {
      let text: string;
      try {
        text = await fs.readFile(/* turbopackIgnore: true */ target, "utf8");
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === "ENOENT" ? { status: "empty" } : { status: "unreadable" };
      }
      const item = decryptItem(text, key, env);
      return item ? { status: "ok", item } : { status: "unreadable" };
    },
    async write(item) {
      await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true, mode: 0o700 });
      const tmp = path.join(/* turbopackIgnore: true */ dir, `.${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      const fh = await fs.open(/* turbopackIgnore: true */ tmp, "wx", 0o600);
      try {
        await fh.writeFile(encryptItem(item, key), "utf8");
        await fh.sync();
      } catch (e) {
        await fh.close();
        await fs.rm(/* turbopackIgnore: true */ tmp, { force: true });
        throw e;
      }
      await fh.close();
      try {
        await fs.rename(/* turbopackIgnore: true */ tmp, target);
      } catch (e) {
        await fs.rm(/* turbopackIgnore: true */ tmp, { force: true });
        throw e;
      }
      try {
        const d = await fs.open(/* turbopackIgnore: true */ dir, "r");
        try {
          await d.sync();
        } finally {
          await d.close();
        }
      } catch {
        // directory fsync is not supported everywhere; the rename itself already happened
      }
    },
  };
}

/** For synthetic fixtures: never touches disk, so test data can never land in the real token file. */
export function createMemoryVault(): TokenVault {
  let item: StoredItem | null = null;
  return {
    async read() {
      return item ? { status: "ok", item: { ...item } } : { status: "empty" };
    },
    async write(next) {
      item = { ...next };
    },
  };
}
