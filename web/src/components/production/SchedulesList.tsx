"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import type { SortDir } from "@/lib/tableSort";
import { PickList } from "@/components/ui/PickList";
import { RangePicker } from "@/components/ui/RangePicker";
import { inRange, type DateRange, type RangePresetSpec } from "@/lib/dateRange";
import { daysAfter } from "@/lib/today";
import { ControlField } from "@/components/ui/ControlField";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { Checkbox } from "@/components/ui/Checkbox";
import { PickSet, type PickSetOption } from "@/components/ui/PickSet";
import { usePublishRecordSet } from "@/lib/recordSet";
import {
  packetDate,
  plansInForce,
  SCHEDULE_WINDOW_DAYS,
  sortSchedules,
  type ScheduleGrouping,
  scheduleSourceLabel,
  type SchedulePlan,
} from "@/lib/productionSchedule";
import { PrintPacket } from "@/components/production/PrintPacket";
import { deleteSchedules, deleteSchedulesMessage } from "@/components/production/scheduleWrites";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";

export type ScheduleRow = {
  id: string;
  schedule_date: string;
  sellsCode: string;
  kitchenCode: string;
  source: string;
  title: string | null;
  location_id: string;
  kitchen_location_id: string;
  generatedAt: string | null;
  printedAt: string | null;
  regenerations: number;
  note: string | null;
  lineCount: number;
  parTotal: number;
  countedLines: number;
};

/**
 * The Window's buttons (Mark, 2026-09-19: the Show picklist became a
 * RangePicker). UPCOMING is today to the far edge of what the page loads, so it
 * is exactly the old tier; "All" is no range, which here means the whole loaded
 * window rather than all history — the page never fetches more than that.
 */
const SCHEDULE_PRESETS: readonly RangePresetSpec[] = [
  {
    key: "upcoming",
    label: "Upcoming",
    range: (t: string) => ({ from: t, to: daysAfter(t, SCHEDULE_WINDOW_DAYS) }),
  },
  "today",
  "tomorrow",
  "yesterday",
  "this_week",
  "previous_week",
  { key: "all", label: "All", range: () => null },
];

/** Re-exported name for the local reads below; `lib/productionSchedule` owns it. */
type Grouping = ScheduleGrouping;

const GROUP_LABEL: Record<Exclude<Grouping, "none">, (r: ScheduleRow) => string> = {
  date: (r) => packetDate(r.schedule_date),
  kitchen: (r) => `Made at ${r.kitchenCode}`,
  sells: (r) => `Sold at ${r.sellsCode}`,
};

