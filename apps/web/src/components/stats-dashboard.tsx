"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import {
  DATE_RANGE_PRESETS,
  DEFAULT_CURRENCY,
  dominantCurrency,
  expensesInRange,
  formatMinorUnits,
  fromLocalDateString,
  listDays,
  listMonths,
  percentChange,
  presetDateRange,
  previousPeriodRange,
  sumByCurrency,
  sumInCurrency,
  totalsByBucket,
  totalsByCategory,
} from "@expense-tracker/shared";
import type { DateRangePreset } from "@expense-tracker/shared";

import { CategoryBars } from "@/components/category-bars";
import { SpendColumns } from "@/components/spend-columns";
import type { ColumnBucket } from "@/components/spend-columns";
import { StatTile } from "@/components/stat-tile";
import type { CategoryOption, StatsExpense } from "@/lib/types";

const PERIODS: Record<
  DateRangePreset,
  { label: string; compare: string; unit: "day" | "month" }
> = {
  today: { label: "Today", compare: "yesterday", unit: "day" },
  week: { label: "This week", compare: "last week", unit: "day" },
  month: { label: "This month", compare: "last month", unit: "day" },
  year: { label: "This year", compare: "last year", unit: "month" },
};

const subscribeNoop = () => () => {};

function dayBuckets(
  expenses: StatsExpense[],
  currency: string,
  from: string,
  to: string,
  preset: DateRangePreset,
): ColumnBucket[] {
  const days = listDays(from, to);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const full = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return totalsByBucket(expenses, currency, days, (e) => e.expense_date).map(
    (bucket) => {
      const date = fromLocalDateString(bucket.key);
      const day = date.getDate();
      // Weeks get weekday names; short month-to-date ranges label every day;
      // a full month labels 1, 5, 10, … so ticks never collide.
      const axisLabel =
        preset === "week"
          ? weekday.format(date)
          : days.length <= 14 || day === 1 || day % 5 === 0
            ? String(day)
            : null;
      return { ...bucket, axisLabel, name: full.format(date) };
    },
  );
}

function monthBuckets(
  expenses: StatsExpense[],
  currency: string,
  from: string,
  to: string,
): ColumnBucket[] {
  const months = listMonths(from, to);
  const short = new Intl.DateTimeFormat(undefined, { month: "short" });
  const full = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  });
  return totalsByBucket(expenses, currency, months, (e) =>
    e.expense_date.slice(0, 7),
  ).map((bucket) => {
    const date = fromLocalDateString(`${bucket.key}-01`);
    return { ...bucket, axisLabel: short.format(date), name: full.format(date) };
  });
}

/**
 * Personal spending overview. Everything is computed in the browser from the
 * server-fetched rows so periods follow the user's local timezone; that
 * means "now" only exists after hydration, hence the mounted gate.
 */
export function StatsDashboard({
  expenses,
  categories,
}: {
  expenses: StatsExpense[];
  categories: CategoryOption[];
}) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [selected, setSelected] = useState<DateRangePreset>("month");

  const stats = useMemo(() => {
    if (!mounted) {
      return null;
    }
    const now = new Date();
    const fallbackCurrency = dominantCurrency(expenses) ?? DEFAULT_CURRENCY;

    return DATE_RANGE_PRESETS.map((preset) => {
      const range = presetDateRange(preset, now);
      const previous = previousPeriodRange(preset, now);
      const current = expensesInRange(expenses, range.from, range.to);
      const totals = sumByCurrency(current);
      const currency = totals[0]?.currency ?? fallbackCurrency;
      const currentTotal = sumInCurrency(current, currency);
      const previousTotal = sumInCurrency(
        expensesInRange(expenses, previous.from, previous.to),
        currency,
      );
      const days = listDays(range.from, range.to).length;

      return {
        preset,
        range,
        currency,
        totals,
        count: current.length,
        change: percentChange(currentTotal, previousTotal),
        averagePerDay: Math.round(currentTotal / days),
        days,
        otherCurrencies: totals.slice(1).map((total) => total.currency),
        byCategory: totalsByCategory(current, currency),
        overTime:
          preset === "today"
            ? null
            : PERIODS[preset].unit === "month"
              ? monthBuckets(current, currency, range.from, range.to)
              : dayBuckets(current, currency, range.from, range.to, preset),
      };
    });
  }, [expenses, mounted]);

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          No expenses yet
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Stats appear once you have logged an expense.{" "}
          <Link
            href="/"
            className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
          >
            Add one
          </Link>
          .
        </p>
      </div>
    );
  }

  const period = stats?.find((entry) => entry.preset === selected) ?? null;
  const meta = PERIODS[selected];

  return (
    <div aria-busy={!stats}>
      <div
        role="group"
        aria-label="Period"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {DATE_RANGE_PRESETS.map((preset) => {
          const entry = stats?.find((item) => item.preset === preset);
          return (
            <StatTile
              key={preset}
              label={PERIODS[preset].label}
              totals={entry?.totals ?? []}
              count={entry?.count ?? 0}
              change={entry?.change ?? null}
              compareLabel={PERIODS[preset].compare}
              selected={selected === preset}
              onSelect={() => setSelected(preset)}
            />
          );
        })}
      </div>

      <section className="mt-8" aria-labelledby="stats-period-heading">
        <h2
          id="stats-period-heading"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {meta.label}
        </h2>
        {period && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {period.count} expense{period.count === 1 ? "" : "s"}
            {period.count > 0 && period.days > 1 && (
              <>
                {" · "}
                {formatMinorUnits(period.averagePerDay, period.currency)} per
                day on average
              </>
            )}
            {period.otherCurrencies.length > 0 && (
              <>
                {" · "}Charts show {period.currency} only (
                {period.otherCurrencies.join(", ")} excluded)
              </>
            )}
          </p>
        )}

        {period && period.count === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No expenses {meta.label.toLowerCase()}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Pick another period to see a breakdown.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                By category
              </h3>
              <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                Share of {meta.label.toLowerCase()}&apos;s spend
              </p>
              {period ? (
                <CategoryBars
                  rows={period.byCategory}
                  categories={categories}
                  currency={period.currency}
                />
              ) : (
                <div className="h-24" />
              )}
            </div>

            {(!period || period.overTime) && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Over time
                </h3>
                <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                  {meta.unit === "month" ? "Monthly" : "Daily"} spend,{" "}
                  {meta.label.toLowerCase()}
                </p>
                {period?.overTime ? (
                  <SpendColumns
                    buckets={period.overTime}
                    currency={period.currency}
                    periodLabel={meta.label.toLowerCase()}
                  />
                ) : (
                  <div className="h-48" />
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
