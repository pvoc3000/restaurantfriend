"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import type { SortDir } from "@/lib/tableSort";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { usePublishRecordSet } from "@/lib/recordSet";
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_OPTIONS,
  batchDate,
  describeAmount,
  isBatchOutstanding,
  yieldAgainstPar,
} from "@/lib/productionBatches";

export type BatchRow = {
  id: string;
  batch_date: string;
  batch_number: string;
  element_name: string;
  element_type: string | null;
  kitchenCode: string;
  shift: string | null;
  batch_label: string | null;
  sort: number | null;
  status: string;
  operatorName: string | null;
  recipe_version_label: string | null;
  batch_amount: number | null;
  batch_unit: string | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
  yield_count: number | null;
  yield_size: number | null;
  yield_unit: string | null;
  generated: boolean;
  notes: string | null;
  hasPhoto: boolean;
};

type Tier = "outstanding" | "today" | "done" | "all";
type Grouping = "date" | "shift" | "element" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  date: (r) => batchDate(r.batch_date),
  shift: (r) => r.shift ?? "No shift",
  element: (r) => r.element_name,
};

/**
 * The week's batches, and what came out of them.
 *
 * The tier that earns its place is OUTSTANDING — to-do plus in-progress — and
 * it is what the screen opens on, because a generated batch log is a CHECKLIST
 * somebody is working down (Mark, 2026-08-09) and "what is still to make" is
 * the question it exists to answer.
 *
 * The fast-moving cells edit in place. A batch's status and its yield are what
 * a baker changes twenty times a shift, and a navigation per batch at 5am would
 * be intolerable; the record is for the photo, the notes and the recipe
 * version, which cannot live in a 56px row.
 *
 * Grouping is the PRIMARY sort with the chosen column sorting WITHIN each run —
 * the 2026-08-05 lesson, since `DataTable` can only band what the ORDER already
 * groups.
 */
