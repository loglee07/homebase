// Generates the local key that encrypts the saved Plaid access token and stores it in .env.local. Never prints the key.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDataKey } from "./env-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = ensureDataKey(path.join(root, ".env.local"));
console.log(r === "exists" ? "FINANCE_TOWN_DATA_KEY is already set in .env.local; left unchanged." : "Generated FINANCE_TOWN_DATA_KEY and saved it in .env.local (not shown). Back it up: without it a saved connection cannot be read.");
