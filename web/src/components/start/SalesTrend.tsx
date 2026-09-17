"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatCents } from "@/lib/tipPool";
import type { TrendPoint } from "@/lib/startPage";

/**
 * NET SALES, DAY BY DAY, THIS YEAR AGAINST LAST (Mark, 2026-09-17: "Maybe a
 * graph comparing this year with last year").
 *
 * Two lines on one axis, every shop folded together. NO HUE: the design
 * system keeps colour for record state, so this year is ink and last year is a
 * grey DASHED line — the dash is what tells them apart for anyone who cannot
 * separate two greys, and the legend names both.
 *
 * A missing day is a GAP in its line, never a drop to zero: a day nobody
 * pulled from Square did not take nothing.
 *
 * DRAWN AT ITS REAL WIDTH, measured, rather than a fixed viewBox scaled to
 * fit: scaled, the 12px axis labels came out 17px on a 1440 window.
 *
 * Hover (or arrow keys, once focused) puts a crosshair on the nearest day and
 * reads out both values; the daily table on /sales is where the same figures
 * live without hovering.
 */
export function SalesTrend({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      const w = Math.round(node.getBoundingClientRect().width);
      // A hidden tab measures 0; keep the last real width rather than drawing nothing.
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const W = width;
  const H = 240;
  const PAD = { top: 12, right: 12, bottom: 28, left: 64 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { max, ticks } = useMemo(() => {
    const values = points.flatMap((p) => [p.thisYear, p.lastYear]).filter((v): v is number => v !== null);
    const top = Math.max(1, ...values);
    const step = niceStep(top / 3);
    const ceiling = Math.ceil(top / step) * step;
    const list: number[] = [];
    for (let v = 0; v <= ceiling; v += step) list.push(v);
    return { max: ceiling, ticks: list };
  }, [points]);

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const thisPath = linePath(points.map((p) => p.thisYear), x, y);
  const lastPath = linePath(points.map((p) => p.lastYear), x, y);

  function nearest(clientX: number, rect: DOMRect): number {
    const px = ((clientX - rect.left) / rect.width) * W;
    const t = (px - PAD.left) / plotW;
    return Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1))));
  }

  const active = hover === null ? null : points[hover];

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] uppercase tracking-[0.12em] text-muted">
        <span>Net sales by day</span>
        <span className="flex items-center gap-2 normal-case tracking-normal text-ink">
          <svg width="24" height="8" aria-hidden>
            <line x1="0" y1="4" x2="24" y2="4" stroke="var(--color-ink)" strokeWidth="2" />
          </svg>
          This year
        </span>
        <span className="flex items-center gap-2 normal-case tracking-normal text-ink">
          <svg width="24" height="8" aria-hidden>
            <line x1="0" y1="4" x2="24" y2="4" stroke="#8a8a8a" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Same weekdays last year
        </span>
      </figcaption>

      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y outline-none"
          role="img"
          aria-label="Net sales per day for the last 30 days, this year and the same weekdays last year"
          tabIndex={0}
          onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
            else if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
            else if (e.key === "Escape") setHover(null);
            else return;
            e.preventDefault();
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-hairline)"
                strokeWidth="1"
              />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--color-muted)">
                {shortDollars(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            // One label a week, on Mondays, so the axis reads as weeks.
            weekdayOf(p.date) === 1 ? (
              <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-muted)">
                {shortDate(p.date)}
              </text>
            ) : null
          )}

          <path d={lastPath} fill="none" stroke="#8a8a8a" strokeWidth="2" strokeDasharray="5 3" />
          <path d={thisPath} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" />

          {active && hover !== null ? (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--color-ink)"
                strokeWidth="1"
                opacity="0.35"
              />
              {active.lastYear !== null && (
                <circle cx={x(hover)} cy={y(active.lastYear)} r="4" fill="#8a8a8a" stroke="white" strokeWidth="2" />
              )}
              {active.thisYear !== null && (
                <circle cx={x(hover)} cy={y(active.thisYear)} r="4" fill="var(--color-ink)" stroke="white" strokeWidth="2" />
              )}
            </g>
          ) : null}
        </svg>

        {active && hover !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 border border-ink bg-white px-3 py-2 text-[13px] shadow-[3px_3px_0_0_var(--color-ink)]"
            style={
              hover > points.length / 2
                ? { right: `${((W - x(hover)) / W) * 100 + 1.5}%` }
                : { left: `${(x(hover) / W) * 100 + 1.5}%` }
            }
          >
            <div className="text-[12px] uppercase tracking-[0.08em] text-muted">
              {longDate(active.date)}
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-bold tabular-nums">
                {active.thisYear === null ? "Not pulled" : formatCents(active.thisYear)}
              </span>
              <span className="text-muted">this year</span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-bold tabular-nums">
                {active.lastYear === null ? "—" : formatCents(active.lastYear)}
              </span>
              <span className="text-muted">{longDate(active.lastYearDate)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** An SVG path through the non-null values, broken wherever one is null. */
function linePath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number
): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** 1, 2 or 5 × a power of ten, at least `raw` — in CENTS. */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function shortDollars(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

// Dates are compared and formatted as strings through UTC midnight, never the
// browser's zone — `new Date("2026-09-17")` is UTC midnight, and reading it in
// local time would move every label a day west of Greenwich.
function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

function longDate(iso: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[weekdayOf(iso)]} ${shortDate(iso)}/${iso.slice(2, 4)}`;
}
