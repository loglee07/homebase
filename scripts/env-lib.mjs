// Helpers for editing .env.local without ever printing values. Used by env-init.mjs and vault-key.mjs (and tested).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const KEY_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/;

/** Parses names and whether each has a non-empty value. Values are never returned. */
export function envKeys(text) {
  const keys = new Map();
  for (const line of text.split("\n")) {
    const m = KEY_LINE.exec(line);
    if (m) keys.set(m[1], m[2].trim().replace(/^["']|["']$/g, "").length > 0);
  }
  return keys;
}

/** Names (with their preceding comment block) from the example file that the target file lacks. Existing lines are never touched. */
export function missingBlocks(example, target) {
  const have = envKeys(target);
  const out = [];
  let comments = [];
  for (const line of example.split("\n")) {
    if (line.trim() === "") comments = [];
    else if (line.trim().startsWith("#")) comments.push(line);
    else {
      const m = KEY_LINE.exec(line);
      if (m && !have.has(m[1])) out.push({ name: m[1], text: [...comments, `${m[1]}=`].join("\n") });
      comments = [];
    }
  }
  return out;
}

export function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Adds the missing placeholders to the end of target. Returns the names added. */
export function addPlaceholders(examplePath, targetPath) {
  const example = readFileSync(examplePath, "utf8");
  if (!existsSync(targetPath)) {
    writeAtomic(targetPath, example);
    return { created: true, added: [] };
  }
  const current = readFileSync(targetPath, "utf8");
  const blocks = missingBlocks(example, current);
  if (blocks.length === 0) return { created: false, added: [] };
  const sep = current.endsWith("\n") ? "\n" : "\n\n";
  writeAtomic(targetPath, `${current}${sep}${blocks.map((b) => b.text).join("\n\n")}\n`);
  return { created: false, added: blocks.map((b) => b.name) };
}

/** Sets NAME to a fresh random 32-byte key (base64) only if it has no value yet. Never prints the key. */
export function ensureDataKey(targetPath, name = "FINANCE_TOWN_DATA_KEY") {
  const key = randomBytes(32).toString("base64");
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const keys = envKeys(current);
  if (keys.get(name)) return "exists";
  const lines = current.split("\n");
  const i = lines.findIndex((l) => KEY_LINE.exec(l)?.[1] === name);
  if (i >= 0) lines[i] = `${name}=${key}`;
  else lines.push(`${name}=${key}`, "");
  writeAtomic(targetPath, lines.join("\n").replace(/\n{3,}$/, "\n\n"));
  return i >= 0 ? "filled" : "added";
}

/** Sets one existing NAME=value line (or appends it). Every other line is kept byte for byte. Never prints. */
export function setEnvValue(targetPath, name, value) {
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const lines = current.split("\n");
  const i = lines.findIndex((l) => KEY_LINE.exec(l)?.[1] === name);
  if (i >= 0) lines[i] = `${name}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
  writeAtomic(targetPath, lines.join("\n"));
}

/**
 * Switches PLAID_ENV between "sandbox" and "production" and nothing else: no secret is moved, copied or deleted, and no
 * saved connection file is touched. Returns names and yes/no facts only, never values.
 */
export function switchPlaidEnv(targetPath, dataDir, target) {
  if (target !== "sandbox" && target !== "production") return { ok: false, reason: "Use exactly: sandbox or production." };
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const keys = envKeys(text);
  const perEnv = target === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET_PRODUCTION";
  const usesPerEnv = keys.get(perEnv) === true;
  if (!usesPerEnv && keys.get("PLAID_SECRET") !== true) return { ok: false, reason: `No secret for ${target}: fill ${perEnv} in .env.local first (nothing was changed).` };
  if (!keys.get("PLAID_CLIENT_ID")) return { ok: false, reason: "PLAID_CLIENT_ID is empty (nothing was changed)." };
  setEnvValue(targetPath, "PLAID_ENV", target);
  const files = ["sandbox", "production"].map((e) => [e, existsSync(`${dataDir}/plaid-item.${e}.enc`)]);
  return { ok: true, env: target, secretVar: usesPerEnv ? perEnv : "PLAID_SECRET", warnSharedSecret: !usesPerEnv, connections: Object.fromEntries(files) };
}
