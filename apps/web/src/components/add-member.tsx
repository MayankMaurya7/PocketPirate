"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { useUnsavedChanges } from "@/components/unsaved-changes";

/**
 * Owner-only: add a member by email. Calls the add_group_member_by_email RPC,
 * which does the lookup server-side (the client cannot see profiles of people
 * it does not already share a group with). Its error messages are written for
 * users, so they are shown verbatim.
 */
export function AddMember({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // No Cancel of its own: the members dialog asks before it closes.
  useUnsavedChanges(email.trim() !== "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAdded(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter an email address.");
      return;
    }

    setPending(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("add_group_member_by_email", {
      _group_id: groupId,
      _email: trimmedEmail,
    });

    if (rpcError) {
      setError(rpcError.message);
      setPending(false);
      return;
    }

    setEmail("");
    setAdded(trimmedEmail);
    setPending(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <label
        htmlFor="member-email"
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Add a member
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="member-email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          placeholder="friend@example.com"
          className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        They need a PocketPirate account with this email.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {added && (
        <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          Added {added}.
        </p>
      )}
    </form>
  );
}
