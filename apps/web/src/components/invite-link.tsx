"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { GroupInvite } from "@/lib/types";

const secondaryButtonClasses =
  "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

/** The join URL for a token, on whichever origin the app is served from. */
function inviteUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/join/${token}`;
}

/**
 * Owner-only: the group's invite link (migration 011). One live link per
 * group; "Reset" mints a new one (revoking the old), "Remove" deletes it.
 * The token is only ever readable by owners, so the link is rendered from
 * the row the server fetched for them, and the RPC's return value bridges
 * the gap until the page re-renders.
 */
export function InviteLink({
  groupId,
  invite,
}: {
  groupId: string;
  invite: GroupInvite | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // A freshly minted token, shown until router.refresh() brings the row.
  const [fresh, setFresh] = useState<string | null>(null);

  const token = fresh ?? invite?.token ?? null;
  const expired = !fresh && invite != null && invite.expired;

  async function handleCreate() {
    setPending(true);
    setError(null);
    setCopied(false);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_group_invite", {
      _group_id: groupId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setPending(false);
      return;
    }

    setFresh(data);
    setPending(false);
    router.refresh();
  }

  async function handleRemove() {
    setPending(true);
    setError(null);
    setCopied(false);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("group_invites")
      .delete()
      .eq("group_id", groupId);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    setFresh(null);
    setPending(false);
    setConfirmingRemove(false);
    router.refresh();
  }

  async function handleCopy() {
    if (!token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy it yourself.");
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Invite link
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Anyone with the link can join after signing in or creating a
            PocketPirate account.
          </p>
        </div>
        {!token && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={pending}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
          >
            {pending ? "Creating…" : "Create link"}
          </button>
        )}
      </div>

      {token && (
        <>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteUrl(token)}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Invite link"
              className="block w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={pending || expired}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p
              className={`text-xs ${
                expired
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              {expired
                ? "This link has expired. Reset it to invite people again."
                : !fresh && invite
                  ? `Expires ${new Date(invite.expires_at).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}.`
                  : "Valid for 30 days."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={pending}
                title="Mint a new link; the old one stops working"
                className={secondaryButtonClasses}
              >
                {pending ? "Working…" : "Reset"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                disabled={pending}
                className={secondaryButtonClasses}
              >
                Remove
              </button>
            </div>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmingRemove}
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={handleRemove}
        pending={pending}
        error={error}
        title="Remove the invite link?"
        description="Anyone who still has the link will no longer be able to join. You can create a new link at any time."
        confirmLabel="Remove link"
        pendingLabel="Removing…"
      />
    </div>
  );
}
