/**
 * Spending aggregation. Pure functions over the lean expense shape every
 * client can produce, so the web dashboard and (later) mobile share one set
 * of numbers. All sums are integer minor units in a single currency — a
 * total across currencies is meaningless, so callers pick one first.
 */

/** The fields aggregation needs; a subset of the `expenses` row. */
export type StatExpense = {
  amount_minor_units: number;
  currency: string;
  expense_date: string;
  category_id: string | null;
};

/** Expenses dated within the inclusive `YYYY-MM-DD` bounds. */
export function expensesInRange<T extends StatExpense>(
  expenses: T[],
  from: string,
  to: string,
): T[] {
  return expenses.filter(
    (expense) => expense.expense_date >= from && expense.expense_date <= to,
  );
}

/** Sum of amounts per currency, largest total first. */
export function sumByCurrency(
  expenses: StatExpense[],
): { currency: string; minorUnits: number; count: number }[] {
  const totals = new Map<string, { minorUnits: number; count: number }>();
  for (const expense of expenses) {
    const entry = totals.get(expense.currency) ?? { minorUnits: 0, count: 0 };
    entry.minorUnits += expense.amount_minor_units;
    entry.count += 1;
    totals.set(expense.currency, entry);
  }
  return [...totals.entries()]
    .map(([currency, entry]) => ({ currency, ...entry }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

/** The currency most expenses are logged in, or null when there are none. */
export function dominantCurrency(expenses: StatExpense[]): string | null {
  return sumByCurrency(expenses)[0]?.currency ?? null;
}

/** Sum of amounts in one currency (other currencies are ignored). */
export function sumInCurrency(
  expenses: StatExpense[],
  currency: string,
): number {
  let total = 0;
  for (const expense of expenses) {
    if (expense.currency === currency) {
      total += expense.amount_minor_units;
    }
  }
  return total;
}

export type Bucket = { key: string; minorUnits: number; count: number };

/**
 * Totals in `currency` for each of `keys`, in order, with empty buckets kept
 * (a day with no spend is still a day on the chart). Expenses whose key is
 * not listed are dropped.
 */
export function totalsByBucket(
  expenses: StatExpense[],
  currency: string,
  keys: string[],
  keyOf: (expense: StatExpense) => string,
): Bucket[] {
  const buckets = new Map<string, Bucket>(
    keys.map((key) => [key, { key, minorUnits: 0, count: 0 }]),
  );
  for (const expense of expenses) {
    if (expense.currency !== currency) {
      continue;
    }
    const bucket = buckets.get(keyOf(expense));
    if (bucket) {
      bucket.minorUnits += expense.amount_minor_units;
      bucket.count += 1;
    }
  }
  return [...buckets.values()];
}

export type CategoryTotal = {
  /** Null for uncategorised expenses. */
  categoryId: string | null;
  minorUnits: number;
  count: number;
  /** Fraction of the period total (0–1). */
  share: number;
};

/** Totals in `currency` per category, largest first; uncategorised last on ties. */
export function totalsByCategory(
  expenses: StatExpense[],
  currency: string,
): CategoryTotal[] {
  const totals = new Map<string | null, { minorUnits: number; count: number }>();
  let grandTotal = 0;
  for (const expense of expenses) {
    if (expense.currency !== currency) {
      continue;
    }
    const entry = totals.get(expense.category_id) ?? { minorUnits: 0, count: 0 };
    entry.minorUnits += expense.amount_minor_units;
    entry.count += 1;
    totals.set(expense.category_id, entry);
    grandTotal += expense.amount_minor_units;
  }
  return [...totals.entries()]
    .map(([categoryId, entry]) => ({
      categoryId,
      ...entry,
      share: grandTotal === 0 ? 0 : entry.minorUnits / grandTotal,
    }))
    .sort(
      (a, b) =>
        b.minorUnits - a.minorUnits ||
        Number(a.categoryId === null) - Number(b.categoryId === null),
    );
}

/**
 * Change from `previous` to `current` as a fraction (0.12 = up 12%), or null
 * when there is no previous value to compare against.
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return null;
  }
  return (current - previous) / previous;
}
