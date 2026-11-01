// Creates .env.local from .env.example, or appends any placeholders it is missing. Never overwrites a value, never prints one.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPlaceholders } from "./env-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { created, added } = addPlaceholders(path.join(root, ".env.example"), path.join(root, ".env.local"));
if (created) console.log("Created .env.local (mode 600). Open it in your editor and fill in the values.");
else if (added.length) console.log(`Added empty placeholders to .env.local: ${added.join(", ")}. Existing values were not touched.`);
else console.log(".env.local already has every setting from .env.example; nothing changed.");
