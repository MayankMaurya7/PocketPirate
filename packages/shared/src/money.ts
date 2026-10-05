/**
 * Money utilities.
 *
 * Amounts are ALWAYS integer minor units (paise for INR, cents for USD) —
 * never floats. Parsing does string arithmetic so user input like "12.34"
 * becomes exactly 1234; conversion to major units happens only at the
 * display edge, inside the formatting helpers.
 */

/** Currency a new expense starts in until per-user preference exists. */
export const DEFAULT_CURRENCY = "INR";

/**
 * The currencies the expense form offers, ISO 4217 code + English name
 * (fixed text, like the date tables — never locale-dependent, so server and
 * browser render the same option labels). Any code works in the database;
 * this is only the picker's list, with the default first.
 */
export const CURRENCIES: readonly { code: string; name: string }[] = [
  { code: "INR", name: "Indian rupee" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "AED", name: "UAE dirham" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "JPY", name: "Japanese yen" },
  { code: "THB", name: "Thai baht" },
  { code: "CHF", name: "Swiss franc" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "MAD", name: "Moroccan dirham" },
];

/**
 * Number of minor-unit digits for an ISO 4217 currency (2 for INR/USD,
 * 0 for JPY), derived from the Intl currency tables.
 */
export function minorUnitExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Parse a user-typed decimal amount ("120", "12.5") into integer minor
 * units. Returns null for anything invalid: non-numeric input, more
 * fraction digits than the currency allows, zero, or unsafely large
 * values.
 */
export function parseAmountToMinorUnits(
  input: string,
  currency: string,
): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,13}(\.\d+)?$/.test(trimmed)) {
    return null;
  }

  const exponent = minorUnitExponent(currency);
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > exponent) {
    return null;
  }

  const minorUnits =
    Number(whole) * 10 ** exponent +
    Number(fraction.padEnd(exponent, "0") || "0");

  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    return null;
  }
  return minorUnits;
}

/** Format minor units as a localized currency string, e.g. 12345 → "₹123.45". */
export function formatMinorUnits(
  minorUnits: number,
  currency: string,
  locale?: string,
): string {
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(minorUnits / 10 ** exponent);
}

/**
 * Minor units as a plain decimal string ("123.45") for prefilling amount
 * inputs. Display-edge only — never feed the result back into arithmetic.
 */
export function minorUnitsToInputValue(
  minorUnits: number,
  currency: string,
): string {
  const exponent = minorUnitExponent(currency);
  return (minorUnits / 10 ** exponent).toFixed(exponent);
}

/**
 * Split `total` minor units equally `count` ways. Integer arithmetic only:
 * the remainder is handed out one unit each to the first shares, so the
 * parts always sum exactly to `total` (e.g. 1000 ÷ 3 → [334, 333, 333]).
 */
export function splitEqually(total: number, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
}

/**
 * Compact currency formatting for tight spaces such as axis ticks and stat
 * tiles: 123456 minor units → "₹1.2K" (or "₹1.2L" under an Indian locale).
 * Display-edge only.
 */
export function formatMinorUnitsCompact(
  minorUnits: number,
  currency: string,
  locale?: string,
): string {
  const exponent = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
  }).format(minorUnits / 10 ** exponent);
}

/**
 * Split `total` minor units in proportion to integer `weights` (shares, or
 * percentages in basis points). Largest-remainder allocation: everyone gets
 * the floor of their exact share, then the leftover units go one each to the
 * largest fractional remainders (earliest index on ties), so the parts sum
 * exactly to `total`. Uses BigInt internally — `total × weight` can exceed
 * 2^53 for large amounts with basis-point weights. A zero weight yields a
 * zero part; callers decide whether that is allowed (splits must be > 0).
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (weights.length === 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const bigTotal = BigInt(total);
  const bigTotalWeight = BigInt(totalWeight);
  const parts: number[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];

  for (const [index, weight] of weights.entries()) {
    const scaled = bigTotal * BigInt(weight);
    parts.push(Number(scaled / bigTotalWeight));
    remainders.push({ index, remainder: scaled % bigTotalWeight });
  }

  let leftover = total - parts.reduce((sum, part) => sum + part, 0);
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const { index } of remainders) {
    if (leftover === 0) {
      break;
    }
    parts[index] += 1;
    leftover -= 1;
  }
  return parts;
}

/** Percentages are handled as integer basis points: 100% = 10 000. */
export const PERCENT_BASIS = 10_000;

/**
 * Parse a user-typed percentage ("33.33", "50") into integer basis points.
 * Null for anything invalid: non-numeric input, more than two decimals, zero
 * or above 100.
 */
export function parsePercentToBasisPoints(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints <= 0 || basisPoints > PERCENT_BASIS) {
    return null;
  }
  return basisPoints;
}

/**
 * Basis points as a plain decimal string for prefilling percent inputs
 * (3334 → "33.34", 5000 → "50"). Display-edge only.
 */
export function basisPointsToInputValue(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.?0+$/, "");
}
