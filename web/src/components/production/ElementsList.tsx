"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import {
  ELEMENT_KINDS,
  elementKindLabel,
  ELEMENT_KIND_LABEL,
  type ElementKind,
} from "@/lib/production";
import {
  applyListFilters,
  type FilterDimension,
  type FilterValues,
} from "@/lib/listFilters";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";

export type ElementRow = {
  id: string;
  name: string;
  kind: ElementKind;
  element_type: string | null;
  schedule_class: string | null;
  is_active: boolean;
  /** What it resolves to today — recomputed on the server each load. */
  cost: Cost;
  /** The name of what it costs FROM, so the Source column can be read. */
  source: string | null;
  recipeCount: number;
};

/**
 * FileMaker's own three, in the order Mark named them (2026-08-09), and
 * measured against the live catalog the same day: WEEKLY 158, AB 47, DONUT 18.
 *
 * `production_elements.schedule_class` is plain text with no check constraint,
 * so this list is a PRESENTATION order rather than the vocabulary itself —
 * anything else the column holds is appended below rather than being made
 * unreachable. That is the "Sold as" lesson: a value left off a list with no
 * `allowNew` doesn't merely go unlisted, it becomes unfindable, while rows
 * carrying it keep rendering, which is what hid that gap for four days.
 */
const SCHEDULE_ORDER = ["DONUT", "AB", "WEEKLY"];

