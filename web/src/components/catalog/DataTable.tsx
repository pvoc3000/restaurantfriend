"use client";

import { useMemo, useState, type ReactNode } from "react";
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
}) {
  const defaultWidths = useMemo<ColumnWidths>(
    () => Object.fromEntries(columns.map((c) => [c.key, c.width])),
    [columns]
  );

  const { widths, startResize, setWidth, reset, customized, totalWidth } =
    useResizableColumns(storageKey, defaultWidths);

  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(
    defaultSort ? { key: defaultSort.key, dir: defaultSort.dir ?? "asc" } : null
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort(makeComparator<T>({ value, dir: sort.dir }));
  }, [rows, columns, sort]);

  if (rows.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  function toggleSort(key: string) {
    setSort((prev) => ({ key, dir: nextSortDir(prev?.key === key, prev?.dir ?? "asc") }));
  }

  const wrapper = scroll
    ? `${maxHeightClass ?? "max-h-[calc(100vh-27rem)]"} min-h-64 overflow-auto rounded border border-neutral-200`
    : "overflow-x-auto";

  return (
    <div className="space-y-1">
      <div className={wrapper}>
        <table
          className="table-fixed border-collapse text-sm"
          style={{ width: totalWidth(columns) }}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: widths[col.key] ?? col.width }} />
            ))}
          </colgroup>
          <thead className={scroll ? "sticky top-0 z-10 bg-white" : ""}>
            <tr
              className={`text-left text-neutral-600 ${
                scroll
                  ? // A sticky row inside border-collapse loses its bottom
                    // border as it detaches, so draw it as an inset shadow.
                    "[&>th]:shadow-[inset_0_-1px_0_#d4d4d4]"
                  : "border-b border-neutral-300"
              }`}
            >
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
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                  rowClassName?.(row) ?? ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-2 py-1 ${col.wrap ? "" : "truncate"} ${
                      col.align === "right" ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {customized && (
        <div className="text-right">
          <button
            onClick={reset}
            title="Restore the default column widths"
            className="text-xs text-neutral-500 hover:underline"
          >
            Reset column widths
          </button>
        </div>
      )}
    </div>
  );
}