export function BatchLogsList({
  rows,
  editable,
}: {
  rows: BatchRow[];
  /** Supervisor and up — 044's `production_batches` write policies. */
  editable: boolean;
}) {
  const [tier, setTier] = useState<Tier>("outstanding");
  const [grouping, setGrouping] = useState<Grouping>("date");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "asc" });

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const counts = useMemo(
    () => ({
      outstanding: rows.filter((r) => isBatchOutstanding(r.status)).length,
      today: rows.filter((r) => r.batch_date === today).length,
      done: rows.filter((r) => r.status === "complete").length,
      all: rows.length,
    }),
    [rows, today]
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "outstanding" && !isBatchOutstanding(r.status)) return false;
      if (tier === "today" && r.batch_date !== today) return false;
      if (tier === "done" && r.status !== "complete") return false;
      if (!q) return true;
      return [
        r.element_name,
        r.batch_number,
        r.kitchenCode,
        r.shift ?? "",
        r.batch_label ?? "",
        r.operatorName ?? "",
        r.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, tier, term, today]);

  const visible = useMemo(() => {
    const value = (r: BatchRow): string | number => {
      switch (sort.key) {
        case "date": return r.batch_date;
        case "element": return r.element_name;
        case "shift": return r.shift ?? "";
        case "status": return r.status;
        case "operator": return r.operatorName ?? "";
        case "number": return r.batch_number;
        case "kitchen": return r.kitchenCode;
        default: return r.batch_date;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    const groupOf = grouping === "none" ? null : GROUP_LABEL[grouping];
    return [...shown].sort((a, b) => {
      if (groupOf) {
        const ag = groupOf(a), bg = groupOf(b);
        if (ag !== bg) return ag < bg ? -1 : 1;
      }
      const av = value(a), bv = value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Within a day the schedule's own order is the one a kitchen works in:
      // numbered batches first, then the flavour ones (040's rule).
      const as = a.sort ?? Number.MAX_SAFE_INTEGER;
      const bs = b.sort ?? Number.MAX_SAFE_INTEGER;
      if (as !== bs) return as - bs;
      return (a.batch_label ?? "") < (b.batch_label ?? "") ? -1 : 1;
    });
  }, [shown, sort, grouping]);

  usePublishRecordSet(
    "/batch-logs",
    visible.map((r) => ({ id: r.id, href: `/batch-logs/${r.id}` }))
  );

  const columns: DataColumn<BatchRow>[] = [
    {
      key: "date",
      label: "Day",
      width: 120,
      pinned: true,
      sortValue: (r) => r.batch_date,
      render: (r) => <span className="text-muted">{batchDate(r.batch_date)}</span>,
    },
    {
      key: "element",
      label: "Element",
      width: 260,
      pinned: true,
      sortValue: (r) => r.element_name,
      render: (r) => (
        <Link href={`/batch-logs/${r.id}`} className="font-medium hover:underline">
          {r.element_name}
          {r.batch_label ? <span className="ml-2 text-muted">#{r.batch_label}</span> : null}
        </Link>
      ),
    },
    {
      key: "kitchen",
      label: "Made at",
      width: 100,
      sortValue: (r) => r.kitchenCode,
      render: (r) => <span className="font-medium">{r.kitchenCode}</span>,
    },
    {
      key: "shift",
      label: "Shift",
      width: 120,
      sortValue: (r) => r.shift ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.shift ? (
          <span className="text-muted">{r.shift}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 150,
      sortValue: (r) => r.status,
      render: (r) =>
        editable ? (
          <InlineValue
            table="production_batches"
            id={r.id}
            column="status"
            kind="pick"
            nullable={false}
            options={BATCH_STATUS_OPTIONS}
            value={r.status}
            ariaLabel={`Status, ${r.element_name} ${batchDate(r.batch_date)}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {BATCH_STATUS_LABEL[r.status as keyof typeof BATCH_STATUS_LABEL] ?? r.status}
          </span>
        ),
    },
    {
      key: "asked",
      label: "To make",
      width: 110,
      sortValue: (r) => r.batch_amount ?? -1,
      hideWhenCompact: true,
      // What the weekly schedule said. Read-only: it is a snapshot of the
      // rhythm, and changing it here would make the row disagree with the
      // schedule it came from without saying so.
      render: (r) => (
        <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
          {describeAmount(r.batch_amount, null, r.batch_unit)}
        </span>
      ),
    },
    {
      key: "yield",
      label: "Yield",
      width: 200,
      sortValue: (r) => r.yield_count ?? -1,
      // Count × size × unit, three cells, because that is what the amount IS —
      // "2 × 22 qt" — and only the pair can be multiplied. FileMaker stored the
      // same three and printed them joined.
      render: (r) =>
        editable ? (
          <span className="flex flex-wrap items-baseline gap-1">
            <InlineValue
              table="production_batches" id={r.id} column="yield_count" kind="number"
              value={r.yield_count} ariaLabel={`Yield count, ${r.element_name}`}
            />
            <span className="text-subtle">×</span>
            <InlineValue
              table="production_batches" id={r.id} column="yield_size" kind="number"
              value={r.yield_size} ariaLabel={`Yield size, ${r.element_name}`}
            />
            <InlineValue
              table="production_batches" id={r.id} column="yield_unit"
              value={r.yield_unit} ariaLabel={`Yield unit, ${r.element_name}`}
            />
          </span>
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {describeAmount(r.yield_count, r.yield_size, r.yield_unit)}
          </span>
        ),
    },
    {
      key: "par",
      label: "Against par",
      width: 140,
      sortValue: (r) => r.par_count ?? -1,
      hideWhenCompact: true,
      render: (r) => {
        const verdict = yieldAgainstPar(r);
        const par = describeAmount(r.par_count, r.par_size, r.par_unit);
        if (verdict === "unknown") {
          return <span className="text-faint">{par}</span>;
        }
        // Yellow for a miss in either direction — worth an eye, not wrong. A
        // batch under par may be exactly what was wanted.
        return (
          <span
            className={verdict === "at" ? "text-muted" : "text-mark"}
            title={`Par is ${par}`}
          >
            {verdict === "at" ? "at par" : verdict === "over" ? "over par" : "under par"}
          </span>
        );
      },
    },
    {
      key: "operator",
      label: "Made by",
      width: 160,
      sortValue: (r) => r.operatorName ?? "",
      render: (r) =>
        r.operatorName ? (
          <span className="text-muted">{r.operatorName}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "number",
      label: "Batch",
      width: 100,
      align: "right",
      sortValue: (r) => r.batch_number,
      hideWhenCompact: true,
      render: (r) => (
        <span className="tabular-nums text-subtle" title={r.generated ? "From the weekly schedule" : "Logged by hand"}>
          {r.batch_number}
          {r.generated ? "" : "*"}
        </span>
      ),
    },
  ];

  const group: DataGroup<BatchRow> | undefined =
    grouping === "none"
      ? undefined
      : {
          label: GROUP_LABEL[grouping],
        };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-batch-logs"
      compactBelow={1200}
      columnChooser
      group={group}
      sort={sort}
      onSortChange={setSort}
      empty={<p className="text-sm text-muted">No batches match.</p>}
      leading={
        <div className="flex flex-wrap items-end gap-4">
          <TextInput
            value={term}
            onValueChange={setTerm}
            placeholder="Search element, shift, batch…"
            aria-label="Search batches"
            className="w-64"
          />
          <TabPicker
            ariaLabel="Which batches"
            value={tier}
            onChange={setTier}
            options={[
              { key: "outstanding" as Tier, label: "To do", count: counts.outstanding },
              { key: "today" as Tier, label: "Today", count: counts.today },
              { key: "done" as Tier, label: "Complete", count: counts.done },
              { key: "all" as Tier, label: "All", count: counts.all },
            ]}
          />
          <div className="space-y-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Group by
            </span>
            <TabPicker
              ariaLabel="Group the batches"
              value={grouping}
              onChange={setGrouping}
              options={[
                { key: "date" as Grouping, label: "Day" },
                { key: "shift" as Grouping, label: "Shift" },
                { key: "element" as Grouping, label: "Element" },
                { key: "none" as Grouping, label: "None" },
              ]}
            />
          </div>
        </div>
      }
    />
  );
}
