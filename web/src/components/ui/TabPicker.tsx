"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The app's one-of-N chooser (Mark, 2026-08-01: the order guide's filter tabs
 * "should be replicated stylistically throughout the app... the default moving
 * forward") — a segmented bar in the guide's style: one box, cells divided by
 * rules, the chosen cell filled black. One choice reads as ONE OBJECT rather
 * than a row of loose buttons, which is the reason the guide drew it this way.
 *
 * This RETIRES the underline-marker tab dialect (border-b-2 on the active
 * label) and the loose bordered-chip dialect — three lists, the PO list and
 * the cleanup queue each had their own; now they all render through here, so a
 * change lands everywhere at once, the DataTable rule.
 *
 * Options:
 * - `count` puts the option's row count beside its label, dimmed and tabular —
 *   the guide's tier style.
 * - `href` renders the cell as a Link instead of a button (the guide's day
 *   picker navigates; everything else sets state).
 * - `accent: true` fills the SELECTED cell yellow instead of black. For the
 *   last-ordered age buckets, where the design system's rule is that colour
 *   means record state: a stale filter left on is hiding everything fresh, and
 *   yellow is the "worth your eye" mark. Neutral choices ("Any age") stay
 *   black.
 *
 * `size="sm"` (h-8, 11px) is for tight bands like the receiving screen's
 * fixed-height pane header; everything in an ordinary filter row is `md`.
 *
 * The root is `flex w-fit`, not `inline-flex`: an inline-level box in a BLOCK
 * parent sits in a line box and collects descender space — 4px of nothing
 * under the control (the trap that put Sign out off its baseline). In a flex
 * row parent the distinction is moot, so flex is right everywhere.
 */
export type TabPickerOption<K extends string = string> = {
  key: K;
  label: ReactNode;
  /** Row count shown beside the label, dimmed. Omit for plain tabs. */
  count?: number;
  title?: string;
  /** Navigate instead of set state — the cell renders as a Link. */
  href?: string;
  /** Selected fill is yellow (the mark colour) instead of black. */
  accent?: boolean;
};

export function TabPicker<K extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: {
  options: readonly TabPickerOption<K>[];
  value: K;
  /** Omit only when every option carries an href. */
  onChange?: (key: K) => void;
  size?: "md" | "sm";
  ariaLabel?: string;
  className?: string;
}) {
  const cell =
    size === "sm" ? "px-3 text-[11px]" : "px-4 text-[12px]";
  const height = size === "sm" ? "h-8" : "h-9";

  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className={`flex ${height} w-fit items-stretch border border-ink ${className}`}
    >
      {options.map((o, i) => {
        const on = o.key === value;
        const cls = `inline-flex items-center gap-2 ${cell} font-semibold uppercase tracking-[0.06em] no-underline transition-colors ${
          i > 0 ? "border-l border-ink" : ""
        } ${
          on
            ? o.accent
              ? "bg-[var(--rf-yellow-500)] text-ink"
              : "bg-ink text-white"
            : "bg-white text-ink hover:bg-neutral-100"
        }`;
        const count =
          o.count !== undefined ? (
            <span className="font-normal tabular-nums opacity-55">{o.count}</span>
          ) : null;

        return o.href ? (
          <Link
            key={o.key}
            href={o.href}
            title={o.title}
            aria-current={on ? "page" : undefined}
            className={cls}
          >
            {o.label}
            {count}
          </Link>
        ) : (
          <button
            key={o.key}
            type="button"
            title={o.title}
            aria-pressed={on}
            onClick={() => onChange?.(o.key)}
            className={cls}
          >
            {o.label}
            {count}
          </button>
        );
      })}
    </span>
  );
}
