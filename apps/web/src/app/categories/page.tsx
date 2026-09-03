import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AddCategory } from "@/components/add-category";
import { AppHeader } from "@/components/app-header";
import { CategoryItem } from "@/components/category-item";
import type { CategoryWithUsage } from "@/lib/types";

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";

  // `expenses(count)` is a PostgREST aggregate over the FK; RLS applies, so it
  // counts only expenses the user can see.
  const { data: categories } = await supabase
    .from("categories")
    .select("*, expenses(count)")
    .order("name");

  const categoryList: CategoryWithUsage[] = (categories ?? []).map(
    ({ expenses, ...category }) => ({
      ...category,
      expenseCount: expenses[0]?.count ?? 0,
    }),
  );

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="categories" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Categories
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Deleting a category keeps its expenses; they just become
          uncategorised.
        </p>

        <div className="mt-6">
          <AddCategory />
        </div>

        {categoryList.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No categories yet
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Add one to start organising your expenses.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {categoryList.map((category) => (
              <CategoryItem key={category.id} category={category} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
