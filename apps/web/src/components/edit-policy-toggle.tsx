"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/switch";
import type { GroupEditPolicy } from "@/lib/types";

const COPY: Record<GroupEditPolicy, string> = {
  everyone: "Anyone in the group can edit or delete expenses and payments.",
  parties:
    "Only the people involved can edit or delete: whoever added or paid for an expense, or the two people in a payment.",
};

/**
 * The owner's "Anyone can edit" switch (`groups.edit_policy`, migration
 * 012). Owners flip it through the owner-only groups UPDATE policy; every
 * other member sees the current rule as text. The switch and its
 * description change the moment it is tapped and pulse until the update
 * and the page refresh are done; on an error they fall back to the saved
 * value and say why.
 */
export function EditPolicyToggle({
  groupId,
  policy,
  isOwner,
}: {
  groupId: string;
  policy: GroupEditPolicy;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(policy);
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const next: GroupEditPolicy = policy === "everyone" ? "parties" : "everyone";
    setError(null);
    startTransition(async () => {
      setShown(next);

      const supabase = createClient();
      // RETURNING runs under the SELECT policy, which every member passes,
      // so "no row" means the UPDATE policy filtered it out (not an owner).
      const { data, error: updateError } = await supabase
        .from("groups")
        .update({ edit_policy: next })
        .eq("id", groupId)
        .select("id")
        .maybeSingle();

      if (updateError || !data) {
        setError(updateError?.message ?? "Only an owner can change this.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <p
        className={`min-w-0 flex-1 text-xs text-zinc-500 transition dark:text-zinc-400 ${
          isPending ? "opacity-60" : ""
        }`}
      >
        {COPY[shown]}
        {!isOwner && " An owner can change this."}
      </p>
      {isOwner && (
        <div className="flex flex-col items-end">
          <Switch
            id={`edit-policy-${groupId}`}
            label="Anyone can edit"
            checked={shown === "everyone"}
            pending={isPending}
            onToggle={handleToggle}
          />
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
