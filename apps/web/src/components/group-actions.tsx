"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GroupForm } from "@/components/group-form";

const secondaryButtonClasses =
  "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const dangerButtonClasses =
  "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/50";

/**
 * Why the viewer cannot leave right now. Both are also enforced by the
 * group_members delete trigger (migration 007); the prop only decides
 * whether to show the button or an explanation.
 */
export type LeaveBlocker = "sole-owner" | "unsettled";

const LEAVE_BLOCKER_HINT: Record<LeaveBlocker, string> = {
  "sole-owner":
    "You are the only owner, so you can delete this group but not leave it.",
  unsettled:
    "Settle up before leaving: you still owe or are owed money in this group.",
};

/**
 * Group title plus the actions the caller is allowed: owners rename and
 * delete; everyone else (and co-owners) can leave. RLS and the delete
 * trigger enforce all of this server-side — the props only decide what to
 * render.
 */
export function GroupActions({
  group,
  isOwner,
  leaveBlocker,
  userId,
}: {
  group: { id: string; name: string };
  isOwner: boolean;
  /** Set when leaving is not possible; the hint replaces the button. */
  leaveBlocker: LeaveBlocker | null;
  userId: string;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "leave" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("groups")
      .delete()
      .eq("id", group.id);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    router.push("/groups");
    router.refresh();
  }

  async function handleLeave() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: leaveError } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", userId);

    if (leaveError) {
      setError(leaveError.message);
      setPending(false);
      return;
    }

    router.push("/groups");
    router.refresh();
  }

  if (renaming) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Rename group
        </h2>
        <GroupForm group={group} onDone={() => setRenaming(false)} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {group.name}
        </h1>

        <div className="flex shrink-0 gap-2">
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                disabled={pending}
                className={secondaryButtonClasses}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => setConfirming("delete")}
                disabled={pending}
                className={dangerButtonClasses}
              >
                Delete group
              </button>
            </>
          )}
          {!leaveBlocker && (
            <button
              type="button"
              onClick={() => setConfirming("leave")}
              disabled={pending}
              className={isOwner ? secondaryButtonClasses : dangerButtonClasses}
            >
              Leave group
            </button>
          )}
        </div>
      </div>

      {leaveBlocker && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {LEAVE_BLOCKER_HINT[leaveBlocker]}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirming === "delete"}
        onCancel={() => setConfirming(null)}
        onConfirm={handleDelete}
        pending={pending}
        error={error}
        title={`Delete “${group.name}”?`}
        description="Every expense and payment recorded in this group will be deleted for all of its members. This can’t be undone."
        confirmLabel="Delete group"
        pendingLabel="Deleting…"
      />

      <ConfirmDialog
        open={confirming === "leave"}
        onCancel={() => setConfirming(null)}
        onConfirm={handleLeave}
        pending={pending}
        error={error}
        title={`Leave “${group.name}”?`}
        description="You will stop seeing this group and its expenses. Anything you paid or were owed stays on record, and an owner can invite you back later."
        confirmLabel="Leave group"
        pendingLabel="Leaving…"
      />
    </div>
  );
}
