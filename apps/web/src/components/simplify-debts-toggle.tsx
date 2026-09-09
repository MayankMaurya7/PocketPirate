"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/switch";

/**
 * The per-group "Simplify debts" switch (`groups.simplify_debts`). Any
 * member may flip it, through the `set_simplify_debts` RPC (the groups
 * UPDATE policy itself is owner-only). The switch flips the moment it is
 * tapped and pulses until the RPC and the page refresh are done; on an
 * error it falls back to the saved value and says why. The database's
 * leave guard reads the same column, so nothing else needs to know.
 */
export function SimplifyDebtsToggle({
  groupId,
  enabled,
}: {
  groupId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Shown value: the tapped state while the save is in flight, then the
  // server's (which, after the refresh, is the same — or the old one on
  // error).
  const [shown, setShown] = useOptimistic(enabled);
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      setShown(!enabled);

      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("set_simplify_debts", {
        _group_id: groupId,
        _enabled: !enabled,
      });

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end">
      <Switch
        id={`simplify-debts-${groupId}`}
        label="Simplify debts"
        checked={shown}
        pending={isPending}
        onToggle={handleToggle}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
