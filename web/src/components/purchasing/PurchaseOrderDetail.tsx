"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { qty } from "@/lib/catalog";
import {
  money,
  orderedQty,
  orderedTotal,
  priceDiffers,
  receivedQty,
  receivedTotal,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  type PoLine,
  type PoStatus,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import { Checkbox } from "@/components/ui/Checkbox";
import { AddPoLines } from "./AddPoLines";
import { ProcessPo, type ProcessingContext } from "./ProcessPo";

/**
 * PO detail: what was ordered, what arrived, and the gap between them.
 *
 * Ordered quantities and the line's unit price are the historical record and
 * stay read-only — receiving adjusts qty_received and notes. The exception is
 * the price-reconciliation action, which writes the invoice price back to the
 * CATALOG (vendor_items.price), leaving the PO's own snapshot untouched.
 */
export function PurchaseOrderDetail({
  order,
  lines,
  locationCode,
  vendorLink,
  orgId,
  processing,
}: {
  order: PurchaseOrder;
  lines: PoLine[];
  locationCode: string;
  vendorLink: ReactNode;
  /** Needed to INSERT a line — org_id is not null and RLS checks it. */
  orgId: string;
  /** Null for viewers below purchaser — the card writes, so it isn't shown. */
  processing: ProcessingContext | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedLines, setCheckedLines] = useState<Set<string>>(new Set());

  // Line selection (and deletion) is purchaser+ work — `processing` is
  // already null for anyone below that role.
  const canEditLines = processing !== null;

  function toggleLine(id: string) {
    setCheckedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Delete the selected lines. Received quantities are order history, so
   *  the confirm names them before anything irreversible happens. */
  async function deleteLines() {
    const selected = lines.filter((l) => checkedLines.has(l.id));
    const received = selected.filter((l) => l.qty_received !== null);
    const message =
      `Delete ${selected.length} line${selected.length === 1 ? "" : "s"} from ${order.po_number}?` +
      (received.length > 0
        ? `\n\nWARNING: ${received.length} of them ${
            received.length === 1 ? "has" : "have"
          } a received quantity — deleting erases that history permanently.`
        : "\n\nThis cannot be undone.");
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_order_items")
      .delete()
      .in("id", [...checkedLines]);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setCheckedLines(new Set());
    router.refresh();
  }

  const ordered = orderedTotal(lines);
  const received = receivedTotal(lines);
  const orderedPackages = orderedQty(lines);
  const receivedPackages = receivedQty(lines);
  const differing = lines.filter(priceDiffers);

  async function setStatus(status: PoStatus) {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status })
      .eq("id", order.id);
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  /** Receive everything at the ordered quantity — the common case. */
  async function receiveAll() {
    setBusy(true);
    setError(null);
    for (const line of lines) {
      const { error } = await supabase
        .from("purchase_order_items")
        .update({ qty_received: line.qty_ordered })
        .eq("id", line.id);
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  /** Push a line's invoice price onto the catalog; the DB trigger logs it. */
  async function adoptPrice(line: PoLine) {
    if (!line.vendor_items || line.unit_price === null) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("vendor_items")
      .update({ price: line.unit_price })
      .eq("id", line.vendor_items.id);
    setBusy(false);
    if (error) setError(error.message);
    else router.refresh();
  }

  const columns: DataColumn<PoLine>[] = [
    // Selection first, purchaser+ only — the delete bar appears once
    // something is checked.
    ...(canEditLines
      ? [
          {
            key: "select",
            label: "",
            width: 40,
            render: (l: PoLine) => (
              <Checkbox
                checked={checkedLines.has(l.id)}
                onChange={() => toggleLine(l.id)}
                label={`select ${l.description ?? l.id}`}
                size={18}
              />
            ),
          } as DataColumn<PoLine>,
        ]
      : []),
    // Type leads (Mark, 2026-07-27 — the table ran off the screen): the item's
    // category is short, repeats down the order, and is what the vendor-facing
    // PDF groups by, so it costs 130px where the item NAME cost 240.
    {
      key: "item_type",
      label: "Type",
      width: 130,
      // Wraps rather than widens — "Flavors and Extracts" doesn't fit 130px on
      // one line and clipping it to "Flavors and …" loses the distinction.
      wrap: true,
      sortValue: (l) => l.vendor_items?.inventory_items?.category ?? null,
      // Type, then Item, then description (Mark, 2026-07-27). A category
      // covers several lines, so the type alone leaves each group in arrival
      // order; the two tiebreaks are the Item cell's own two lines, read top
      // to bottom. Brand last so identical descriptions still land somewhere
      // predictable.
      sortTiebreaks: [
        (l) => l.vendor_items?.inventory_items?.name ?? l.description ?? "",
        (l) => l.description ?? "",
        (l) => l.brand ?? "",
      ],
      render: (l) => (
        <span className="text-muted">
          {l.vendor_items?.inventory_items?.category ?? "—"}
        </span>
      ),
    },
    {
      key: "product_id",
      label: "Product ID",
      width: 120,
      sortValue: (l) => l.product_id,
      render: (l) => <span className="text-muted">{l.product_id ?? "—"}</span>,
    },
    // What the item IS and what you ordered it as, in one wrapping cell —
    // two columns' worth of information in one column's width. The catalog
    // name leads because that's what you recognise; the snapshot beneath it is
    // what the vendor's invoice will say.
    {
      key: "item",
      label: "Item",
      width: 280,
      wrap: true,
      sortValue: (l) => l.vendor_items?.inventory_items?.name ?? l.description,
      // One item can appear twice under different pack sizes, so the cell's
      // second line breaks the tie here too.
      sortTiebreaks: [(l) => l.description ?? "", (l) => l.brand ?? ""],
      render: (l) => {
        const name = l.vendor_items?.inventory_items?.name ?? null;
        const orderedAs = [l.brand, l.description].filter(Boolean).join(" · ");
        // A line whose vendor item is gone still has its snapshot — that's the
        // historical record, so it leads instead of an em dash.
        if (!name) return <span className="text-muted">{orderedAs || "—"}</span>;
        return (
          <span className="block leading-snug">
            <span className="block text-ink">{name}</span>
            {orderedAs && (
              <span className="block text-xs text-muted">{orderedAs}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "package_desc",
      label: "Pack",
      // 85px clipped every multi-pack to "1 × 5 l…", which is the same
      // information-off-the-edge problem. The 40px comes out of Note below, so
      // the table's total width is unchanged.
      width: 125,
      sortValue: (l) => l.package_desc,
      render: (l) => <span className="text-muted">{l.package_desc ?? "—"}</span>,
    },
    {
      key: "qty_ordered",
      label: "Ordered",
      width: 95,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered),
      render: (l) => <span className="text-body">{Number(l.qty_ordered)}</span>,
    },
    {
      key: "qty_received",
      label: "Received",
      width: 110,
      align: "right",
      sortValue: (l) => (l.qty_received === null ? null : Number(l.qty_received)),
      render: (l) => (
        <InlineValue
          table="purchase_order_items"
          id={l.id}
          column="qty_received"
          value={l.qty_received}
          kind="number"
          align="right"
          placeholder="—"
        />
      ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 120,
      align: "right",
      sortValue: (l) => (l.unit_price === null ? null : Number(l.unit_price)),
      render: (l) => {
        const catalog = l.vendor_items?.price;
        return (
          <span className="text-body">
            {money(l.unit_price)}
            {priceDiffers(l) && (
              <span
                className="ml-1 text-xs font-semibold text-accent"
                title={`Catalog price is ${money(catalog ?? null)}`}
              >
                ≠
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "line_total",
      label: "Line total",
      width: 120,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
      render: (l) => (
        <span className="text-muted">
          {money(Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0))}
        </span>
      ),
    },
    {
      key: "discrepancy_note",
      label: "Note",
      // Lent 40px to Pack: this column is empty on almost every line, and it's
      // the last one, so it's also the cheapest place to give width back.
      width: 150,
      sortValue: (l) => l.discrepancy_note,
      render: (l) => (
        <InlineValue
          table="purchase_order_items"
          id={l.id}
          column="discrepancy_note"
          value={l.discrepancy_note}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              {order.po_number}
            </h1>
            <span
              className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[order.status]}`}
            >
              {PO_STATUS_LABEL[order.status]}
            </span>
          </div>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {vendorLink} · {locationCode}
          </p>
        </div>
        {/* Ordered / Received as two Statistics: the header answers "how big
            is this order and did it all arrive" before anything else. */}
        <div className="ml-auto flex items-start gap-8 text-right">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Ordered total
            </div>
            <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(ordered)}
            </div>
          </div>
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Received total
            </div>
            <div
              className={`text-[22px] font-bold tabular-nums tracking-[-0.01em] ${
                received < ordered - 0.005 ? "text-accent" : ""
              }`}
            >
              {money(received)}
            </div>
          </div>
        </div>
      </div>

      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Ordered
        </dt>
        <dd className="tabular-nums">{order.order_date}</dd>
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Delivery
        </dt>
        <dd className="tabular-nums">{order.delivery_date ?? "—"}</dd>
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Sent via
        </dt>
        <dd>{order.sent_via ?? "—"}</dd>
        <dt className="text-[12px] uppercase leading-6 tracking-[0.12em] text-subtle">
          Notes
        </dt>
        <dd>
          <InlineValue
            table="purchase_orders"
            id={order.id}
            column="notes"
            value={order.notes}
            placeholder="none"
          />
        </dd>
      </dl>

      {error && <p className="text-sm text-accent">{error}</p>}

      {processing && <ProcessPo order={order} context={processing} />}

      {/* How many DISTINCT products, and how many packages they add up to —
          the second is what you count off the truck, and the line count alone
          never told you (Mark, 2026-07-27). Packages of each line's own vendor
          item, so a case and an each both count as one; that's the intended
          reading for a delivery check. Received is shown only once something
          has been, so the bar stays quiet on a draft. */}
      <div className="flex flex-wrap items-center gap-4 border border-ink px-4 py-3 text-sm">
        <span className="text-subtle">
          {lines.length} {lines.length === 1 ? "product" : "products"} ·{" "}
          <span className="tabular-nums text-body">{qty(orderedPackages)}</span>{" "}
          {orderedPackages === 1 ? "package" : "packages"}
          {receivedPackages > 0 && (
            <>
              {" · "}
              <span
                className={`tabular-nums ${
                  receivedPackages < orderedPackages ? "text-accent" : "text-body"
                }`}
              >
                {qty(receivedPackages)}
              </span>{" "}
              received
            </>
          )}
        </span>

        {/* Adding a line is a write to the order, so it sits with the other
            two — and it's purchaser+ for the same reason the delete bar is. */}
        {canEditLines && (
          <span className="ml-auto">
            <AddPoLines order={order} orgId={orgId} lines={lines} />
          </span>
        )}

        <button
          disabled={busy}
          onClick={receiveAll}
          className={`${canEditLines ? "" : "ml-auto "}h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35`}
        >
          Receive all as ordered
        </button>

        <label className="flex items-center gap-2">
          <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Status
          </span>
          <select
            value={order.status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as PoStatus)}
            className="h-9 border border-ink bg-white px-2"
          >
            {PO_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {PO_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {differing.length > 0 && (
        <div className="space-y-2 border border-ink bg-mark-fill px-4 py-3 text-sm">
          <p className="text-ink">
            {differing.length}{" "}
            {differing.length === 1 ? "line's price differs" : "lines' prices differ"} from
            the catalog. Adopting sets the catalog price; the order keeps what it
            was billed.
          </p>
          <ul className="space-y-1">
            {differing.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span className="text-body">
                  {l.vendor_items?.inventory_items?.name ?? l.description}
                </span>
                <span className="tabular-nums text-muted">
                  invoice {money(l.unit_price)} · catalog{" "}
                  {money(l.vendor_items?.price ?? null)}
                </span>
                <button
                  disabled={busy}
                  onClick={() => adoptPrice(l)}
                  className="border border-accent bg-white px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
                >
                  Update catalog to {money(l.unit_price)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkedLines.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 border border-ink px-4 py-3 text-sm">
          <span>
            {checkedLines.size} {checkedLines.size === 1 ? "line" : "lines"} selected
          </span>
          <button
            disabled={busy}
            onClick={deleteLines}
            className="h-9 border border-accent bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-35"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={() => setCheckedLines(new Set())}
            className="ml-auto text-muted underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Clear
          </button>
        </div>
      )}

      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.id}
        // v2: the columns changed meaning (Type replaced the item name, and the
        // name moved into the wrapping Item cell), so any width stored against
        // v1's keys is wrong by definition — a new key drops them.
        storageKey="rf.purchaseOrderLines.columnWidths.v2"
        // Type first (Mark, 2026-07-27): it groups the order the way the
        // vendor-facing PDF does, so the screen and the document read alike.
        defaultSort={{ key: "item_type" }}
        rowClassName={(l) =>
          l.qty_received !== null && Number(l.qty_received) < Number(l.qty_ordered)
            ? "bg-[var(--rf-yellow-50)]"
            : ""
        }
        empty={<p className="text-sm text-muted">This order has no lines.</p>}
      />
    </div>
  );
}
