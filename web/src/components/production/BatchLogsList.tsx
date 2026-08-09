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
  amountTotal,
} from "@/lib/productionBatches";

export type BatchRow = {
  id: string;
  batch_date: string;
  batch_number: string;
  element_name: string;
  element_type: string | null;
  kitchenCode: string;
  batch_label: string | null;
  sort: number | null;
  status: string;
  /** The EMPLOYEE who made it — FileMaker's "Prepared by". */
  operatorName: string | null;
  /** The app user who entered the record — FileMaker's "By". A different
   *  person from the operator more often than not. */
  createdByName: string | null;
  recipe_version_label: string | null;
  batch_amount: number | null;
  batch_unit: string | null;
  par_count: number | null;
  par_size: number | null;
  par_unit: string | null;
  on_hand_count: number | null;
  on_hand_size: number | null;
  on_hand_unit: string | null;
  yield_count: number | null;
  yield_size: number | null;
  yield_unit: string | null;
  generated: boolean;
  notes: string | null;
  hasPhoto: boolean;
};

/**
 * A count × size unit trio, edited in place.
 *
 * Three cells rather than one box because that is what the amount IS — "3 ×
 * 1.5 gal", which is exactly how FileMaker's own detail lays it out (# CONTAINERS
 * × AMOUNT IN CONTAINER). Only the pair can be multiplied, and 036 parsed the
 * free text into three columns precisely so it could be.
 */
function AmountCells({
  row,
  prefix,
  editable,
}: {
  row: BatchRow;
  prefix: "on_hand" | "yield";
  editable: boolean;
}) {
  const count = prefix === "on_hand" ? row.on_hand_count : row.yield_count;
  const size = prefix === "on_hand" ? row.on_hand_size : row.yield_size;
  const unit = prefix === "on_hand" ? row.on_hand_unit : row.yield_unit;
  const what = prefix === "on_hand" ? "On hand" : "Made";

  if (!editable) {
    return (
      <span className={`${READ_ONLY_VALUE} tabular-nums`}>
        {describeAmount(count, size, unit)}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-baseline gap-1">
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_count`} kind="number"
        value={count} ariaLabel={`${what} count, ${row.element_name}`}
      />
      <span className="text-subtle">×</span>
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_size`} kind="number"
        value={size} ariaLabel={`${what} size, ${row.element_name}`}
      />
      <InlineValue
        table="production_batches" id={row.id} column={`${prefix}_unit`}
        value={unit} ariaLabel={`${what} unit, ${row.element_name}`}
      />
    </span>
  );
}

type Tier = "outstanding" | "today" | "done" | "all";
type Grouping = "date" | "location" | "type" | "element" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  date: (r) => batchDate(r.batch_date),
  location: (r) => r.kitchenCode,
  type: (r) => r.element_type ?? "No type",
  element: (r) => r.element_name,
};

/**
 * What the BANDS sort by, which is NOT always what they say.
 *
 * A day's label is "Mon 8/3", and sorting a week by that string puts Monday,
 * then Thursday, then Tuesday — alphabetical order, which is not an order any
 * kitchen works in. Caught on the real DF01 week. So the date grouping sorts by
 * the ISO date underneath and prints the friendly form; the others group by a
 * name, where the label IS the key.
 */
