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
  children,
}: {
  label: string;
  align?: "left" | "right";
  /** The direction if this is the active sort column, otherwise false. */
  sorted: SortDir | false;
  onSort?: () => void;
  onResizeStart: (event: PointerEvent) => void;
  onResizeReset: () => void;
  /** Replaces the sort button — used for the select-all checkbox column. */
  children?: ReactNode;
}) {
  const arrow = sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "";

  return (
    <th
      // p-0 on the cell, padding on the inner div, so the grip can sit exactly
      // on the column boundary instead of inside the padding.
      className="p-0 font-medium"
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}
    >
      <div
        className={`relative flex items-center px-2 py-1 ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {children ??
          (onSort ? (
            <button
              type="button"
              onClick={onSort}
              title={`Sort by ${label.toLowerCase()}`}
              className={`inline-flex max-w-full items-center gap-1 rounded px-1 hover:bg-neutral-100 ${
                sorted ? "font-semibold text-neutral-900" : ""
              }`}
            >
              <span className="truncate">{label}</span>
              {/* Reserve the arrow's width so headers don't jump when sort moves. */}
              <span className={`w-3 shrink-0 text-xs ${sorted ? "" : "text-neutral-300"}`}>
                {arrow || "↕"}
              </span>
            </button>
          ) : (
            <span className="truncate px-1">{label}</span>
          ))}

        {/* Resize grip: a visible divider on every column boundary so it's
            discoverable at rest, with a hit area wider than the line itself and
            straddling the boundary. `group` drives the line's hover state. */}
        <span
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label || "select"} column`}
          title="Drag to resize · double-click to reset this column"
          className="group absolute inset-y-0 right-0 z-10 flex w-3 translate-x-1/2 cursor-col-resize touch-none select-none justify-center"
        >
          <span className="w-px self-stretch bg-neutral-300 transition-colors group-hover:w-0.5 group-hover:bg-blue-500" />
        </span>
      </div>
    </th>
  );
}
