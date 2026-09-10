"use client";

import type { PointerEvent, ReactNode } from "react";
import { useShell } from "@/components/ShellProvider";
import type { SortDir } from "@/lib/tableSort";

/**
 * One header cell for the list screens: a sort button plus a drag-to-resize
 * grip. Shared so both tables behave identically — including the WebKit fix.
 *
 * The positioning context is the inner DIV, not the <th>: under border-collapse
 * WebKit doesn't make a table cell a containing block, so a grip anchored to the
 * <th> escapes to the table and vanishes in Safari while looking fine in Chrome.
 *
 * A LABEL WRAPS RATHER THAN TRUNCATING (Mark, 2026-08-02: the titles clip "even
 * when it appears there is plenty of room"). There WAS room — in the cell, not
 * in the label's share of it. Measured on PO detail at 1440: the Product ID
 * header is 113px wide and the label got 57 of it. The other 56 went on the
 * cell's padding (32), the sort button's own padding (8), a gap (4) and the
 * sort arrow's reserved width (12) — while the BODY cell below spends only its
 * 32. The header was working with 24px less room than the data it labels, which
 * is exactly why a column can look roomy and still clip its title.
 *
 * Four changes, and none of them alone was enough:
 *
 *   - The button's `px-1` is gone (8px). It also meant the label started 20px
 *     into the cell while the values below started at 16 — a 4px kink in every
 *     column. The hover wash now sits flush to the text.
 *   - The sort marker moved OUT of the label's line into the cell's padding
 *     (16px), where it costs the label nothing and still never jumps.
 *   - Cell padding is `px-3` at every width, header and body alike (8px). The
 *     `xl:px-4` step was air a dense table can't afford (Mark's own suggestion).
 *   - Wrapping. `table-fixed` means a wrapped label can't widen its column — it
 *     takes a second line and the head row grows to the tallest. Truncation was
 *     never buying layout safety here, only silence: "LINE TOT…" tells you less
 *     than two short lines do.
 *
 * Together that turns 57px of label room into 89 on the same column. What
 * remains is the honest case: a SINGLE word wider than its whole column. That
 * one is clipped with an ellipsis rather than split — measured at 834px, the PO
 * list's Files column rendered "FILE/S", which reads as a rendering fault where
 * "FILE…" reads as "there's more". If you see one, the column is too narrow for
 * its name: widen the weight or shorten the label.
 *
 * ON A TABLET (Mark, 2026-09-10: "how can we make it easier to resize columns
 * on a tablet? I struggle to get it"), two things change, both keyed on the
 * SHELL rather than the pointer, like everything else the tablet does:
 *
 *   - THE GRIP IS FINGER-SIZED. The desk's is a 12px strip centred on a 1px
 *     line — fine for a cursor, and a finger needs about 44. On a tablet the
 *     strip is 40px, capped at half the cell (`max-w-[50%]`) so a narrow column
 *     keeps most of its heading for sorting. THE LINE STAYS 1px: a 6px handle
 *     drawn on it was tried and read as thick dividers (Mark, the same day), so
 *     the target grew and the mark did not.
 *   - NO DRAG-TO-REORDER. A sideways drag from anywhere else in the header
 *     picked the column up, so a touch that just missed the grip moved the
 *     column instead of resizing it — the near-miss was the whole problem.
 *     Reordering is rare enough on an iPad to give up; it stays on the desk.
 */
