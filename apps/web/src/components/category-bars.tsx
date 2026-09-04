"use client";

import { formatMinorUnits } from "@expense-tracker/shared";
import type { CategoryTotal } from "@expense-tracker/shared";

import type { CategoryOption } from "@/lib/types";

/** A category's share of a period as a horizontal bar, largest first. */
export function CategoryBars({
  rows,
  categories,
  currency,
}: {
  rows: CategoryTotal[];
  categories: CategoryOption[];
  currency: string;
}) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const max = Math.max(...rows.map((row) => row.minorUnits), 1);

  const labelled = rows.map((row) => {
    const category = row.categoryId ? byId.get(row.categoryId) : undefined;
    return {
      ...row,
      key: row.categoryId ?? "none",
      name: row.categoryId
        ? (category?.name ?? "Deleted category")
        : "Uncategorised",
      color: category?.color ?? null,
    };
  });

  return (
    <div>
      <ul className="space-y-2">
        {labelled.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 transition hover:bg-zinc-50 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:py-0.5 dark:hover:bg-zinc-800/60"
          >
            <span className="order-1 flex min-w-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  row.color ? "" : "border border-dashed border-zinc-400"
                }`}
                style={row.color ? { backgroundColor: row.color } : undefined}
              />
              <span className="truncate" title={row.name}>
                {row.name}
              </span>
            </span>
            <span
              className="order-3 col-span-2 flex h-3 items-center sm:order-2 sm:col-span-1"
              aria-hidden="true"
            >
              <span
                className="h-3 rounded-r bg-emerald-600 dark:bg-emerald-500"
                style={{ width: `${(row.minorUnits / max) * 100}%` }}
              />
            </span>
            <span className="order-2 text-right text-sm tabular-nums text-zinc-900 sm:order-3 dark:text-zinc-100">
              {formatMinorUnits(row.minorUnits, currency)}
              <span className="ml-2 inline-block w-9 text-xs text-zinc-500 dark:text-zinc-400">
                {Math.round(row.share * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>

      <details className="mt-3">
        <summary className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Show as table
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1 font-medium">Category</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Share</th>
              <th className="py-1 text-right font-medium">Expenses</th>
            </tr>
          </thead>
          <tbody className="text-zinc-700 dark:text-zinc-200">
            {labelled.map((row) => (
              <tr key={row.key}>
                <td className="py-1">{row.name}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatMinorUnits(row.minorUnits, currency)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {Math.round(row.share * 100)}%
                </td>
                <td className="py-1 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
