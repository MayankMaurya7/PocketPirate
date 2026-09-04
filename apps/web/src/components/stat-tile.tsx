"use client";

import {
  formatMinorUnits,
  formatMinorUnitsCompact,
  minorUnitExponent,
} from "@expense-tracker/shared";

/** Amounts from this many major units up are shown compact ("₹1.2L"). */
const COMPACT_FROM_MAJOR_UNITS = 100_000;

function tileAmount(minorUnits: number, currency: string): string {
  const major = minorUnits / 10 ** minorUnitExponent(currency);
  return major >= COMPACT_FROM_MAJOR_UNITS
    ? formatMinorUnitsCompact(minorUnits, currency)
    : formatMinorUnits(minorUnits, currency);
}

/**
 * A period's headline: total spend, expense count, and the change against
 * the like-for-like previous period. Doubles as the selector for the charts
 * below it (`aria-pressed`), so the four periods are both the KPI row and
 * the filter row.
 */
export function StatTile({
  label,
  totals,
  count,
  change,
  compareLabel,
  selected,
  onSelect,
}: {
  label: string;
  /** Per-currency totals, dominant currency first. */
  totals: { currency: string; minorUnits: number }[];
  count: number;
  /** Fractional change vs the previous period, or null when it had no spend. */
  change: number | null;
  compareLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  let delta: string;
  if (count === 0 && change === null) {
    delta = "Nothing yet";
  } else if (change === null) {
    delta = `No spend ${compareLabel}`;
  } else if (change === 0) {
    delta = `Same as ${compareLabel}`;
  } else {
    const percent = Math.round(Math.abs(change) * 100);
    delta = `${change > 0 ? "▲" : "▼"} ${percent}% vs ${compareLabel}`;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col items-start rounded-2xl border bg-white p-4 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:bg-zinc-900 dark:focus:ring-offset-zinc-950 ${
        selected
          ? "border-emerald-500 ring-1 ring-emerald-500"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      }`}
    >
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="mt-1 flex flex-col text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {totals.length === 0 ? (
          <span className="text-zinc-400 dark:text-zinc-500">—</span>
        ) : (
          totals.map((total) => (
            <span
              key={total.currency}
              title={formatMinorUnits(total.minorUnits, total.currency)}
            >
              {tileAmount(total.minorUnits, total.currency)}
            </span>
          ))
        )}
      </span>
      <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {count} expense{count === 1 ? "" : "s"}
      </span>
      <span className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        {delta}
      </span>
    </button>
  );
}
