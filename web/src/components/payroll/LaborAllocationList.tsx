"use client";

import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { laborPostingState, monthLabel, percentText, type LaborPostingRef } from "@/lib/laborAllocation";
import { LaborAllocationDialog } from "./LaborAllocationDialog";

export type LaborMonthRow = {
  /** The first of the month. */
  month: string;
  /** Hours by shop code. */
  hours: Record<string, number>;
  unassignedHours: number;
  totalHours: number;
  external_ref: LaborPostingRef | null;
  posted_at: string | null;
  post_error: string | null;
  /** The month is not over yet. */
  current: boolean;
};

function hoursText(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * The months, newest first: each shop's hours and share, and whether the
 * split is in QuickBooks. Review… reads the month's labor out of QuickBooks
 * and shows the entry before anything is sent.
 */
export function LaborAllocationList({
  orgId,
  rows,
  shopCodes,
  editable,
}: {
  orgId: string;
  rows: LaborMonthRow[];
  shopCodes: string[];
  editable: boolean;
}) {
  const [open, setOpen] = useState<LaborMonthRow | null>(null);

  const columns: DataColumn<LaborMonthRow>[] = [
    {
      key: "month",
      label: "Month",
      width: 170,
      pinned: true,
      sortValue: (r) => r.month,
      render: (r) => (
        <span>
          {monthLabel(r.month)}
          {r.current ? <span className="ml-2 text-[11px] text-muted">so far</span> : null}
        </span>
      ),
    },
    ...shopCodes.map<DataColumn<LaborMonthRow>>((code) => ({
      key: `shop-${code}`,
      label: code,
      width: 150,
      align: "right",
      sortValue: (r) => r.hours[code] ?? 0,
      render: (r) => {
        const h = r.hours[code] ?? 0;
        if (!h) return <span className="text-faint">—</span>;
        return (
          <span className="tabular-nums">
            {hoursText(h)} h <span className="text-muted">· {percentText(r.totalHours ? h / r.totalHours : 0)}</span>
          </span>
        );
      },
    })),
    {
      key: "total",
      label: "Hours",
      width: 110,
      align: "right",
      sortValue: (r) => r.totalHours,
      render: (r) =>
        r.totalHours ? <span className="tabular-nums">{hoursText(r.totalHours)}</span> : <span className="text-faint">—</span>,
    },
    {
      key: "quickbooks",
      label: "QuickBooks",
      width: 200,
      sortValue: (r) => laborPostingState(r),
      render: (r) => {
        const state = laborPostingState(r);
        if (state === "failed") return <span className="text-accent">Failed</span>;
        if (state === "posted") {
          return (
            <span>
              {r.external_ref?.qbo?.doc_number ?? "Posted"}
              {r.posted_at ? <span className="ml-2 text-[11px] text-muted tabular-nums">{r.posted_at.slice(0, 10)}</span> : null}
            </span>
          );
        }
        return <span className="text-faint">—</span>;
      },
    },
    {
      key: "review",
      label: "",
      width: 110,
      render: (r) =>
        r.totalHours > 0 ? (
          <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setOpen(r)}>
            Review…
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.month}
        storageKey="rf.laborAllocation.v1"
        defaultSort={{ key: "month", dir: "desc" }}
        empty={<p className="text-sm text-muted">No timesheets in the last year.</p>}
      />
      {open ? (
        <LaborAllocationDialog orgId={orgId} row={open} editable={editable} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
