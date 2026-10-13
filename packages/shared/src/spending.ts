import {
  type ExpenseMovement,
  type PaidExpense,
  expensePayers,
} from "./ledger";

/**
 * What each member spent in a group, as opposed to what they owe.
 *
 * Two numbers per member and currency:
 * - `paid`: money that left their pocket for the group's expenses (their
 *   payer rows, or the whole amount when they are the single payer);
 * - `share`: the sum of their split shares — what the group's spending
 *   cost them, regardless of who paid.
 *
 * An expense that was not split is counted as the payer's own: paid and
 * share both equal what they paid. So, summed over everyone (including
 * members who have since left), paid and share each add up to the group's
 * total spend, and paid − share is the net position the balance ledger shows
 * before any recorded payment. Payments are deliberately not spending and
 * never appear here.
 */

export type SpendingEntry = { currency: string; paid: number; share: number };

export type SpendingExpense = PaidExpense & {
  currency: string;
  expense_splits: ExpenseMovement[];
};

export type GroupSpending = {
  /** One entry per currency per member; members on no expense are absent. */
  byMember: Map<string, SpendingEntry[]>;
  /** The group's total spend per currency (= Σ paid = Σ share). */
  totals: Map<string, number>;
};

export function groupSpending(expenses: SpendingExpense[]): GroupSpending {
  // user id → currency → entry, kept in first-seen order.
  const ledger = new Map<string, Map<string, SpendingEntry>>();
  const totals = new Map<string, number>();

  const entryFor = (userId: string, currency: string): SpendingEntry => {
    const byCurrency = ledger.get(userId) ?? new Map<string, SpendingEntry>();
    const entry = byCurrency.get(currency) ?? { currency, paid: 0, share: 0 };
    byCurrency.set(currency, entry);
    ledger.set(userId, byCurrency);
    return entry;
  };

  for (const expense of expenses) {
    const { currency } = expense;
    totals.set(currency, (totals.get(currency) ?? 0) + expense.amount_minor_units);

    const payers = expensePayers(expense);
    for (const payer of payers) {
      entryFor(payer.user_id, currency).paid += payer.amount_minor_units;
    }

    if (expense.expense_splits.length > 0) {
      for (const split of expense.expense_splits) {
        entryFor(split.user_id, currency).share += split.amount_minor_units;
      }
    } else {
      // Not split: the payer(s) spent it on themselves.
      for (const payer of payers) {
        entryFor(payer.user_id, currency).share += payer.amount_minor_units;
      }
    }
  }

  const byMember = new Map<string, SpendingEntry[]>();
  for (const [userId, byCurrency] of ledger) {
    byMember.set(userId, [...byCurrency.values()]);
  }
  return { byMember, totals };
}

/** Add several members' entries together, e.g. everyone who has left the group. */
export function sumSpending(entries: Iterable<SpendingEntry[]>): SpendingEntry[] {
  const byCurrency = new Map<string, SpendingEntry>();
  for (const list of entries) {
    for (const { currency, paid, share } of list) {
      const entry = byCurrency.get(currency) ?? { currency, paid: 0, share: 0 };
      entry.paid += paid;
      entry.share += share;
      byCurrency.set(currency, entry);
    }
  }
  return [...byCurrency.values()];
}
