import type { Tables } from "@expense-tracker/shared";

import type { GroupInvite } from "@/lib/types";

/**
 * Turns the owner's `group_invites` row into what the UI renders, judging
 * expiry against the clock here (request time on the server) rather than
 * inside a component, where the React purity rule forbids reading it.
 */
export function toGroupInvite(
  row: Pick<Tables<"group_invites">, "token" | "expires_at">,
): GroupInvite {
  return { ...row, expired: new Date(row.expires_at).getTime() <= Date.now() };
}
