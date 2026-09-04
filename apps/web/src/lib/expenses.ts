import { formatMinorUnits } from "@expense-tracker/shared";

import { type GroupOption, memberLabel } from "@/lib/types";

/**
 * The embed used by every expense list. `payer` must name the FK explicitly:
 * expenses has two FKs to profiles (user_id and created_by).
 */
export const EXPENSE_SELECT =
  "*, categories(id, name, color, icon), groups(id, name), payer:profiles!expenses_user_id_fkey(id, display_name, email, avatar_url), expense_splits(user_id, amount_minor_units)";

/** The embed that turns `groups` rows into `GroupOption`s (see below). */
export const GROUP_OPTION_SELECT =
  "id, name, group_members(user_id, profiles(id, display_name, email, avatar_url))";

type GroupOptionRow = {
  id: string;
  name: string;
  group_members: {
    user_id: string;
    profiles: {
      id: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
    } | null;
  }[];
};

/** Shape `groups` rows (with members + profiles embedded) for the UI. */
export function toGroupOption(row: GroupOptionRow): GroupOption {
  return {
    id: row.id,
    name: row.name,
    members: row.group_members.map((member) => ({
      user_id: member.user_id,
      label: memberLabel(member.profiles),
    })),
  };
}

/** Sum amounts per currency; expenses may have been logged in several. */
export function totalsByCurrency(
  expenses: { currency: string; amount_minor_units: number }[],
): string[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(
      expense.currency,
      (totals.get(expense.currency) ?? 0) + expense.amount_minor_units,
    );
  }
  return [...totals.entries()].map(([currency, minorUnits]) =>
    formatMinorUnits(minorUnits, currency),
  );
}

/** A member's net position in one currency. Positive = is owed money. */
export type BalanceEntry = { currency: string; minorUnits: number };

/**
 * Net balance per member from split expenses: the payer is credited the
 * full amount and every participant is debited their share, so per
 * currency the balances sum to zero. Un-split expenses are ignored — the
 * payer bore them alone and nobody owes anything.
 */
export function balancesByMember(
  expenses: {
    user_id: string;
    currency: string;
    amount_minor_units: number;
    expense_splits: { user_id: string; amount_minor_units: number }[];
  }[],
): Map<string, BalanceEntry[]> {
  const ledger = new Map<string, Map<string, number>>();
  const add = (userId: string, currency: string, delta: number) => {
    const byCurrency = ledger.get(userId) ?? new Map<string, number>();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + delta);
    ledger.set(userId, byCurrency);
  };

  for (const expense of expenses) {
    if (expense.expense_splits.length === 0) {
      continue;
    }
    add(expense.user_id, expense.currency, expense.amount_minor_units);
    for (const split of expense.expense_splits) {
      add(split.user_id, expense.currency, -split.amount_minor_units);
    }
  }

  const balances = new Map<string, BalanceEntry[]>();
  for (const [userId, byCurrency] of ledger) {
    balances.set(
      userId,
      [...byCurrency.entries()]
        .filter(([, minorUnits]) => minorUnits !== 0)
        .map(([currency, minorUnits]) => ({ currency, minorUnits })),
    );
  }
  return balances;
}
