"use client";

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { makeComparator, nextSortDir, type SortDir, type SortValue } from "@/lib/tableSort";
import { useResizableColumns, type ColumnWidths } from "@/lib/columnWidths";
import { useColumnVisibility } from "@/lib/columnVisibility";
import {
  applyColumnOrder,
  isMovableColumn,
  movedColumnOrder,
  useColumnDrag,
  useColumnOrder,
  type ColumnDropTarget,
} from "@/lib/columnOrder";
import { useScrollMemory } from "@/lib/scrollMemory";
import {
  STICKY_HEAD_ROW,
  STICKY_HEAD_ROW_IN_PANE,
  useOverflowOnlyWhenNeeded,
  useViewportAtLeast,
} from "@/lib/tableHead";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnsMenu } from "./ColumnsMenu";

export type DataColumn<T> = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  /** Omit to make the column unsortable (e.g. a control column). */
  sortValue?: (row: T) => SortValue;
  /**
   * Applied in order when `sortValue` ties, never overriding the chosen
   * column. For a column with few distinct values — a category, a status —
   * the primary sort alone leaves the rows inside each group in whatever
   * order they arrived, which reads as unsorted.
   */
  sortTiebreaks?: ((row: T) => string)[];
  render: (row: T) => ReactNode;
  /** Cells truncate by default; opt out for cells that need to wrap. */
  wrap?: boolean;
  /**
   * Replaces the header's sort button with a control — the select-all checkbox
   * on a selection column, which has no label and nothing to sort by.
   */
  header?: ReactNode;
  /**
   * Drop this column when the table is compact — see DataTable's
   * `compactBelow`. For the reference data you'd read at a desk but not while
   * standing in the shop; it's still on the record's own screen.
   */
  hideWhenCompact?: boolean;
  /**
   * Keep this column out of the Columns menu, so the reader can't hide it.
   *
   * For the column that IS the row — the item's name, the PO number — and for
   * control columns (select-all, the ⋯ menu), which carry no label to offer
   * anyway. Everything else is the reader's business.
   */
  pinned?: boolean;
};

/**
 * Turns a sorted list into a grouped report: a full-width band before each run
 * of rows sharing a label, with the size of the run.
 *
 * The CALLER decides whether grouping applies — pass `undefined` and there are
 * no bands. That's because it only makes sense on a column with repeated values
 * (a category, a section, a type), so both lists that use it switch it on only
 * when the sort is one of those columns.
 *
 * It assumes the rows arrive already grouped, which follows from them being
 * sorted by the same column. A caller sorting by something else while grouping
 * by a category would get a band every few rows — correct, and a sign the two
 * are out of step.
 */
export type DataGroup<T> = { label: (row: T) => string };

