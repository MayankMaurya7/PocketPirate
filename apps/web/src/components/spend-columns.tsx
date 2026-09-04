"use client";

import { useEffect, useRef, useState } from "react";

import {
  formatMinorUnits,
  formatMinorUnitsCompact,
} from "@expense-tracker/shared";
import type { Bucket } from "@expense-tracker/shared";

/** Width assumed until the container has been measured. */
const DEFAULT_WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 20, right: 12, bottom: 28, left: 52 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const MAX_BAR = 24;
const CORNER = 4;

/** A "nice" tick step (1 / 2 / 2.5 / 5 × 10ⁿ) giving about `ticks` steps. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const nice =
    normalised <= 1
      ? 1
      : normalised <= 2
        ? 2
        : normalised <= 2.5
          ? 2.5
          : normalised <= 5
            ? 5
            : 10;
  return nice * magnitude;
}

/** A column with the top corners rounded and a square base on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(CORNER, h, w / 2);
  const base = y + h;
  return [
    `M${x},${base}`,
    `V${y + r}`,
    `a${r},${r} 0 0 1 ${r},-${r}`,
    `H${x + w - r}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

export type ColumnBucket = Bucket & {
  /** Short axis label, or null to leave the tick unlabelled. */
  axisLabel: string | null;
  /** Full name for the tooltip and table ("Mon 3 Mar", "March 2026"). */
  name: string;
};

/**
 * Spend per day (or per month) as a single-series column chart. Hovering or
 * focusing a column shows its value; the largest column is labelled
 * directly; a table view sits below for everything else.
 *
 * The SVG is laid out in CSS pixels at the container's measured width (not
 * scaled from a fixed viewBox) so text and strokes stay the same size on a
 * phone as on a desktop.
 */
export function SpendColumns({
  buckets,
  currency,
  periodLabel,
}: {
  buckets: ColumnBucket[];
  currency: string;
  periodLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width);
      if (measured > 0) {
        setWidth(measured);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - PAD.left - PAD.right;
  const max = Math.max(...buckets.map((bucket) => bucket.minorUnits), 1);
  const step = niceStep(max, 4);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) {
    ticks.push(value);
  }

  const band = plotWidth / buckets.length;
  const barWidth = Math.min(MAX_BAR, band * 0.7);
  const yOf = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H;
  const maxIndex = buckets.findIndex((bucket) => bucket.minorUnits === max);

  const activeBucket = active === null ? null : buckets[active];
  const activeLeft =
    active === null ? 0 : ((PAD.left + band * (active + 0.5)) / width) * 100;

  return (
    <div>
      <div ref={containerRef} className="relative">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          height={HEIGHT}
          role="img"
          aria-label={`Spend over time, ${periodLabel}`}
          // Full width so that, until measured, the default-width layout
          // scales to fit instead of overflowing on a narrow screen.
          className="block w-full overflow-visible text-emerald-600 dark:text-emerald-500"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={yOf(value)}
                y2={yOf(value)}
                className={
                  value === 0
                    ? "stroke-zinc-300 dark:stroke-zinc-700"
                    : "stroke-zinc-200 dark:stroke-zinc-800"
                }
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD.left - 8}
                y={yOf(value)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 text-[11px] tabular-nums dark:fill-zinc-400"
              >
                {formatMinorUnitsCompact(value, currency)}
              </text>
            </g>
          ))}

          {buckets.map((bucket, index) => {
            const x = PAD.left + band * index + (band - barWidth) / 2;
            const y = yOf(bucket.minorUnits);
            const height = PAD.top + PLOT_H - y;
            const isActive = active === index;
            return (
              <g
                key={bucket.key}
                tabIndex={0}
                role="img"
                aria-label={`${bucket.name}: ${formatMinorUnits(bucket.minorUnits, currency)}, ${bucket.count} expense${bucket.count === 1 ? "" : "s"}`}
                className="outline-none"
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                {/* Hit target: the whole band, full plot height. */}
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                />
                {bucket.minorUnits > 0 && (
                  <path
                    d={columnPath(x, y, barWidth, height)}
                    fill="currentColor"
                    className={isActive ? "opacity-70" : ""}
                  />
                )}
                {isActive && (
                  <rect
                    x={x - 2}
                    y={y - 2}
                    width={barWidth + 4}
                    height={height + 4}
                    rx={CORNER + 1}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                )}
                {index === maxIndex && active === null && (
                  <text
                    x={Math.min(
                      Math.max(x + barWidth / 2, PAD.left + 18),
                      width - PAD.right - 18,
                    )}
                    y={y - 6}
                    textAnchor="middle"
                    className="fill-zinc-700 text-[11px] font-medium tabular-nums dark:fill-zinc-200"
                  >
                    {formatMinorUnitsCompact(bucket.minorUnits, currency)}
                  </text>
                )}
                {bucket.axisLabel && (
                  <text
                    x={PAD.left + band * (index + 0.5)}
                    y={HEIGHT - PAD.bottom + 16}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
                  >
                    {bucket.axisLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {activeBucket && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-800"
            style={{ left: `${Math.min(Math.max(activeLeft, 12), 88)}%` }}
          >
            <div className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatMinorUnits(activeBucket.minorUnits, currency)}
            </div>
            <div className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
              {activeBucket.name} · {activeBucket.count} expense
              {activeBucket.count === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>

      <details className="mt-3">
        <summary className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Show as table
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Expenses</th>
            </tr>
          </thead>
          <tbody className="text-zinc-700 dark:text-zinc-200">
            {buckets.map((bucket) => (
              <tr key={bucket.key}>
                <td className="py-1">{bucket.name}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatMinorUnits(bucket.minorUnits, currency)}
                </td>
                <td className="py-1 text-right tabular-nums">{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
