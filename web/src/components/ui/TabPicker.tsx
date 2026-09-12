"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The app's one-of-N chooser (Mark, 2026-08-01: the order guide's filter tabs
 * "should be replicated stylistically throughout the app... the default moving
 * forward") — a segmented bar in the guide's style: one box, cells divided by
 * rules. One choice reads as ONE OBJECT rather than a row of loose buttons,
 * which is the reason the guide drew it this way.
 *
 * **SINCE 2026-09-12 THEY ARE CLASSIC MAC TABS** (Mark): the selected tab is
 * WHITE, full height and open at the bottom (no bottom border), the rest GREY
 * (#c0c0c0) and 8px shorter, bottom-aligned, all with black type. What follows about a black selected cell is
 * history; the rule that there is no per-caller colour still holds.
 *
 * This RETIRES the underline-marker tab dialect (border-b-2 on the active
 * label) and the loose bordered-chip dialect — three lists, the PO list and
 * the cleanup queue each had their own; now they all render through here, so a
 * change lands everywhere at once, the DataTable rule.
 *
 * **The selected cell is ALWAYS one colour** (black until 2026-09-12). There is no per-caller colour, on
 * purpose (Mark, 2026-08-01, spotting a yellow selected cell on Inventory:
 * "highlighted yellow instead of black like everywhere else"). The last-ordered
 * age buckets carried a yellow selected fill over from the chip dialect this
 * replaced — the argument being that a stale filter left on hides everything
 * fresh, so it was worth a mark. Two things outrank that: one control has one
 * selected state or it isn't one control, and the design system reserves colour
 * for record STATE, which a filter is not — a filter is view state, and how
 * much it's hiding is already said by the "401 of 790" count in the header.
 *
 * Options:
 * - `count` puts the option's row count beside its label, dimmed and tabular —
 *   the guide's tier style.
 * - `href` renders the cell as a Link instead of a button (the guide's day
 *   picker navigates; everything else sets state).
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
};

export function TabPicker<K extends string>({
  options,
  value,
  onChange,
  size = "md",
  stretch = false,
  ariaLabel,
  className = "",
}: {
  options: readonly TabPickerOption<K>[];
  value: K;
  /** Omit only when every option carries an href. */
  onChange?: (key: K) => void;
  size?: "md" | "sm";
  /**
   * Fill the container's width, dividing it evenly between the cells, instead
   * of sizing to the labels. For a bar that has to line up with the controls
   * above it (Mark, 2026-08-01, on the vendor's item filters) — put it in a
   * `w-fit` wrapper alongside those controls and the wrapper takes the widest
   * row's width, which this then matches exactly.
   */
  stretch?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const cell = size === "sm" ? "px-3 text-[11px]" : "px-4 text-[12px]";
  // CLASSIC MAC TABS (Mark, 2026-09-12: "the active tab should be white with
  // black text, the inactive tabs should be grey … the active tab should be 4px
  // taller than the inactive tabs"). The SELECTED tab keeps the control's old
  // full height and the others are 4px SHORTER, bottom-aligned — so the
  // footprint is unchanged and no filter row anywhere moves.
  const tall = size === "sm" ? "h-8" : "h-9";
  // 8px shorter since the same day (Mark: "make it 8px taller than the
  // inactive tabs"), and the selected tab has NO BOTTOM BORDER — it opens onto
  // whatever sits below it, the way a Mac tab joins its panel.
  const short = size === "sm" ? "h-6" : "h-7";

  return (
    <span
      role="group"
      aria-label={ariaLabel}
      // `flex-1`, not `w-fit`, since the rule below (Mark, 2026-09-12: "a 1px
      // line under the whole row that stops under the selected tab"): the
      // control now claims the rest of its row so the rule can run to the edge.
      // In a flex row `flex-1` takes only the leftover space, so nothing beside
      // it is pushed onto another line; in a block parent a `flex` box already
      // fills the width. An `ml-auto` sibling still wins the space first.
      className={`flex ${tall} ${stretch ? "w-full" : "min-w-0 flex-1"} items-end ${className}`}
    >
      {options.map((o, i) => {
        const on = o.key === value;
        // whitespace-nowrap: a cell label is a name, never a paragraph. It
        // only bites when stretched — equal shares made "Never ordered" wrap to
        // two lines inside a 36px bar — but a wrapped tab is wrong everywhere,
        // and with nowrap a flex cell can't shrink below its own label, so the
        // shares come out as-equal-as-the-words-allow instead.
        //
        // Each tab is its OWN box now, the neighbours overlapping by one pixel
        // (`-ml-px`) so a shared edge is one rule, not two. The selected tab
        // sits above its neighbours (`z-10`) so its full-height border is the
        // one you see. Hover is the Mac look's 2px edge, drawn inset so
        // nothing grows — never a fill, since grey already means unselected.
        const cls = `relative inline-flex ${on ? `${tall} z-10 border-b-0 bg-white` : `${short} bg-[#c0c0c0] hover:shadow-[inset_0_0_0_1px_#000]`} items-center gap-2 whitespace-nowrap border border-ink ${cell} font-semibold uppercase tracking-[0.06em] text-ink no-underline ${
          // Equal shares, centred — a stretched bar whose cells were sized by
          // their labels would put "Never ordered" three times the width of
          // "2+ years" and read as a mistake.
          stretch ? "flex-1 justify-center" : ""
        } ${i > 0 ? "-ml-px" : ""}`;
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
      {/* THE RULE: the grey tabs' own bottom borders carry it under the tabs,
          the selected tab leaves the gap, and this runs it on to the edge. A
          stretched bar has no leftover width, so it needs none. */}
      {stretch ? null : <span aria-hidden className="min-w-0 flex-1 border-b border-ink" />}
    </span>
  );
}