/**
 * The standard list table: sortable headers, drag-resizable columns persisted
 * per table, and column labels that stick under the masthead as you scroll.
 * Every list in the app uses this so the behaviour is identical everywhere and
 * lives in one place.
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
  group,
  compactBelow,
  sort: controlledSort,
  onSortChange,
  columnChooser = false,
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
  /** Band rows before each run of like-labelled rows. See DataGroup. */
  group?: DataGroup<T>;
  /**
   * Below this viewport width, drop every column marked `hideWhenCompact`.
   *
   * This is what makes the sticky column labels work on a tablet, and the
   * reason is worth stating: a sticky cell inside an `overflow-x: auto` box
   * pins to that box, which never scrolls vertically, so a table that has to
   * scroll sideways cannot have a sticky header (see useOverflowOnlyWhenNeeded).
   * Shedding columns until the table FITS is the only fix that also stops you
   * swiping sideways to read a row — and it's what the order guide has always
   * done, dropping its Line column below 880.
   *
   * Set it to the narrowest width at which the FULL set still fits, so nothing
   * is hidden while there's room for it. Omit for a table narrow enough
   * everywhere, or one on a detail screen.
   */
  compactBelow?: number;
  /**
   * Controlled sort, for screens that persist it in the URL. Pass both or
   * neither: with `onSortChange` the caller owns the sort (and the ordering of
   * `rows`), otherwise the table sorts itself. Two sources of truth here was a
   * real bug — the header arrow and the URL disagreeing about the order.
   */
  sort?: { key: string; dir: SortDir } | null;
  onSortChange?: (next: { key: string; dir: SortDir }) => void;
  /**
   * Show the columns chooser above the table's right edge — for a LIST, the
   * screen whose table is the point. Off by default so the tables embedded in
   * detail screens (a vendor's items, an item's locations) don't each sprout a
   * control for four columns.
   */
  columnChooser?: boolean;
}) {
  const defaultWidths = useMemo<ColumnWidths>(
    () => Object.fromEntries(columns.map((c) => [c.key, c.width])),
    [columns]
  );

  const { widths, startResize, setWidth, reset, customized } =
    useResizableColumns(storageKey, defaultWidths);

  // A table in `scroll` mode is the one list the page's own scroll memory can't
  // see: the rows move inside this pane and the window never moves at all. Its
  // key is the path plus the widths key, which is already this table's identity
  // — so a paned table remembers its place with no caller changes, and every
  // future one does too. Unpaned tables pass an empty key, which is a no-op.
  const paneRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useScrollMemory(scroll ? `pane:${pathname}:${storageKey}` : "", paneRef);
  // Only the unpaned case: a pane is a scroll container on purpose, and its
  // header sticks to the pane rather than to the masthead.
  useOverflowOnlyWhenNeeded(paneRef, !scroll);

  // COMPACT: below `compactBelow` the marked columns come out, so the table
  // narrows enough to fit — which is what lets its labels stick. A threshold of
  // 0 always matches, so a table without a compact set still calls the hook.
  const wide = useViewportAtLeast(compactBelow ?? 0);
  const compact = compactBelow !== undefined && !wide;
  // Two independent reasons a column can be absent, and they compose: the
  // window is too narrow for it (compact), or the reader has unchecked it in
  // the Columns menu (lib/columnVisibility, keyed by this same storageKey, so a
  // table gets this by having a key rather than by opting in).
  const { hidden } = useColumnVisibility(storageKey);
  // WHERE the columns sit is the reader's too (lib/columnOrder, same key):
  // drag a header sideways to move it. Order is applied before the visibility
  // filters so all three compose — the compact set still sheds, your unchecked
  // columns still come out, and what's left stands where you put it.
  const { stored: storedOrder, setOrder, resetOrder, customized: orderCustomized } =
    useColumnOrder(storageKey);
  const orderedColumns = useMemo(
    () => applyColumnOrder(columns, storedOrder),
    [columns, storedOrder]
  );
  const visibleColumns = orderedColumns.filter(
    (col) =>
      !(compact && col.hideWhenCompact) && !(hidden.has(col.key) && !col.pinned)
  );

  // The drag writes through the FULL movable order (hidden columns keep their
  // places); the drop target always names a VISIBLE column, so the anchor is
  // present in both.
  const headRowRef = useRef<HTMLTableRowElement>(null);
  const { dragging, startColumnDrag, indicatorRef, chipRef } = useColumnDrag({
    headRowRef,
    onDrop: (dragKey: string, target: ColumnDropTarget) => {
      const movableKeys = orderedColumns.filter(isMovableColumn).map((c) => c.key);
      setOrder(movedColumnOrder(movableKeys, dragKey, target));
    },
  });
  const dragSlots = visibleColumns.map((c) => ({
    key: c.key,
    movable: isMovableColumn(c),
  }));
  const movableVisible = dragSlots.filter((s) => s.movable).length;

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
    return [...rows].sort(
      makeComparator<T>({ value, dir: sort.dir, tiebreaks: column.sortTiebreaks })
    );
  }, [rows, columns, sort, controlled]);

  // How many rows sit under each band. Recomputed whenever the order changes,
  // which is cheap even on Inventory's 790 rows and keeps the count honest when
  // a filter narrows the list.
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (group) {
      for (const row of sorted) {
        const label = group.label(row);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return counts;
  }, [sorted, group]);

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

  // FLUID COLUMNS. The table is exactly as wide as its container and the
  // columns divide that width in the PROPORTIONS their pixel widths describe.
  // A wide screen gets wider columns instead of dead space; a narrow one
  // squeezes instead of growing a horizontal scrollbar. And because the table
  // can never be wider than the box it sits in, the sticky column labels always
  // work — pixel widths plus hand-picked breakpoints were what made this feel
  // "old school html" (Mark, 2026-07-31), and they had left the PO list a 6px
  // margin that a visible scrollbar was enough to eat.
  //
  // PURE PERCENTAGES, never a calc mixing % and px. A <col> width like
  // `calc((100% - 95px) * 0.22)` is DISCARDED — measured 2026-07-31: the eight
  // vendor columns all collapsed to an equal 163px share, while the same shares
  // written as `calc(100% * 0.22)` resolved correctly. So a column can't be held
  // at a fixed pixel width while its neighbours flex; everything scales, which
  // is also why a control column just needs a share generous enough to stay
  // usable at the narrowest width it will meet.
  const naturalTotal = visibleColumns.reduce(
    (sum, col) => sum + (widths[col.key] ?? col.width),
    0
  );

  const colWidth = (col: DataColumn<T>) => {
    const w = widths[col.key] ?? col.width;
    if (naturalTotal <= 0) return `${w}px`;
    return `${((w / naturalTotal) * 100).toFixed(4)}%`;
  };

  return (
    <div className="space-y-1">
      {/* Directly above the LAST column header, at the table's right edge
          (Mark, 2026-07-31). It belongs to the table, not to each list's filter
          row: it acts on these columns, and every list putting it somewhere
          slightly different is how you end up hunting for it.

          It is the only thing on this strip. A `tools` slot lived here for one
          commit, holding the PO list's select-all opposite the chooser; that
          checkbox belongs in the selection column's `header` cell, where every
          list's has always gone, so the slot went with it rather than staying
          as a second way to do the same thing. */}
      {columnChooser && (
        <div className="flex justify-end">
          {/* The ordered list, not the declared one — the checklist reads in
              the same order as the table it acts on. */}
          <ColumnsMenu storageKey={storageKey} columns={orderedColumns} />
        </div>
      )}
      <div ref={paneRef} className={wrapper}>
        {/* 13px on a tablet, 15 at a desk (Mark, 2026-07-31) — the row has
            less width to give at the small end, and smaller type buys back
            more of it than any column tuning does. */}
        <table className="w-full table-fixed border-collapse text-[13px] xl:text-[15px]">
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col.key} style={{ width: colWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            {/* The column labels stick: under the masthead for a table in the
                page's own flow, at the top of the pane for one that scrolls
                inside itself. See lib/tableHead for both, and for why the
                wrapper's overflow has to get out of the way. */}
            <tr
              ref={headRowRef}
              className={`text-left ${scroll ? STICKY_HEAD_ROW_IN_PANE : STICKY_HEAD_ROW}`}
            >
              {visibleColumns.map((col) => (
                <ColumnHeader
                  key={col.key}
                  label={col.label}
                  align={col.align}
                  sorted={sort?.key === col.key ? sort.dir : false}
                  onSort={col.sortValue ? () => toggleSort(col.key) : undefined}
                  onResizeStart={(e) => startResize(e, col.key)}
                  onResizeReset={() => setWidth(col.key, col.width)}
                  onDragStart={
                    movableVisible > 1 && isMovableColumn(col)
                      ? (e) =>
                          startColumnDrag(e, { key: col.key, label: col.label }, dragSlots)
                      : undefined
                  }
                  dragSource={dragging?.key === col.key}
                >
                  {col.header}
                </ColumnHeader>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const key = rowKey(row);
              const expandable = expand !== undefined && (expand.canExpand?.(row) ?? true);
              const isOpen = expandable && open.has(key);

              // A band opens each new run. Comparing with the PREVIOUS row's
              // label rather than tracking a running value keeps this a pure
              // function of the sorted array.
              const label = group ? group.label(row) : null;
              const startsGroup =
                label !== null &&
                (index === 0 || group!.label(sorted[index - 1]) !== label);

              return (
                <Fragment key={key}>
                  {startsGroup && (
                    <tr className="border-b border-hairline bg-neutral-100">
                      <td
                        colSpan={visibleColumns.length}
                        className="px-2 py-1 text-xs font-semibold tracking-[0.12em] text-body uppercase"
                      >
                        {label}
                        <span className="ml-2 font-normal tracking-normal text-subtle normal-case">
                          {groupCounts.get(label) ?? 0}
                        </span>
                      </td>
                    </tr>
                  )}
                  {/* No rule between rows (Mark, 2026-07-25) — the hover wash
                      carries the eye across the width instead. */}
                  <tr
                    className={`hover:bg-neutral-50 ${rowClassName?.(row) ?? ""}`}
                  >
                    {visibleColumns.map((col, index) => {
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
                          className={`h-14 px-3 py-4 xl:px-4 ${col.wrap ? "" : "truncate"} ${
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
                      <td colSpan={visibleColumns.length} className="px-4 py-5">
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

      {(customized || orderCustomized) && (
        <div className="flex justify-end gap-4">
          {orderCustomized && (
            <button
              onClick={resetOrder}
              title="Restore the default column order"
              className="text-[12px] uppercase tracking-[0.12em] text-subtle hover:underline"
            >
              Reset column order
            </button>
          )}
          {customized && (
            <button
              onClick={reset}
              title="Restore the default column widths"
              className="text-[12px] uppercase tracking-[0.12em] text-subtle hover:underline"
            >
              Reset column widths
            </button>
          )}
        </div>
      )}

      {/* The drag overlay: the drop line down the table's on-screen height and
          a chip naming what's in hand. Portalled to the body — a fixed element
          inside the table would still be clipped by a transformed ancestor —
          and pointer-events-none so neither can swallow the pointerup. The
          per-move positions are written through the refs (lib/columnOrder), so
          nothing here re-renders while the pointer moves. */}
      {dragging &&
        createPortal(
          <>
            <div
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none fixed z-50 w-0.5 bg-ink"
              style={{
                top: dragging.tableTop,
                height: dragging.tableHeight,
                display: "none",
              }}
            />
            <div
              ref={chipRef}
              aria-hidden
              className="pointer-events-none fixed z-50 border-2 border-ink bg-white px-2 py-1 text-[11px] font-semibold whitespace-nowrap uppercase tracking-[0.12em] text-ink"
              style={{
                left: dragging.x,
                top: dragging.y,
                // Above the finger — which is covering the drop area — but
                // beside a mouse pointer, which isn't.
                transform: dragging.touch
                  ? "translate(-50%, calc(-100% - 16px))"
                  : "translate(14px, 18px)",
              }}
            >
              {dragging.label}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
