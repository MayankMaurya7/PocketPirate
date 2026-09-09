import { type ExpenseListItem, type GroupOption, memberLabel } from "@/lib/types";

export const FORMER_MEMBER = "a former member";

/** Byte-order comparison, matching the ledger's tie-breaks on user_id. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type MemberNamer = (id: string, options?: { sentence?: boolean }) => string;

/**
 * How to name each person on an expense. The viewer is "you"; the primary
 * payer's label comes from the embedded profile (visible even if they have
 * left); everyone else from the group option's current members, and a
 * member who has since left is "a former member". `sentence` capitalises
 * the two placeholders for use at the start of a line — real labels are
 * left alone so an email is not mangled.
 */
export function expenseMemberNamer(
  expense: ExpenseListItem,
  groups: GroupOption[],
  userId: string,
): MemberNamer {
  const members = groups.find((group) => group.id === expense.group_id)?.members;
  return (id, options) => {
    if (id === userId) {
      return options?.sentence ? "You" : "you";
    }
    if (id === expense.user_id) {
      return memberLabel(expense.payer);
    }
    const label = members?.find((member) => member.user_id === id)?.label;
    if (label) {
      return label;
    }
    return options?.sentence ? "A former member" : FORMER_MEMBER;
  };
}

/**
 * The same, for anything that is not an expense row (activity entries,
 * payments): names come only from the group's current members.
 */
export function groupMemberNamer(
  group: GroupOption | undefined,
  userId: string,
): MemberNamer {
  return (id, options) => {
    if (id === userId) {
      return options?.sentence ? "You" : "you";
    }
    const label = group?.members.find((member) => member.user_id === id)?.label;
    if (label) {
      return label;
    }
    return options?.sentence ? "A former member" : FORMER_MEMBER;
  };
}
