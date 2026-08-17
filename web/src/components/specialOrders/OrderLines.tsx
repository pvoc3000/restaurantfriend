"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { moveInOrder, renumber, useRowDrag, type DropTarget } from "@/lib/rowDrag";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Checkbox } from "@/components/ui/Checkbox";
import { AddOrderLine, type MenuItem } from "./AddOrderLine";
import { isProductionLine, lineTotal, money } from "@/lib/specialOrders";

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
 * The lines — decision 5's editable COPIES of production items.
 *
 * EVERY FIELD IS EDITABLE, THE NAME INCLUDED, and that is the module's point
 * rather than a convenience: "Promise Ring - Glazed - Letter" is a real line,
 * and a customized name is what a special order IS. `production_item_id` stays
 * on the row as the link back — it is provenance and the route to the kitchen
 * (decision 9), never the source of what prints.
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
        <table className="w-full min-w-[54rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              {canWrite ? <th className="w-6 px-0 py-2" /> : null}
              <th className="px-3 py-2 text-left">Item</th>
              <th className="w-24 px-3 py-2 text-right">Qty</th>
              <th className="w-28 px-3 py-2 text-right">Price</th>
              <th className="w-16 px-3 py-2 text-center">Tax</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="w-28 px-3 py-2 text-right">Total</th>
              {canWrite ? <th className="w-8 px-1 py-2" /> : null}
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
                        tell four "Angry Samoa" lines apart. */}
                    <span className="block text-[12px] text-subtle">
                      {[row.item_donut, row.item_type, row.item_cut, row.item_finish, row.item_size]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
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
