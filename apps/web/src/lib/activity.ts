import { formatDate, formatMinorUnits } from "@expense-tracker/shared";

import type { MemberNamer } from "@/lib/members";
import type { ActivityEntry } from "@/lib/types";

/** One `{from, to}` pair from an entry's `changes` (see migration 013). */
export type ActivityChange = { from: unknown; to: unknown };

type AmountRow = { user_id: string; amount_minor_units: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The entry's changes as a map; anything malformed is skipped. */
export function activityChanges(entry: ActivityEntry): Record<string, ActivityChange> {
  if (!isRecord(entry.changes)) {
    return {};
  }
  const result: Record<string, ActivityChange> = {};
  for (const [key, value] of Object.entries(entry.changes)) {
    if (isRecord(value) && "from" in value && "to" in value) {
      result[key] = { from: value.from, to: value.to };
    }
  }
  return result;
}

/** The entry's snapshot as a plain record. */
export function activitySnapshot(entry: ActivityEntry): Record<string, unknown> {
  return isRecord(entry.snapshot) ? entry.snapshot : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRows(value: unknown): AmountRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const user_id = asString(item.user_id);
    const amount_minor_units = asNumber(item.amount_minor_units);
    return user_id !== null && amount_minor_units !== null
      ? [{ user_id, amount_minor_units }]
      : [];
  });
}

/** What the entry is about: the snapshot's title and amount. */
export function activitySubject(entry: ActivityEntry): {
  title: string;
  amount: string | null;
  currency: string;
} {
  const snapshot = activitySnapshot(entry);
  const currency = asString(snapshot.currency) ?? "INR";
  const minorUnits = asNumber(snapshot.amount_minor_units);
  const amount = minorUnits === null ? null : formatMinorUnits(minorUnits, currency);
  if (entry.entity_kind === "settlement") {
    return { title: "a payment", amount, currency };
  }
  return {
    title: asString(snapshot.description) || "an expense",
    amount,
    currency,
  };
}

function formatDateValue(value: unknown): string {
  const text = asString(value);
  return text ? formatDate(text) : "—";
}

function formatRows(
  rows: AmountRow[],
  currency: string,
  nameOf: MemberNamer,
): string {
  if (rows.length === 0) {
    return "nobody";
  }
  return rows
    .slice()
    .sort((a, b) => b.amount_minor_units - a.amount_minor_units)
    .map(
      (row) =>
        `${nameOf(row.user_id, { sentence: true })} ${formatMinorUnits(row.amount_minor_units, currency)}`,
    )
    .join(", ");
}

/**
 * Each change as "Field: before → after", in a fixed order. Categories are
 * private per user, so a category change can only be reported as such.
 */
export function describeActivity(
  entry: ActivityEntry,
  nameOf: MemberNamer,
): { label: string; from: string; to: string }[] {
  const changes = activityChanges(entry);
  const { currency } = activitySubject(entry);
  const money = (value: unknown) => {
    const minorUnits = asNumber(value);
    return minorUnits === null ? "—" : formatMinorUnits(minorUnits, currency);
  };
  const text = (value: unknown) => asString(value) || "(none)";
  const person = (value: unknown) => {
    const id = asString(value);
    return id ? nameOf(id, { sentence: true }) : "—";
  };

  const lines: { label: string; from: string; to: string }[] = [];
  const push = (key: string, label: string, format: (value: unknown) => string) => {
    const change = changes[key];
    if (change) {
      lines.push({ label, from: format(change.from), to: format(change.to) });
    }
  };

  push("description", "Description", text);
  push("amount", "Amount", money);
  push("currency", "Currency", text);
  push("date", "Date", formatDateValue);
  push("paid_by", "Paid by", person);
  push("note", "Note", text);
  if (changes.category) {
    lines.push({ label: "Category", from: "changed", to: "" });
  }
  push("payers", "Paid by", (value) => formatRows(asRows(value), currency, nameOf));
  push("split", "Split", (value) => formatRows(asRows(value), currency, nameOf));

  return lines;
}
