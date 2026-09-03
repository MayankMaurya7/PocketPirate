import type { Enums, Tables } from "@expense-tracker/shared";

/** The category fields the UI needs (picker options, list badges). */
export type CategoryOption = Pick<
  Tables<"categories">,
  "id" | "name" | "color" | "icon"
>;

/**
 * An expense row as the lists render it. `categories` is null when
 * uncategorised — or when another member logged it, since categories are
 * private per user and RLS hides theirs. `groups` is null for personal
 * expenses. `payer` is the profile behind `user_id` (whose expense it is).
 */
export type ExpenseListItem = Tables<"expenses"> & {
  categories: CategoryOption | null;
  groups: Pick<Tables<"groups">, "id" | "name"> | null;
  payer: MemberProfile | null;
};

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

/** A group as the expense form / filters need it: name + who is in it. */
export type GroupOption = {
  id: string;
  name: string;
  members: GroupMemberOption[];
};
