import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  UNCATEGORISED,
  hasActiveFilters,
  parseExpenseFilters,
} from "@/lib/expense-filters";
import {
  EXPENSE_SELECT,
  GROUP_OPTION_SELECT,
  toGroupOption,
  totalsByCurrency,
} from "@/lib/expenses";
import { AddExpense } from "@/components/add-expense";
import { AppHeader } from "@/components/app-header";
import { ExpenseFilters } from "@/components/expense-filters";
import { ExpenseList } from "@/components/expense-list";
import type { ExpenseListItem } from "@/lib/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userId = data.claims.sub;
  const filters = parseExpenseFilters(await searchParams);

  let expenseQuery = supabase.from("expenses").select(EXPENSE_SELECT);

  if (filters.group) {
    // Every member's expenses in the group (RLS grants this to members).
    expenseQuery = expenseQuery.eq("group_id", filters.group);
    if (filters.member) {
      expenseQuery = expenseQuery.eq("user_id", filters.member);
    }
  } else {
    expenseQuery = expenseQuery.eq("user_id", userId).is("group_id", null);
  }

  if (filters.category === UNCATEGORISED) {
    expenseQuery = expenseQuery.is("category_id", null);
  } else if (filters.category) {
    expenseQuery = expenseQuery.eq("category_id", filters.category);
  }
  if (filters.from) {
    expenseQuery = expenseQuery.gte("expense_date", filters.from);
  }
  if (filters.to) {
    expenseQuery = expenseQuery.lte("expense_date", filters.to);
  }

  const [{ data: categories }, { data: groups }, { data: expenses }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, color, icon")
        .order("name"),
      supabase.from("groups").select(GROUP_OPTION_SELECT).order("name"),
      expenseQuery
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

  const categoryList = categories ?? [];
  const groupList = (groups ?? []).map(toGroupOption);
  const expenseList: ExpenseListItem[] = expenses ?? [];
  const filtering = hasActiveFilters(filters);
  const totals = totalsByCurrency(expenseList);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="expenses" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(var(--bottom-nav-space)+1.5rem)] pt-6 sm:pb-10 sm:pt-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Expenses
          </h1>
        </div>

        <div className="mt-6">
          <AddExpense
            categories={categoryList}
            groups={groupList}
            userId={userId}
            defaultGroupId={filters.group ?? undefined}
          />
        </div>

        <div className="mt-6">
          <ExpenseFilters
            filters={filters}
            categories={categoryList}
            groups={groupList}
          />
        </div>

        {expenseList.length > 0 && (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            {expenseList.length} expense{expenseList.length === 1 ? "" : "s"}
            {" · "}
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {totals.join(" + ")}
            </span>
          </p>
        )}

        <div className="mt-3">
          <ExpenseList
            expenses={expenseList}
            categories={categoryList}
            groups={groupList}
            userId={userId}
            emptyTitle={filtering ? "No matching expenses" : "No expenses yet"}
            emptyHint={
              filtering
                ? "Try a wider date range, another category or group."
                : "Add your first expense to start tracking."
            }
          />
        </div>
      </main>
    </div>
  );
}
