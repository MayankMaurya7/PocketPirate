import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AddExpense } from "@/components/add-expense";
import { ExpenseItem } from "@/components/expense-item";
import { SignOutButton } from "@/components/sign-out-button";
import type { ExpenseWithCategory } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userId = data.claims.sub;

  const [{ data: categories }, { data: expenses }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, color, icon")
      .order("name"),
    supabase
      .from("expenses")
      .select("*, categories(id, name, color, icon)")
      .eq("user_id", userId)
      .is("group_id", null)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const expenseList: ExpenseWithCategory[] = expenses ?? [];

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              S
            </span>
            <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Spendwise
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-zinc-600 sm:block dark:text-zinc-400">
              {email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Your expenses
          </h1>
        </div>

        <div className="mt-6">
          <AddExpense categories={categories ?? []} />
        </div>

        {expenseList.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No expenses yet
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Add your first expense to start tracking.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {expenseList.map((expense) => (
              <ExpenseItem
                key={expense.id}
                expense={expense}
                categories={categories ?? []}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
