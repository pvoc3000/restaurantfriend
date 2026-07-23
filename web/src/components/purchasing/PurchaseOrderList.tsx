"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  money,
  PO_STATUS_CLASS,
  PO_STATUS_LABEL,
  PO_STATUS_ORDER,
  type PoStatus,
} from "@/lib/purchaseOrders";
import {
  poDetailHref,
  poFiltersToQuery,
  poListHref,
  RANGES,
  type PoFilters,
  type PoSortKey,
  type RangeKey,
  type StatusFilter,
} from "@/lib/poFilters";
import { makeComparator, type SortValue } from "@/lib/tableSort";
import { withFrom } from "@/lib/breadcrumbs";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import type { PoListRow } from "@/app/(app)/purchase-orders/page";

function sortValue(po: PoListRow, key: PoSortKey): SortValue {
  switch (key) {
    case "po_number":
      return po.po_number;
    case "order_date":
      return po.order_date;
    case "vendor":
      return po.vendors?.name ?? null;
    case "status":
      return PO_STATUS_ORDER.indexOf(po.status);
    case "lines":
      return po.line_count;
    case "total":
      return po.ordered_total;
  }
}

/**
 * The PO list — the Monday workflow surface (spec §4.8): status at a glance,
 * a totals row, and selection for the batch operations that follow once PDF
 * generation exists.
 */
