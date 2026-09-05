import {
  type ExpenseMovement,
  attributeExpenseDebts,
  debtsFromNets,
  expensePayers,
} from "@expense-tracker/shared";

/**
 * Group balances: who owes whom.
 *
 * Two things move money between members:
 * - a split group expense: every participant owes the payer their share
 *   (the payer's own share cancels out). When several people paid, the
 *   shared `attributeExpenseDebts` rule decides which participant owes
 *   which payer — the database's leave guard applies the same rule;
 * - a recorded settlement: the payer is credited and the payee debited.
 *
 * Debts are kept per unordered pair of members and per currency ("direct"
 * debts), so every number on screen can be traced to the expenses and
 * payments between those two people. The per-member net balances are
 * derived from the same pairwise ledger, so per currency they always sum to
 * zero.
 *
 * A group can instead opt into **simplified** debts (`groups.simplify_debts`):
 * the pairwise history is folded into each member's net position and the
 * members are re-paired from those with `debtsFromNets` — fewer payments,
 * but a debt may then point at someone you never split with. Net balances
 * are the same either way. The database's leave guard
 * (`private.has_unsettled_balance`) reads the same flag and judges
 * pairwise or on net position to match, so "you appear in no debt here"
 * and "you may leave" always agree.
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
  expense_splits: ExpenseMovement[];
  /** Empty when `user_id` paid it all (see `expensePayers`). */
  expense_payers: ExpenseMovement[];
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

export type LedgerOptions = {
  /** Re-pair members from net positions instead of listing direct debts. */
  simplify?: boolean;
};

export function groupLedger(
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[],
  { simplify = false }: LedgerOptions = {},
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
    // Un-split expenses move no money between members.
    if (expense.expense_splits.length === 0) {
      continue;
    }
    for (const debt of attributeExpenseDebts(
      expensePayers(expense),
      expense.expense_splits,
    )) {
      owe(debt.from, debt.to, expense.currency, debt.minorUnits);
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

  const balances = new Map<string, BalanceEntry[]>();
  for (const [userId, byCurrency] of ledger) {
    const entries = [...byCurrency.entries()]
      .filter(([, minorUnits]) => minorUnits !== 0)
      .map(([currency, minorUnits]) => ({ currency, minorUnits }));
    if (entries.length > 0) {
      balances.set(userId, entries);
    }
  }

  if (!simplify) {
    debts.sort((a, b) => b.minorUnits - a.minorUnits);
    return { debts, balances };
  }

  // Simplified view: forget the pairs and re-pair everyone from their net
  // position, one currency at a time. Anyone at zero (settled, or offsetting
  // debts) drops out, which is exactly what the leave guard checks.
  const netsByCurrency = new Map<string, Map<string, number>>();
  for (const [userId, entries] of balances) {
    for (const { currency, minorUnits } of entries) {
      const nets = netsByCurrency.get(currency) ?? new Map<string, number>();
      nets.set(userId, minorUnits);
      netsByCurrency.set(currency, nets);
    }
  }

  const simplified: Debt[] = [];
  for (const [currency, nets] of netsByCurrency) {
    for (const debt of debtsFromNets(nets)) {
      simplified.push({ ...debt, currency });
    }
  }
  simplified.sort((a, b) => b.minorUnits - a.minorUnits);

  return { debts: simplified, balances };
}
