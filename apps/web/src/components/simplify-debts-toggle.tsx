"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

/**
 * The per-group "Simplify debts" switch (`groups.simplify_debts`). Owners
 * flip it — the groups UPDATE policy is owner-only, so for everyone else
 * the switch is shown disabled as a read-out of the current mode. The page
 * re-renders from the server after a change, and the database's leave
 * guard reads the same column, so nothing else needs to know.
 */
export function SimplifyDebtsToggle({
  groupId,
  enabled,
  canEdit,
}: {
  groupId: string;
  enabled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    // RETURNING runs under the SELECT policy, which every member passes, so
    // "no row" means the UPDATE policy filtered it out (not an owner).
    const { data, error: updateError } = await supabase
      .from("groups")
      .update({ simplify_debts: !enabled })
      .eq("id", groupId)
      .select("id")
      .maybeSingle();

    if (updateError || !data) {
      setError(updateError?.message ?? "Only an owner can change this.");
      setPending(false);
      return;
    }

    router.refresh();
    setPending(false);
  }

  const id = `simplify-debts-${groupId}`;

  return (
    <div className="flex flex-col items-end">
      <label
        htmlFor={id}
        className={`flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 ${
          canEdit ? "cursor-pointer" : "cursor-default"
        }`}
        title={canEdit ? undefined : "Only an owner can change this"}
      >
        Simplify debts
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={!canEdit || pending}
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 ${
            enabled ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
