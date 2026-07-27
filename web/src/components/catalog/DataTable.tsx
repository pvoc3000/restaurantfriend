"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { makeComparator, nextSortDir, type SortDir, type SortValue } from "@/lib/tableSort";
import { useResizableColumns, type ColumnWidths } from "@/lib/columnWidths";
import { ColumnHeader } from "./ColumnHeader";

export type DataColumn<T> = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  /** Omit to make the column unsortable (e.g. a control column). */
  sortValue?: (row: T) => SortValue;
  render: (row: T) => ReactNode;
  /** Cells truncate by default; opt out for cells that need to wrap. */
  wrap?: boolean;
};

/**
 * The standard list table: sortable headers, drag-resizable columns persisted
 * per table, optional scroll pane with a sticky header. Every list in the app
 * uses this so the behaviour is identical everywhere and lives in one place.
 *
 * Sort state is local rather than in the URL — these tables are usually one of
 * several on a detail screen, and they'd collide over the same query params.
 * The big list screens (Inventory, Vendors) keep URL-persisted sort because
 * there the sort IS the view; they share the same primitives underneath.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  defaultSort,
  rowClassName,
  scroll = false,
  maxHeightClass,
  empty,
  expand,
  sort: controlledSort,
  onSortChange,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  /** localStorage key for this table's column widths. */
  storageKey: string;
  defaultSort?: { key: string; dir?: SortDir };
  rowClassName?: (row: T) => string;
  scroll?: boolean;
  maxHeightClass?: string;
  empty?: ReactNode;
  /**
   * Makes rows expandable: a chevron joins the first cell, and `render` fills a
   * full-width panel below the row. `summary` shows what's inside without
   * opening it — a disclosure that looks identical on every row tells you
   * nothing about which ones are worth a click.
   */
  expand?: {
    render: (row: T) => ReactNode;
    summary?: (row: T) => ReactNode;
    canExpand?: (row: T) => boolean;
  };
  /**
   * Controlled sort, for screens that persist it in the URL. Pass both or
   * neither: with `onSortChange` the caller owns the sort (and the ordering of
   * `rows`), otherwise the table sorts itself. Two sources of truth here was a
   * real bug — the header arrow and the URL disagreeing about the order.
   */
  sort?: { key: string; dir: SortDir } | null;
  onSortChange?: (next: { key: string; dir: SortDir }) => void;
}) {
  const defaultWidths = useMemo<ColumnWidths>(
    () => Object.fromEntries(columns.map((c) => [c.key, c.width])),
    [columns]
  );

  const { widths, startResize, setWidth, reset, customized, totalWidth } =
    useResizableColumns(storageKey, defaultWidths);

  const [internalSort, setInternalSort] = useState<{ key: string; dir: SortDir } | null>(
    defaultSort ? { key: defaultSort.key, dir: defaultSort.dir ?? "asc" } : null
  );
  const controlled = onSortChange !== undefined;
  const sort = controlled ? controlledSort ?? null : internalSort;
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // When the caller owns the sort it has already ordered `rows`; re-sorting
  // here would fight it (and lose its tiebreaks).
  const sorted = useMemo(() => {
    if (controlled || !sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort(makeComparator<T>({ value, dir: sort.dir }));
  }, [rows, columns, sort, controlled]);

  if (rows.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  function toggleSort(key: string) {
    const next = { key, dir: nextSortDir(sort?.key === key, sort?.dir ?? "asc") };
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
  }

  // No outer box: the header's 2px black rule and the row hairlines are the
  // only structure a table gets.
  const wrapper = scroll
    ? `${maxHeightClass ?? "max-h-[calc(100vh-27rem)]"} min-h-64 overflow-auto`
    : "overflow-x-auto";

  return (
    <div className="space-y-1">
      <div className={wrapper}>
        <table
          className="table-fixed border-collapse text-[15px]"
          style={{ width: totalWidth(columns) }}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: widths[col.key] ?? col.width }} />
            ))}
          </colgroup>
          <thead className={scroll ? "sticky top-0 z-10 bg-white" : ""}>
            {/* The 2px rule under every table head, drawn as an inset shadow
                because a sticky row inside border-collapse loses its bottom
                border as it detaches. Same rule in both cases so sticky and
                static tables read identically. */}
            <tr className="text-left [&>th]:shadow-[inset_0_-2px_0_var(--rf-neutral-900)]">
              {columns.map((col) => (
                <ColumnHeader
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  sorted={sort?.key === col.key ? sort.dir : false}
                  onSort={col.sortValue ? () => toggleSort(col.key) : undefined}
                  onResizeStart={(e) => startResize(e, col.key)}
                  onResizeReset={() => setWidth(col.key, col.width)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row);
              const expandable = expand !== undefined && (expand.canExpand?.(row) ?? true);
              const isOpen = expandable && open.has(key);

              return (
                <Fragment key={key}>
                  {/* No rule between rows (Mark, 2026-07-25) — the hover wash
                      carries the eye across the width instead. */}
                  <tr
                    className={`hover:bg-neutral-50 ${rowClassName?.(row) ?? ""}`}
                  >
                    {columns.map((col, index) => {
                      const cell = col.render(row);
                      // The chevron and summary ride in the first cell so the
                      // disclosure reads as part of the row's identity rather
                      // than as another column.
                      const content =
                        index === 0 && expand ? (
                          <span className="flex min-w-0 items-center gap-3">
                            {expandable ? (
                              // A bordered box rather than a bare glyph: it
                              // reads as a control at a glance and gives a
                              // real click target. Filled black when open.
                              <button
                                type="button"
                                onClick={() => toggleOpen(key)}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? "Collapse row" : "Expand row"}
                                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center border-[1.5px] border-ink text-[9px] leading-none transition-colors ${
                                  isOpen ? "bg-ink text-white" : "bg-white text-ink"
                                }`}
                              >
                                {isOpen ? "▼" : "▶"}
                              </button>
                            ) : (
                              <span aria-hidden className="w-[22px] shrink-0" />
                            )}
                            <span className="min-w-0 shrink-0 truncate">{cell}</span>
                            {/* A summary that returns nothing renders nothing —
                                no placeholder eating the row's width. */}
                            {expand.summary?.(row) && (
                              <span className="min-w-0 truncate text-xs text-faint">
                                {expand.summary(row)}
                              </span>
                            )}
                          </span>
                        ) : (
                          cell
                        );

                      return (
                        <td
                          key={col.key}
                          className={`h-14 px-4 py-4 ${col.wrap ? "" : "truncate"} ${
                            col.align === "right" ? "text-right tabular-nums" : ""
                          }`}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>

                  {isOpen && expand && (
                    <tr className="border-b border-hairline bg-neutral-50">
                      <td colSpan={columns.length} className="px-4 py-5">
                        {expand.render(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {customized && (
        <div className="text-right">
          <button
            onClick={reset}
            title="Restore the default column widths"
            className="text-[12px] uppercase tracking-[0.12em] text-subtle hover:underline"
          >
            Reset column widths
          </button>
        </div>
      )}
    </div>
  );
}
