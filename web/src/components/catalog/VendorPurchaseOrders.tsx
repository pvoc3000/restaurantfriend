"use client";

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import {
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  money,
  type PoStatus,
} from "@/lib/purchaseOrders";

/** One order placed with this vendor. What the vendor record's Purchase Orders
 *  tab shows — the row, not the document. */
export type VendorPoRow = {
  id: string;
  po_number: string;
  status: PoStatus;
  order_date: string;
  delivery_date: string | null;
  location_code: string;
  line_count: number;
  ordered_total: number;
  received_total: number;
};

/** Cap on the fetch — the same 500 `/purchase-orders` stops at. */
export const VENDOR_PO_CAP = 500;

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

/**
 * A vendor's purchase orders — `/purchase-orders` with everything taken off
 * that is about WORKING the list rather than READING it (Mark, 2026-09-05:
 * "a simplified version of the purchase order screen"). No date window, no
 * status chips, no selection bar, no row menu: from a vendor's record the
 * question is "what have we ordered from these people", and the answer is
 * the rows, newest first, each a link to the order where the work happens.
 *
 * The Vendor column is GONE — every row is this vendor — and a SHOP column
 * takes its place, because unlike the list this is not scoped to the working
 * location (see `lib/vendors`). Files and Sent via are dropped too: the first
 * is a Friday question about deliveries, the second a transport detail, and
 * neither is about the vendor.
 *
 * The sort is the table's own (uncontrolled) rather than in the URL: the tab
 * is already a URL parameter and a second one for a table this narrow would
 * be ceremony. The Ordered and Received totals close the table, `DataTable`'s
 * own `totals` row, keyed by column so they stay under the figures they sum.
 */
export function VendorPurchaseOrders({
  orders,
  from,
  capped,
}: {
  orders: VendorPoRow[];
  /** Where a row's link comes back to — this vendor, this tab. */
  from: Crumb;
  capped: boolean;
}) {
  const columns: DataColumn<VendorPoRow>[] = [
    {
      key: "po_number",
      label: "PO number",
      pinned: true,
      width: 160,
      sortValue: (po) => po.po_number,
      render: (po) => (
        <Link href={withFrom(`/purchase-orders/${po.id}`, from)} className={LINK}>
          {po.po_number}
        </Link>
      ),
    },
    {
      key: "location",
      label: "Shop",
      width: 80,
      sortValue: (po) => po.location_code,
      render: (po) => <span className="text-muted">{po.location_code}</span>,
    },
    {
      key: "order_date",
      label: "Ordered",
      width: 130,
      sortValue: (po) => po.order_date,
      render: (po) => <span className="tabular-nums text-muted">{po.order_date}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (po) => PO_STATUS_ORDER.indexOf(po.status),
      render: (po) => (
        <span
          className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[po.status]}`}
        >
          {PO_STATUS_LABEL[po.status]}
        </span>
      ),
    },
    {
      key: "delivery_date",
      label: "Delivery",
      width: 130,
      hideWhenCompact: true,
      sortValue: (po) => po.delivery_date,
      render: (po) => (
        <span className="tabular-nums text-muted">{po.delivery_date ?? "—"}</span>
      ),
    },
    {
      key: "lines",
      label: "Lines",
      width: 78,
      align: "right",
      hideWhenCompact: true,
      sortValue: (po) => po.line_count,
      render: (po) => <span className="text-muted">{po.line_count}</span>,
    },
    {
      key: "total",
      label: "Ordered",
      width: 120,
      align: "right",
      sortValue: (po) => po.ordered_total,
      render: (po) => <span className="text-body">{money(po.ordered_total)}</span>,
    },
    {
      key: "received_total",
      label: "Received",
      width: 120,
      align: "right",
      sortValue: (po) => po.received_total,
      render: (po) => (
        <span
          className={
            // The list's own rule: a received total short of the order is the
            // thing worth an eye.
            po.status === "received" && po.received_total < po.ordered_total - 0.005
              ? "font-semibold text-accent"
              : "text-muted"
          }
        >
          {money(po.received_total)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={orders}
      columns={columns}
      rowKey={(po) => po.id}
      storageKey="rf.vendorPurchaseOrders.v1"
      defaultSort={{ key: "order_date", dir: "desc" }}
      compactBelow={1100}
      leading={
        <div className="space-y-1">
          <SectionHeading count={orders.length}>Purchase orders</SectionHeading>
          {capped && (
            <p className="text-sm text-muted">
              The most recent {VENDOR_PO_CAP}. Older orders are on the purchase order list.
            </p>
          )}
        </div>
      }
      totals={(rows) => ({
        total: (
          <span className="font-semibold text-ink">
            {money(rows.reduce((s, r) => s + r.ordered_total, 0))}
          </span>
        ),
        received_total: (
          <span className="font-semibold text-ink">
            {money(rows.reduce((s, r) => s + r.received_total, 0))}
          </span>
        ),
      })}
      empty={<p className="text-sm text-muted">No purchase orders for this vendor.</p>}
    />
  );
}
