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
  return { status: res.status, data };
}
