"use client";

import { useMemo, useState, type ReactNode } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import type { SortDir } from "@/lib/tableSort";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { usePublishRecordSet } from "@/lib/recordSet";
import { batchDate } from "@/lib/productionBatches";
import {
  BATCH_LOG_RANGES,
  batchLogRangeHref,
  type BatchLogRange,
} from "@/lib/batchLogFilters";

export type BatchLogRow = {
  id: string;
  log_date: string;
  kitchenCode: string;
  status: string;
  generatedByName: string | null;
  generated_at: string | null;
  printed_at: string | null;
  note: string | null;
  /** Its items, rolled up — the two figures the list exists to answer. */
  batches: number;
  done: number;
};

type Tier = "open" | "today" | "complete" | "all";
type Grouping = "date" | "location" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: BatchLogRow) => string> = {
  date: (r) => batchDate(r.log_date),
  location: (r) => r.kitchenCode,
};

/** What the BANDS sort by, which is not what they say — a date's label sorts
 *  alphabetically and reads Mon, Thu, Tue. */
const GROUP_KEY: Record<Exclude<Grouping, "none">, (r: BatchLogRow) => string> = {
  date: (r) => r.log_date,
  location: (r) => r.kitchenCode,
};

/**
 * The batch logs — the MASTER records.
 *
 * Mark, 2026-08-09: "a batch log record is really just a date the log was
 * generated, who generated it, what the status is … basically a way to
 * associate batch logs together." So this list is one row per DOCUMENT, and
 * opening one shows the batches on it.
 *
 * The column that earns its place is DONE — "18 of 26" — because "how far
 * through is that day" is the question you open this screen with, and it is the
 * one thing no other column can be scanned for.
 */
