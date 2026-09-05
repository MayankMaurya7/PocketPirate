"use client";

import {
  attributeExpenseDebts,
  expensePayers,
  formatMinorUnits,
} from "@expense-tracker/shared";

import { AddedAt } from "@/components/added-at";
import {
  type ExpenseListItem,
  type GroupOption,
  memberLabel,
} from "@/lib/types";

const FORMER_MEMBER = "a former member";

/** Byte-order comparison, matching the ledger's tie-breaks on user_id. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * How to name each person on an expense. The viewer is "you"; the primary
 * payer's label comes from the embedded profile (visible even if they have
 * left); everyone else from the group option's current members, and a
 * member who has since left is "a former member". `sentence` capitalises
 * the two placeholders for use at the start of a line — real labels are
 * left alone so an email is not mangled.
 */
export function expenseMemberNamer(
  expense: ExpenseListItem,
  groups: GroupOption[],
  userId: string,
): (id: string, options?: { sentence?: boolean }) => string {
  const members = groups.find((group) => group.id === expense.group_id)?.members;
  return (id, options) => {
    if (id === userId) {
      return options?.sentence ? "You" : "you";
    }
    if (id === expense.user_id) {
      return memberLabel(expense.payer);
    }
    const label = members?.find((member) => member.user_id === id)?.label;
    if (label) {
      return label;
    }
    return options?.sentence ? "A former member" : FORMER_MEMBER;
  };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {children}
    </h3>
  );
}

function PersonRow({
  name,
  isViewer,
  amount,
}: {
  name: string;
  isViewer: boolean;
  amount: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isViewer
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
        {name}
      </p>
      <p className="shrink-0 text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
        {amount}
      </p>
    </li>
  );
}

/**
 * Everything about one group expense that the list row has no room for:
 * who paid how much, every participant's share, and the debts the expense
 * creates between them (the same attribution the group's balances use, so
 * the numbers here add up to what the Balances section shows).
 */
export function ExpenseDetails({
  expense,
  groups,
  userId,
  onEdit,
}: {
  expense: ExpenseListItem;
  groups: GroupOption[];
  userId: string;
  onEdit?: () => void;
}) {
  const nameOf = expenseMemberNamer(expense, groups, userId);
  const category = expense.categories;
  const enteredByMe = expense.created_by === userId;
  const currency = expense.currency;

  const meta: string[] = [
    new Date(`${expense.expense_date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  ];
  if (category) {
    meta.push(category.name);
  } else if (enteredByMe) {
    meta.push("Uncategorised");
  }
  if (expense.groups) {
    meta.push(expense.groups.name);
  }
  meta.push(`Added by ${nameOf(expense.created_by)}`);

  const payers = [...expensePayers(expense)].sort(
    (a, b) =>
      b.amount_minor_units - a.amount_minor_units || compareIds(a.user_id, b.user_id),
  );
  const splits = [...expense.expense_splits].sort(
    (a, b) =>
      b.amount_minor_units - a.amount_minor_units || compareIds(a.user_id, b.user_id),
  );
  const debts = attributeExpenseDebts(payers, splits);

  const listClass =
    "mt-2 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {expense.description || category?.name || "Expense"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {meta.join(" · ")}
            <AddedAt iso={expense.created_at} date={expense.expense_date} />
          </p>
        </div>
        <p className="shrink-0 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatMinorUnits(expense.amount_minor_units, currency)}
        </p>
      </div>

      <section className="mt-5">
        <SectionHeading>Paid by</SectionHeading>
        <ul className={listClass}>
          {payers.map((payer) => (
            <PersonRow
              key={payer.user_id}
              name={nameOf(payer.user_id, { sentence: true })}
              isViewer={payer.user_id === userId}
              amount={formatMinorUnits(payer.amount_minor_units, currency)}
            />
          ))}
        </ul>
      </section>

      {splits.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-zinc-300 px-4 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Not split — this expense does not change anyone&apos;s balance.
        </p>
      ) : (
        <>
          <section className="mt-5">
            <SectionHeading>
              Split {splits.length} way{splits.length === 1 ? "" : "s"}
            </SectionHeading>
            <ul className={listClass}>
              {splits.map((split) => (
                <PersonRow
                  key={split.user_id}
                  name={nameOf(split.user_id, { sentence: true })}
                  isViewer={split.user_id === userId}
                  amount={formatMinorUnits(split.amount_minor_units, currency)}
                />
              ))}
            </ul>
          </section>

          <section className="mt-5">
            <SectionHeading>Who owes whom for this</SectionHeading>
            {debts.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Nobody — everyone paid exactly their share.
              </p>
            ) : (
              <ul className={listClass}>
                {debts.map((debt) => {
                  const iOwe = debt.from === userId;
                  const owedToMe = debt.to === userId;
                  return (
                    <li
                      key={`${debt.from}|${debt.to}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <p className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                        <span className="font-medium">
                          {nameOf(debt.from, { sentence: true })}
                        </span>
                        {iOwe ? " owe " : " owes "}
                        <span className="font-medium">{nameOf(debt.to)}</span>
                      </p>
                      <p
                        className={`shrink-0 font-medium tabular-nums ${
                          iOwe
                            ? "text-red-600 dark:text-red-400"
                            : owedToMe
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-900 dark:text-zinc-100"
                        }`}
                      >
                        {formatMinorUnits(debt.minorUnits, currency)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              The group&apos;s balances add these up across every expense and
              recorded payment.
            </p>
          </section>
        </>
      )}

      {onEdit && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Edit expense
          </button>
        </div>
      )}
    </div>
  );
}
