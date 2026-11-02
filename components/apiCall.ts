/** Fired when a protected brokerage route says the session is gone, so every client locks together. */
export const SESSION_ENDED_EVENT = "finance-town:session-ended";

/** Same-origin calls to this app's own loopback API. Cookies stay HttpOnly; nothing here reads or logs a response body. */
export async function apiCall(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  // A 401 from any protected route (not a wrong code at login) means the one shared session ended or expired.
  if (res.status === 401 && path.startsWith("brokerage/") && path !== "brokerage/session") window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: (data as { reason?: string } | null)?.reason }));
  return { status: res.status, data };
}
