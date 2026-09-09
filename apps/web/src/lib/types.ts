import type { Enums, Tables } from "@expense-tracker/shared";

/** The category fields the UI needs (picker options, list badges). */
export type CategoryOption = Pick<
  Tables<"categories">,
  "id" | "name" | "color" | "icon"
>;

/** One participant's share of a group expense. */
export type ExpenseSplit = Pick<
  Tables<"expense_splits">,
  "user_id" | "amount_minor_units"
>;

/** How much one member paid of a group expense paid by several people. */
export type ExpensePayer = Pick<
  Tables<"expense_payers">,
  "user_id" | "amount_minor_units"
>;

/**
 * An expense row as the lists render it. `categories` is null when
 * uncategorised — or when another member logged it, since categories are
 * private per user and RLS hides theirs. `groups` is null for personal
 * expenses. `payer` is the profile behind `user_id` (whose expense it is).
 * `expense_splits` is empty for personal and un-split group expenses.
 * `expense_payers` is empty unless several members paid — then `user_id`
 * (and `payer`) is the primary payer and appears among the rows.
 */
export type ExpenseListItem = Tables<"expenses"> & {
  categories: CategoryOption | null;
  groups: Pick<Tables<"groups">, "id" | "name"> | null;
  payer: MemberProfile | null;
  expense_splits: ExpenseSplit[];
  expense_payers: ExpensePayer[];
};

/** The lean expense projection the stats page aggregates. */
export type StatsExpense = Pick<
  Tables<"expenses">,
  "id" | "amount_minor_units" | "currency" | "expense_date" | "category_id"
>;

/** A full category row plus how many (visible) expenses reference it. */
export type CategoryWithUsage = Tables<"categories"> & {
  expenseCount: number;
};

export type GroupRole = Enums<"group_role">;

/** A group row for the list view, with the caller's role and member count. */
export type GroupSummary = Pick<Tables<"groups">, "id" | "name" | "created_at"> & {
  role: GroupRole;
  memberCount: number;
};

/** The profile fields shown for a group member. */
export type MemberProfile = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "email" | "avatar_url"
>;

/** One membership row with the member's profile joined in. */
export type GroupMember = Pick<
  Tables<"group_members">,
  "user_id" | "role" | "joined_at"
> & {
  profiles: MemberProfile | null;
};

/** What to call a member in the UI: name, else email, else a placeholder. */
export function memberLabel(profile: MemberProfile | null): string {
  return profile?.display_name || profile?.email || "Unknown member";
}

/** A member as the expense form's "Paid by" picker needs it. */
export type GroupMemberOption = { user_id: string; label: string };

/** Who may edit or delete a group's transactions (see migration 012). */
export type GroupEditPolicy = Enums<"group_edit_policy">;

/**
 * A group as the expense form / filters need it: name, who is in it (its
 * current members) and its edit policy.
 */
export type GroupOption = {
  id: string;
  name: string;
  editPolicy: GroupEditPolicy;
  members: GroupMemberOption[];
};

/** A recorded payment between two group members (see migration 006). */
export type Settlement = Tables<"settlements">;

/**
 * A group's current invite link (see migration 011); owners only. `expired`
 * is judged by the server when the page renders, so the client never needs
 * the clock during render.
 */
export type GroupInvite = Pick<Tables<"group_invites">, "token" | "expires_at"> & {
  expired: boolean;
};

/**
 * Display label per member id for a group page. Members who have left are
 * absent — callers fall back to a "former member" label.
 */
export type MemberLabels = Record<string, string>;

/** One entry of a group's activity trail (see migration 013). */
export type ActivityEntry = Tables<"group_activity">;
export type ActivityAction = Enums<"activity_action">;
