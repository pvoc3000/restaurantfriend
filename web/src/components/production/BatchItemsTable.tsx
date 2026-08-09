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
  describeAmount,
  isBatchOutstanding,
  amountTotal,
} from "@/lib/productionBatches";

export type BatchRow = {
  id: string;
  element_name: string;
  element_type: string | null;
  /** The EMPLOYEE who made it — FileMaker's "Prepared by". ONE per batch, and
   *  it varies row to row: different people take different elements. */
  operatorName: string | null;
  batch_label: string | null;
  sort: number | null;
  status: string;
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

type Tier = "outstanding" | "done" | "all";
type Grouping = "type" | "element" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  type: (r) => r.element_type ?? "No type",
  element: (r) => r.element_name,
};

/**
 * What the BANDS sort by, which is not always what they say — an unset type has
 * to sink last rather than sort under the empty string (`lib/tableSort`'s rule).
 */
const GROUP_KEY: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  type: (r) => r.element_type ?? "￿",
  element: (r) => r.element_name.toLowerCase(),
};

/**
 * ONE LOG's batches, and what came out of them.
 *
 * It opens on ALL of them, grouped by item type — a log is a checklist you work
 * down (Mark, 2026-08-09), and hiding the finished half of it would make the
 * page shrink as the shift goes on. The To do tier is there for when the list
 * is long enough that you want only what is left.
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
export function BatchItemsTable({
  rows,
  editable,
  add,
  selectedId,
  onSelect,
  fill,
}: {
  rows: BatchRow[];
  /** Supervisor and up — 044's `production_batches` write policies. */
  editable: boolean;
  /** The "New batch" command, which belongs to the LOG rather than the table. */
  add?: React.ReactNode;
  /** Which row the detail pane is showing. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Fill the parent rather than capping — the pinned-pane layout. */
  fill?: boolean;
}) {
  const [tier, setTier] = useState<Tier>("all");
  const [grouping, setGrouping] = useState<Grouping>("type");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "element", dir: "asc" });

  const counts = useMemo(
    () => ({
      outstanding: rows.filter((r) => isBatchOutstanding(r.status)).length,
      done: rows.filter((r) => r.status === "complete" || r.status === "skipped").length,
      all: rows.length,
    }),
    [rows]
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "outstanding" && !isBatchOutstanding(r.status)) return false;
      if (tier === "done" && r.status !== "complete" && r.status !== "skipped") return false;
      if (!q) return true;
      return [
        r.element_name,
        r.operatorName ?? "",
        r.batch_label ?? "",
        r.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, tier, term]);

  const visible = useMemo(() => {
    const value = (r: BatchRow): string | number => {
      switch (sort.key) {
        case "element": return r.element_name;
        case "type": return r.element_type ?? "";
        case "operator": return r.operatorName ?? "";
        case "status": return r.status;
        default: return r.element_name;
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
    "/batches",
    visible.map((r) => ({ id: r.id, href: `/batches/${r.id}` }))
  );

  // MARK'S ORDER, 2026-08-09, pared back to what varies ROW TO ROW.
  //
  // FileMaker's list ran date · location · order · batch · element · type ·
  // prepared by · par · on hand · made · note · by · status, because it was one
  // flat table of every batch ever. This one sits INSIDE a log, so Date,
  // Location and By say the same thing on all thirty rows as the header above
  // them, and the batch NUMBER identifies a row you already have in front of
  // you (Mark, 2026-08-09: "no longer needed in batch items now that they are
  // in the master batch log record" … "batch is also no longer needed").
  //
  // PREPARED BY STAYS, and it was taken out and put back the same day — worth
  // recording because the argument for removing it was wrong in an instructive
  // way. FileMaker's screen reads "Campos, Crystal" on all sixteen rows, which
  // looks like a fact about the LOG rather than the batch. It isn't: "one person
  // could do one element, and another person another element" (Mark,
  // 2026-08-09). One person happening to work a whole round is not the same as
  // the column belonging to the round.
  //
  // And ONE PERSON PER BATCH is the rule, not a limitation — "not two people
  // doing one element". So `operator_employee_id` is singular on purpose and
  // wants no join table.
  //
  // ORDER STAYS (Mark: "that's something probably only I use when I do
  // production, but it's useful to me and I want to keep it") — it is thinly
  // filled today, 1 of 30 at DF02, and that is a data gap rather than a reason
  // to drop the column.
  //
  // PREPARED BY stays and is not the same fact: it is the EMPLOYEE who made the
  // batch, which varies row to row, where By was the app user who entered the
  // record — one person for the whole log.
  const columns: DataColumn<BatchRow>[] = [
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
      key: "element",
      label: "Element",
      width: 260,
      pinned: true,
      sortValue: (r) => r.element_name,
      render: (r) =>
        onSelect ? (
          // A BUTTON, not a link: the destination is the pane below, and the
          // pane's own header carries the way out to /batches/[id]. It is also
          // the keyboard path to a selection the row click makes with a mouse —
          // a `<tr>` cannot be focused.
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className="text-left font-medium hover:underline"
          >
            {r.element_name}
            {r.generated ? null : (
              <span className="ml-1.5 text-muted" title="Logged by hand">
                *
              </span>
            )}
          </button>
        ) : (
          <Link href={`/batches/${r.id}`} className="font-medium hover:underline">
            {r.element_name}
            {r.generated ? null : (
              <span className="ml-1.5 text-muted" title="Logged by hand">
                *
              </span>
            )}
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
      width: 130,
      sortValue: (r) => amountTotal(r.on_hand_count, r.on_hand_size) ?? -1,
      // LINEAR, and read-only (Mark, 2026-08-09). Three stacked editors made a
      // 56px row three lines tall and put the same control in two places; the
      // detail pane below owns the editing, so this states the amount and gets
      // out of the way. Empty is ONE em dash, not "— × — —".
      render: (r) => (
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>
          {describeAmount(r.on_hand_count, r.on_hand_size, r.on_hand_unit)}
        </span>
      ),
    },
    {
      key: "made",
      label: "Made",
      width: 130,
      sortValue: (r) => amountTotal(r.yield_count, r.yield_size) ?? -1,
      render: (r) => (
        <span className={`${READ_ONLY_VALUE} tabular-nums`}>
          {describeAmount(r.yield_count, r.yield_size, r.yield_unit)}
        </span>
      ),
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
            ariaLabel={`Status, ${r.element_name}`}
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
      scroll={fill}
      fill={fill}
      onRowClick={onSelect ? (r) => onSelect(r.id) : undefined}
      // The selected row is a light fill, never the black a band uses: black
      // DELIMITS here and this row is still one of the list's own.
      rowClassName={(r) => (r.id === selectedId ? "bg-mark-fill" : "")}
      group={group}
      sort={sort}
      onSortChange={setSort}
      empty={<p className="text-sm text-muted">No batches match.</p>}
      leading={
        <div className="flex flex-wrap items-end gap-4">
          {add}
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
              { key: "all" as Tier, label: "All", count: counts.all },
              { key: "outstanding" as Tier, label: "To do", count: counts.outstanding },
              { key: "done" as Tier, label: "Done", count: counts.done },
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
