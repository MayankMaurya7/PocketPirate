import type {
  ExpenseListItem,
  GroupOption,
  Settlement,
} from "@/lib/types";

/**
 * Client mirror of who may edit or delete a transaction (migration 012).
 * RLS is the real check — these only decide whether to offer the action,
 * and what to tell the viewer when it is not on offer.
 *
 * `ok: false` carries a user-facing reason. `groups` holds the viewer's
 * groups with their current members, so "not in the list" means the person
 * has left.
 */
export type EditPermission = { ok: true } | { ok: false; reason: string };

const FORMER_MEMBER_REASON =
  "This can't be changed any more: someone involved has left the group.";

function isMember(group: GroupOption, userId: string): boolean {
  return group.members.some((member) => member.user_id === userId);
}

/** Mirrors `private.can_edit_expense`, plus the personal-expense rule. */
export function expenseEditPermission(
  expense: ExpenseListItem,
  groups: GroupOption[],
  userId: string,
): EditPermission {
  if (!expense.group_id) {
    return expense.created_by === userId
      ? { ok: true }
      : { ok: false, reason: "Only the owner of a personal expense can edit it." };
  }

  const group = groups.find((candidate) => candidate.id === expense.group_id);
  if (!group || !isMember(group, userId)) {
    return { ok: false, reason: "Only members of the group can edit this." };
  }

  const party = expense.created_by === userId || expense.user_id === userId;
  if (group.editPolicy === "parties" && !party) {
    return {
      ok: false,
      reason:
        "In this group only whoever added or paid for an expense can change it.",
    };
  }

  const involved = [
    expense.user_id,
    ...expense.expense_payers.map((payer) => payer.user_id),
    ...expense.expense_splits.map((split) => split.user_id),
  ];
  if (involved.some((id) => !isMember(group, id))) {
    return { ok: false, reason: FORMER_MEMBER_REASON };
  }

  return { ok: true };
}

/** Mirrors the settlements UPDATE/DELETE policies. */
export function settlementEditPermission(
  settlement: Settlement,
  group: GroupOption | undefined,
  userId: string,
): EditPermission {
  if (!group || !isMember(group, userId)) {
    return { ok: false, reason: "Only members of the group can edit this." };
  }

  const party =
    settlement.from_user_id === userId || settlement.to_user_id === userId;
  if (group.editPolicy === "parties" && !party) {
    return {
      ok: false,
      reason: "In this group only the two people in a payment can change it.",
    };
  }

  if (
    !isMember(group, settlement.from_user_id) ||
    !isMember(group, settlement.to_user_id)
  ) {
    return { ok: false, reason: FORMER_MEMBER_REASON };
  }

  return { ok: true };
}
