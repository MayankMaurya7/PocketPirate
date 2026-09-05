"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DATE_RANGE_PRESETS, presetDateRange } from "@expense-tracker/shared";
import type { DateRangePreset } from "@expense-tracker/shared";

import {
  EMPTY_FILTERS,
  UNCATEGORISED,
  expenseFiltersToQuery,
  hasActiveFilters,
} from "@/lib/expense-filters";
import type { ExpenseListFilters } from "@/lib/expense-filters";
import type { CategoryOption, GroupOption } from "@/lib/types";

const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
};

const selectClasses =
  "block rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

const chipBase =
  "rounded-full px-3 py-1 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950";
const chipActive =
  "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900";
const chipInactive =
  "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

/**
 * Category + date-range filters for the expense list. State lives in the URL
 * so the server component does the filtering and the view is bookmarkable.
 * Preset ranges are resolved here, in the browser, so they follow the user's
 * local timezone.
 *
 * The URL only changes once the server has re-rendered, so the chosen filter
 * is mirrored optimistically — the UI updates on click, not after the
 * round-trip. `useOptimistic` falls back to the real `filters` prop when the
 * transition settles.
 */
export function ExpenseFilters({
  filters: committed,
  categories,
  groups,
}: {
  filters: ExpenseListFilters;
  categories: CategoryOption[];
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filters, setOptimisticFilters] = useOptimistic(committed);

  function apply(next: ExpenseListFilters) {
    const query = expenseFiltersToQuery(next);
    startTransition(() => {
      setOptimisticFilters(next);
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    });
  }

  function selectPreset(preset: DateRangePreset) {
    if (filters.range === preset) {
      apply({ ...filters, range: null, from: null, to: null });
      return;
    }
    const { from, to } = presetDateRange(preset);
    apply({ ...filters, range: preset, from, to });
  }

  function selectCustom() {
    if (filters.range === "custom") {
      apply({ ...filters, range: null, from: null, to: null });
      return;
    }
    // Keep whatever bounds a preset had so the user can tweak them.
    apply({ ...filters, range: "custom" });
  }

  const showCustomInputs = filters.range === "custom";
  const selectedGroup = groups.find((group) => group.id === filters.group);

  return (
    <div className="space-y-3" aria-busy={isPending}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="filter-group" className="sr-only">
          Group
        </label>
        <select
          id="filter-group"
          value={filters.group ?? ""}
          onChange={(event) =>
            apply({
              ...filters,
              group: event.target.value || null,
              member: null,
            })
          }
          className={selectClasses}
        >
          <option value="">Personal</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>

        {selectedGroup && (
          <>
            <label htmlFor="filter-member" className="sr-only">
              Paid by
            </label>
            <select
              id="filter-member"
              value={filters.member ?? ""}
              onChange={(event) =>
                apply({ ...filters, member: event.target.value || null })
              }
              className={selectClasses}
            >
              <option value="">Paid by anyone</option>
              {selectedGroup.members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {DATE_RANGE_PRESETS.map((preset) => {
          const active = filters.range === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              aria-pressed={active}
              className={`${chipBase} ${active ? chipActive : chipInactive}`}
            >
              {PRESET_LABELS[preset]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={selectCustom}
          aria-pressed={showCustomInputs}
          className={`${chipBase} ${showCustomInputs ? chipActive : chipInactive}`}
        >
          Custom
        </button>

        {/* Own line on phones (the chips already fill the width), right-aligned beside them from `sm` up. */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <span
            role="status"
            className={`text-xs text-zinc-400 transition-opacity dark:text-zinc-500 ${
              isPending ? "opacity-100" : "opacity-0"
            }`}
          >
            Updating…
          </span>

          <label htmlFor="filter-category" className="sr-only">
            Category
          </label>
          <select
            id="filter-category"
            value={filters.category ?? ""}
            onChange={(event) =>
              apply({ ...filters, category: event.target.value || null })
            }
            className={`${selectClasses} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All categories</option>
            <option value={UNCATEGORISED}>Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          {hasActiveFilters(filters) && (
            <button
              type="button"
              onClick={() => apply(EMPTY_FILTERS)}
              className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {showCustomInputs && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="filter-from"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              From
            </label>
            <input
              id="filter-from"
              type="date"
              value={filters.from ?? ""}
              max={filters.to ?? undefined}
              onChange={(event) =>
                apply({
                  ...filters,
                  range: "custom",
                  from: event.target.value || null,
                })
              }
              className={`${selectClasses} mt-1`}
            />
          </div>
          <div>
            <label
              htmlFor="filter-to"
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              To
            </label>
            <input
              id="filter-to"
              type="date"
              value={filters.to ?? ""}
              min={filters.from ?? undefined}
              onChange={(event) =>
                apply({
                  ...filters,
                  range: "custom",
                  to: event.target.value || null,
                })
              }
              className={`${selectClasses} mt-1`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
