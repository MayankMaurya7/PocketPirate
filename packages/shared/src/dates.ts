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

/** Parse a `YYYY-MM-DD` string into a Date at local midnight. */
export function fromLocalDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A Date's local calendar month as `YYYY-MM`. */
export function toLocalMonthString(date: Date): string {
  return toLocalDateString(date).slice(0, 7);
}

/** Every calendar day from `from` to `to` inclusive, as `YYYY-MM-DD`. */
export function listDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = fromLocalDateString(from);
  const end = fromLocalDateString(to);
  while (cursor <= end) {
    days.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Every calendar month from `from` to `to` inclusive, as `YYYY-MM`. */
export function listMonths(from: string, to: string): string[] {
  const months: string[] = [];
  const cursor = fromLocalDateString(from);
  cursor.setDate(1);
  const end = fromLocalDateString(to);
  while (cursor <= end) {
    months.push(toLocalMonthString(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/**
 * Move a date by whole months, clamping the day to the target month's length
 * (31 Mar − 1 month → 28 Feb, not 3 Mar as `setMonth` alone would give).
 */
function shiftMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/**
 * The like-for-like slice of the previous period: `presetDateRange` shifted
 * back one period, so month-to-date is compared with last month up to the
 * same day rather than with the whole of last month. Today → yesterday,
 * week → the same weekdays last week, month → same days last month, year →
 * same dates last year.
 */
export function previousPeriodRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const current = presetDateRange(preset, now);
  const from = fromLocalDateString(current.from);
  const to = fromLocalDateString(current.to);

  switch (preset) {
    case "today":
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      return { from: toLocalDateString(from), to: toLocalDateString(to) };
    case "week":
      from.setDate(from.getDate() - 7);
      to.setDate(to.getDate() - 7);
      return { from: toLocalDateString(from), to: toLocalDateString(to) };
    case "month":
      return {
        from: toLocalDateString(shiftMonths(from, -1)),
        to: toLocalDateString(shiftMonths(to, -1)),
      };
    case "year":
      return {
        from: toLocalDateString(shiftMonths(from, -12)),
        to: toLocalDateString(shiftMonths(to, -12)),
      };
  }
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "4 Sep 2026" for a YYYY-MM-DD string, without touching the locale.
 * `toLocaleDateString` differs between the server's Node (en-US: "Sep 4,
 * 2026") and the browser (en-GB/en-IN: "4 Sept 2026"), which breaks
 * hydration for any server-rendered row — so dates that reach the HTML
 * go through this, and only after-hydration times use the locale.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? "";
  return `${day} ${name.slice(0, 3)} ${year}`;
}

/** "September 2026" for a YYYY-MM (or YYYY-MM-DD) string. */
export function formatMonth(isoMonth: string): string {
  const [year, month] = isoMonth.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ""} ${year}`;
}
