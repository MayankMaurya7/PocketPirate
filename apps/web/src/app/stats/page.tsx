import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { StatsDashboard } from "@/components/stats-dashboard";
import type { StatsExpense } from "@/lib/types";

/** PostgREST caps a single response at `max_rows` (1000 in config.toml). */
const PAGE_SIZE = 1000;

export default async function StatsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userId = data.claims.sub;

  // Periods and buckets are computed in the browser (local timezone), so the
  // server only bounds the fetch: everything from 1 Jan of last year covers
  // "this year" plus its like-for-like comparison against last year.
  const since = `${new Date().getUTCFullYear() - 1}-01-01`;

  // Page through the result: the API truncates silently at PAGE_SIZE rows.
  const expenses: StatsExpense[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("expenses")
      .select("id, amount_minor_units, currency, expense_date, category_id")
      .eq("user_id", userId)
      .is("group_id", null)
      .eq("status", "confirmed")
      .gte("expense_date", since)
      .order("expense_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Could not load expenses: ${error.message}`);
    }
    expenses.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) {
      break;
    }
  }

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, color, icon")
    .order("name");

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="stats" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Stats
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your personal expenses. Group spending is not included yet.
        </p>

        <div className="mt-6">
          <StatsDashboard expenses={expenses} categories={categories ?? []} />
        </div>
      </main>
    </div>
  );
}
