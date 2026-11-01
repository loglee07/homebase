/** All money is integer cents. Never store or compute dollars as floats. */
export type Cents = number;

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  }
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, v) => total + assertCents(v), 0);
}

const dollarsFormat = new Intl.NumberFormat("en-US");

/** Formats cents as "$1,234.56" or "-$1,234.56". Pure integer math, no float division. */
export function formatCents(cents: Cents, opts: { signed?: boolean } = {}): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  const body = `$${dollarsFormat.format(dollars)}.${rest}`;
  if (cents < 0) return `-${body}`;
  return opts.signed && cents > 0 ? `+${body}` : body;
}

/** Largest balance accepted for manual entry: $999,999,999,999.99 (far below Number.MAX_SAFE_INTEGER cents). */
export const MAX_MANUAL_CENTS: Cents = 99_999_999_999_999;

export type ParsedMoney = { ok: true; cents: Cents } | { ok: false; error: string };

/**
 * Parses typed USD ("1234", "1,234.5", "$1,234.56") into integer cents with string math only.
 * Rejects negatives, exponents, junk, and more than two decimal places.
 */
export function parseDollarsToCents(input: string): ParsedMoney {
  const text = input.trim().replace(/^\$\s*/, "");
  if (!text) return { ok: false, error: "Enter an amount." };
  if (/^[-+−]/.test(text)) return { ok: false, error: "Enter a positive amount. For debts, enter what you owe." };
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(text);
  if (!m || (m[1] === undefined && !m[2]) || m[2] === "") return { ok: false, error: "Use numbers only, like 1234.56." };
  const decimals = m[2] ?? "";
  if (decimals.length > 2) return { ok: false, error: "Use at most two decimal places." };
  const whole = (m[1] ?? "0").replace(/,/g, "");
  if (whole.length > 12) return { ok: false, error: "That amount is too large." };
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (cents > MAX_MANUAL_CENTS) return { ok: false, error: "That amount is too large." };
  return { ok: true, cents: assertCents(cents) };
}
