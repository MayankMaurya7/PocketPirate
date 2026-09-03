/**
 * Calendar-date helpers.
 *
 * Expense dates are plain `YYYY-MM-DD` strings (the `date` column), with no
 * timezone. Ranges are computed in the caller's local timezone — on the
 * client, where the user's zone is known — and passed to the server as
 * strings, so the server never has to guess a timezone.
 */

/** Named relative ranges offered by the list filters. */
export const DATE_RANGE_PRESETS = ["today", "week", "month", "year"] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export function isDateRangePreset(value: string): value is DateRangePreset {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/** Matches a `YYYY-MM-DD` calendar date string (shape only). */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A Date's local calendar day as `YYYY-MM-DD`. */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Inclusive `from`/`to` bounds for a preset, relative to `now` in local time.
 * Weeks start on Monday. Every preset ends on today (no future dates).
 */
export function presetDateRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = toLocalDateString(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "today":
      break;
    case "week": {
      // getDay(): 0 = Sunday … 6 = Saturday. Shift so Monday is day 0.
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      break;
    }
    case "month":
      start.setDate(1);
      break;
    case "year":
      start.setMonth(0, 1);
      break;
  }

  return { from: toLocalDateString(start), to };
}
