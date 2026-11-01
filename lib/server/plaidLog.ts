import { PlaidServiceError } from "./plaidService";

/** One server log line for a failed Plaid call: route, our error code and Plaid's own identifiers. Never message text, bodies, headers or tokens. */
export function logPlaidFailure(route: string, e: unknown): void {
  if (!(e instanceof PlaidServiceError)) {
    console.error(`[plaid] ${route} failed outside Plaid (${e instanceof Error ? e.name : "non-error"})`);
    return;
  }
  const d = e.diag;
  console.error(
    `[plaid] ${route} failed: code=${e.code}` +
      (d ? ` stage=${d.stage} http=${d.status ?? "none"} error_type=${d.errorType ?? "none"} error_code=${d.errorCode ?? "none"} request_id=${d.requestId ?? "none"}` : ""),
  );
}
