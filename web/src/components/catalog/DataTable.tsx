"use client";

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { makeComparator, nextSortDir, type SortDir, type SortValue } from "@/lib/tableSort";
import { useResizableColumns, type ColumnWidths } from "@/lib/columnWidths";
import { isColumnVisible, useColumnVisibility } from "@/lib/columnVisibility";
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
  useFillViewportHeight,
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
   * Drop this column BY DEFAULT when the table is compact — see DataTable's
   * `compactBelow`. For the reference data you'd read at a desk but not while
   * standing in the shop; it's still on the record's own screen. A default
   * only: the reader can bring it back from the Columns menu, whose checkbox
   * beats the width tier in both directions (lib/columnVisibility).
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
 * Grouping only makes sense on a column with repeated values — a category, a
 * section, a type — and only while THAT column is the sort, or you get a heading
 * every few rows instead of a break between runs. Two ways to say so:
 *
 *   - The caller decides, passing `undefined` when it doesn't apply. That's what
 *     the lists keeping their sort in the URL do (Inventory, Vendors,
 *     Employees), since they already hold the sort.
 *   - `sortKey`, for a table that leaves its sort to DataTable — the vendor's
 *     items. The caller has no way to know what the sort currently is, so it
 *     names the column and the table decides.
 *
 * Either way the rows must arrive already grouped, which follows from being
 * sorted by the same column.
 *
 * `summary` puts a SUBTOTAL on a closing row beneath each run, above a rule.
 *
 * It first went in the BAND, on the reasoning that the band already exists and
 * a table of 56px rows can't afford an extra row per group. Mark used it and
 * said otherwise (2026-08-05): "subtotals should be trailing the data, not
 * leading in the header band, and the values should align with their columns."
 * He is right, and the alignment is the whole of the argument — a subtotal is a
 * number you check against the column above it, and one rendered as a sentence
 * in the band is a number you have to re-read to place. Trailing also matches
 * how every printed register in this trade sets a total: under the run it sums,
 * not over it.
 *
 * So it returns a map KEYED BY COLUMN KEY rather than a ReactNode. The table
 * renders one cell per visible column and fills it from that map, which is what
 * makes the figures line up automatically and keeps working when the reader
 * hides or reorders a column.
 */
