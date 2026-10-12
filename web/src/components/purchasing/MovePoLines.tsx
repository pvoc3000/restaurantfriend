"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { DateField } from "@/components/ui/DateField";
import { nextDeliveryDate } from "@/lib/poProcessing";
import type { PoLine, PurchaseOrder } from "@/lib/purchaseOrders";

type DraftOrder = {
  id: string;
  po_number: string;
  delivery_date: string | null;
  purchase_order_items: { count: number }[];
};

const NEW = "new";

/**
 * Move lines to another DRAFT order for the same vendor at the same shop, or
 * to a new one (Mark, 2026-10-12) — how an order arriving on two days is
 * split. A move, never a copy: each line is on exactly one order before and
 * after, which is the point. Duplicate-then-delete could leave an item on both
 * orders, and re-adding by hand could leave it on neither.
 *
 * The write is migration 199's `move_purchase_order_lines`, one transaction:
 * the new order (when asked for) and the move land together or not at all, and
 * it re-checks everything this dialog shows.
 *
 * LINES THAT CANNOT MOVE STAY, AND THE DIALOG SAYS SO. A received quantity is
 * this order's history, and a bill line records the order beside the line
 * (025), so moving a billed line would leave the bill naming the wrong order.
 *
 * A matching item already on the target stays a second line — the two can
 * carry different prices and notes, and merging would have to pick.
 */
export function MovePoLines({
  order,
  lines,
  deliveryDays,
  onClose,
  onMoved,
}: {
  order: PurchaseOrder;
  /** The lines asked for — one from a row's ⋯, the ticked ones from Actions. */
  lines: PoLine[];
  /** The vendor's delivery weekdays at this shop, for the new order's date. */
  deliveryDays: number[] | null;
  onClose: () => void;
  onMoved: (moved: { id: string; po_number: string; lineIds: string[] }) => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [billed, setBilled] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState("");
  // The new order's delivery: the vendor's next delivery day AFTER this
  // order's own, since arriving on another day is why it is being split.
  const [delivery, setDelivery] = useState<string | null>(() =>
    nextDeliveryDate(order.delivery_date ?? order.order_date, deliveryDays)
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const lineIds = lines.map((l) => l.id).join(",");
  useEffect(() => {
    let stale = false;
    (async () => {
      const [targets, bills] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("id, po_number, delivery_date, purchase_order_items ( count )")
          .eq("vendor_id", order.vendor_id)
          .eq("location_id", order.location_id)
          .eq("status", "draft")
          .neq("id", order.id)
          .order("delivery_date", { nullsFirst: false })
          .order("po_number"),
        supabase
          .from("vendor_bill_lines")
          .select("purchase_order_item_id")
          .in("purchase_order_item_id", lineIds.split(",")),
      ]);
      if (stale) return;
      setLoading(false);
      const error = targets.error ?? bills.error;
      if (error) {
        setFailed(error.message);
        return;
      }
      const found = (targets.data ?? []) as unknown as DraftOrder[];
      setDrafts(found);
      setBilled(
        new Set((bills.data ?? []).map((b) => b.purchase_order_item_id as string))
      );
      // With no other draft there is one answer, so it is already given.
      if (found.length === 0) setChoice(NEW);
    })();
    return () => {
      stale = true;
    };
    // The dialog is mounted per request, so its inputs never change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const movable = lines.filter((l) => l.qty_received === null && !billed.has(l.id));
  const staying = lines.length - movable.length;
  const one = lines.length === 1 ? lines[0] : null;
  const what = one
    ? one.vendor_items?.inventory_items?.name ?? one.description ?? "this item"
    : `${movable.length} ${movable.length === 1 ? "line" : "lines"}`;

  const ready = !loading && !busy && movable.length > 0 && choice !== "";

  function close() {
    if (busy) return;
    onClose();
  }

  async function move() {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    const { data, error } = await supabase.rpc("move_purchase_order_lines", {
      p_lines: movable.map((l) => l.id),
      p_target: choice === NEW ? null : choice,
      p_delivery_date: choice === NEW ? delivery : null,
    });
    const target = (data as { id: string; po_number: string }[] | null)?.[0];
    if (error || !target) {
      setBusy(false);
      setFailed(error?.message ?? "The lines could not be moved.");
      return;
    }
    onMoved({ ...target, lineIds: movable.map((l) => l.id) });
  }

  const options = [
    ...drafts.map((d) => {
      const count = d.purchase_order_items[0]?.count ?? 0;
      return {
        value: d.id,
        label: (
          <span className="tabular-nums">
            {d.po_number} · {d.delivery_date ? `delivery ${d.delivery_date}` : "no delivery date"} ·{" "}
            {count} {count === 1 ? "line" : "lines"}
          </span>
        ),
      };
    }),
    {
      value: NEW,
      label: "New purchase order",
      after: (
        <>
          <span className="text-muted">delivery</span>
          <DateField
            boxed
            value={delivery}
            onChange={(next) => {
              setDelivery(next);
              setChoice(NEW);
            }}
            disabled={busy}
            ariaLabel="Delivery date of the new purchase order"
          />
        </>
      ),
    },
  ];

  return (
    <Dialog
      title={one ? "Move item to other PO" : "Move lines to other PO"}
      onClose={close}
      busy={busy}
      onSubmit={ready ? () => void move() : undefined}
      footer={
        <>
          <button type="button" onClick={close} disabled={busy} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void move()}
            disabled={!ready}
            className={DIALOG_COMMIT_CLASS}
          >
            {busy ? "Moving…" : "Move"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted">Loading draft orders…</p>
      ) : movable.length === 0 ? (
        <p className="text-sm">
          {one ? "This line" : "None of these lines"} can be moved: a line with a received
          quantity, or one that is on a bill, stays on {order.po_number}.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Move {what} from {order.po_number} to:
          </p>
          <Radio
            vertical
            ariaLabel="Move to"
            options={options}
            value={choice}
            onChange={setChoice}
            disabled={busy}
          />
          {staying > 0 && (
            <p className="text-sm text-accent">
              {staying} of the {lines.length} selected {staying === 1 ? "stays" : "stay"} on{" "}
              {order.po_number}: a line with a received quantity, or one that is on a bill,
              cannot be moved.
            </p>
          )}
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-accent">{failed}</p>}
    </Dialog>
  );
}