export function PurchaseOrderList({
  orders,
  initialFilters,
  activeLocationCode,
  capped,
}: {
  orders: PoListRow[];
  initialFilters: PoFilters;
  activeLocationCode: string;
  capped: boolean;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<PoFilters>(initialFilters);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function update(patch: Partial<PoFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = poFiltersToQuery(next);
    window.history.replaceState(
      null,
      "",
      query ? `/purchase-orders?${query}` : "/purchase-orders"
    );
  }

  // The date window is a server filter, so changing it must re-run the page —
  // router.push, not the replaceState the other filters use.
  function setRange(range: RangeKey) {
    router.push(poListHref({ ...filters, range }));
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const po of orders) counts[po.status] = (counts[po.status] ?? 0) + 1;
    return counts;
  }, [orders]);

  const visible = useMemo(() => {
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return orders.filter((po) => {
      if (filters.status !== "all" && po.status !== filters.status) return false;
      if (words.length === 0) return true;
      const haystack = `${po.po_number} ${po.vendors?.name ?? ""} ${po.status}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [orders, filters.status, filters.q]);

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<PoListRow>({
          value: (po) => sortValue(po, filters.sort),
          dir: filters.dir,
          tiebreaks: [(po) => po.po_number],
        })
      ),
    [visible, filters.sort, filters.dir]
  );

  const pageTotal = useMemo(
    () => visible.reduce((sum, po) => sum + po.ordered_total, 0),
    [visible]
  );
  const selectedTotal = useMemo(
    () =>
      visible
        .filter((po) => checked.has(po.id))
        .reduce((sum, po) => sum + po.ordered_total, 0),
    [visible, checked]
  );

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleChecked =
    sorted.length > 0 && sorted.every((po) => checked.has(po.id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) sorted.forEach((po) => next.delete(po.id));
      else sorted.forEach((po) => next.add(po.id));
      return next;
    });
  }

  const columns: DataColumn<PoListRow>[] = [
    {
      key: "select",
      label: "",
      width: 32,
      render: (po) => (
        <input
          type="checkbox"
          checked={checked.has(po.id)}
          onChange={() => toggleOne(po.id)}
          aria-label={`select ${po.po_number}`}
        />
      ),
    },
    {
      key: "po_number",
      label: "PO number",
      width: 140,
      sortValue: (po) => po.po_number,
      render: (po) => (
        <Link
          href={poDetailHref(po.id, filters)}
          className="text-blue-700 hover:underline"
        >
          {po.po_number}
        </Link>
      ),
    },
    {
      key: "order_date",
      label: "Ordered",
      width: 110,
      sortValue: (po) => po.order_date,
      render: (po) => <span className="tabular-nums text-neutral-600">{po.order_date}</span>,
    },
    {
      key: "vendor",
      label: "Vendor",
      width: 200,
      sortValue: (po) => po.vendors?.name ?? null,
      render: (po) =>
        po.vendors ? (
          <Link
            href={withFrom(`/vendors/${po.vendors.id}`, {
              href: poListHref(filters),
              label: "POs",
            })}
            className="text-blue-700 hover:underline"
          >
            {po.vendors.name}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 110,
      sortValue: (po) => PO_STATUS_ORDER.indexOf(po.status),
      render: (po) => (
        <span className={`rounded px-1.5 py-0.5 text-xs ${PO_STATUS_CLASS[po.status]}`}>
          {PO_STATUS_LABEL[po.status]}
        </span>
      ),
    },
    {
      key: "sent_via",
      label: "Sent via",
      width: 100,
      sortValue: (po) => po.sent_via,
      render: (po) => <span className="text-neutral-600">{po.sent_via ?? "—"}</span>,
    },
    {
      key: "delivery_date",
      label: "Delivery",
      width: 110,
      sortValue: (po) => po.delivery_date,
      render: (po) => (
        <span className="tabular-nums text-neutral-600">{po.delivery_date ?? "—"}</span>
      ),
    },
    {
      key: "lines",
      label: "Lines",
      width: 70,
      align: "right",
      sortValue: (po) => po.line_count,
      render: (po) => <span className="text-neutral-600">{po.line_count}</span>,
    },
    {
      key: "total",
      label: "Ordered",
      width: 110,
      align: "right",
      sortValue: (po) => po.ordered_total,
      render: (po) => <span className="text-neutral-700">{money(po.ordered_total)}</span>,
    },
    {
      key: "received_total",
      label: "Received",
      width: 110,
      align: "right",
      sortValue: (po) => po.received_total,
      render: (po) => (
        <span
          className={
            // A received total short of what was ordered is the signal worth
            // catching on this screen.
            po.status === "received" && po.received_total < po.ordered_total - 0.005
              ? "text-amber-700"
              : "text-neutral-600"
          }
        >
          {money(po.received_total)}
        </span>
      ),
    },
  ];

  const statusTabs: StatusFilter[] = [
    "all",
    ...PO_STATUS_ORDER.filter((s) => (statusCounts[s] ?? 0) > 0),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <span className="text-sm text-neutral-500">
          {visible.length} of {orders.length} · {activeLocationCode}
        </span>
        <span className="ml-auto text-sm text-neutral-600">
          Total <span className="font-medium tabular-nums">{money(pageTotal)}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search PO number or vendor…"
          className="w-64 rounded border border-neutral-300 px-2 py-1 text-sm"
        />

        <div className="flex items-center gap-1 text-sm">
          {statusTabs.map((s) => (
            <button
              key={s}
              onClick={() => update({ status: s })}
              className={`rounded px-2 py-1 ${
                filters.status === s
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {s === "all" ? "All" : PO_STATUS_LABEL[s as PoStatus]}
              <span
                className={`ml-1.5 ${
                  filters.status === s ? "text-neutral-300" : "text-neutral-400"
                }`}
              >
                {s === "all" ? orders.length : statusCounts[s] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-neutral-400">Window</span>
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded px-2 py-1 ${
                filters.range === r.key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {capped && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Showing the 500 most recent orders in this window — narrow the window
          to see everything in it.
        </p>
      )}

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>{checked.size} selected</span>
          <span className="tabular-nums text-neutral-600">{money(selectedTotal)}</span>
          <span className="text-neutral-500">
            Batch process and shopping lists arrive with PO generation.
          </span>
          <button
            onClick={() => setChecked(new Set())}
            className="ml-auto text-neutral-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allVisibleChecked}
          onChange={toggleAllVisible}
          aria-label="select all"
        />
        <span className="text-neutral-500">Select all shown</span>
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(po) => po.id}
        storageKey="rf.purchaseOrders.columnWidths.v1"
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as PoSortKey, dir: next.dir })
        }
        empty={<p className="text-sm text-neutral-600">No orders in this window.</p>}
      />
    </div>
  );
}
