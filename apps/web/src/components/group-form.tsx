"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { useUnsavedChanges } from "@/components/unsaved-changes";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

/**
 * Create/rename form for a group. Pass `group` to rename it in place; omit it
 * to create a new one (which then navigates to the new group's page).
 */
export function GroupForm({
  group,
  onDone,
}: {
  group?: { id: string; name: string };
  onDone: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState(group?.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDiscard = useUnsavedChanges(name !== (group?.name ?? ""));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a group name.");
      return;
    }

    setPending(true);
    const supabase = createClient();

    if (group) {
      const { error: updateError } = await supabase
        .from("groups")
        .update({ name: trimmedName })
        .eq("id", group.id);

      if (updateError) {
        setError(updateError.message);
        setPending(false);
        return;
      }

      router.refresh();
      onDone();
      return;
    }

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const userId = claimsData?.claims.sub;
    if (claimsError || !userId) {
      setError("Your session has expired. Refresh and sign in again.");
      setPending(false);
      return;
    }

    // The id is minted here rather than read back with `.select()`: Postgres
    // applies the SELECT policy to an INSERT's RETURNING rows *before* AFTER
    // triggers run, and on_group_created (which makes us a member, and so
    // able to see the row) is an AFTER trigger — so returning the row fails
    // with "new row violates row-level security policy".
    const id = crypto.randomUUID();
    const { error: insertError } = await supabase
      .from("groups")
      .insert({ id, name: trimmedName, created_by: userId });

    if (insertError) {
      setError(insertError.message);
      setPending(false);
      return;
    }

    router.push(`/groups/${id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="group-name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Name
        </label>
        <input
          id="group-name"
          type="text"
          required
          maxLength={60}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          placeholder="Flat 4B, Goa trip…"
          className={inputClasses}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
        >
          {pending ? "Saving…" : group ? "Save changes" : "Create group"}
        </button>
        <button
          type="button"
          onClick={() => confirmDiscard(onDone)}
          disabled={pending}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
