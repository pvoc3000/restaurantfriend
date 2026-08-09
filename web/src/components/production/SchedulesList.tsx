"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import type { SortDir } from "@/lib/tableSort";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { Checkbox } from "@/components/ui/Checkbox";
import { usePublishRecordSet } from "@/lib/recordSet";
import { packetDate } from "@/lib/productionSchedule";
import { PrintPacket } from "@/components/production/PrintPacket";

export type ScheduleRow = {
  id: string;
  schedule_date: string;
  sellsCode: string;
  kitchenCode: string;
  source: string;
  title: string | null;
  generatedAt: string | null;
  printedAt: string | null;
  regenerations: number;
  note: string | null;
  lineCount: number;
  parTotal: number;
  countedLines: number;
};

type Tier = "upcoming" | "today" | "unprinted" | "all";
type Grouping = "date" | "kitchen" | "sells" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: ScheduleRow) => string> = {
  date: (r) => packetDate(r.schedule_date),
  kitchen: (r) => `Made at ${r.kitchenCode}`,
  sells: (r) => `Sold at ${r.sellsCode}`,
};

/**
 * The nights, most recent first.
 *
 * The tier that earns its place is UNPRINTED: at closing the question is "what
 * have I generated that nobody has paper for", and that is the one thing the
 * columns can't be scanned for at a glance. It is the PO list's Files column
 * doing the same job.
 *
 * Grouping is the PRIMARY sort with the chosen column sorting WITHIN each run —
 * the 2026-08-05 lesson, because `DataTable` can only band what the ORDER
 * already groups, so passing `sortKey` instead leaves a grouping that silently
 * doesn't band.
 */
