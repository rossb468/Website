/**
 * Money handling.
 *
 * Amounts are stored as integer minor units. Aggregators report major units
 * as JSON floats, and floats make change detection lie: `12.20 - 12.10` is
 * `0.09999999999999964`, so a naive differ either invents changes that did
 * not happen or misses one-cent changes that did. Converting once at the
 * provider boundary and staying in integers downstream removes that class of
 * bug entirely.
 */

/** Currencies whose minor unit is not 1/100. */
const EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BIF: 0,
  DJF: 0,
  GNF: 0,
  KMF: 0,
  MGA: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VUV: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function minorUnitExponent(currency: string | null | undefined): number {
  if (!currency) return 2;
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Major units (e.g. dollars) -> integer minor units (e.g. cents). */
export function toMinorUnits(amount: number, currency: string | null | undefined): number {
  const factor = 10 ** minorUnitExponent(currency);
  // Round the scaled value rather than truncating: binary floats represent
  // 19.99 as 19.989999..., and truncation would turn that into 1998.
  return Math.round(amount * factor);
}

export function toMajorUnits(minor: number, currency: string | null | undefined): number {
  return minor / 10 ** minorUnitExponent(currency);
}

/** Human-readable amount, e.g. `-$42.30`. Sign is always shown for deltas. */
export function formatAmount(minor: number, currency = 'USD', opts: { signed?: boolean } = {}): string {
  const exponent = minorUnitExponent(currency);
  const value = toMajorUnits(minor, currency);
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
      signDisplay: opts.signed ? 'exceptZero' : 'auto',
    }).format(value);
    return formatted;
  } catch {
    // Unknown/unofficial currency code (crypto, etc.) — Intl throws on those.
    const sign = opts.signed && minor > 0 ? '+' : '';
    return `${sign}${value.toFixed(exponent)} ${currency}`;
  }
}

/** Magnitude only, no sign — for phrasing like "$42.30 at Blue Bottle". */
export function formatMagnitude(minor: number, currency = 'USD'): string {
  return formatAmount(Math.abs(minor), currency);
}
