"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { moveInOrder, renumber, useRowDrag, type DropTarget } from "@/lib/rowDrag";
import { InlineValue } from "@/components/catalog/InlineValue";
import { ColumnHeader } from "@/components/catalog/ColumnHeader";
import { useResizableColumns } from "@/lib/columnWidths";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Checkbox } from "@/components/ui/Checkbox";
import { AddOrderLine, type MenuItem } from "./AddOrderLine";
import { isProductionLine, lineTotal, money } from "@/lib/specialOrders";
import {
  cutLetter,
  cutOptions,
  donutOptions,
  isLetterCut,
  taxonomyOptions,
} from "@/lib/specialOrderLines";

export type OrderLineRow = {
  id: string;
  sort: number | null;
  production_item_id: string | null;
  name: string;
  item_donut: string | null;
  item_type: string | null;
  item_cut: string | null;
  item_finish: string | null;
  item_size: string | null;
  notes: string | null;
  qty: number | null;
  unit_price: number | null;
  taxable: boolean;
};

/**
 * THE COLUMNS ARE DRAG-RESIZABLE, THROUGH THE SAME BRAIN EVERY LIST USES
 * (Mark, 2026-08-19: "I'd like to be able to drag to resize the columns").
 *
 * This table is NOT a `catalog/DataTable` and deliberately stays one, which is
 * worth stating because the convention says every list is. Two things it does
 * that the component cannot: a line is DRAGGED TO REORDER (`useRowDrag`, the ⠿
 * grip — a special order's line order is meaningful, and FileMaker's slots are
 * where it comes from), and the last row is a SUBTOTAL spanning most of the
 * width. `DataTable` has neither, and teaching it row-drag would touch fifteen
 * screens to serve one — the same reasoning that leaves `/order-guide` and
 * `/cleanup` hand-rolled.
 *
 * What it does NOT have to hand-roll is the resizing. `useResizableColumns` and
 * `catalog/ColumnHeader` are the shared primitives underneath `DataTable`, so
 * the grip, its Safari fixes, the persistence and the reset all behave here
 * exactly as they do on every list — which is the whole point of them living in
 * `lib/`.
 *
 * The widths are WEIGHTS, not pixels — `colWidth` turns them into percentages
 * of the visible total, which is the app's fluid-column rule: a wide screen
 * gets wider columns rather than dead space, and the table can never exceed its
 * box. NO SORTING, so the headers take no `onSort`: the order IS the document,
 * and a click that reordered it would fight the drag handle beside it.
 */
const LINE_WIDTHS: Record<string, number> = {
  grip: 28,
  item: 300,
  note: 260,
  qty: 88,
  price: 104,
  tax: 64,
  total: 112,
  remove: 36,
};

/**
 * The lines — decision 5's editable COPIES of production items.
 *
 * EVERY FIELD IS EDITABLE, THE NAME INCLUDED, and that is the module's point
 * rather than a convenience: "Promise Ring - Glazed - Letter" is a real line,
 * and a customized name is what a special order IS. `production_item_id` stays
 * on the row as the link back — it is provenance and the route to the kitchen
 * (decision 9), never the source of what prints.
 *
 * THE TAXONOMY UNDER THE NAME IS EDITABLE TOO (Mark, 2026-08-19: "We need to
 * be able to edit the fields of an item after it has been added"). Donut, type,
 * cut, finish and size were rendered as plain text, so the five fields that
 * decide what the KITCHEN DOCUMENT says were the only ones on the row nobody
 * could correct — and they are the ones most likely to need it, because they
 * arrive as a snapshot of a menu item that is only ever approximately the thing
 * being ordered. Each is a `PickList` over the live menu's own distinct values
 * with `allowNew`, which is the app's rule for a vocabulary that legitimately
 * grows: the catalog is the vocabulary, and a customized line may say something
 * the catalog does not.
 *
 * THE CUT IS WHERE A LETTER DONUT'S LETTER LIVES — `lib/specialOrderLines`
 * carries the measurement and the rule; the cell here just offers what that
 * module returns, so a letter donut's cut list grows a Letter group and every
 * other line's does not.
 *
 * A `Misc*` LINE IS MONEY, NOT PRODUCTION. It counts toward every figure on the
 * totals card and is excluded from the kitchen document and the production
 * schedule. The row says so in words rather than by a colour, because "this
 * will not be made" is a claim worth reading.
 */
