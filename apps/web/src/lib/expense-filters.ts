import { ISO_DATE_PATTERN, isDateRangePreset } from "@expense-tracker/shared";
import type { DateRangePreset } from "@expense-tracker/shared";

/** Sentinel `category` value meaning "expenses with no category". */
export const UNCATEGORISED = "none";

/** How the date range was chosen — a preset, explicit dates, or nothing. */
export type DateRangeKind = DateRangePreset | "custom";

/** Parsed, validated list filters. Every field is null when not applied. */
export type ExpenseListFilters = {
  /** A group id, or null for the personal list. */
  group: string | null;
  /** A member's user id (only meaningful with `group`), or null for all. */
  member: string | null;
  /** A category id, `UNCATEGORISED`, or null for all. */
  category: string | null;
  range: DateRangeKind | null;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from: string | null;
  to: string | null;
};

export const EMPTY_FILTERS: ExpenseListFilters = {
  group: null,
  member: null,
  category: null,
  range: null,
  from: null,
  to: null,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check for ids coming from the URL before they reach a query. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Parse URL search params into filters, dropping anything malformed. The
 * category id is only shape-checked here; RLS makes a foreign id harmless
 * (it just matches nothing).
 */
export function parseExpenseFilters(params: SearchParams): ExpenseListFilters {
  const rawGroup = single(params.group);
  const group = rawGroup && isUuid(rawGroup) ? rawGroup : null;

  const rawMember = single(params.member);
  const member = group && rawMember && isUuid(rawMember) ? rawMember : null;

  const rawCategory = single(params.category);
  const category =
    rawCategory === UNCATEGORISED || (rawCategory && isUuid(rawCategory))
      ? rawCategory
      : null;

  const rawFrom = single(params.from);
  const rawTo = single(params.to);
  let from = rawFrom && ISO_DATE_PATTERN.test(rawFrom) ? rawFrom : null;
  let to = rawTo && ISO_DATE_PATTERN.test(rawTo) ? rawTo : null;
  if (from && to && from > to) {
    [from, to] = [to, from];
  }

  const rawRange = single(params.range);
  let range: DateRangeKind | null = null;
  if (rawRange === "custom" && (from || to)) {
    range = "custom";
  } else if (rawRange && isDateRangePreset(rawRange) && from && to) {
    range = rawRange;
  } else if (from || to) {
    range = "custom";
  } else {
    from = null;
    to = null;
  }

  return { group, member, category, range, from, to };
}

/** Serialise filters back to a query string (without the leading `?`). */
export function expenseFiltersToQuery(filters: ExpenseListFilters): string {
  const params = new URLSearchParams();
  if (filters.group) params.set("group", filters.group);
  if (filters.group && filters.member) params.set("member", filters.member);
  if (filters.category) params.set("category", filters.category);
  if (filters.range) params.set("range", filters.range);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

export function hasActiveFilters(filters: ExpenseListFilters): boolean {
  return (
    filters.group !== null ||
    filters.category !== null ||
    filters.range !== null
  );
}
