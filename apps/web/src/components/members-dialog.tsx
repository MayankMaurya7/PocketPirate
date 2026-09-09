"use client";

import { useState } from "react";

import { AddMember } from "@/components/add-member";
import { EditPolicyToggle } from "@/components/edit-policy-toggle";
import { InviteLink } from "@/components/invite-link";
import { MemberItem } from "@/components/member-item";
import { Modal } from "@/components/modal";
import { UsersIcon } from "@/components/icons";
import type { BalanceEntry } from "@/lib/balances";
import type { GroupEditPolicy, GroupInvite, GroupMember } from "@/lib/types";

/**
 * The "N people" chip under the group title, opening a dialog with the
 * member list (net balances, owner-only invite/add/remove and the "Anyone
 * can edit" permission). Keeps the page itself to the two things that
 * matter day to day: balances and the timeline.
 */
export function MembersDialog({
  groupId,
  members,
  userId,
  isOwner,
  editPolicy,
  balances,
  showBalances,
  invite,
}: {
  groupId: string;
  members: GroupMember[];
  userId: string;
  isOwner: boolean;
  editPolicy: GroupEditPolicy;
  balances: Map<string, BalanceEntry[]>;
  showBalances: boolean;
  /** The group's current invite link; only fetched for (and shown to) owners. */
  invite: GroupInvite | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <UsersIcon />
        {members.length} {members.length === 1 ? "person" : "people"}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Members">
        {showBalances && (
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Net position in the group: green is owed, red owes.
          </p>
        )}

        {isOwner && (
          <div className="mb-3 space-y-3">
            <InviteLink groupId={groupId} invite={invite} />
            <AddMember groupId={groupId} />
            <EditPolicyToggle groupId={groupId} policy={editPolicy} />
          </div>
        )}

        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {members.map((member) => (
            <MemberItem
              key={member.user_id}
              groupId={groupId}
              member={member}
              isSelf={member.user_id === userId}
              canRemove={isOwner && member.user_id !== userId}
              balance={
                showBalances ? (balances.get(member.user_id) ?? []) : undefined
              }
            />
          ))}
        </ul>
      </Modal>
    </>
  );
}