export function OrderLines({
  orderId,
  orgId,
  rows,
  canWrite,
  menu,
}: {
  orderId: string;
  orgId: string;
  rows: OrderLineRow[];
  canWrite: boolean;
  /** The priced menu, resolved on the server — see `MenuItem`. */
  menu: MenuItem[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ order: string[]; basedOn: string } | null>(null);

  const serverOrder = rows.map((r) => r.id).join("|");
  const ordered =
    optimistic && optimistic.basedOn === serverOrder
      ? (optimistic.order.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as OrderLineRow[])
      : rows;

  /**
   * A drop renumbers the WHOLE list and writes only what moved.
   *
   * The whole list because a null `sort` sorts last, and 27,327 migrated v1
   * lines carry a slot number while every hand-added one may not — writing one
   * row's sort alone would put it somewhere nobody dropped it. `renumber` owns
   * that rule and is fixture-pinned on it.
   *
   * Each write `.select()`s its own result: with no matching policy Postgres
   * updates zero rows and PostgREST returns NO error, so a bare call would
   * report success over a list that never moved.
   */
  function dropRow(dragId: string, target: DropTarget) {
    const next = moveInOrder(ordered.map((r) => r.id), dragId, target);
    const writes = renumber(next, new Map(ordered.map((r) => [r.id, r.sort])));
    if (writes.length === 0) return;

    setError(null);
    setOptimistic({ order: next, basedOn: serverOrder });
    start(async () => {
      const results = await Promise.all(
        writes.map((w) =>
          supabase.from("special_order_items").update({ sort: w.sort }).eq("id", w.id).select("id")
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        setOptimistic(null);
        setError(failed.error.message);
        return;
      }
      if (results.some((r) => !r.data?.length)) {
        setOptimistic(null);
        setError("The new order wasn't saved — the database refused it and said nothing.");
        return;
      }
      router.refresh();
    });
  }

  const { dragging, startRowDrag, indicatorRef, chipRef } = useRowDrag({
    bodyRef,
    onDrop: dropRow,
  });

  const { widths, startResize, setWidth, reset, customized } = useResizableColumns(
    "rf.specialOrderLines.columnWidths.v1",
    LINE_WIDTHS
  );

  /** The columns actually on screen — the two control ones only when writable. */
  const columnKeys = [
    ...(canWrite ? ["grip"] : []),
    "item",
    "note",
    "qty",
    "price",
    "tax",
    "total",
    ...(canWrite ? ["remove"] : []),
  ];
  // `DataTable`'s own arithmetic: a weight over the visible total, as a
  // percentage. Never mixed with a px length in the same value — a `<col>` width
  // of `calc(100% - 95px)` is silently DISCARDED (measured, 2026-07-31).
  const naturalTotal = columnKeys.reduce((sum, k) => sum + (widths[k] ?? LINE_WIDTHS[k]), 0);
  const colWidth = (key: string) =>
    `${(((widths[key] ?? LINE_WIDTHS[key]) / naturalTotal) * 100).toFixed(4)}%`;

  async function remove(row: OrderLineRow) {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Take "${row.name}" off this order?\n\nThe totals recompute without it. Nothing in the catalog is touched.`
        ),
        confirmLabel: "Remove",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was removed — the database refused it and said nothing.");
        return;
      }
      router.refresh();
    });
  }

  async function setTaxable(row: OrderLineRow, next: boolean) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_order_items")
        .update({ taxable: next })
        .eq("id", row.id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else router.refresh();
    });
  }

  const subtotal = ordered.reduce((a, l) => a + lineTotal(l), 0);

  return (
    <section className="space-y-2">
      <SectionHeading count={ordered.length}>Items</SectionHeading>

      <div className="overflow-x-auto">
        {/* `table-fixed`, which is what makes a `<col>` width mean anything at
            all — in auto layout the browser sizes columns from their content
            and a dragged width is a suggestion it ignores. */}
        <table className="w-full min-w-[54rem] table-fixed border-collapse text-[14px]">
          <colgroup>
            {columnKeys.map((key) => (
              <col key={key} style={{ width: colWidth(key) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b-2 border-ink text-left">
              {canWrite ? <th className="p-0" /> : null}
              {/* NOTE IS THE SECOND COLUMN (Mark, 2026-08-19), where it used
                  to sit between Tax and Total. It belongs beside the thing it
                  is about — "\"H\". Chocolate glaze with rainbow sprinkles" is a
                  sentence about the item on its left — and moving it out of the
                  middle lets Qty · Price · Tax · Total run as one unbroken band
                  of figures against the right margin. */}
              {(
                [
                  ["item", "Item", "left"],
                  ["note", "Note", "left"],
                  ["qty", "Qty", "right"],
                  ["price", "Price", "right"],
                  ["tax", "Tax", "left"],
                  ["total", "Total", "right"],
                ] as const
              ).map(([key, label, align]) => (
                <ColumnHeader
                  key={key}
                  label={label}
                  align={align}
                  // No sort: the ORDER IS THE DOCUMENT (see LINE_WIDTHS).
                  sorted={false}
                  onResizeStart={(e) => startResize(e, key)}
                  onResizeReset={() => setWidth(key, LINE_WIDTHS[key])}
                />
              ))}
              {canWrite ? <th className="p-0" /> : null}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {ordered.map((row) => {
              const production = isProductionLine(row);
              return (
                <tr
                  key={row.id}
                  data-row-id={row.id}
                  className={`align-top hover:bg-neutral-50 ${dragging?.id === row.id ? "opacity-40" : ""}`}
                >
                  {canWrite ? (
                    <td className="px-0 py-2">
                      {/* A dedicated grip, `touch-none` on it alone: a row drag
                          and a page scroll are the same direction, so a
                          full-width handle would stop an iPad scrolling the
                          table at all. */}
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Reorder ${row.name}`}
                        title={`Drag to reorder ${row.name}`}
                        onPointerDown={(e) => startRowDrag(e, { id: row.id, label: row.name })}
                        className="block cursor-grab touch-none select-none px-1 text-[13px] leading-none text-subtle hover:text-ink"
                      >
                        ⠿
                      </span>
                    </td>
                  ) : null}

                  <td className="px-3 py-2">
                    {canWrite ? (
                      <InlineValue
                        table="special_order_items"
                        id={row.id}
                        column="name"
                        value={row.name}
                        ariaLabel="Item name"
                        className="font-medium"
                      />
                    ) : (
                      <span className="font-medium">{row.name}</span>
                    )}
                    {/* The taxonomy under the customized name — what the
                        kitchen document prints beneath it, and the only way to
                        tell four "Angry Samoa" lines apart. Editable in place
                        since 2026-08-19; see the header. */}
                    {canWrite ? (
                      <LineTaxonomy row={row} menu={menu} />
                    ) : (
                      <span className="block text-[12px] text-subtle">
                        {[row.item_donut, row.item_type, row.item_cut, row.item_finish, row.item_size]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    )}
                    {!production ? (
                      <span className="block text-[12px] text-mark">
                        Money only — this never reaches the kitchen
                      </span>
                    ) : !row.production_item_id ? (
                      /* Decision 9's precondition, said on the row that breaks
                         it rather than only in the refusal at scheduling time.
                         `production_schedule_items.item_id` is NOT NULL. */
                      <span className="block text-[12px] text-mark">
                        No production item — this line cannot be scheduled
                      </span>
                    ) : (
                      <Link
                        href={`/production-items/${row.production_item_id}`}
                        className="block text-[12px] text-subtle underline underline-offset-2 hover:text-ink"
                      >
                        On the menu
                      </Link>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    {canWrite ? (
                      <InlineValue
                        table="special_order_items" id={row.id} column="notes" value={row.notes}
                        ariaLabel={`Note on ${row.name}`} placeholder="—"
                      />
                    ) : (
                      <span className="text-muted">{row.notes ?? "—"}</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums">
                    {canWrite ? (
                      <InlineValue
                        table="special_order_items" id={row.id} column="qty" kind="number"
                        value={row.qty} nullable={false} ariaLabel={`Quantity of ${row.name}`}
                        className="text-right"
                      />
                    ) : (
                      (row.qty ?? 0)
                    )}
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums">
                    {canWrite ? (
                      <InlineValue
                        table="special_order_items" id={row.id} column="unit_price" kind="number"
                        value={row.unit_price} nullable={false} ariaLabel={`Price of ${row.name}`}
                        className="text-right"
                        format={(v) => `$${Number(v).toFixed(2)}`}
                      />
                    ) : (
                      money(Number(row.unit_price ?? 0))
                    )}
                  </td>

                  <td className="px-3 py-2 text-center">
                    {/* `ui/Checkbox`, never a raw input. FMP's own "Plus Tax"
                        per line — 22,127 of 27,445 v1 slots carry it. */}
                    <Checkbox
                      checked={row.taxable}
                      disabled={!canWrite || pending}
                      onChange={(next) => setTaxable(row, next)}
                      label={`${row.name} is taxable`}
                    />
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums">{money(lineTotal(row))}</td>

                  {canWrite ? (
                    <td className="px-1 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        disabled={pending}
                        aria-label={`Remove ${row.name}`}
                        title={`Remove ${row.name}`}
                        className="px-1 text-[15px] leading-none text-subtle hover:text-accent disabled:opacity-35"
                      >
                        ×
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}

            {ordered.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 8 : 6} className="px-3 py-6 text-sm text-muted">
                  Nothing on this order yet.
                </td>
              </tr>
            ) : (
              // No `data-row-id`, so it can never be a drop target.
              <tr className="border-t-2 border-ink font-semibold">
                <td colSpan={canWrite ? 6 : 5} className="px-3 py-2 text-right">
                  Items
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(subtotal)}</td>
                {canWrite ? <td /> : null}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The same footer `DataTable` puts under every list, and it appears the
          same way — only once a width has actually been dragged. */}
      {customized ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={reset}
            title="Restore the default column widths"
            className="text-[12px] uppercase tracking-[0.12em] text-subtle hover:underline"
          >
            Reset column widths
          </button>
        </div>
      ) : null}

      {canWrite ? (
        <AddOrderLine orderId={orderId} orgId={orgId} existing={ordered} menu={menu} />
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}

      {/* Portalled to the body, like every other drag overlay here: a `fixed`
          element inside the table would be clipped by a transformed ancestor.
          Both nodes are positioned per move through refs — no re-render. */}
      {dragging
        ? createPortal(
            <>
              <div
                ref={indicatorRef}
                style={{ display: "none", left: dragging.tableLeft, width: dragging.tableWidth }}
                className="pointer-events-none fixed z-50 h-0.5 bg-ink"
              />
              <div
                ref={chipRef}
                style={{
                  left: dragging.x,
                  top: dragging.y,
                  transform: dragging.touch
                    ? "translate(-50%, calc(-100% - 16px))"
                    : "translate(14px, 18px)",
                }}
                className="pointer-events-none fixed z-50 border border-ink bg-white px-2 py-1 text-[12px] shadow-none"
              >
                {dragging.label}
              </div>
            </>,
            document.body
          )
        : null}
    </section>
  );
}

/**
 * The five snapshot fields, on one line, each a pick cell.
 *
 * ONE LINE AND THE SAME SEPARATORS, because it is the same sentence it always
 * was — "Bananaversary · Raised · Letter D · Plain · Regular" is how this row
 * has read since the module shipped and how the kitchen sheet prints it. Every
 * slot shows even when empty, so the fields do not shuffle about as they are
 * filled in; an empty one is a faint em dash you can click.
 *
 * ALL FIVE CARRY `allowNew`. The vocabulary is whatever the live menu says,
 * which is honest and is not exhaustive: decision 5 makes a line a customized
 * COPY, so "Raised, but baked" has to be typeable. Clearing is offered because
 * the columns are nullable and empty is a real value — 27,808 migrated lines
 * carry no taxonomy at all.
 *
 * THE CUT IS THE ONE WITH A RULE IN IT. Its options come from `cutOptions`,
 * which adds the characters ONLY when this line is already a letter donut — so
 * choosing the letter IS choosing the cut, and a Promise Ring is not offered
 * forty-two characters that mean nothing to it.
 *
 * A CHOSEN LETTER SHOWS AS THE CHARACTER, under a static "Letter" beside it.
 * `Letter - "D"` set in a row of five values is four words of packaging around
 * the one that matters, and the packaging is the same on every letter line —
 * so the word is written once, plainly, and the cell holds the D. The stored
 * value is unchanged and the picker still says it in full. On a line whose
 * character is still open the cell reads "Letter" itself and there is no
 * prefix, or it would say the word twice.
 */
function LineTaxonomy({ row, menu }: { row: OrderLineRow; menu: MenuItem[] }) {
  const cell = "text-[12px] text-subtle";
  const isLetter = isLetterCut(row.item_cut);
  const letter = cutLetter(row.item_cut);

  return (
    <span className="flex flex-wrap items-baseline gap-x-1 text-[12px] text-subtle">
      <Slot>
        <InlineValue
          table="special_order_items" id={row.id} column="item_donut" kind="pick"
          value={row.item_donut} options={donutOptions(menu)} allowNew
          ariaLabel={`Donut on ${row.name}`} className={cell}
        />
      </Slot>
      <Sep />
      <Slot>
        <InlineValue
          table="special_order_items" id={row.id} column="item_type" kind="pick"
          value={row.item_type} options={taxonomyOptions(menu, "item_type")} allowNew
          ariaLabel={`Type of ${row.name}`} className={cell}
        />
      </Slot>
      <Sep />
      {/* The static half of a letter cut — see the header. */}
      {isLetter && letter ? <span>Letter</span> : null}
      <Slot>
        <InlineValue
          table="special_order_items" id={row.id} column="item_cut" kind="pick"
          value={row.item_cut} options={cutOptions(menu, row.item_cut)} allowNew
          ariaLabel={
            isLetter
              ? letter
                ? `Letter on ${row.name} — currently ${letter}`
                : `Letter on ${row.name} — none chosen yet`
              : `Cut of ${row.name}`
          }
          className={cell}
        />
      </Slot>
      {/* Said in words on a letter line whose character is still open. A bare
          "Letter" is a legitimate state — 935 real lines are exactly that, an
          order for letters whose word nobody has settled — so this is a note in
          the mark colour rather than a red one. */}
      {isLetter && !letter ? <span className="text-mark">(no letter yet)</span> : null}
      <Sep />
      <Slot>
        <InlineValue
          table="special_order_items" id={row.id} column="item_finish" kind="pick"
          value={row.item_finish} options={taxonomyOptions(menu, "finish")} allowNew
          ariaLabel={`Finish on ${row.name}`} className={cell}
        />
      </Slot>
      <Sep />
      <Slot>
        <InlineValue
          table="special_order_items" id={row.id} column="item_size" kind="pick"
          value={row.item_size} options={taxonomyOptions(menu, "size")} allowNew
          ariaLabel={`Size of ${row.name}`} className={cell}
        />
      </Slot>
    </span>
  );
}

/** One field's box. `min-w-0` so a long donut name wraps rather than pushing
 *  the money columns sideways. */
function Slot({ children }: { children: ReactNode }) {
  return <span className="min-w-0">{children}</span>;
}

const Sep = () => <span className="text-faint">·</span>;
