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
        className={`relative flex items-center px-3 py-3 xl:px-4 ${
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
              className={`inline-flex max-w-full items-center gap-1 px-1 uppercase tracking-[0.12em] hover:bg-neutral-100 ${
                sorted ? "font-semibold text-ink" : "text-subtle"
              }`}
            >
              <span className="truncate">{label}</span>
              {/* Reserve the arrow's width so headers don't jump when sort moves. */}
              <span
                className={`w-3 shrink-0 text-[8px] ${sorted ? "" : "text-neutral-300"}`}
              >
                {arrow || "↕"}
              </span>
            </button>
          ) : (
            <span
              title={onDragStart ? "Drag sideways to move the column" : undefined}
              className="truncate px-1 text-subtle"
            >
              {label}
            </span>
          ))}

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
