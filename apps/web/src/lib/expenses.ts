import { formatMinorUnits } from "@expense-tracker/shared";

import { type GroupOption, memberLabel } from "@/lib/types";

/**
 * The embed used by every expense list. `payer` must name the FK explicitly:
 * expenses has two FKs to profiles (user_id and created_by). `expense_payers`
 * is empty unless several members paid (then `payer` is the primary one).
 */
export const EXPENSE_SELECT =
  "*, categories(id, name, color, icon), groups(id, name), payer:profiles!expenses_user_id_fkey(id, display_name, email, avatar_url), expense_splits(user_id, amount_minor_units), expense_payers(user_id, amount_minor_units)";

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
