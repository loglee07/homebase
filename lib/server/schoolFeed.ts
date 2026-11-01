// Fetches one school's Canvas feed. The feed link is a secret (anyone holding it can read the calendar), so it is only
// ever used here: never returned, logged or put in an error. Redirects are followed by hand and checked at every hop.
import type { SchoolErrorCode, SchoolId } from "../school";
import { parseFeedUrl, redirectAllowed } from "./schoolHosts";

export class SchoolFeedError extends Error {
  constructor(readonly code: SchoolErrorCode) {
    super(code); // the code is the whole message
  }
}

export const FEED_ENV: Record<SchoolId, string> = { sdsu: "CANVAS_SDSU_FEED_URL", sdccd: "CANVAS_SDCCD_FEED_URL" };
export const FEED_TIMEOUT_MS = 15_000;
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type FetchLike = (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

/** Whether a school has a feed link set. Says nothing about whether the link is valid. */
export const feedConfigured = (school: SchoolId, env: NodeJS.ProcessEnv = process.env): boolean => Boolean(env[FEED_ENV[school]]?.trim());

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) throw new SchoolFeedError("too_large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SchoolFeedError("too_large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

export async function fetchFeedText(school: SchoolId, env: NodeJS.ProcessEnv = process.env, doFetch: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const raw = env[FEED_ENV[school]];
  if (!raw || !raw.trim()) throw new SchoolFeedError("not_configured");
  let url = parseFeedUrl(school, raw);
  if (!url) throw new SchoolFeedError("feed_host_rejected");
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await doFetch(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { Accept: "text/calendar, text/plain;q=0.5" } });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      throw new SchoolFeedError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      let next: URL | null = null;
      try {
        next = loc ? new URL(loc, url) : null;
      } catch {
        next = null;
      }
      if (!next || !redirectAllowed(school, next)) throw new SchoolFeedError("redirect_rejected");
      url = next;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new SchoolFeedError("auth_failed");
    if (res.status === 404 || res.status === 410) throw new SchoolFeedError("not_found");
    if (res.status === 429) throw new SchoolFeedError("rate_limited");
    if (!res.ok) throw new SchoolFeedError("unknown");
    let body: string;
    try {
      body = await readCapped(res);
    } catch (e) {
      if (e instanceof SchoolFeedError) throw e;
      throw new SchoolFeedError("network");
    }
    if (!/^﻿?\s*BEGIN:VCALENDAR/i.test(body)) throw new SchoolFeedError("not_a_calendar");
    return body;
  }
  throw new SchoolFeedError("redirect_rejected"); // too many hops
}
