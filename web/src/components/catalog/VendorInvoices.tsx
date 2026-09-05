"use client";

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import {
  BILL_STAGE_CLASS,
  BILL_STAGE_LABEL,
  BILL_STAGE_ORDER,
  agingBucket,
  billStage,
  type InvoiceStatus,
} from "@/lib/invoices";
import { money } from "@/lib/purchaseOrders";

/** One bill from this vendor. What the vendor record's Invoices tab shows —
 *  the RECORD, never the scanned document (Mark, 2026-09-05). */
export type VendorInvoiceRow = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total: number | null;
  is_credit: boolean;
  status: InvoiceStatus;
  location_code: string;
  /** The orders its lines point at, derived exactly as `/invoices` derives
   *  them — never a header claim. */
  purchase_orders: { id: string; po_number: string }[];
  /** The PRESENCE of a QuickBooks link, never the id (086's rule). */
  qbo_linked: boolean;
  qbo_balance: number | null;
  qbo_checked_at: string | null;
};

/** Cap on the fetch — the same 500 `/invoices` stops at. */
export const VENDOR_INVOICE_CAP = 500;

const LINK =
  "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

function signedTotal(i: VendorInvoiceRow): number {
  const t = Number(i.total ?? 0);
  return i.is_credit ? -t : t;
}

function stageOf(i: VendorInvoiceRow) {
  return billStage({
    status: i.status,
    linked: i.qbo_linked,
    qbo_balance: i.qbo_balance,
    qbo_checked_at: i.qbo_checked_at,
  });
}

/**
 * A vendor's invoices — `/invoices` read rather than worked (Mark,
 * 2026-09-05: "a simplified version of the invoices screen"). No aging tiers,
 * no status menu, no selection bar, no Check QuickBooks, no New invoice: from
 * the vendor's record the question is "what have they billed us", and the
 * answer is the rows, newest first, each a link to the bill.
 *
 * Vendor column gone (every row is this vendor), Shop column in its place —
 * see `VendorPurchaseOrders` and `lib/vendors` for why this reads across
 * every shop. Files and Lines are dropped; the Status chip is the list's own
 * `billStage` ladder so Paid and Submitted read the same here as there, and
 * an overdue OPEN bill is red by the list's own rule.
 */
export function VendorInvoices({
  invoices,
  from,
  today,
  capped,
}: {
  invoices: VendorInvoiceRow[];
  from: Crumb;
  /** The org's calendar day (lib/today) — the overdue test is measured from it. */
  today: string;
  capped: boolean;
}) {
  const columns: DataColumn<VendorInvoiceRow>[] = [
    {
      key: "invoice_number",
      label: "Invoice",
      pinned: true,
      width: 150,
      sortValue: (i) => i.invoice_number,
      render: (i) => (
        <Link href={withFrom(`/invoices/${i.id}`, from)} className={LINK}>
          {i.invoice_number ?? <span className="text-faint">No number</span>}
        </Link>
      ),
    },
    {
      key: "location",
      label: "Shop",
      width: 80,
      sortValue: (i) => i.location_code,
      render: (i) => <span className="text-muted">{i.location_code}</span>,
    },
    {
      key: "invoice_date",
      label: "Invoiced",
      width: 120,
      sortValue: (i) => i.invoice_date,
      render: (i) => (
        <span className="tabular-nums text-muted">{i.invoice_date ?? "—"}</span>
      ),
    },
    {
      key: "due_date",
      label: "Due",
      width: 120,
      hideWhenCompact: true,
      sortValue: (i) => i.due_date,
      render: (i) => {
        const overdue = i.status === "open" && agingBucket(i.due_date, today) === "overdue";
        return (
          <span
            className={
              overdue ? "font-semibold tabular-nums text-accent" : "tabular-nums text-muted"
            }
          >
            {i.due_date ?? "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      sortValue: (i) => BILL_STAGE_ORDER.indexOf(stageOf(i)),
      render: (i) => {
        const stage = stageOf(i);
        return (
          <span
            className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${BILL_STAGE_CLASS[stage]}`}
          >
            {BILL_STAGE_LABEL[stage]}
          </span>
        );
      },
    },
    {
      key: "po",
      label: "PO",
      width: 160,
      hideWhenCompact: true,
      sortValue: (i) => i.purchase_orders[0]?.po_number ?? null,
      render: (i) => {
        if (i.purchase_orders.length === 0) return <span className="text-faint">—</span>;
        const [first, ...rest] = i.purchase_orders;
        return (
          <span className="text-muted">
            <Link href={withFrom(`/purchase-orders/${first.id}`, from)} className={LINK}>
              {first.po_number}
            </Link>
            {rest.length > 0 && ` +${rest.length}`}
          </span>
        );
      },
    },
    {
      key: "total",
      label: "Total",
      width: 135,
      align: "right",
      sortValue: (i) => signedTotal(i),
      render: (i) => (
        <span className={i.is_credit ? "font-semibold text-accent" : "text-body"}>
          {money(signedTotal(i))}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={invoices}
      columns={columns}
      rowKey={(i) => i.id}
      storageKey="rf.vendorInvoices.v1"
      defaultSort={{ key: "invoice_date", dir: "desc" }}
      compactBelow={1100}
      leading={
        <div className="space-y-1">
          <SectionHeading count={invoices.length}>Invoices</SectionHeading>
          {capped && (
            <p className="text-sm text-muted">
              The most recent {VENDOR_INVOICE_CAP}. Older bills are on the invoice list.
            </p>
          )}
        </div>
      }
      totals={(rows) => ({
        total: (
          <span className="font-semibold text-ink">
            {money(rows.reduce((s, r) => s + signedTotal(r), 0))}
          </span>
        ),
      })}
      empty={<p className="text-sm text-muted">No invoices from this vendor.</p>}
    />
  );
}
