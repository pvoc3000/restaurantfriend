"use client";

import { useMemo } from "react";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import type { SortDir } from "@/lib/tableSort";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { useRememberedView } from "@/lib/viewMemory";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import {
  BATCH_STATUSES,
  BATCH_STATUS_LABEL,
  BATCH_STATUS_OPTIONS,
  batchStatusTone,
  describeAmount,
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
  /**
   * Loaded from FileMaker (046) rather than made here.
   *
   * It exists so the "by hand" marker can stay silent. That marker reads
   * `is_generated = false` as "somebody logged this themselves", which is true
   * of an app row and false of a migrated one — history carries the flag false
   * only because 045's partial unique index would refuse the 58 kitchen-days
   * that batched an element twice. An asterisk on 14,103 rows would say nothing
   * anyway.
   */
  migrated: boolean;
  notes: string | null;
  hasPhoto: boolean;
};

/**
 * Item type, STATUS, or nothing (Mark, 2026-08-09).
 *
 * Element is gone and status replaces it, which is the same test every grouping
 * in this app has to pass: FEW VALUES, MANY ROWS EACH, so the run a heading
 * opens is worth naming. An element appears at most twice on one log — 044's
 * partial unique index allows a second hand-logged batch of the same thing and
 * nothing else — so grouping by it produced thirty headings over thirty rows.
 * Status has five values and a log is a checklist, so "what is still to do" is
 * a real run.
 */
type Grouping = "type" | "status" | "none";

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  type: (r) => r.element_type ?? "No type",
  status: (r) =>
    BATCH_STATUS_LABEL[r.status as keyof typeof BATCH_STATUS_LABEL] ?? r.status,
};

/**
 * What the RUNS sort by, which is not always what they say — an unset type has
 * to sink last rather than sort under the empty string (`lib/tableSort`'s rule),
 * and status bands read in the order a batch moves through them rather than
 * alphabetically, which would put Complete above To do.
 */
const GROUP_KEY: Record<Exclude<Grouping, "none">, (r: BatchRow) => string> = {
  type: (r) => r.element_type ?? "￿",
  status: (r) => {
    const at = BATCH_STATUSES.indexOf(r.status as (typeof BATCH_STATUSES)[number]);
    return String(at < 0 ? BATCH_STATUSES.length : at);
  },
};

