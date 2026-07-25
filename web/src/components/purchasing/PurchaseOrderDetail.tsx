"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  money,
  orderedTotal,
  priceDiffers,
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
  processing,
}: {
  order: PurchaseOrder;
  lines: PoLine[];
  locationCode: string;
  vendorLink: ReactNode;
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
            width: 32,
            render: (l: PoLine) => (
              <input
                type="checkbox"
                checked={checkedLines.has(l.id)}
                onChange={() => toggleLine(l.id)}
                aria-label={`select ${l.description ?? l.id}`}
              />
            ),
          } as DataColumn<PoLine>,
        ]
      : []),
    {
      key: "item",
      label: "Item",
      width: 200,
      sortValue: (l) => l.vendor_items?.inventory_items?.name ?? l.description,
      render: (l) => l.vendor_items?.inventory_items?.name ?? "—",
    },
    {
      key: "product_id",
      label: "Product ID",
      width: 100,
      sortValue: (l) => l.product_id,
      render: (l) => <span className="text-neutral-600">{l.product_id ?? "—"}</span>,
    },
    {
      key: "description",
      label: "Ordered as",
      width: 240,
      sortValue: (l) => l.description,
      render: (l) => (
        <span className="text-neutral-600">
          {[l.brand, l.description].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "package_desc",
      label: "Pack",
      width: 70,
      sortValue: (l) => l.package_desc,
      render: (l) => <span className="text-neutral-600">{l.package_desc ?? "—"}</span>,
    },
    {
      key: "qty_ordered",
      label: "Ordered",
      width: 80,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered),
      render: (l) => <span className="text-neutral-700">{Number(l.qty_ordered)}</span>,
    },
    {
      key: "qty_received",
      label: "Received",
      width: 90,
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
      width: 100,
      align: "right",
      sortValue: (l) => (l.unit_price === null ? null : Number(l.unit_price)),
      render: (l) => {
        const catalog = l.vendor_items?.price;
        return (
          <span className="text-neutral-700">
            {money(l.unit_price)}
            {priceDiffers(l) && (
              <span
                className="ml-1 text-xs text-amber-700"
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
      width: 100,
      align: "right",
      sortValue: (l) => Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
      render: (l) => (
        <span className="text-neutral-600">
          {money(Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0))}
        </span>
      ),
    },
    {
      key: "discrepancy_note",
      label: "Note",
      width: 160,
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
    <div className="space-y-5">
      {/* Type label first (house rule): the slide-over panel hides
          breadcrumbs, so this line is the only cue to the record kind. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Purchase Order
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold">{order.po_number}</h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${PO_STATUS_CLASS[order.status]}`}>
          {PO_STATUS_LABEL[order.status]}
        </span>
        <span className="text-sm text-neutral-500">
          {vendorLink} · {locationCode}
        </span>
        </div>
      </div>

      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">Ordered</dt>
        <dd className="tabular-nums">{order.order_date}</dd>
        <dt className="text-neutral-500">Delivery</dt>
        <dd className="tabular-nums">{order.delivery_date ?? "—"}</dd>
        <dt className="text-neutral-500">Sent via</dt>
        <dd>{order.sent_via ?? "—"}</dd>
        <dt className="text-neutral-500">Notes</dt>
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

      {error && <p className="text-sm text-red-700">{error}</p>}

      {processing && <ProcessPo order={order} context={processing} />}

      <div className="flex flex-wrap items-center gap-4 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
        <span>
          Ordered <span className="font-medium tabular-nums">{money(ordered)}</span>
        </span>
        <span>
          Received{" "}
          <span
            className={`font-medium tabular-nums ${
              received < ordered - 0.005 ? "text-amber-700" : ""
            }`}
          >
            {money(received)}
          </span>
        </span>
        <span className="text-neutral-500">{lines.length} lines</span>

        <button
          disabled={busy}
          onClick={receiveAll}
          className="ml-auto rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100 disabled:opacity-50"
        >
          Receive all as ordered
        </button>

        <label className="flex items-center gap-1 text-neutral-600">
          Status
          <select
            value={order.status}
            disabled={busy}
            onChange={(e) => setStatus(e.target.value as PoStatus)}
            className="rounded border border-neutral-300 bg-white px-2 py-1"
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
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <p className="text-amber-800">
            {differing.length}{" "}
            {differing.length === 1 ? "line's price differs" : "lines' prices differ"} from
            the catalog. Adopting sets the catalog price; the order keeps what it
            was billed.
          </p>
          <ul className="space-y-1">
            {differing.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span className="text-neutral-700">
                  {l.vendor_items?.inventory_items?.name ?? l.description}
                </span>
                <span className="tabular-nums text-neutral-600">
                  invoice {money(l.unit_price)} · catalog{" "}
                  {money(l.vendor_items?.price ?? null)}
                </span>
                <button
                  disabled={busy}
                  onClick={() => adoptPrice(l)}
                  className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  Update catalog to {money(l.unit_price)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkedLines.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>
            {checkedLines.size} {checkedLines.size === 1 ? "line" : "lines"} selected
          </span>
          <button
            disabled={busy}
            onClick={deleteLines}
            className="rounded border border-red-300 bg-white px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={() => setCheckedLines(new Set())}
            className="ml-auto text-neutral-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.id}
        storageKey="rf.purchaseOrderLines.columnWidths.v1"
        defaultSort={{ key: "item" }}
        rowClassName={(l) =>
          l.qty_received !== null && Number(l.qty_received) < Number(l.qty_ordered)
            ? "bg-amber-50/50"
            : ""
        }
        empty={<p className="text-sm text-neutral-600">This order has no lines.</p>}
      />
    </div>
  );
}