export function SchedulesList({
  rows,
  editable,
  today,
}: {
  rows: ScheduleRow[];
  editable: boolean;
  today: string;
}) {
  const [tier, setTier] = useState<Tier>("upcoming");
  const [grouping, setGrouping] = useState<Grouping>("date");
  const [term, setTerm] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "desc" });

  const counts = useMemo(
    () => ({
      upcoming: rows.filter((r) => r.schedule_date >= today).length,
      today: rows.filter((r) => r.schedule_date === today).length,
      unprinted: rows.filter((r) => r.printedAt === null).length,
      all: rows.length,
    }),
    [rows, today]
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "upcoming" && r.schedule_date < today) return false;
      if (tier === "today" && r.schedule_date !== today) return false;
      if (tier === "unprinted" && r.printedAt !== null) return false;
      if (!q) return true;
      return [r.schedule_date, r.sellsCode, r.kitchenCode, r.title ?? "", r.note ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, tier, term, today]);

  const visible = useMemo(() => {
    const value = (r: ScheduleRow): string | number => {
      switch (sort.key) {
        case "date": return r.schedule_date;
        case "sells": return r.sellsCode;
        case "kitchen": return r.kitchenCode;
        case "source": return r.source;
        case "lines": return r.lineCount;
        case "par": return r.parTotal;
        case "counted": return r.countedLines;
        case "printed": return r.printedAt ?? "";
        case "regenerated": return r.regenerations;
        default: return r.schedule_date;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    const groupOf = grouping === "none" ? null : GROUP_LABEL[grouping];
    return [...shown].sort((a, b) => {
      // The group leads, ALWAYS ascending — a run is a table of contents, not
      // the thing you sorted. Except by DATE, where "most recent first" is what
      // anyone means and an ascending band would put last month at the top.
      if (groupOf) {
        const ag = groupOf(a), bg = groupOf(b);
        if (ag !== bg) {
          const lead = grouping === "date" ? -1 : 1;
          return (ag < bg ? -1 : 1) * lead;
        }
      }
      const av = value(a), bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Tiebreaks always read ascending whichever way the primary points.
      if (a.sellsCode !== b.sellsCode) return a.sellsCode < b.sellsCode ? -1 : 1;
      return a.kitchenCode < b.kitchenCode ? -1 : 1;
    });
  }, [shown, sort, grouping]);

  usePublishRecordSet(
    "/schedules",
    visible.map((r) => ({ id: r.id, href: `/schedules/${r.id}` }))
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.id));

  const columns: DataColumn<ScheduleRow>[] = [
    {
      key: "select",
      label: "",
      width: 56,
      pinned: true,
      header: (
        <Checkbox
          checked={allChecked}
          onChange={() =>
            setChecked(allChecked ? new Set() : new Set(visible.map((r) => r.id)))
          }
          label="Select every schedule shown"
          size={18}
        />
      ),
      render: (r) => (
        <Checkbox
          checked={checked.has(r.id)}
          onChange={() => toggle(r.id)}
          label={`Select ${r.schedule_date} ${r.sellsCode}`}
          size={18}
        />
      ),
    },
    {
      key: "date",
      label: "Date",
      width: 170,
      pinned: true,
      sortValue: (r) => r.schedule_date,
      render: (r) => (
        <Link href={`/schedules/${r.id}`} className="font-medium hover:underline">
          {packetDate(r.schedule_date)}
        </Link>
      ),
    },
    {
      key: "sells",
      label: "Sells at",
      width: 100,
      sortValue: (r) => r.sellsCode,
      render: (r) => <span className="font-medium">{r.sellsCode}</span>,
    },
    {
      key: "kitchen",
      label: "Made at",
      width: 100,
      sortValue: (r) => r.kitchenCode,
      // The column FileMaker could not have. A kitchen that differs from the
      // shop is decision 9's whole point, so it is emphasised; a same-shop one
      // is quiet.
      render: (r) => (
        <span className={r.kitchenCode === r.sellsCode ? "text-muted" : "font-medium"}>
          {r.kitchenCode}
        </span>
      ),
    },
    {
      key: "source",
      label: "From",
      width: 110,
      sortValue: (r) => r.source,
      hideWhenCompact: true,
      render: (r) => (
        <span className="text-muted">
          {r.source === "plan"
            ? "Plan"
            : r.source === "special_order"
              ? r.title ?? "Special order"
              : r.title ?? "By hand"}
        </span>
      ),
    },
    {
      key: "lines",
      label: "Items",
      width: 90,
      align: "right",
      sortValue: (r) => r.lineCount,
      render: (r) => <span className="tabular-nums text-muted">{r.lineCount}</span>,
    },
    {
      key: "par",
      label: "To make",
      width: 100,
      align: "right",
      sortValue: (r) => r.parTotal,
      render: (r) => <span className="tabular-nums">{r.parTotal.toLocaleString()}</span>,
    },
    {
      key: "counted",
      label: "Counted",
      width: 110,
      align: "right",
      sortValue: (r) => r.countedLines,
      hideWhenCompact: true,
      // Phase 5 fills these. Until then the column reads an em dash, which is
      // the truth rather than a placeholder.
      render: (r) =>
        r.countedLines === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums text-muted">
            {r.countedLines} of {r.lineCount}
          </span>
        ),
    },
    {
      key: "printed",
      label: "Printed",
      width: 130,
      sortValue: (r) => r.printedAt ?? "",
      render: (r) =>
        r.printedAt ? (
          <span className="text-muted">{r.printedAt.slice(0, 10)}</span>
        ) : (
          // Yellow: worth an eye, not wrong. A night with no paper in the
          // kitchen is what this list is scanned for.
          <span className="text-mark">not printed</span>
        ),
    },
    {
      key: "regenerated",
      label: "Regenerated",
      width: 120,
      align: "right",
      sortValue: (r) => r.regenerations,
      hideWhenCompact: true,
      render: (r) =>
        r.regenerations ? (
          <span className="tabular-nums text-mark" title="This day was generated more than once">
            {r.regenerations}×
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  // No `sortKey`: the group IS the primary sort above, so every grouping bands
  // whatever column you then sort within it by.
  const group: DataGroup<ScheduleRow> | undefined =
    grouping === "none"
      ? undefined
      : {
          label: GROUP_LABEL[grouping],
          summary: (run) => ({
            lines: <span className="tabular-nums">{run.reduce((n, r) => n + r.lineCount, 0)}</span>,
            par: (
              <span className="tabular-nums">
                {run.reduce((n, r) => n + r.parTotal, 0).toLocaleString()}
              </span>
            ),
          }),
        };

  return (
    <div className="space-y-4">
      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="production-schedules"
        compactBelow={1200}
        columnChooser
        group={group}
        empty={<p className="text-sm text-muted">No schedules match these filters.</p>}
        sort={sort}
        onSortChange={setSort}
        leading={
          <div className="flex flex-wrap items-end gap-4">
            <TextInput
              value={term}
              onValueChange={setTerm}
              placeholder="Search shop, kitchen, note…"
              aria-label="Search schedules"
              className="w-64"
            />
            <TabPicker
              ariaLabel="Which schedules"
              value={tier}
              onChange={setTier}
              options={[
                { key: "upcoming" as Tier, label: "Upcoming", count: counts.upcoming },
                { key: "today" as Tier, label: "Today", count: counts.today },
                { key: "unprinted" as Tier, label: "Unprinted", count: counts.unprinted },
                { key: "all" as Tier, label: "All", count: counts.all },
              ]}
            />
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Group by
              </span>
              <TabPicker
                ariaLabel="Group the schedules"
                value={grouping}
                onChange={setGrouping}
                options={[
                  { key: "date" as Grouping, label: "Date" },
                  { key: "kitchen" as Grouping, label: "Kitchen" },
                  { key: "sells" as Grouping, label: "Shop" },
                  { key: "none" as Grouping, label: "None" },
                ]}
              />
            </div>
          </div>
        }
      />

      {checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-4 border border-ink bg-white px-4 py-3 text-sm">
          <span className="font-medium">
            {checked.size} {checked.size === 1 ? "night" : "nights"} selected
          </span>
          <PrintPacket
            scheduleIds={[...checked]}
            editable={editable}
            onPrinted={() => setChecked(new Set())}
          />
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="ml-auto text-muted underline underline-offset-[3px] hover:text-ink"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
