"use client";

import type { PointerEvent, ReactNode } from "react";
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
   * the sort click — see lib/columnOrder's threshold.
   */
  onDragStart?: (event: PointerEvent) => void;
  /** This column is the one being dragged — dim it while its ghost travels. */
  dragSource?: boolean;
  /** Replaces the sort button — used for the select-all checkbox column. */
  children?: ReactNode;
}) {
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
          onDragStart
            ? (e) => {
                if ((e.target as Element).closest("[data-resize-grip]")) return;
                onDragStart(e);
              }
            : undefined
        }
        className={`relative flex items-center px-3 py-3 ${
          align === "right" ? "justify-end" : ""
        } ${onDragStart ? "touch-pan-y" : ""} ${dragSource ? "opacity-40" : ""}`}
      >
        {children ??
          (onSort ? (
            <button
              type="button"
              onClick={onSort}
              title={`Sort by ${label.toLowerCase()}${
                onDragStart ? " · drag sideways to move the column" : ""
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
              title={onDragStart ? "Drag sideways to move the column" : undefined}
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
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 flex items-center text-[8px] ${
            align === "right" ? "left-1" : "right-1"
          } ${sorted ? "text-ink" : "text-neutral-300"}`}
        >
          {arrow || "↕"}
        </span>

        {/* Resize grip: a visible divider on every column boundary so it's
            discoverable at rest, with a hit area wider than the line itself and
            straddling the boundary. `group` drives the line's hover state. */}
        <span
          data-resize-grip
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label || "select"} column`}
          title="Drag to resize · double-click to reset this column"
          className="group absolute inset-y-0 right-0 z-10 flex w-3 translate-x-1/2 cursor-col-resize touch-none select-none justify-center"
        >
          <span className="w-px self-stretch bg-neutral-200 transition-colors group-hover:w-0.5 group-hover:bg-ink" />
        </span>
      </div>
    </th>
  );
}
