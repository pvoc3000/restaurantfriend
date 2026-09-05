"use client";

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { money } from "@/lib/purchaseOrders";
import { ITEM_PURCHASE_CAP } from "@/lib/inventoryItems";

/** One RECEIVED purchase order line of this item. */
export type ItemPurchaseRow = {
  id: string;
  po_id: string;
  po_number: string;
  order_date: string;
  vendor_name: string | null;
  /** The line's snapshot of what was bought — vendor description, brand and
   *  pack as they were the day it was ordered (013). */
  description: string | null;
  brand: string | null;
  package_desc: string | null;
  qty_ordered: number;
  qty_received: number;
  unit_price: number | null;
};

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

function lineTotal(r: ItemPurchaseRow): number {
  return r.qty_received * Number(r.unit_price ?? 0);
}

/**
 * The item's purchase history — every purchase order line of it that was
 * RECEIVED, newest first (Mark, 2026-09-05: "purchase order items for this
 * inventory item, filtered where received qty > 0"). A line ordered and never
 * received is not a purchase, so it isn't here; the order it sits on is one
 * click away through the PO number.
 *
 * THE WORKING SHOP'S ONLY (Mark, 2026-09-05), which is the opposite call
 * from the vendor record's two tabs and the right one here: a vendor is one
 * account across shops, where what DF01 paid for its flour is DF01's fact.
 * The heading names the shop so the scope is stated rather than implied.
 *
 * THE QUANTITIES ARE IN PACKAGES OF WHATEVER VENDOR ITEM THE LINE WAS, so the
 * same item bought as a 50 lb bag one week and a case of 12 the next has two
 * rows whose quantities do not add — which is why the closing row sums only
 * the MONEY. The Pack column is there so a reader can see what a "2" was two
 * of.
 */
export function ItemPurchaseHistory({
  rows,
  from,
  capped,
  locationCode,
}: {
  rows: ItemPurchaseRow[];
  from: Crumb;
  capped: boolean;
  /** The working shop, whose purchases these are. Null with no working shop,
   *  in which case there is nothing to scope by and nothing is listed. */
  locationCode: string | null;
}) {
  const columns: DataColumn<ItemPurchaseRow>[] = [
    {
      key: "po_number",
      label: "PO number",
      pinned: true,
      // 160: a PO number is 13 fixed characters ("112-181203-01") and this
      // table sits beside a 192px sidebar, so at 1280 the content column is
      // ~977px and a weight of 150 over 1275 resolved to 115px — clipped.
      // Weights are proportional; see CLAUDE.md on measuring, not guessing.
      width: 160,
      sortValue: (r) => r.po_number,
      render: (r) => (
        <Link href={withFrom(`/purchase-orders/${r.po_id}`, from)} className={LINK}>
          {r.po_number}
        </Link>
      ),
    },
    {
      key: "order_date",
      label: "Ordered",
      width: 120,
      sortValue: (r) => r.order_date,
      render: (r) => <span className="tabular-nums text-muted">{r.order_date}</span>,
    },
    {
      key: "vendor",
      label: "Vendor",
      width: 150,
      sortValue: (r) => r.vendor_name,
      render: (r) => <span className="text-body">{r.vendor_name ?? "—"}</span>,
    },
    {
      key: "description",
      label: "Description",
      width: 220,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (r) => r.description,
      render: (r) => (
        <span className="text-body">
          {r.description ?? <span className="text-faint">—</span>}
          {r.brand && <span className="text-muted"> · {r.brand}</span>}
        </span>
      ),
    },
    {
      key: "pack",
      label: "Pack",
      width: 100,
      hideWhenCompact: true,
      sortValue: (r) => r.package_desc,
      render: (r) => <span className="text-muted">{r.package_desc ?? "—"}</span>,
    },
    {
      key: "qty_ordered",
      label: "Ordered",
      width: 85,
      align: "right",
      hideWhenCompact: true,
      sortValue: (r) => r.qty_ordered,
      render: (r) => <span className="tabular-nums text-muted">{r.qty_ordered}</span>,
    },
    {
      key: "qty_received",
      label: "Received",
      width: 85,
      align: "right",
      sortValue: (r) => r.qty_received,
      render: (r) => (
        <span
          className={
            // Short of the order is the thing worth an eye — the PO list's rule.
            r.qty_received < r.qty_ordered - 0.005
              ? "font-semibold tabular-nums text-accent"
              : "tabular-nums text-body"
          }
        >
          {r.qty_received}
        </span>
      ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 105,
      align: "right",
      sortValue: (r) => r.unit_price,
      render: (r) => <span className="tabular-nums text-muted">{money(r.unit_price)}</span>,
    },
    {
      key: "total",
      label: "Total",
      width: 110,
      align: "right",
      sortValue: (r) => lineTotal(r),
      render: (r) => <span className="text-body">{money(lineTotal(r))}</span>,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="rf.itemPurchaseHistory.v1"
      defaultSort={{ key: "order_date", dir: "desc" }}
      // 1440, not the app's usual 1280: beside the record's sidebar this table
      // has ~190px less than a list does, so the tier that drops Description,
      // Pack and the ordered qty has to fire one step earlier or a 1280 laptop
      // clips the PO number. Measured, not chosen.
      compactBelow={1440}
      leading={
        <div className="space-y-1">
          <SectionHeading count={rows.length}>
            Purchase history{locationCode ? ` at ${locationCode}` : ""}
          </SectionHeading>
          {capped && (
            <p className="text-sm text-muted">The most recent {ITEM_PURCHASE_CAP} received lines.</p>
          )}
        </div>
      }
      totals={(shown) => ({
        total: (
          <span className="font-semibold text-ink">
            {money(shown.reduce((s, r) => s + lineTotal(r), 0))}
          </span>
        ),
      })}
      empty={
        <p className="text-sm text-muted">
          {locationCode
            ? `Nothing received for this item at ${locationCode} yet.`
            : "Pick a working location to see its purchase history."}
        </p>
      }
    />
  );
}