export function BatchLogsIndex({
  rows,
  range,
  params,
  locationCode,
  action,
  note,
}: {
  rows: BatchLogRow[];
  /**
   * How far back the SERVER fetched. Unlike every other control on this list it
   * is not local state: it bounds the query, so it has to reach the server
   * component, which means the URL (see lib/batchLogFilters).
   */
  range: BatchLogRange;
  /** Whatever else is in the URL, so a range chip keeps it. */
  params: Record<string, string | string[] | undefined>;
  /** The working shop, for the heading's count line. */
  locationCode?: string | null;
  /** The screen's create command, beside the title. */
  action?: ReactNode;
  /** A line under the heading — what the count alone cannot say. */
  note?: ReactNode;
}) {
  // ALL, not Open (Mark, 2026-08-09). Open was the right default while this
  // screen held one row: a log is a thing you work, so the one being worked is
  // what you came for. 046 changed the shape of the list under it — 439 of
  // DF02's 440 logs are complete history — so the default now hid 99.8% of the
  // screen and read as an empty page beside a chip saying "Complete 439".
  const [tier, setTier] = useState<Tier>("all");
  const [grouping, setGrouping] = useState<Grouping>("none");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "desc" });

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const counts = useMemo(
    () => ({
      open: rows.filter((r) => r.status === "open").length,
      today: rows.filter((r) => r.log_date === today).length,
      complete: rows.filter((r) => r.status === "complete").length,
      all: rows.length,
    }),
    [rows, today]
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "open" && r.status !== "open") return false;
      if (tier === "today" && r.log_date !== today) return false;
      if (tier === "complete" && r.status !== "complete") return false;
      if (!q) return true;
      return [r.log_date, r.kitchenCode, r.generatedByName ?? "", r.note ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, tier, term, today]);

  const visible = useMemo(() => {
    const value = (r: BatchLogRow): string | number => {
      switch (sort.key) {
        case "date": return r.log_date;
        case "location": return r.kitchenCode;
        case "status": return r.status;
        case "batches": return r.batches;
        case "done": return r.batches === 0 ? -1 : r.done / r.batches;
        case "generated": return r.generatedByName ?? "";
        case "printed": return r.printed_at ?? "";
        default: return r.log_date;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    const groupOf = grouping === "none" ? null : GROUP_KEY[grouping];
    return [...shown].sort((a, b) => {
      if (groupOf) {
        const ag = groupOf(a), bg = groupOf(b);
        // Dates band newest first, like the schedules list: an ascending band
        // would put last month at the top of the screen.
        if (ag !== bg) return (ag < bg ? -1 : 1) * (grouping === "date" ? -1 : 1);
      }
      const av = value(a), bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.kitchenCode < b.kitchenCode ? -1 : 1;
    });
  }, [shown, sort, grouping]);

  usePublishRecordSet(
    "/batch-logs",
    visible.map((r) => ({ id: r.id, href: `/batch-logs/${r.id}` }))
  );

  const columns: DataColumn<BatchLogRow>[] = [
    {
      key: "date",
      label: "Date",
      width: 150,
      pinned: true,
      sortValue: (r) => r.log_date,
      render: (r) => (
        <Link href={`/batch-logs/${r.id}`} className="font-medium hover:underline">
          {batchDate(r.log_date)}
        </Link>
      ),
    },
    {
      key: "location",
      label: "Location",
      width: 110,
      sortValue: (r) => r.kitchenCode,
      render: (r) => <span className="font-medium">{r.kitchenCode}</span>,
    },
    {
      key: "batches",
      label: "Batches",
      width: 100,
      align: "right",
      sortValue: (r) => r.batches,
      render: (r) => <span className="tabular-nums text-muted">{r.batches}</span>,
    },
    {
      key: "done",
      label: "Done",
      width: 130,
      align: "right",
      sortValue: (r) => (r.batches === 0 ? -1 : r.done / r.batches),
      // How far through the day is. Yellow while there is work left — worth an
      // eye, never wrong; a log with batches outstanding is the normal state of
      // one somebody is working.
      render: (r) => {
        if (r.batches === 0) return <span className="text-faint">—</span>;
        const left = r.batches - r.done;
        return (
          <span
            className={`tabular-nums ${left > 0 ? "text-mark" : "text-muted"}`}
            title={left > 0 ? `${left} still to make` : "Everything on this log is done"}
          >
            {r.done} of {r.batches}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      sortValue: (r) => r.status,
      render: (r) =>
        r.status === "complete" ? (
          <span className={`${READ_ONLY_VALUE} text-muted`}>Complete</span>
        ) : (
          <span className={`${READ_ONLY_VALUE}`}>Open</span>
        ),
    },
    {
      key: "generated",
      label: "Generated by",
      width: 160,
      sortValue: (r) => r.generatedByName ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.generatedByName ? (
          <span className="text-muted">{r.generatedByName}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "printed",
      label: "Printed",
      width: 130,
      sortValue: (r) => r.printed_at ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.printed_at ? (
          <span className="text-muted">{r.printed_at.slice(0, 10)}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "note",
      label: "Note",
      width: 220,
      wrap: true,
      sortValue: (r) => r.note ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.note ? <span>{r.note}</span> : <span className="text-faint">—</span>,
    },
  ];

  const group: DataGroup<BatchLogRow> | undefined =
    grouping === "none" ? undefined : { label: GROUP_LABEL[grouping] };

  return (
    <div className="space-y-4">
      <PageHeading
        title="Batch Logs"
        code={locationCode}
        visible={visible.length}
        total={rows.length}
        noun="logs"
      />

      {/* Its own filter row, above the table — `PlansList`'s change and reason. */}
      <div className="flex flex-wrap items-end gap-4">
        <TextInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search date, kitchen, note…"
          aria-label="Search batch logs"
          className="w-64"
        />
        {/* HREF CELLS, not an onChange — this one is a navigation, because the
            rows it wants do not exist on the client yet. The order guide's day
            strip is the same control for the same reason. */}
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Show
          </span>
          <TabPicker
            ariaLabel="How far back to look"
            value={range}
            options={BATCH_LOG_RANGES.map((r) => ({
              key: r.key,
              label: r.label,
              href: batchLogRangeHref(r.key, params),
            }))}
          />
        </div>
        <TabPicker
          ariaLabel="Which logs"
          value={tier}
          onChange={setTier}
          options={[
            { key: "open" as Tier, label: "Open", count: counts.open },
            { key: "today" as Tier, label: "Today", count: counts.today },
            { key: "complete" as Tier, label: "Complete", count: counts.complete },
            { key: "all" as Tier, label: "All", count: counts.all },
          ]}
        />
        <div className="space-y-1.5">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Group by
          </span>
          <TabPicker
            ariaLabel="Group the logs"
            value={grouping}
            onChange={setGrouping}
            options={[
              { key: "none" as Grouping, label: "None" },
              { key: "date" as Grouping, label: "Date" },
              { key: "location" as Grouping, label: "Location" },
            ]}
          />
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {note}
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-batch-log-index"
      compactBelow={1100}
      columnChooser
      group={group}
      sort={sort}
      onSortChange={setSort}
      empty={<p className="text-sm text-muted">No logs match.</p>}
    />
    </div>
  );
}
