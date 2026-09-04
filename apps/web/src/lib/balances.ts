/**
 * Group balances: who owes whom.
 *
 * Two things move money between members:
 * - a split group expense: every participant owes the payer their share
 *   (the payer's own share cancels out);
 * - a recorded settlement: the payer is credited and the payee debited.
 *
 * Debts are kept per unordered pair of members and per currency ("direct"
 * debts, not simplified across the group), so every number on screen can
 * be traced to the expenses and payments between those two people. The
 * per-member net balances are derived from the same pairwise ledger, so
 * per currency they always sum to zero.
 */

/** A member's net position in one currency. Positive = is owed money. */
export type BalanceEntry = { currency: string; minorUnits: number };

/** `from` owes `to` this much, in one currency. Always positive. */
export type Debt = {
  from: string;
  to: string;
  currency: string;
  minorUnits: number;
};

export type LedgerExpense = {
  user_id: string;
  currency: string;
  amount_minor_units: number;
  expense_splits: { user_id: string; amount_minor_units: number }[];
};

export type LedgerSettlement = {
  from_user_id: string;
  to_user_id: string;
  currency: string;
  amount_minor_units: number;
};

export type GroupLedger = {
  /** Non-zero pairwise debts, largest first. */
  debts: Debt[];
  /** Non-zero net positions per member (members with none are absent). */
  balances: Map<string, BalanceEntry[]>;
};

/** Stable key for an unordered pair; `a < b` after sorting. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function groupLedger(
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[],
): GroupLedger {
  // pair key → currency → amount the lexically-first member owes the other
  // (negative when it is the other way round).
  const pairs = new Map<string, Map<string, number>>();

  // Record that `debtor` owes `creditor` `amount` more.
  const owe = (debtor: string, creditor: string, currency: string, amount: number) => {
    if (debtor === creditor || amount === 0) {
      return;
    }
    const key = pairKey(debtor, creditor);
    const byCurrency = pairs.get(key) ?? new Map<string, number>();
    const sign = debtor < creditor ? 1 : -1;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + sign * amount);
    pairs.set(key, byCurrency);
  };

  for (const expense of expenses) {
    for (const split of expense.expense_splits) {
      owe(split.user_id, expense.user_id, expense.currency, split.amount_minor_units);
    }
  }

  for (const settlement of settlements) {
    // Paying someone reduces what you owe them (or makes them owe you).
    owe(
      settlement.to_user_id,
      settlement.from_user_id,
      settlement.currency,
      settlement.amount_minor_units,
    );
  }

  const debts: Debt[] = [];
  const ledger = new Map<string, Map<string, number>>();
  const credit = (userId: string, currency: string, delta: number) => {
    const byCurrency = ledger.get(userId) ?? new Map<string, number>();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + delta);
    ledger.set(userId, byCurrency);
  };

  for (const [key, byCurrency] of pairs) {
    const [first, second] = key.split("|") as [string, string];
    for (const [currency, net] of byCurrency) {
      if (net === 0) {
        continue;
      }
      const [from, to] = net > 0 ? [first, second] : [second, first];
      const minorUnits = Math.abs(net);
      debts.push({ from, to, currency, minorUnits });
      credit(to, currency, minorUnits);
      credit(from, currency, -minorUnits);
    }
  }

  debts.sort((a, b) => b.minorUnits - a.minorUnits);

  const balances = new Map<string, BalanceEntry[]>();
  for (const [userId, byCurrency] of ledger) {
    const entries = [...byCurrency.entries()]
      .filter(([, minorUnits]) => minorUnits !== 0)
      .map(([currency, minorUnits]) => ({ currency, minorUnits }));
    if (entries.length > 0) {
      balances.set(userId, entries);
    }
  }

  return { debts, balances };
}
