"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { RowMenu } from "@/components/ui/RowMenu";
import { createClient } from "@/lib/supabase/client";
import { usePublishRecordSet } from "@/lib/recordSet";
import { withFrom } from "@/lib/breadcrumbs";
import { sortRows } from "@/lib/tableSort";
import {
  applyListFilters,
  filterCounts,
  filterHref,
  parseFilterSearch,
  parseFilterValues,
  parseListSort,
  urlFilterParams,
  type FilterDimension,
  type FilterValues,
  type ListSort,
  type RawSearchParams,
} from "@/lib/filterMenus";
import {
  overlappingPlans,
  planRange,
  duplicateTitle,
  REVIEW_DEFAULTS_PARAM,
  type PlanSummary,
} from "@/lib/productionPlans";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

export type PlanRow = PlanSummary & {
  notes: string | null;
  sellsCode: string;
  kitchenCode: string | null;
  trayCount: number;
  slotCount: number;
};

/** This list's own address — its URL, its record-set key, its crumb. */
const PATH = "/plans";

/**
 * Every column you can sort by — `columns` below, minus the ones with no
 * `sortValue`. KEEP THE TWO IN STEP; see the production items list for why.
 */
const SORT_KEYS = [
  "active",
  "title",
  "sells",
  "kitchen",
  "dates",
  "trays",
  "slots",
] as const;

/**
 * The plans.
 *
 * The column that does not exist anywhere in FileMaker is KITCHEN, and it is
 * the point of decision 9: a plan is (selling location, kitchen, dates, trays),
 * so DF01 making DF02's raised donuts while DF02 makes its own cake donuts is
 * two rows here rather than an impossible pair of values on the Location table.
 *
 * Overlap is shown, never blocked. Two active plans covering the same shop on
 * the same day is the FEATURE — their union is that shop's menu — and what the
 * reader needs to know is that pars will SUM, which is a warning's job.
 */
