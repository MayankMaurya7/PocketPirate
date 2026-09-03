"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import type { CategoryWithUsage } from "@/lib/types";

/** Preset swatches — the seeded defaults plus a few extras. */
const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Postgres unique_violation — (user_id, name) is unique on categories. */
const UNIQUE_VIOLATION = "23505";

const inputClasses =
  "mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600";

const labelClasses =
  "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

/**
 * Add/edit form for a category. Pass `category` to edit it in place; omit it
 * to create a new one.
 */
export function CategoryForm({
  category,
  onDone,
}: {
  category?: CategoryWithUsage;
  onDone: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(
    category?.color.toLowerCase() ?? PRESET_COLORS[0],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a category name.");
      return;
    }
    if (!HEX_COLOR.test(color)) {
      setError("Pick a valid colour.");
      return;
    }

    setPending(true);
    const supabase = createClient();

    let dbError: { code?: string; message: string } | null = null;

    if (category) {
      const { error: updateError } = await supabase
        .from("categories")
        .update({ name: trimmedName, color })
        .eq("id", category.id);
      dbError = updateError;
    } else {
      const { data: claimsData, error: claimsError } =
        await supabase.auth.getClaims();
      const userId = claimsData?.claims.sub;
      if (claimsError || !userId) {
        setError("Your session has expired. Refresh and sign in again.");
        setPending(false);
        return;
      }

      const { error: insertError } = await supabase
        .from("categories")
        .insert({ user_id: userId, name: trimmedName, color });
      dbError = insertError;
    }

    if (dbError) {
      setError(
        dbError.code === UNIQUE_VIOLATION
          ? `You already have a category named "${trimmedName}".`
          : dbError.message,
      );
      setPending(false);
      return;
    }

    // Re-run the server components so the list reflects the change.
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="category-name" className={labelClasses}>
          Name
        </label>
        <input
          id="category-name"
          type="text"
          required
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          placeholder="Groceries, Subscriptions…"
          className={inputClasses}
        />
      </div>

      <fieldset disabled={pending}>
        <legend className={labelClasses}>Colour</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((preset) => {
            const selected = preset === color;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-label={`Use colour ${preset}`}
                aria-pressed={selected}
                className={`h-7 w-7 rounded-full transition focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                  selected
                    ? "ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-50 dark:ring-offset-zinc-900"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: preset }}
              />
            );
          })}

          <label className="ml-1 flex cursor-pointer items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              aria-label="Custom colour"
              className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
            />
            Custom
          </label>
        </div>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-zinc-950"
        >
          {pending
            ? "Saving…"
            : category
              ? "Save changes"
              : "Add category"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