export type DataGroup<T> = {
  label: (row: T) => string;
  sortKey?: string;
  summary?: (rows: T[]) => Record<string, ReactNode>;
};

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
  fill = false,
  maxHeightClass,
  empty,
  expand,
  group,
  compactBelow,
  sort: controlledSort,
  onSortChange,
  columnChooser = false,
  leading,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  /** localStorage key for this table's column widths. */
  storageKey: string;
  defaultSort?: { key: string; dir?: SortDir };
  rowClassName?: (row: T) => string;
  scroll?: boolean;
  /**
   * With `scroll`: fill the parent instead of capping at a height.
   *
   * For a table that is one column of a row sized to the window — invoice
   * detail's lines beside its document — where the answer to "how tall" is
   * "whatever is left", and the parent already knows. The root becomes a flex
   * column and the pane takes the slack, so the column labels stay put and the
   * rows scroll under them.
   *
   * `min-h-0` on both is the load-bearing part: without it a flex child takes
   * its CONTENT height and overflows its parent rather than scrolling — the
   * same trap the receiving screen's lines pane documents.
   */
  fill?: boolean;
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
   *
   * A DEFAULT, not a law (Mark's iPad report, 2026-08-01): the Columns menu
   * shows what this tier dropped and an explicit check brings the column back.
   * Before that, a width-dropped column looked exactly like a setting synced
   * in from another device — missing, "visible" in the menu, untogglable.
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
  /**
   * Content for the strip that runs above the table, to the LEFT of the columns
   * eye — this table's own filters, or its heading.
   *
   * It exists because that strip was otherwise an EMPTY 32px band wherever the
   * chooser was on (Mark, 2026-08-01: the filters should "feel more a part of
   * the datatable... since that's what they work on", and a table's heading
   * "could come closer to the table"). Measured on vendor detail before this:
   * 44px between a heading and its table and 48px between the filters and
   * theirs, of which 32px was the eye's band in both cases — so no amount of
   * margin tuning could close them. Sharing the row removes the band entirely
   * and says something true besides: what's on that strip belongs to this
   * table.
   */
  leading?: ReactNode;
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
  //
  // `rows.length > 0` is load-bearing, not a micro-optimisation. An empty table
  // returns before the pane is rendered at all (see the early return below), so
  // the layout effect measures a NULL ref and gives up — and its deps are only
  // [ref, enabled], so when rows arrive later it never runs again. The wrapper
  // then keeps its pre-JS `overflow-x-auto`, which the last column's resize grip
  // overhangs by 6px, which makes it a scroll container, which pushes the sticky
  // labels 64px DOWN — under the rows they label.
  //
  // Found on /pay-periods, whose default filter is legitimately empty until
  // someone opens a fortnight: land on it, click All, and the header paints over
  // the first row. No existing list defaults to an empty filter, which is the
  // only reason this had never shown. Flipping `enabled` false → true when the
  // first row appears is what re-runs the measurement.
  useOverflowOnlyWhenNeeded(paneRef, !scroll && rows.length > 0);
  // A pane ends where the window does, unless the caller named a height. Same
  // hazard, same guard: a paned table that starts empty would otherwise keep
  // whatever height it first computed against a pane that wasn't there.
  useFillViewportHeight(paneRef, scroll && !maxHeightClass && rows.length > 0);

  // COMPACT: below `compactBelow` the marked columns come out, so the table
  // narrows enough to fit — which is what lets its labels stick. A threshold of
  // 0 always matches, so a table without a compact set still calls the hook.
  const wide = useViewportAtLeast(compactBelow ?? 0);
  const compact = compactBelow !== undefined && !wide;
  // Two reasons a column can be absent — the reader unchecked it, or the
  // window is too narrow for it — and the reader's explicit choice beats the
  // width default in BOTH directions (lib/columnVisibility, keyed by this same
  // storageKey, so a table gets this by having a key rather than by opting in).
  const { hidden, shown } = useColumnVisibility(storageKey);
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
  const visibleColumns = orderedColumns.filter((col) =>
    isColumnVisible(col, compact, hidden, shown)
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
  // A `sortKey` group bands only while that column is the sort. Resolved here
  // rather than at the call site because for an internally-sorted table the
  // caller has no way to know what the sort currently is.
  const banding = group && (!group.sortKey || group.sortKey === sort?.key) ? group : null;

  // The rows under each band, kept rather than just counted — a `summary` needs
  // the run itself to total it, and the count is `.length` of the same thing.
  const groupRows = useMemo(() => {
    const runs = new Map<string, T[]>();
    if (banding) {
      for (const row of sorted) {
        const label = banding.label(row);
        const run = runs.get(label);
        if (run) run.push(row);
        else runs.set(label, [row]);
      }
    }
    return runs;
  }, [sorted, banding]);

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
  //
  // `overflow-x-hidden` on a pane, not `overflow-auto` (Mark, 2026-08-01: "a
  // bottom scroll bar when there shouldn't be"). The columns are fluid — the
  // table is a percentage of the pane and can never exceed it — so a pane has
  // nothing to scroll sideways TO. What it was scrolling to was 6px of nothing:
  // the LAST column's resize grip is `w-3` shifted `translate-x-1/2` so it
  // straddles the column boundary, which on the final column means it hangs 6px
  // past the table's right edge. Measured here: table 1314px in a 1314px pane,
  // scrollWidth 1320. Hiding the axis costs nothing (the grip's outer half is
  // dead space either way) and the pane stays a scroll container for y, so the
  // sticky header still sticks to it.
  //
  // No `min-h-64` either. It existed to stop a pane collapsing, but it's a
  // MINIMUM HEIGHT, so a vendor with one item got a 256px box around a 110px
  // table — 146px of empty pane. The floor belongs on the max-height (the hook
  // refuses to go below 256), not on the height itself: then a short table is
  // as tall as its rows and a long one stops at the window.
  const wrapper = scroll
    ? `${fill ? "min-h-0 flex-1" : maxHeightClass ?? ""} overflow-y-auto overflow-x-hidden`
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
    // space-y-2, not 1 (Mark, 2026-08-01): once the strip above carried real
    // content — a heading, a filter bar — sitting 4px off the column labels it
    // read as crowding them rather than belonging to them. This is the gap
    // between the strip and the table, and between the table and the
    // reset-widths footer.
    <div
      className={
        fill ? "flex h-full min-h-0 flex-col gap-y-2" : "space-y-2"
      }
    >
      {/* Directly above the LAST column header, at the table's right edge
          (Mark, 2026-07-31). It belongs to the table, not to each list's filter
          row: it acts on these columns, and every list putting it somewhere
          slightly different is how you end up hunting for it.

          It is the only thing on this strip. A `tools` slot lived here for one
          commit, holding the PO list's select-all opposite the chooser; that
          checkbox belongs in the selection column's `header` cell, where every
          list's has always gone, so the slot went with it rather than staying
          as a second way to do the same thing. */}
      {(columnChooser || leading) && (
        // `leading` on the left, the eye on the right, one row — and the eye
        // gets a cell of its OWN (Mark, 2026-08-01: "so when the screen gets
        // smaller the other elements wrap but the eye stays in place"). NOT
        // flex-wrap on this row: the leading content is what wraps, inside its
        // own `min-w-0 flex-1` box, so the eye never breaks onto a line of its
        // own and never leaves the table's right edge. Measured before the
        // fix at 1440: the filters overflowed and pushed the eye to a second
        // line, left-aligned, which looked like a stray button.
        // items-end: the eye belongs to the column headers directly beneath it
        // (Mark, 2026-08-01), so it sits at the BOTTOM of the strip — beside
        // the last row of a wrapping filter block, not floating at the top of
        // it.
        <div className="flex items-end justify-between gap-x-4">
          <div className="min-w-0 flex-1">{leading}</div>
          {/* The ordered list, not the declared one — the checklist reads in
              the same order as the table it acts on. It gets `compact` so its
              checkboxes can tell the truth about the width tier. */}
          {columnChooser && (
            // `-mb-1` because `items-end` aligns BOXES and the eye is a 32px
            // button centring a 24px glyph, so its artwork stops 4px short of
            // its own bottom edge. Against a ~20px heading that read as the eye
            // floating above the line rather than sitting on it (Mark,
            // 2026-08-02). Nudging the button rather than shifting the glyph
            // inside it keeps the hover wash centred on the artwork, which is
            // the thing the button's size exists to do.
            <div className="-mb-1 shrink-0">
              <ColumnsMenu storageKey={storageKey} columns={orderedColumns} compact={compact} />
            </div>
          )}
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
              const label = banding ? banding.label(row) : null;
              const startsGroup =
                label !== null &&
                (index === 0 || banding!.label(sorted[index - 1]) !== label);
              // The last row of a run — where the subtotal goes. The final row
              // of the table always ends its run, which is what puts a subtotal
              // under the last group as well as the ones with a band after them.
              const endsGroup =
                label !== null &&
                (index === sorted.length - 1 || banding!.label(sorted[index + 1]) !== label);

              return (
                <Fragment key={key}>
                  {/* BLACK, white text (Mark, 2026-08-02, with a screenshot of
                      the FileMaker employee list beside it). It was a grey
                      wash, which at 56px row height read as one more row rather
                      than as a break between runs. Black is what the app
                      already uses for a band that DELIMITS — the masthead, the
                      ActionBar — and it's the mark FMP used for exactly this.
                      One style for every list that groups, not a per-caller
                      option: the same argument the TabPicker settled. */}
                  {startsGroup && (
                    <tr className="bg-ink text-white">
                      <td
                        colSpan={visibleColumns.length}
                        className="px-3 py-2 text-xs font-semibold tracking-[0.12em] uppercase"
                      >
                        {label}
                        <span className="ml-2 font-normal tracking-normal text-white/55 normal-case">
                          {groupRows.get(label)?.length ?? 0}
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
                          // px-3 at every width, matching the header (which
                          // needed the 8px back — see ColumnHeader). The xl step
                          // to px-4 was buying air a dense table can't afford.
                          className={`h-14 px-3 py-4 ${col.wrap ? "" : "truncate"} ${
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

                  {/* The run's subtotal, UNDER the run and aligned to the
                      columns it sums. One cell per visible column, filled from
                      the caller's map, so the figures land beneath their own
                      headings however the reader has hidden or reordered them.

                      The rule ABOVE it is the only rule between rows in this
                      table, and it earns that: a rule which delimits is exactly
                      what the design system keeps (the head's 2px, a group
                      band), where a rule between every row is what it drops. */}
                  {endsGroup && banding?.summary && (
                    <tr className="border-t-2 border-ink">
                      {(() => {
                        const cells = banding.summary(groupRows.get(label!) ?? []);
                        return visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className={`h-11 px-3 py-2 text-[13px] font-semibold ${
                              col.align === "right" ? "text-right" : ""
                            } ${col.key in cells ? "tabular-nums" : ""}`}
                          >
                            {cells[col.key] ?? null}
                          </td>
                        ));
                      })()}
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