/**
 * ONE LOG's batches, and what came out of them.
 *
 * It shows ALL of them, grouped by item type — a log is a checklist you work
 * down (Mark, 2026-08-09), and hiding the finished half of it would make the
 * page shrink as the shift goes on.
 *
 * THERE IS NO All / To do / Done TIER, and it was built and removed the same day
 * (Mark). Every filter it offered is one the STATUS column already answers on
 * every row, and grouping by status now answers it for the whole list at once —
 * so the tier was a third way to ask a question the screen was already showing
 * you, sitting where the eye goes first.
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
  selectedId,
  onSelect,
  fill,
}: {
  rows: BatchRow[];
  /** Supervisor and up — 044's `production_batches` write policies. */
  editable: boolean;
  /** Which row the detail pane is showing. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Fill the parent rather than capping — the pinned-pane layout. */
  fill?: boolean;
}) {
  // REMEMBERED WHILE YOU WALK RECORDS (Mark, 2026-08-09: "when navigating using
  // the buttons in the upper right hand corner of the detail screen, I'd like
  // the search and filters to be retained"). `ui/RecordNav` steps to the next
  // LOG, which remounts this table — so plain `useState` meant a search you
  // typed to find the glazes was gone the moment you moved to the next day,
  // which is exactly the walk it was typed for. See `lib/viewMemory`: in
  // memory, so a reload still starts clean.
  //
  // The SORT is remembered too. Mark named the search and the filters, and the
  // sort is the same class of thing set up for the same reason — leaving it out
  // would produce the identical complaint on the next pass.
  const [grouping, setGrouping] = useRememberedView<Grouping>("batch-items.grouping", "type");
  const [term, setTerm] = useRememberedView("batch-items.search", "");
  const [sort, setSort] = useRememberedView<{ key: string; dir: SortDir }>(
    "batch-items.sort",
    { key: "element", dir: "asc" }
  );

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.element_name, r.operatorName ?? "", r.batch_label ?? "", r.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, term]);

  const visible = useMemo(() => {
    /**
     * EVERY COLUMN, and it has to be every column.
     *
     * This table is CONTROLLED — it passes `sort` and `onSortChange`, so
     * `DataTable` renders the rows exactly as given and never consults a
     * column's own `sortValue`. So a key missing from this switch falls to the
     * default and sorts by element name instead, while the header dutifully
     * draws its arrow: the column looks sorted and isn't.
     *
     * Mark caught it on Order (2026-08-09), and Order was one of FIVE — par,
     * on hand, made and note were all falling through the same hole. The keys
     * must match the `columns` array below; there is no type that checks it,
     * which is why they are listed here in the same order.
     */
    const value = (r: BatchRow): string | number => {
      switch (sort.key) {
        // Numeric, and unset sinks last in BOTH directions — `lib/tableSort`'s
        // rule, reproduced here because this comparator is our own.
        case "sort": return r.sort ?? Number.MAX_SAFE_INTEGER;
        case "element": return r.element_name;
        case "type": return r.element_type ?? "";
        case "operator": return r.operatorName ?? "";
        // The AMOUNT, not the count — `amountTotal` is what makes 4 × 1.5
        // sort above 3 gal. -1 keeps "nothing recorded" below every real
        // figure, since a real one is never negative.
        case "par": return amountTotal(r.par_count, r.par_size) ?? -1;
        case "onhand": return amountTotal(r.on_hand_count, r.on_hand_size) ?? -1;
        case "made": return amountTotal(r.yield_count, r.yield_size) ?? -1;
        case "note": return r.notes ?? "";
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

  // No `usePublishRecordSet`: the record book walks a LIST of records, and a
  // batch has no route to walk to — it is only ever the pane's subject.

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
      // 90, not 80: at 1280 the narrower share left the LABEL 50px and it
      // rendered "ORD…", which reads as a rendering fault where the values
      // under it are two characters wide.
      width: 90,
      align: "right",
      // The batch's place in the day. A LABEL with a number beside it, never an
      // integer alone: 040 measured "Blueberry", "Caramel" and "x2" among the
      // real values, so what sorts and what prints are two different things.
      sortValue: (r) => r.sort ?? Number.MAX_SAFE_INTEGER,
      render: (r) =>
        r.batch_label ? (
          <span className="tabular-nums opacity-70">{r.batch_label}</span>
        ) : (
          <span className="opacity-45">—</span>
        ),
    },
    {
      key: "element",
      label: "Element",
      width: 260,
      pinned: true,
      sortValue: (r) => r.element_name,
      // A BUTTON, and there is no link branch because there is nowhere to link
      // to: a batch has no route of its own. It is the KEYBOARD path to the
      // selection a row click makes with a mouse — a `<tr>` cannot be focused.
      render: (r) => (
        <button
          type="button"
          onClick={() => onSelect?.(r.id)}
          className="text-left font-medium hover:underline"
        >
          {r.element_name}
          {r.generated || r.migrated ? null : (
            <span className="ml-1.5 text-muted" title="Logged by hand">
              *
            </span>
          )}
        </button>
      ),
    },
    {
      key: "type",
      label: "Item type",
      width: 130,
      sortValue: (r) => r.element_type ?? "",
      // `opacity-70` rather than `text-muted`, here and on the two cells below.
      // A colour class on the cell would beat the row's, so a skipped row would
      // come out grey except for three columns that stayed neutral-600 — which
      // reads as a rendering fault rather than as a muted cell. Opacity composes
      // with whatever ink the row is carrying, and on an uncoloured row it lands
      // within a shade of where `text-muted` was.
      render: (r) =>
        r.element_type ? (
          <span className="opacity-70">{r.element_type}</span>
        ) : (
          <span className="opacity-45">—</span>
        ),
    },
    {
      key: "operator",
      label: "Prepared by",
      width: 160,
      sortValue: (r) => r.operatorName ?? "",
      render: (r) =>
        r.operatorName ? (
          <span className="opacity-70">{r.operatorName}</span>
        ) : (
          <span className="opacity-45">—</span>
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
        <span className={`${READ_ONLY_VALUE} tabular-nums opacity-70`}>
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
          // UPPERCASE ON THE CONTROL, never on an ancestor: the browser reset
          // sets `button { text-transform: none }`, so a wrapper's `uppercase`
          // does not reach the picker inside it — the same trap the plan
          // matrix's title hit. `InlineValue` forwards `className` to it.
          <InlineValue
            table="production_batches"
            id={r.id}
            column="status"
            kind="pick"
            nullable={false}
            options={BATCH_STATUS_OPTIONS}
            value={r.status}
            className="uppercase"
            ariaLabel={`Status, ${r.element_name}`}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} uppercase`}>
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
          // Black caps text over a rule, not a filled band — FileMaker's own
          // treatment for exactly this heading (Mark, 2026-08-09). See
          // DataGroup.heading.
          heading: true,
        };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-batch-logs"
      compactBelow={1200}
      columnChooser
      // The pane below takes a fixed slice of one viewport, so what is left is
      // all this list gets — see DataTable's `dense`.
      dense
      scroll={fill}
      fill={fill}
      onRowClick={onSelect ? (r) => onSelect(r.id) : undefined}
      // The selected row is a light fill, never the black a band uses: black
      // DELIMITS here and this row is still one of the list's own — and the
      // fill sits UNDER the status colour rather than replacing it, so picking
      // a row never changes what its colour is telling you.
      rowClassName={(r) =>
        `${batchStatusTone(r.status)} ${r.id === selectedId ? "bg-mark-fill" : ""}`.trim()
      }
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
                { key: "status" as Grouping, label: "Status" },
                { key: "none" as Grouping, label: "None" },
              ]}
            />
          </div>
        </div>
      }
    />
  );
}
