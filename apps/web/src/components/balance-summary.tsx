import { formatMinorUnits } from "@expense-tracker/shared";

import type { BalanceEntry } from "@/lib/balances";

/**
 * The viewer's overall position in the group, one line per currency:
 * "you owe ₹80" / "you are owed ₹8,864.83" / settled up.
 */
export function BalanceSummary({ balance }: { balance: BalanceEntry[] }) {
  if (balance.length === 0) {
    return (
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        You are settled up.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {balance.map((entry) => (
        <li
          key={entry.currency}
          className="text-sm font-medium text-zinc-600 dark:text-zinc-300"
        >
          Overall, you{" "}
          {entry.minorUnits > 0 ? (
            <>
              are owed{" "}
              <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatMinorUnits(entry.minorUnits, entry.currency)}
              </span>
            </>
          ) : (
            <>
              owe{" "}
              <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                {formatMinorUnits(-entry.minorUnits, entry.currency)}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
