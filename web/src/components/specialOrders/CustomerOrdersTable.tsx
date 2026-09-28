"use client";

import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { KIND_LABEL, STATUS_LABEL, money, type SpecialOrderStatus } from "@/lib/specialOrders";

export type CustomerOrderRow = {
  id: string;
  number: string;
  kind: string;
  status: SpecialOrderStatus | null;
  title: string | null;
  event_date: string | null;
  total: number;
  /** What this table says is owed on the order; 0 for nothing. */
  due: number;
};

/**
 * A customer's orders — the whole list on their record's Orders tab, or the
 * ones owed and not invoiced on its Billing tab.
 */
export function CustomerOrdersTable({
  heading,
  rows,
  from,
  storageKey,
  accent = false,
}: {
  heading: string;
  rows: CustomerOrderRow[];
  /** Where a row's link comes back to — this customer, this tab. */
  from: Crumb;
  storageKey: string;
  /** The Due figures in the accent: every row here is owed. */
  accent?: boolean;
}) {
  const columns: DataColumn<CustomerOrderRow>[] = [
    {
      key: "number",
      label: "Number",
      pinned: true,
      width: 110,
      sortValue: (o) => o.number,
      render: (o) => (
        <Link href={withFrom(`/special-orders/${o.id}`, from)} className="tabular-nums hover:underline">
          {o.number}
        </Link>
      ),
    },
    {
      key: "event_date",
      label: "Event",
      width: 130,
      sortValue: (o) => o.event_date,
      render: (o) => <span className="tabular-nums text-muted">{o.event_date ?? "—"}</span>,
    },
    {
      key: "title",
      label: "What",
      width: 320,
      sortValue: (o) => o.title,
      render: (o) => <span className="text-muted">{o.title ?? "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (o) => statusText(o),
      render: (o) => <span className="text-muted">{statusText(o)}</span>,
    },
    {
      key: "total",
      label: "Total",
      width: 120,
      align: "right",
      sortValue: (o) => o.total,
      render: (o) => <span className="tabular-nums">{money(o.total)}</span>,
    },
    {
      key: "due",
      label: "Due",
      width: 120,
      align: "right",
      sortValue: (o) => o.due,
      render: (o) => (
        <span className={`tabular-nums ${accent ? "text-accent" : "text-faint"}`}>
          {o.due > 0 ? money(o.due) : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(o) => o.id}
      storageKey={storageKey}
      defaultSort={{ key: "event_date", dir: "desc" }}
      compactBelow={900}
      leading={<SectionHeading count={rows.length}>{heading}</SectionHeading>}
      empty={<p className="text-sm text-muted">Nothing here.</p>}
    />
  );
}

function statusText(o: CustomerOrderRow): string {
  return o.kind === "order" ? (o.status ? STATUS_LABEL[o.status] : "—") : KIND_LABEL[o.kind as never];
}
