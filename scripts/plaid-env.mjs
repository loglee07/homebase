// Usage: npm run plaid:env -- sandbox|production
// Switches PLAID_ENV in .env.local. Secrets, the encryption key and saved connections are never touched or deleted:
// each environment keeps its own encrypted file (.data/plaid-item.<env>.enc). Prints names only, never values.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { switchPlaidEnv } from "./env-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = switchPlaidEnv(path.join(root, ".env.local"), path.join(root, ".data"), process.argv[2]);
if (!r.ok) {
  console.error(r.reason);
  process.exit(1);
}
console.log(`PLAID_ENV is now ${r.env}. Secret used: ${r.secretVar}.`);
if (r.warnSharedSecret) console.log(`Warning: ${r.secretVar} is a single shared variable. Plaid issues a different secret per environment, so make sure it is the ${r.env} one, or use PLAID_SECRET_SANDBOX / PLAID_SECRET_PRODUCTION.`);
console.log(`Saved connections (kept, not read): sandbox ${r.connections.sandbox ? "present" : "none"}, production ${r.connections.production ? "present" : "none"}.`);
console.log("Restart the dev server for this to take effect: npm run dev:stop && npm run dev");
