/**
 * Money utilities.
 *
 * Amounts are ALWAYS integer minor units (paise for INR, cents for USD) —
 * never floats. Parsing does string arithmetic so user input like "12.34"
 * becomes exactly 1234; conversion to major units happens only at the
 * display edge, inside the formatting helpers.
 */

/** Currency snapshotted onto expenses until per-user preference exists. */
export const DEFAULT_CURRENCY = "INR";

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