/** Title case for display; the stored values are shouted. */
function scheduleLabel(value: string): string {
  return value.length <= 2
    ? value.toUpperCase()
    : value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** The unset option can't be "", so "none" is the word for carrying no schedule. */
const NO_SCHEDULE = "none";

/**
 * The element catalog.
 *
 * Grouped by TYPE, which is the column that earns a band by the usual test —
 * few values, many rows each (Topping 61, Glaze 35, Cleaning 25 over ~470
 * rows). The band appears only when the sort is Type, so it can't become a
 * heading every few rows.
 *
 * FOUR COMBINING MENUS RATHER THAN ONE ROW OF TABS (Mark, 2026-08-09: "instead
 * of single filter with all options displayed, lets try a row of popup menus to
 * combine filter options"). The single `TabPicker` mixed two questions into one
 * row — three of its five cells were the KIND and the fourth was whether a cost
 * resolves — so asking both at once was impossible and the row could only grow.
 *
 * Two of the four are Mark's list applied as written. The other two are here
 * because dropping them would have deleted working behaviour:
 *
 * - **Cost** carries the old Uncosted tier, which is not a category but the
 *   catalog cleanup: 209 elements resolve to no cost at all, and until somebody
 *   works through them every recipe containing one prints "≥". It is better off
 *   as a menu than as a tab, because "uncosted AND on the weekly bake" is now a
 *   question you can ask.
 * - **Schedule's "None"** is 247 of the 470 elements — more than half the
 *   catalog, and invisible under Mark's three named values. Same argument as
 *   "No section" being a real option on an item's shelf: without it there is no
 *   way to see the ones that have none, which is the set most worth working on.
 */
export function ElementsList({ rows, editable }: { rows: ElementRow[]; editable: boolean }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});

  const dimensions = useMemo<FilterDimension<ElementRow>[]>(() => {
    // Whatever the column actually holds, Mark's three first.
    const schedules = [...new Set(rows.map((r) => r.schedule_class).filter(Boolean) as string[])];
    schedules.sort((a, b) => {
      const ai = SCHEDULE_ORDER.indexOf(a.toUpperCase());
      const bi = SCHEDULE_ORDER.indexOf(b.toUpperCase());
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return a.localeCompare(b);
    });

    return [
      {
        key: "active",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
        matches: (r, v) => (v === "active" ? r.is_active : !r.is_active),
      },
      {
        // Labelled for the column it filters. Mark called this "element type",
        // but the table's TYPE column is `element_type` (Topping, Glaze) and
        // this is `kind` — a menu named after the wrong neighbour would be a
        // small lie repeated on every visit.
        key: "kind",
        label: "Kind",
        options: ELEMENT_KINDS.map((k) => ({ value: k, label: ELEMENT_KIND_LABEL[k] })),
        matches: (r, v) => r.kind === v,
      },
      {
        key: "schedule",
        label: "Schedule",
        options: [
          ...schedules.map((s) => ({ value: s, label: scheduleLabel(s) })),
          { value: NO_SCHEDULE, label: "None" },
        ],
        matches: (r, v) =>
          v === NO_SCHEDULE ? r.schedule_class === null : r.schedule_class === v,
      },
      {
        key: "cost",
        label: "Cost",
        options: [
          { value: "costed", label: "Costed" },
          { value: "uncosted", label: "Uncosted" },
        ],
        matches: (r, v) => (v === "uncosted" ? r.cost.cost === null : r.cost.cost !== null),
      },
    ];
  }, [rows]);

  // SEARCH FIRST, THEN THE MENUS — so the menus' counts describe the list you
  // are looking at rather than the whole catalog. The other order would have a
  // menu offer "Weekly 158" while the search has already cut you to nine.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      // Every column you can READ, you can search — including SCHEDULE (Mark,
      // 2026-08-09), which is how you pull up everything on the weekly bake.
      // A search that silently ignores a column the table is showing reads as
      // the term not being in the data.
      [r.name, r.element_type ?? "", r.schedule_class ?? "", r.source ?? ""].some((field) =>
        field.toLowerCase().includes(q)
      )
    );
  }, [rows, search]);

  const visible = useMemo(
    () => applyListFilters(searched, dimensions, filters),
    [searched, dimensions, filters]
  );

  // The list publishes what it is showing, so a detail screen can walk it.
  usePublishRecordSet(
    "/elements",
    visible.map((r) => ({ id: r.id, href: `/elements/${r.id}` }))
  );

  const columns: DataColumn<ElementRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_elements" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "name",
      label: "Element",
      width: 300,
      pinned: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/elements/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 110,
      sortValue: (r) => r.kind,
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{elementKindLabel(r.kind)}</span>,
    },
    {
      key: "type",
      label: "Type",
      width: 160,
      sortValue: (r) => r.element_type ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.element_type ?? "—"}</span>,
    },
    {
      key: "source",
      label: "Costs from",
      width: 260,
      hideWhenCompact: true,
      sortValue: (r) => r.source ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.source ?? "—"}</span>,
    },
    {
      key: "schedule",
      label: "Schedule",
      width: 110,
      hideWhenCompact: true,
      sortValue: (r) => r.schedule_class ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.schedule_class ?? "—"}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      width: 140,
      align: "right",
      // Nulls sink in both directions via lib/tableSort, so the uncosted don't
      // masquerade as the cheapest.
      sortValue: (r) => r.cost.cost,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span
          className="tabular-nums"
          // The ≥ says a figure is a lower bound; this says what it's hiding.
          title={unresolvedSummary(r.cost) ?? undefined}
        >
          {formatCost(r.cost)}
          {r.cost.unit ? (
            <span className="text-subtle"> /{r.cost.unit}</span>
          ) : null}
        </span>
      ),
    },
  ];

  const group: DataGroup<ElementRow> = {
    sortKey: "type",
    label: (r) => r.element_type ?? "No type",
  };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-elements"
      compactBelow={1280}
      columnChooser
      group={group}
      empty={<p className="text-sm text-muted">No elements match these filters.</p>}
      leading={
        <div className="space-y-3">
          <FilterMenus
            rows={searched}
            total={rows.length}
            noun="elements"
            dimensions={dimensions}
            values={filters}
            onChange={setFilters}
            leading={
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Search
                </span>
                <TextInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Name, type, schedule…"
                  className="w-64"
                  aria-label="Search elements"
                  clearLabel="Clear the search"
                />
              </div>
            }
          />
          {filters.cost === "uncosted" ? (
            <p className="max-w-[80ch] text-[13px] text-muted">
              These resolve to no cost at all — a purchased element with no
              inventory item, a made one with no recipe, or a manual one with no
              amount. Every recipe containing one prints its cost as a lower
              bound until they are settled.
            </p>
          ) : null}
        </div>
      }
    />
  );
}