const GROUP_KEY: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  date: (r) => r.batch_date,
  location: (r) => r.kitchenCode,
  type: (r) => r.element_type ?? "￿", // no type sinks last, lib/tableSort's rule
  element: (r) => r.element_name.toLowerCase(),
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
        case "location": return r.kitchenCode;
        case "type": return r.element_type ?? "";
        case "status": return r.status;
        case "operator": return r.operatorName ?? "";
        case "number": return r.batch_number;
        case "kitchen": return r.kitchenCode;
        default: return r.batch_date;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    const groupOf = grouping === "none" ? null : GROUP_KEY[grouping];
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

  // MARK'S ORDER, 2026-08-09, and it is FileMaker's own Batch Logs list — its
  // search globals are date · location · order · batch · element · elementType
  // · employee, which is this row read left to right.
  //
  // Day-of-week and SHIFT are gone. They belong to the element SCHEDULE, which
  // is what generation reads; a logged batch carries the date it was generated
  // for and nothing about the rhythm that proposed it.
  const columns: DataColumn<BatchRow>[] = [
    {
      key: "date",
      label: "Date",
      width: 120,
      pinned: true,
      sortValue: (r) => r.batch_date,
      render: (r) => <span className="text-muted">{batchDate(r.batch_date)}</span>,
    },
    {
      key: "location",
      label: "Location",
      width: 100,
      sortValue: (r) => r.kitchenCode,
      render: (r) => <span className="font-medium">{r.kitchenCode}</span>,
    },
    {
      key: "sort",
      label: "Order",
      width: 80,
      align: "right",
      // The batch's place in the day. A LABEL with a number beside it, never an
      // integer alone: 040 measured "Blueberry", "Caramel" and "x2" among the
      // real values, so what sorts and what prints are two different things.
      sortValue: (r) => r.sort ?? Number.MAX_SAFE_INTEGER,
      render: (r) =>
        r.batch_label ? (
          <span className="tabular-nums text-muted">{r.batch_label}</span>
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
      render: (r) => (
        <span
          className="tabular-nums text-muted"
          title={r.generated ? "From the weekly schedule" : "Logged by hand"}
        >
          {r.batch_number}
          {r.generated ? "" : "*"}
        </span>
      ),
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
        </Link>
      ),
    },
    {
      key: "type",
      label: "Item type",
      width: 130,
      sortValue: (r) => r.element_type ?? "",
      render: (r) =>
        r.element_type ? (
          <span className="text-muted">{r.element_type}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "operator",
      label: "Prepared by",
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
      key: "par",
      label: "Par",
      width: 120,
      // What this kitchen keeps on hand — the ASK, snapshotted at generation.
      // Read-only: changing it here would make the row disagree with the
      // element's own stock figure without saying so.
      sortValue: (r) => amountTotal(r.par_count, r.par_size) ?? -1,
      render: (r) => (
        <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
          {describeAmount(r.par_count, r.par_size, r.par_unit)}
        </span>
      ),
    },
    {
      key: "onhand",
      label: "On hand",
      width: 190,
      sortValue: (r) => amountTotal(r.on_hand_count, r.on_hand_size) ?? -1,
      render: (r) => <AmountCells row={r} prefix="on_hand" editable={editable} />,
    },
    {
      key: "made",
      label: "Made",
      width: 190,
      sortValue: (r) => amountTotal(r.yield_count, r.yield_size) ?? -1,
      render: (r) => <AmountCells row={r} prefix="yield" editable={editable} />,
    },
    {
      key: "note",
      label: "Note",
      width: 220,
      wrap: true,
      sortValue: (r) => r.notes ?? "",
      hideWhenCompact: true,
      render: (r) =>
        editable ? (
          <InlineValue
            table="production_batches"
            id={r.id}
            column="notes"
            value={r.notes}
            ariaLabel={`Note, ${r.element_name}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.notes ?? "—"}</span>
        ),
    },
    {
      key: "by",
      // NOT "prepared by". FileMaker's own list carries both and so does this:
      // PREPARED BY is the employee who made it — often somebody with no login
      // at all — and BY is whoever entered the record. Two people, two columns,
      // which is the whole reason 044 stores both.
      label: "By",
      width: 120,
      sortValue: (r) => r.createdByName ?? "",
      hideWhenCompact: true,
      render: (r) =>
        r.createdByName ? (
          <span className="text-muted">{r.createdByName}</span>
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
                { key: "date" as Grouping, label: "Date" },
                { key: "location" as Grouping, label: "Location" },
                { key: "type" as Grouping, label: "Item type" },
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