export function ColumnHeader({
  label,
  align = "left",
  sorted,
  onSort,
  onResizeStart,
  onResizeReset,
  onDragStart,
  dragSource = false,
  children,
}: {
  label: string;
  align?: "left" | "right";
  /** The direction if this is the active sort column, otherwise false. */
  sorted: SortDir | false;
  onSort?: () => void;
  onResizeStart: (event: PointerEvent) => void;
  onResizeReset: () => void;
  /**
   * Makes the column movable: a sideways drag from anywhere in the header
   * (except the resize grip) picks it up. A press that doesn't travel is still
   * the sort click — see lib/columnOrder's threshold. Ignored on a tablet.
   */
  onDragStart?: (event: PointerEvent) => void;
  /** This column is the one being dragged — dim it while its ghost travels. */
  dragSource?: boolean;
  /** Replaces the sort button — used for the select-all checkbox column. */
  children?: ReactNode;
}) {
  const tablet = useShell() === "tablet";
  // No reordering on a tablet — see the header.
  const dragStart = tablet ? undefined : onDragStart;
  const arrow = sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "";

  return (
    <th
      // p-0 on the cell, padding on the inner div, so the grip can sit exactly
      // on the column boundary instead of inside the padding.
      className="p-0 text-[11px] font-normal uppercase tracking-[0.08em] xl:text-[12px] xl:tracking-[0.12em]"
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}
    >
      <div
        // touch-pan-y, not touch-none: vertical pans stay the browser's (the
        // header is sticky at the top of a list you scroll), horizontal ones
        // reach the drag as pointer moves instead of being taken for a scroll.
        onPointerDown={
          dragStart
            ? (e) => {
                if ((e.target as Element).closest("[data-resize-grip]")) return;
                dragStart(e);
              }
            : undefined
        }
        className={`relative flex items-center px-3 py-3 ${
          align === "right" ? "justify-end" : ""
        } ${dragStart ? "touch-pan-y" : ""} ${dragSource ? "opacity-40" : ""}`}
      >
        {children ??
          (onSort ? (
            <button
              type="button"
              onClick={onSort}
              title={`Sort by ${label.toLowerCase()}${
                dragStart ? " · drag sideways to move the column" : ""
              }`}
              // The wrapped lines take the COLUMN's alignment, or a two-line
              // label over a money column would sit ragged against the edge its
              // figures line up on.
              className={`block max-w-full uppercase tracking-[0.12em] hover:bg-neutral-100 ${
                align === "right" ? "text-right" : "text-left"
              } ${sorted ? "font-semibold text-ink" : "text-subtle"}`}
            >
              {/* Wraps at spaces. A single word too wide for its whole column
                  is CLIPPED WITH AN ELLIPSIS rather than split — "FILE/S" on a
                  narrow Files column reads worse than "FILE…", and a break
                  mid-word looks like a rendering fault where an ellipsis reads
                  as "there's more". */}
              <span className="block overflow-hidden text-ellipsis">{label}</span>
            </button>
          ) : (
            <span
              title={dragStart ? "Drag sideways to move the column" : undefined}
              className="block overflow-hidden text-ellipsis text-subtle"
            >
              {label}
            </span>
          ))}

        {/* The sort marker sits in the cell's PADDING, not in the label's line —
            it was `w-3` plus a `gap-1` inside the button, so every header gave
            16px to a glyph 8px wide and the label wrapped mid-word to pay for
            it ("PRODUC/T ID"). Out here it costs the label nothing, and it
            still holds its place whether or not the column is the sorted one,
            so nothing jumps when the sort moves. On the LEADING edge for a
            right-aligned column, where its figures don't reach. */}
        {/* AND ONLY ON A COLUMN YOU CAN ACTUALLY SORT BY. The resting `↕` is a
            promise, and on a column with no `onSort` it is one nothing keeps —
            noticed when the special-order lines table took these headers for
            their resize grips (its order IS the document, so none of its
            columns sorts). It was equally wrong on every control column, which
            has never had an `onSort` either. */}
        {/* AND ONLY ON THE COLUMN THAT IS SORTED (Mark, 2026-09-09: "little up
            and down arrow icons in the table header on columns that aren't
            currently being sorted on. Why? Those can go away"). The resting
            `↕` said "you could sort by this", which every labelled column can,
            so it was a mark on nearly every header saying nothing in
            particular. The one arrow that remains says which column IS sorted
            and which way, which is the fact worth a glyph. Its position is
            absolute, so nothing moves when the sort does. */}
        {onSort && sorted && arrow ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 flex items-center text-[8px] text-ink ${
              align === "right" ? "left-1" : "right-1"
            }`}
          >
            {arrow}
          </span>
        ) : null}

        {/* Resize grip: a visible divider on every column boundary so it's
            discoverable at rest, with a hit area wider than the line itself and
            straddling the boundary. `group` drives the line's hover state.
            On a tablet the hit area is 40px (capped at half the cell) while the
            line stays 1px — see the header. */}
        <span
          data-resize-grip
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label || "select"} column`}
          title={tablet ? "Drag to resize" : "Drag to resize · double-click to reset this column"}
          className={`group absolute inset-y-0 right-0 z-10 flex translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center ${
            tablet ? "w-10 max-w-[50%]" : "w-3"
          }`}
        >
          <span
            // 1px on a tablet too, and no hover thickening there: a tap can
            // leave `:hover` stuck on, which would leave a 2px dark line.
            className={`w-px self-stretch bg-neutral-200 ${
              tablet ? "" : "transition-colors group-hover:w-0.5 group-hover:bg-ink"
            }`}
          />
        </span>
      </div>
    </th>
  );
}
