"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { CategoryForm } from "@/components/category-form";
import { PencilIcon, TrashIcon } from "@/components/icons";
import type { CategoryWithUsage } from "@/lib/types";

/** One category row: colour dot, name, usage count, edit/delete. */
export function CategoryItem({ category }: { category: CategoryWithUsage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usage = category.expenseCount;

  async function handleDelete() {
    const message =
      usage === 0
        ? `Delete "${category.name}"?`
        : `Delete "${category.name}"? ${usage} expense${
            usage === 1 ? "" : "s"
          } will become uncategorised.`;
    if (!window.confirm(message)) {
      return;
    }

    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", category.id);

    if (deleteError) {
      setError(deleteError.message);
      setPending(false);
      return;
    }

    router.refresh();
  }

  if (editing) {
    return (
      <li className="p-5">
        <CategoryForm category={category} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: category.color }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {category.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {usage === 0
            ? "Not used yet"
            : `${usage} expense${usage === 1 ? "" : "s"}`}
          {category.is_default && " · Default"}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          aria-label={`Edit ${category.name}`}
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={`Delete ${category.name}`}
          className="rounded-md p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/50 dark:hover:text-red-400"
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
