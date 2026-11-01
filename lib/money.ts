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
