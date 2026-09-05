"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * The "Join group" button on the invite page. Exchanges the token through
 * the accept_group_invite RPC (which adds the caller as a member) and moves
 * on to the group. Its error messages are written for users, so they are
 * shown verbatim — an expired link, for instance.
 */
export function JoinGroup({ token, groupName }: { token: string; groupName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { data: groupId, error: rpcError } = await supabase.rpc(
      "accept_group_invite",
      { _token: token },
    );

    if (rpcError) {
      setError(rpcError.message);
      setPending(false);
      return;
    }

    // Leave `pending` set: the browser is navigating away.
    router.replace(`/groups/${groupId}`);
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={pending}
        className="flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
      >
        {pending ? "Joining…" : `Join ${groupName}`}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
