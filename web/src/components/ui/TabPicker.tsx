"use client";

import { AlertMark } from "@/components/ui/AlertMark";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * The app's one-of-N chooser (Mark, 2026-08-01: the order guide's filter tabs
 * "should be replicated stylistically throughout the app... the default moving
 * forward") — a segmented bar in the guide's style: one box, cells divided by
 * rules. One choice reads as ONE OBJECT rather than a row of loose buttons,
 * which is the reason the guide drew it this way.
 *
 * **SINCE 2026-09-12 THEY ARE CLASSIC MAC TABS** (Mark): the selected tab is
 * WHITE, full height and open at the bottom (no bottom border), the rest
 * 8px shorter and bottom-aligned — GREY (#c0c0c0) with black type, ROUNDED at
 * the top and 4px apart since 2026-11-05 (Mark); black with grey type and a
 * white edge from 2026-09-28 to then, grey before. What follows about a black selected cell is
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
  /** Something on this tab wants reading: a yellow "!" after the label, and
   *  this text for a screen reader (`ui/AlertMark`). */
  alert?: string;
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
  placement = "top",
  heavy = false,
  ariaLabel,
  className = "",
}: {
  options: readonly TabPickerOption<K>[];
  value: K;
  /** Omit only when every option carries an href. */
  onChange?: (key: K) => void;
  size?: "md" | "sm";
  /**
   * Which side of its panel the tabs hang from. "bottom" turns the control
   * upside down — rounded at the bottom, the rule along the TOP, the selected
   * tab open upward into the panel above (Mark, 2026-11-05, for the email
   * compose box: tabs "on the bottom … instead of the top"). Everything else,
   * the colours and the sizes, is the same control.
   */
  placement?: "top" | "bottom";
  /**
   * Tabs that belong to a WINDOW wear its 2px frame, like the email compose box
   * they hang from (Mark, 2026-11-05: "the tab border doesn't match the box
   * border"). NO shadow: they carried one at half the box's offset for a day,
   * and Mark took it off ("remove the drop shadow on the bottom tabs … Keep the
   * 2px borders though").
   */
  heavy?: boolean;
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
  const below = placement === "bottom";
  /** The row's rule: under the tabs, or over them when they hang below. */
  const rule = `${below ? (heavy ? "border-t-2" : "border-t") : heavy ? "border-b-2" : "border-b"} border-ink`;
  const edge = heavy ? "border-2" : "border";
  const hoverEdge = "hover:shadow-[inset_0_0_0_1px_#000]";

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
      className={`flex ${tall} ${stretch ? "w-full" : "min-w-0 flex-1"} ${below ? "items-start" : "items-end"} ${className}`}
    >
      {/* THE LEAD-IN (Mark, 2026-10-16): a short stretch of the rule BEFORE
          the first tab, so the row reads as tabs standing on a line rather
          than as a bar whose line starts at its own edge. Fixed and short — it
          says where the line comes from, and anything longer pushes the first
          tab away from the left edge every filter row shares. Left off a
          stretched bar for the same reason the trailing rule is. */}
      {stretch ? null : <span aria-hidden className={`w-3 shrink-0 ${rule}`} />}
      {options.map((o, i) => {
        const on = o.key === value;
        // whitespace-nowrap: a cell label is a name, never a paragraph. It
        // only bites when stretched — equal shares made "Never ordered" wrap to
        // two lines inside a 36px bar — but a wrapped tab is wrong everywhere,
        // and with nowrap a flex cell can't shrink below its own label, so the
        // shares come out as-equal-as-the-words-allow instead.
        //
        // Each tab is its OWN box, with ROUNDED TOP CORNERS and a 4px gap to
        // its neighbour (Mark, 2026-11-05: "more of a classic mac look …
        // rounded corners … spaced a little further apart"). The gap carries
        // the row's rule (the spacer below), so the tabs still stand on one
        // line. The selected tab sits above (`z-10`). Hover is the Mac look's
        // inset edge, so nothing grows — never a fill, since grey already
        // means unselected.
        //
        // AN UNSELECTED TAB IS GREY WITH BLACK TYPE (#c0c0c0, the Mac look's
        // grey) — again, since 2026-11-05 (Mark: "the inactive tabs being
        // grey instead of black fill"). It was this until 2026-09-28, then
        // black with grey type and a white edge until now.
        const cls = `relative inline-flex ${below ? "rounded-b-[6px]" : "rounded-t-[6px]"} ${on ? `${tall} z-10 border-ink ${below ? "border-t-0" : "border-b-0"} bg-white text-ink` : `${short} border-ink bg-[#c0c0c0] text-ink ${hoverEdge}`} items-center gap-2 whitespace-nowrap ${edge} ${cell} font-semibold uppercase tracking-[0.06em] no-underline ${
          // Equal shares, centred — a stretched bar whose cells were sized by
          // their labels would put "Never ordered" three times the width of
          // "2+ years" and read as a mistake.
          stretch ? "flex-1 justify-center" : ""
        }`;
        const count =
          o.count !== undefined ? (
            // Dimmed on every tab, now that every tab has black type.
            <span className="font-normal tabular-nums opacity-55">{o.count}</span>
          ) : null;

        // THE GAP BETWEEN TABS carries the row's rule, so the line under the
        // row is unbroken except beneath the selected tab.
        const gap = i > 0 ? <span aria-hidden className={`w-1 shrink-0 ${below ? "self-start" : "self-end"} ${rule}`} /> : null;

        return (
          <Fragment key={o.key}>
            {gap}
            {o.href ? (
              <Link href={o.href} title={o.title} aria-current={on ? "page" : undefined} className={cls}>
                {o.label}
                {count}
                {o.alert ? <AlertMark label={o.alert} /> : null}
              </Link>
            ) : (
              <button
                type="button"
                title={o.title}
                aria-pressed={on}
                onClick={() => onChange?.(o.key)}
                className={cls}
              >
                {o.label}
                {count}
                {o.alert ? <AlertMark label={o.alert} /> : null}
              </button>
            )}
          </Fragment>
        );
      })}
      {/* THE RULE: the lead-in above starts it, the grey tabs' own bottom
          borders and the gaps between them carry it under the tabs, the
          selected tab leaves the gap, and this runs it on to the edge. A
          stretched bar has no leftover width, so it needs none. */}
      {stretch ? null : <span aria-hidden className={`min-w-0 flex-1 ${rule}`} />}
    </span>
  );
}
