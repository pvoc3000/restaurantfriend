"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { payPeriodDetailHref } from "@/lib/payPeriodRoutes";
import { usePublishRecordSet } from "@/lib/recordSet";
import { makeComparator, type SortDir, type SortValue } from "@/lib/tableSort";
import {
  PAY_PERIOD_STATUS_LABEL,
  PAY_PERIOD_STATUS_CLASS,
  formatPeriodRange,
  daysBetween,
  type PayPeriodStatus,
} from "@/lib/payPeriods";
import { NewPayPeriod } from "./NewPayPeriod";

const WIDTHS_STORAGE_KEY = "rf.payPeriods.columnWidths.v1";

export type PayPeriodRow = {
  id: string;
  legacy_id: string | null;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
  notes: string | null;
  exported_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
};

type SortKey = "start" | "end" | "status" | "days" | "notes";
/** `current` is the roll-up: anything not yet closed. */
type Filter = "current" | PayPeriodStatus | "all";

/**
 * The payroll calendar.
 *
 * Sorted NEWEST FIRST by default, which is the opposite of every catalog list
 * and right here: a pay period is a diary, and the fortnight you want is
 * almost always the one that just ended. The 178 loaded from FileMaker run back
 * to 2019 and you will never scroll to them.
 *
 * The status filter carries a roll-up the way the PO list's `open` does, and
 * for the same reason — the raw statuses answer "what state is this in", and
 * the roll-up answers the question you actually came with. Here that question
 * is "what still needs me", so `Current` means NOT CLOSED: an exported period
 * is still live work (it can be reopened, and payroll hasn't run), where a
 * closed one is inert.
 */
export function PayPeriodsList({
  rows,
  canWrite,
  today,
  settings,
}: {
  rows: PayPeriodRow[];
  canWrite: boolean;
  today: string;
  /** `orgs.settings.payroll` — the fortnight, per design rule 2. */
  settings?: unknown;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("current");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "start",
    dir: "desc",
  });

  function sortValue(row: PayPeriodRow, key: SortKey): SortValue {
    switch (key) {
      case "start":
        return row.start_date;
      case "end":
        return row.end_date;
      case "status":
        return row.status;
      case "days":
        return daysBetween(row.start_date, row.end_date);
      case "notes":
        return row.notes;
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, current: 0 };
    for (const r of rows) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (r.status !== "closed") c.current += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "current" && r.status === "closed") return false;
      if (filter !== "current" && filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return `${formatPeriodRange(r)} ${r.start_date} ${r.end_date} ${r.notes ?? ""} ${
        PAY_PERIOD_STATUS_LABEL[r.status]
      }`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, filter]);

  const sorted = useMemo(
    () =>
      [...shown].sort(
        makeComparator<PayPeriodRow>({
          value: (r) => sortValue(r, sort.key),
          dir: sort.dir,
          // Start date is unique per org — 027 forbids overlap — so it is the
          // last word, the way the PO number is on the PO list.
          tiebreaks: [(r) => r.start_date],
        })
      ),
    [shown, sort.key, sort.dir]
  );

  usePublishRecordSet(
    "/pay-periods",
    useMemo(() => sorted.map((p) => ({ id: p.id, href: payPeriodDetailHref(p.id) })), [sorted])
  );

  // Bands only when the SORT is the grouped column — DataTable's rule, and what
  // stops a heading appearing every few rows. Status is the only column here
  // with few values and many rows each, which is the test.
  const group: DataGroup<PayPeriodRow> = {
    label: (r) => PAY_PERIOD_STATUS_LABEL[r.status],
    sortKey: "status",
  };

  const LINK =
    "text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900";

  const columns: DataColumn<PayPeriodRow>[] = [
    {
      key: "start",
      label: "Pay period",
      width: 300,
      // This IS the row — there is no other way to tell one fortnight from
      // another, so it can't be hidden.
      pinned: true,
      sortValue: (r) => sortValue(r, "start"),
      render: (r) => (
        <Link href={payPeriodDetailHref(r.id)} className={LINK}>
          {formatPeriodRange(r)}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 160,
      sortValue: (r) => sortValue(r, "status"),
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: "dates",
      label: "Dates",
      width: 230,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "start"),
      render: (r) => (
        <span className="text-muted tabular-nums">
          {r.start_date} → {r.end_date}
        </span>
      ),
    },
    {
      key: "days",
      label: "Days",
      width: 90,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "days"),
      render: (r) => {
        const n = daysBetween(r.start_date, r.end_date);
        // 178 of 178 are 14 days, so anything else is worth the eye — YELLOW,
        // which is this app's "worth your eye" and not its "wrong". A 7-day
        // period is legal and configurable, just unusual here.
        return (
          <span className={`tabular-nums ${n === 14 ? "text-muted" : "bg-mark-fill px-1 text-ink"}`}>
            {n}
          </span>
        );
      },
    },
    {
      key: "notes",
      label: "Note",
      width: 320,
      hideWhenCompact: true,
      sortValue: (r) => sortValue(r, "notes"),
      render: (r) => <span className="text-muted">{r.notes ?? "—"}</span>,
    },
  ];

  /**
   * The PO list's convention, and for its reasons: both ROLL-UPS are shown
   * always, and an empty raw status is dropped from the row. "Open 0" says
   * nothing is in that state right now, which is noise; "Current 0" says
   * nothing is outstanding, which is the answer you came for.
   *
   * All leads, Current sits second as the working list, and the raw statuses
   * after it are ways of narrowing that.
   */
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "current", label: "Current" },
    ...(["open", "review", "exported", "closed"] as PayPeriodStatus[])
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => ({ key: s as Filter, label: PAY_PERIOD_STATUS_LABEL[s] })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <TextInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search pay periods"
          aria-label="Search pay periods"
          clearLabel="Clear the search"
          className="h-9 w-72 text-sm"
        />
        <TabPicker
          ariaLabel="Filter by status"
          value={filter}
          onChange={setFilter}
          options={filters.map((f) => ({
            key: f.key,
            label: f.label,
            count: counts[f.key] ?? 0,
          }))}
        />
        <span className="text-sm text-muted">
          {shown.length === rows.length
            ? `${rows.length} period${rows.length === 1 ? "" : "s"}`
            : `${shown.length} of ${rows.length}`}
        </span>
        {canWrite && (
          // Right-aligned in the filter row — the template `NewEmployee` set for
          // the app's first create, and the one every list follows.
          <div className="ml-auto">
            <NewPayPeriod rows={rows} today={today} settings={settings} />
          </div>
        )}
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        compactBelow={1280}
        group={group}
        sort={sort}
        onSortChange={(next) => setSort({ key: next.key as SortKey, dir: next.dir })}
        empty={
          // "No rows match that filter" is the wrong sentence when the filter is
          // Current and every period is closed — nothing is being hidden, there
          // simply is no live fortnight, and the answer is to open one. Which is
          // exactly the state the app lands in after the historical load, so
          // this is the FIRST thing anyone sees on this screen.
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "No pay periods yet. Open the first one to start recording hours."
              : filter === "current"
                ? "No period is open. Payroll has nowhere to record hours until you open the next fortnight."
                : "No pay periods match that filter."}
          </p>
        }
      />
    </div>
  );
}

/** The PO list's chip, exactly — same box, same type, same class vocabulary. */
export function StatusChip({ status }: { status: PayPeriodStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PAY_PERIOD_STATUS_CLASS[status]}`}
    >
      {PAY_PERIOD_STATUS_LABEL[status]}
    </span>
  );
}
