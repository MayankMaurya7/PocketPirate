/**
 * Who owes whom for one split group expense.
 *
 * With a single payer the answer is obvious: every other participant owes
 * the payer their share. Once several people paid (see the `expense_payers`
 * table) it is not, so the rule below is fixed and shared with the database
 * — `private.has_unsettled_balance` (migration 008) implements the same
 * steps in SQL, and the two must agree to the unit:
 *
 *   1. Each person's net = what they paid − their share. Nets are integers
 *      and sum to zero; people at zero drop out.
 *   2. Creditors (net > 0) are sorted by net desc, then user_id; debtors
 *      (net < 0) by |net| desc, then user_id. Each side is laid end to end
 *      along [0, D), D being the total owed. A debtor owes each creditor the
 *      length of the overlap of their two intervals.
 *
 * Exact integer arithmetic, deterministic, and for one payer it reduces to
 * the old rule. user_ids are compared as plain strings: lowercase UUIDs
 * order the same way as Postgres `uuid` values (never `localeCompare`, whose
 * rules for hyphens differ by locale).
 */

/** One person's money movement on an expense: paid, or owes, this much. */
export type ExpenseMovement = {
  user_id: string;
  amount_minor_units: number;
};

/** `from` owes `to` this much of one expense. Always positive. */
export type ExpenseDebt = {
  from: string;
  to: string;
  minorUnits: number;
};

/** The fields needed to know who paid an expense. */
export type PaidExpense = {
  user_id: string;
  amount_minor_units: number;
  expense_payers: ExpenseMovement[];
};

/** Byte-order comparison, matching Postgres `uuid` ordering for lowercase ids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Who paid how much. No payer rows means `user_id` paid the whole amount
 * (every expense before migration 008, and the common case since).
 */
export function expensePayers(expense: PaidExpense): ExpenseMovement[] {
  return expense.expense_payers.length > 0
    ? expense.expense_payers
    : [{ user_id: expense.user_id, amount_minor_units: expense.amount_minor_units }];
}

/**
 * Attribute one expense's debts between its payers and participants using
 * the net-then-overlap rule above. Expects the payers and the splits to sum
 * to the same total, as the database guarantees; if they do not, the
 * shorter side simply runs out and the excess is not attributed.
 */
export function attributeExpenseDebts(
  payers: ExpenseMovement[],
  splits: ExpenseMovement[],
): ExpenseDebt[] {
  const nets = new Map<string, number>();
  for (const payer of payers) {
    nets.set(payer.user_id, (nets.get(payer.user_id) ?? 0) + payer.amount_minor_units);
  }
  for (const split of splits) {
    nets.set(split.user_id, (nets.get(split.user_id) ?? 0) - split.amount_minor_units);
  }
  return debtsFromNets(nets);
}

/**
 * Step 2 of the rule on its own: turn net positions (user id → paid − owed,
 * summing to zero) into who-owes-whom by the end-to-end overlap sweep. Used
 * per expense above, and by a group's "simplify debts" view, which feeds it
 * every member's net position per currency instead — the same deterministic
 * pairing, so the database's leave guard only has to check that a member's
 * net is zero to know they appear in no simplified debt. Not the minimum
 * number of transfers in general (that is NP-hard), but never more than
 * people − 1.
 */
export function debtsFromNets(nets: ReadonlyMap<string, number>): ExpenseDebt[] {
  const creditors = [...nets]
    .filter(([, net]) => net > 0)
    .sort(([idA, netA], [idB, netB]) => netB - netA || compareIds(idA, idB));
  const debtors = [...nets]
    .filter(([, net]) => net < 0)
    .map(([id, net]) => [id, -net] as [string, number])
    .sort(([idA, owedA], [idB, owedB]) => owedB - owedA || compareIds(idA, idB));

  // Walk both rows of intervals in step: each debt is the overlap of the
  // current creditor's and debtor's intervals, and whichever ends first
  // moves on.
  const debts: ExpenseDebt[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  let creditorLeft = creditors[0]?.[1] ?? 0;
  let debtorLeft = debtors[0]?.[1] ?? 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const amount = Math.min(creditorLeft, debtorLeft);
    debts.push({
      from: debtors[debtorIndex][0],
      to: creditors[creditorIndex][0],
      minorUnits: amount,
    });
    creditorLeft -= amount;
    debtorLeft -= amount;
    if (creditorLeft === 0) {
      creditorIndex += 1;
      creditorLeft = creditors[creditorIndex]?.[1] ?? 0;
    }
    if (debtorLeft === 0) {
      debtorIndex += 1;
      debtorLeft = debtors[debtorIndex]?.[1] ?? 0;
    }
  }

  return debts;
}

/**
 * One person's position on a split expense: what they paid minus their
 * share. Positive = they lent that much in total, negative = they borrowed.
 * Equals the sum of the debts `attributeExpenseDebts` assigns them.
 */
export function expenseNetFor(
  userId: string,
  payers: ExpenseMovement[],
  splits: ExpenseMovement[],
): { paid: number; share: number; net: number } {
  let paid = 0;
  let share = 0;
  for (const payer of payers) {
    if (payer.user_id === userId) {
      paid += payer.amount_minor_units;
    }
  }
  for (const split of splits) {
    if (split.user_id === userId) {
      share += split.amount_minor_units;
    }
  }
  return { paid, share, net: paid - share };
}