/**
 * What the BANDS sort by, which is NOT what they say.
 *
 * A date's label is "SUN 8/9/2026", and ordering a window by that string reads
 * FRI, MON, SAT, SUN, THU — alphabetical, which is not an order anybody wants.
 * It stayed invisible while only one night existed; found on the batch log's
 * own week and fixed in both places at once.
 */
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
  plans,
  stampable,
  editable,
  today,
  locations,
  kitchenId,
  action,
}: {
  rows: ScheduleRow[];
  /** Every plan, active or not — `plansInForce` decides which are in force. */
  plans: SchedulePlan[];
  /** Supervisor and up — who may print, which STAMPS the night (044). */
  stampable: boolean;
  /**
   * Purchaser and up, per the Page Permissions sheet — who may DELETE a night.
   * Separate from `stampable` because the two are different rungs and the bar
   * can legitimately exist for somebody who may print and not delete.
   */
  editable: boolean;
  today: string;
  /** The active shops, in order — the Show filter's Location and Kitchen lists. */
  locations: { id: string; code: string }[];
  /** The working location, which the Show filter starts ticked on as KITCHEN. */
  kitchenId: string | null;
  /** The screen's create command, beside the title. */
  action?: ReactNode;
}) {
  const router = useRouter();
  const [range, setRange] = useState<DateRange | null>(() => ({
    from: today,
    to: daysAfter(today, SCHEDULE_WINDOW_DAYS),
  }));
  /**
   * THE SHOW FILTER (Mark, 2026-09-19): one set holding three questions —
   * `unprinted`, `loc:<id>` and `kitchen:<id>`. OR within a group, AND across
   * them, and a group with nothing ticked asks nothing, so an empty set is
   * every night loaded. It starts on the working kitchen, which is what this
   * screen showed when that was a scope on the query.
   */
  const [show, setShow] = useState<string[]>(() => (kitchenId ? [`kitchen:${kitchenId}`] : []));
  const [grouping, setGrouping] = useState<Grouping>("date");
  const [term, setTerm] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "desc" });

  const showOptions = useMemo((): PickSetOption[] => {
    const count = (pred: (r: ScheduleRow) => boolean) => String(rows.filter(pred).length);
    return [
      { value: "unprinted", label: "Unprinted Only", hint: count((r) => r.printedAt === null) },
      ...locations.map((l) => ({
        value: `loc:${l.id}`,
        label: l.code,
        group: "Location",
        summary: `Sold at ${l.code}`,
        hint: count((r) => r.location_id === l.id),
      })),
      ...locations.map((l) => ({
        value: `kitchen:${l.id}`,
        label: l.code,
        group: "Kitchen",
        summary: `Made at ${l.code}`,
        hint: count((r) => r.kitchen_location_id === l.id),
      })),
    ];
  }, [rows, locations]);

  const filter = useMemo(() => {
    const ids = (prefix: string) =>
      new Set(show.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length)));
    return { unprinted: show.includes("unprinted"), shops: ids("loc:"), kitchens: ids("kitchen:") };
  }, [show]);

  // The heading names a kitchen only when the list is exactly one kitchen's.
  const headingCode =
    filter.kitchens.size === 1
      ? locations.find((l) => filter.kitchens.has(l.id))?.code ?? null
      : null;

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (range && !inRange(r.schedule_date, range)) return false;
      if (filter.unprinted && r.printedAt !== null) return false;
      if (filter.shops.size > 0 && !filter.shops.has(r.location_id)) return false;
      if (filter.kitchens.size > 0 && !filter.kitchens.has(r.kitchen_location_id)) return false;
      if (!q) return true;
      // Both spellings of the date, because the column shows one and the row
      // stores the other: `packetDate` prints "Thu 8/7/2026" where the column
      // sorts on "2026-08-07". Searching only the stored form meant that typing
      // what is printed in front of you — "Thu", "8/7" — found nothing, which
      // reads as the schedule not being there.
      return [
        r.schedule_date,
        packetDate(r.schedule_date),
        r.sellsCode,
        r.kitchenCode,
        // The From column's own words, through the same function it renders
        // with — so "by hand" finds the ones made by hand. Calling the helper
        // rather than repeating its three cases is what stops the two drifting.
        scheduleSourceLabel(r, plans),
        r.title ?? "",
        r.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, plans, range, filter, term]);

  // The order lives in `lib/productionSchedule` so it can be fixture-tested —
  // a comparator inside a `useMemo` is exactly where the group-leads bug hid.
  const visible = useMemo(() => sortSchedules(shown, sort, grouping), [shown, sort, grouping]);

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

  /**
   * Delete the ticked nights (Mark, 2026-09-09).
   *
   * The confirm and the write are `scheduleWrites`' — the same pair the
   * record's own Delete goes through, so what is NAMED and the `.select()`
   * row-count check cannot drift between the two doors.
   *
   * It reads the rows out of `rows`, not `visible`: a selection survives a
   * filter change, so a night ticked and then filtered off screen is still
   * going, and the confirm has to be able to count it. `.filter` rather than a
   * lookup per id, because the set is small and the ORDER of the message's
   * facts should follow the list rather than the order things were ticked.
   */
  async function removeChecked() {
    const going = rows.filter((r) => checked.has(r.id));
    if (!going.length) return;
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(deleteSchedulesMessage(going)),
        confirmLabel: going.length === 1 ? "Delete" : `Delete ${going.length}`,
        tone: "danger",
      }))
    ) {
      return;
    }
    setDeleting(true);
    setFailed(null);
    const result = await deleteSchedules(createClient(), going.map((r) => r.id));
    setDeleting(false);
    if ("error" in result) {
      setFailed(result.error);
      return;
    }
    setChecked(new Set());
    router.refresh();
  }

  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.id));

  const columns: DataColumn<ScheduleRow>[] = [
    // The selection exists for the print bar, and printing STAMPS the night
    // (044's `mark_schedule_printed`, supervisor+) — so a role that cannot
    // stamp gets no boxes: staff are Read Only here per the Page Permissions
    // sheet, and a bar whose only command raises for them is noise.
    ...(stampable ? [{
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
        />
      ),
      render: (r) => (
        <Checkbox
          checked={checked.has(r.id)}
          onChange={() => toggle(r.id)}
          label={`Select ${r.schedule_date} ${r.sellsCode}`}
        />
      ),
    } satisfies DataColumn<ScheduleRow>] : []),
    {
      key: "date",
      label: "Date",
      width: 140,
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
      width: 210,
      // Sorted by the LABEL, not by `source`: the column shows plan names now,
      // so sorting by the raw value would group every plan schedule together
      // under an order the reader cannot see.
      sortValue: (r) => scheduleSourceLabel(r, plans),
      hideWhenCompact: true,
      render: (r) => {
        // The `title` carries the full list where the label had to summarise —
        // a hover is no use on an iPad, but this is the overflow of a rare
        // multi-plan day rather than something you need in order to work.
        const named = r.source === "plan" ? plansInForce(r, plans) : [];
        return (
          <span
            className="text-muted"
            title={named.length > 2 ? named.map((p) => p.title).join(" + ") : undefined}
          >
            {scheduleSourceLabel(r, plans)}
          </span>
        );
      },
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
      <PageHeading
        title="Schedules"
        code={headingCode}
        visible={visible.length}
        total={rows.length}
        noun="schedules"
        action={action}
      />

      {/* Its own filter row, above the table — `PlansList`'s change and for its
          reason: in `DataTable`'s `leading` it shared a strip with the columns
          eye and read as part of the table. */}
      <div className="flex flex-wrap items-end gap-4">
        <TextInput
          value={term}
          onValueChange={setTerm}
          aria-label="Search schedules"
          search
          icon={<SearchGlyph />}
        />
        {/* A RANGE rather than a tier list (Mark, 2026-09-19), at the
            purchasing lists' measured `w-52`. Unprinted is not a date, so it
            left the range for the Show set beside it — and now combines with
            any window, where the tier could only mean "unprinted, ever". */}
        <ControlField label="Window">
          <div className="w-52">
            <RangePicker
              value={range}
              onChange={setRange}
              presets={SCHEDULE_PRESETS}
              today={today}
              ariaLabel="Which nights"
              placeholder="All"
            />
          </div>
        </ControlField>
        <ControlField label="Show">
          <PickSet
            options={showOptions}
            value={show}
            onChange={setShow}
            allLabel="All"
            label="Which schedules to show"
            noun="filters"
          />
        </ControlField>
        <ControlField label="Group by">
          <PickList
            ariaLabel="Group the schedules"
            variant="field"
            value={grouping}
            onPick={(v) => setGrouping(v as Grouping)}
            options={[
              { value: "date", label: "Date" },
              { value: "kitchen", label: "Kitchen" },
              { value: "sells", label: "Shop" },
              { value: "none", label: "None" },
            ]}
            fit
          />
        </ControlField>
      </div>

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
      />

      {stampable && checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-4 border border-ink bg-white px-4 py-3 text-sm">
          <span className="font-medium">
            {checked.size} {checked.size === 1 ? "night" : "nights"} selected
          </span>
          <PrintPacket
            scheduleIds={[...checked]}
            stampable={stampable}
            onPrinted={() => setChecked(new Set())}
          />
          {/* RED, like the record's own Delete and every other destructive
              command out on a screen — a reader cannot tell "opens a confirm"
              from "destroys" by looking. Gated on `editable`, not on
              `stampable`: printing STAMPS a night and is supervisor+ (044),
              where deleting one is a purchaser's write, so the bar can exist
              for somebody who may print and not delete. */}
          {editable ? (
            <button
              type="button"
              onClick={removeChecked}
              disabled={deleting}
              className={DANGER_BUTTON_CLASS}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : null}
          {failed ? <span className="text-accent">{failed}</span> : null}
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