export function PlansList({
  rows,
  orgId,
  editable,
  initialFilters,
  initialSearch = "",
  action,
}: {
  rows: PlanRow[];
  orgId: string;
  editable: boolean;
  /** The URL's query, raw. */
  initialFilters?: RawSearchParams;
  initialSearch?: string;
  /**
   * The screen's create command, right-aligned in this list's own control row
   * (Mark, 2026-09-03, moving it down out of the title row — Facilities' shape).
   * A NODE rather than a flag: only the page knows what to hand it.
   */
  action?: ReactNode;
}) {
  const router = useRouter();

  /**
   * ONE DIMENSION, so it stays a `TabPicker` — see the recipes list, which
   * borrows `lib/filterMenus`' URL contract the same way and for the same
   * reason. `defaultValue` is what keeps a plain `/plans` on ACTIVE.
   */
  const dimensions = useMemo<FilterDimension<PlanRow>[]>(
    () => [
      {
        key: "tier",
        label: "Which plans",
        defaultValue: "active",
        options: [
          { value: "active", label: "Active" },
          { value: "all", label: "All" },
        ],
        matches: (r, v) => (v === "active" ? r.is_active : true),
      },
    ],
    []
  );

  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
  const [search, setSearch] = useState(() => {
    const live = urlFilterParams(PATH);
    return live ? parseFilterSearch(live) : initialSearch;
  });
  const [filters, setFilters] = useState<FilterValues>(() =>
    parseFilterValues(dimensions, urlFilterParams(PATH) ?? initialFilters ?? {})
  );
  const [sort, setSort] = useState<ListSort | null>(() =>
    parseListSort(urlFilterParams(PATH) ?? initialFilters ?? {}, SORT_KEYS)
  );
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  // `history.replaceState`, never `router.replace`: the filtering is all
  // client-side over rows the server already sent.
  function writeUrl(
    nextFilters: FilterValues,
    nextSearch: string,
    nextSort: ListSort | null
  ) {
    window.history.replaceState(
      null,
      "",
      filterHref(PATH, dimensions, nextFilters, nextSearch, nextSort)
    );
  }

  function changeTier(next: string) {
    const nextFilters = { ...filters, tier: next };
    setFilters(nextFilters);
    writeUrl(nextFilters, search, sort);
  }

  function changeSearch(next: string) {
    setSearch(next);
    writeUrl(filters, next, sort);
  }

  function changeSort(next: ListSort) {
    setSort(next);
    writeUrl(filters, search, next);
  }

  // This list had no search box at all, alone among the module's five (audit,
  // 2026-08-09). It was defensible while a shop had two plans and indefensible
  // the moment it has a season's worth — and a list you can filter but not
  // search is the odd one out wherever you have just come from.
  //
  // Every text column it shows, and nothing it doesn't: the plan's name, both
  // shop codes, the notes, and the dates in the form the In-force column PRINTS
  // them (`planRange`, the same function that renders it) as well as the stored
  // ISO — the schedules list's lesson, where searching what was on screen found
  // nothing because the row stored the other spelling.
  // Search first, so the tab counts describe the list you are looking at —
  // `FilterMenus`' rule, applied to a TabPicker.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.title,
        r.sellsCode,
        r.kitchenCode ?? "",
        r.notes ?? "",
        r.starts_on,
        r.ends_on ?? "",
        planRange(r),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );
  const counts = filterCounts(searched, dimensions, filters).tier;
  const overlaps = useMemo(() => overlappingPlans(rows), [rows]);

  /** This view's own address — where a link back from a plan returns to. */
  const listHref = filterHref(PATH, dimensions, filters, search, sort);

  /** Every plan link carries the filtered view, so the breadcrumb lands back
   *  on it; `crumbPath` drops the query, so the record-set key stays bare. */
  const detailHref = (id: string) =>
    withFrom(`/plans/${id}`, { href: listHref, label: "Plans" });

  /**
   * Copy a plan and everything under it — trays, and the slots on them with
   * their pars.
   *
   * THE COPY ARRIVES INACTIVE, and that is the one deviation from "an exact
   * copy". Decision 9 makes a shop's menu the UNION of its active plans and
   * their pars SUM, so an active duplicate covering the same dates would
   * silently double that shop's production the next time anyone generated. The
   * list's own Active toggle is one tap away, which makes turning it on a
   * deliberate act rather than a consequence.
   *
   * Written parent-first — plan, then trays, then slots — because a child with
   * no parent cannot exist, while a plan with no trays is visible and one
   * gesture from being fixed.
   */
  function duplicatePlan(row: PlanRow) {
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      const title = duplicateTitle(rows.map((r) => r.title), row.title);

      const { data: made, error } = await supabase
        .from("production_plans")
        .insert({
          org_id: orgId,
          location_id: row.location_id,
          kitchen_location_id: row.kitchen_location_id,
          title,
          starts_on: row.starts_on,
          ends_on: row.ends_on,
          is_active: false,
          notes: row.notes ?? null,
        })
        .select("id");
      if (error || !made?.length) {
        setFailed(error?.message ?? "That plan could not be duplicated.");
        return;
      }
      const planId = made[0].id as string;

      const { data: trays, error: trayError } = await supabase
        .from("production_plan_trays")
        .select("id, tray_number, band, sort, notes")
        .eq("plan_id", row.id);
      if (trayError) {
        setFailed(`${title} was created, but its trays could not be read: ${trayError.message}`);
        return;
      }
      if (!trays?.length) {
        router.push(`/plans/${planId}`);
        return;
      }

      const { data: madeTrays, error: copyError } = await supabase
        .from("production_plan_trays")
        .insert(
          trays.map((t) => ({
            org_id: orgId,
            plan_id: planId,
            tray_number: t.tray_number as string,
            band: (t.band ?? null) as string | null,
            sort: t.sort as number | null,
            notes: (t.notes ?? null) as string | null,
          }))
        )
        // Ordered so the new ids line up with the ones they came from — the
        // insert's own return order is not something to rely on.
        .select("id, tray_number");
      if (copyError || madeTrays?.length !== trays.length) {
        setFailed(
          `${title} was created, but its trays could not be copied: ${
            copyError?.message ?? "nothing was written"
          }`
        );
        return;
      }
      const newTrayByNumber = new Map(
        madeTrays.map((t) => [t.tray_number as string, t.id as string])
      );

      const { data: slots, error: slotReadError } = await supabase
        .from("production_plan_tray_items")
        .select("tray_id, weekday, item_id, par, sort")
        .in("tray_id", trays.map((t) => t.id as string));
      if (slotReadError) {
        setFailed(`${title} was created, but its items could not be read: ${slotReadError.message}`);
        return;
      }
      const oldNumberById = new Map(trays.map((t) => [t.id as string, t.tray_number as string]));
      const rowsToWrite = (slots ?? []).flatMap((s) => {
        const trayId = newTrayByNumber.get(oldNumberById.get(s.tray_id as string) ?? "");
        return trayId
          ? [{
              org_id: orgId,
              tray_id: trayId,
              weekday: Number(s.weekday),
              item_id: s.item_id as string,
              // The par travels, exactly as it does on a drag-copy. Where the
              // shop's own default disagrees, the new plan OFFERS it.
              par: s.par === null ? null : Number(s.par),
              sort: s.sort as number | null,
            }]
          : [];
      });
      if (rowsToWrite.length) {
        const { data: copied, error: slotError } = await supabase
          .from("production_plan_tray_items")
          .insert(rowsToWrite)
          .select("id");
        if (slotError || copied?.length !== rowsToWrite.length) {
          setFailed(
            `${title} was created, but its items could not be copied: ${
              slotError?.message ?? "nothing was written"
            }`
          );
          return;
        }
      }
      router.push(`/plans/${planId}?${REVIEW_DEFAULTS_PARAM}=review`);
    });
  }

  /** Take a plan off the book — 039 cascades its trays, and those their slots. */
  async function deletePlan(row: PlanRow) {
    const held = row.trayCount
      ? ` and its ${row.trayCount} tray${row.trayCount === 1 ? "" : "s"}${
          row.slotCount ? ` carrying ${row.slotCount} item${row.slotCount === 1 ? "" : "s"}` : ""
        }`
      : "";
    if (!(await confirmDialog({ ...splitConfirmMessage(`Delete "${row.title}"${held}? This cannot be undone.`), confirmLabel: "Delete plan", tone: "danger" }))) return;
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("production_plans")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error || !data?.length) {
        setFailed(error?.message ?? "That plan could not be deleted.");
        return;
      }
      router.refresh();
    });
  }

  const columns: DataColumn<PlanRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_plans" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "title",
      label: "Plan",
      width: 260,
      pinned: true,
      sortValue: (r) => r.title,
      render: (r) => (
        <span className="block">
          <Link href={detailHref(r.id)} className="font-medium hover:underline">
            {r.title}
          </Link>
          {overlaps.has(r.id) ? (
            // Yellow: worth an eye, not wrong. Decision 9 names this exactly.
            <span
              className="block text-[12px] text-mark"
              title={`Also active here: ${overlaps.get(r.id)!.join(", ")}. Pars will sum.`}
            >
              overlaps {overlaps.get(r.id)!.length === 1 ? "1 other plan" : `${overlaps.get(r.id)!.length} other plans`}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "sells",
      label: "Sells at",
      width: 110,
      sortValue: (r) => r.sellsCode,
      sortTiebreaks: [(r) => r.title],
      render: (r) => <span className="font-medium">{r.sellsCode}</span>,
    },
    {
      key: "kitchen",
      label: "Made at",
      width: 110,
      sortValue: (r) => r.kitchenCode ?? "",
      sortTiebreaks: [(r) => r.title],
      // The whole reason this module exists as designed. A kitchen that differs
      // from the selling shop is the case FMP could not express at all.
      render: (r) =>
        r.kitchenCode === null ? (
          <span className="text-mark" title="No kitchen set — generation will not know who makes this">
            not set
          </span>
        ) : (
          <span className={r.kitchenCode === r.sellsCode ? "text-muted" : "font-medium"}>
            {r.kitchenCode}
          </span>
        ),
    },
    {
      key: "dates",
      label: "In force",
      width: 220,
      sortValue: (r) => r.starts_on,
      render: (r) => <span className="text-muted">{planRange(r)}</span>,
    },
    {
      key: "trays",
      label: "Trays",
      width: 90,
      align: "right",
      sortValue: (r) => r.trayCount,
      render: (r) => <span className="tabular-nums text-muted">{r.trayCount}</span>,
    },
    {
      key: "slots",
      label: "Slots filled",
      width: 110,
      align: "right",
      hideWhenCompact: true,
      sortValue: (r) => r.slotCount,
      render: (r) => <span className="tabular-nums text-muted">{r.slotCount}</span>,
    },
    // The row's own commands, in the app's ⋯ idiom. Unlabelled and pinned out
    // of the Columns menu: it is a control column, not a field.
    ...(editable
      ? ([
          {
            key: "actions",
            label: "",
            width: 60,
            align: "right",
            render: (r: PlanRow) => (
              <RowMenu
                label={`Actions for ${r.title}`}
                items={[
                  {
                    label: "Duplicate plan",
                    hint: "An inactive copy, with its trays, items and pars",
                    disabled: pending,
                    onSelect: () => duplicatePlan(r),
                  },
                  {
                    label: "Delete plan",
                    hint: r.trayCount
                      ? `Removes it and its ${r.trayCount} tray${r.trayCount === 1 ? "" : "s"}`
                      : "Removes it from the book",
                    danger: true,
                    disabled: pending,
                    onSelect: () => deletePlan(r),
                  },
                ]}
              />
            ),
          },
        ] as DataColumn<PlanRow>[])
      : []),
  ];

  // The rows in the order the table shows them — `DataTable` is told the sort
  // rather than finding one, so these two can never disagree. Not memoized:
  // `columns` is rebuilt every render (its cells close over `detailHref`).
  const sorted = sortRows(visible, columns, sort);

  // The list publishes what it is showing, IN THAT ORDER, so a detail screen
  // walks the found set the way you are reading it.
  usePublishRecordSet(
    PATH,
    sorted.map((r) => ({ id: r.id, href: detailHref(r.id) }))
  );

  return (
    <>
      {failed ? <p className="mb-3 text-[13px] text-accent">{failed}</p> : null}
    <DataTable
      rows={sorted}
      sort={sort}
      onSortChange={changeSort}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-plans"
      compactBelow={1100}
      columnChooser
      empty={<p className="text-sm text-muted">No plans match these filters.</p>}
      leading={
        <div className="flex flex-wrap items-end gap-3">
          <TextInput
            value={search}
            onValueChange={changeSearch}
            placeholder="Search plans"
            aria-label="Search plans"
            clearLabel="Clear the search"
            className="w-64"
          />
          <TabPicker
            ariaLabel="Which plans"
            value={filters.tier ?? "active"}
            onChange={changeTier}
            options={dimensions[0].options.map((o) => ({
              key: o.value,
              label: o.label,
              count: counts[o.value],
            }))}
          />
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
      }
    />
    </>
  );
}
