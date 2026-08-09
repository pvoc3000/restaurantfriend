"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { elementKindLabel, type ElementKind } from "@/lib/production";
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

type Tier = "all" | "made" | "purchased" | "manual" | "uncosted";

/**
 * The element catalog.
 *
 * Grouped by TYPE, which is the column that earns a band by the usual test —
 * few values, many rows each (Topping 61, Glaze 35, Cleaning 25 over ~470
 * rows). The band appears only when the sort is Type, so it can't become a
 * heading every few rows.
 *
 * The **Uncosted** tier is not a category, it is the catalog cleanup: 155 of the
 * migrated elements resolve to no cost at all, and until somebody works through
 * them every recipe containing one prints "≥". Giving it a tab makes the
 * backlog a place you can go rather than a footnote under each recipe.
 */
export function ElementsList({ rows, editable }: { rows: ElementRow[]; editable: boolean }) {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<Tier>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      made: rows.filter((r) => r.kind === "made").length,
      purchased: rows.filter((r) => r.kind === "purchased").length,
      manual: rows.filter((r) => r.kind === "manual").length,
      uncosted: rows.filter((r) => r.cost.cost === null).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "uncosted" ? r.cost.cost !== null : tier !== "all" && r.kind !== tier) {
        return false;
      }
      if (!q) return true;
      // Every column you can READ, you can search — including SCHEDULE (Mark,
      // 2026-08-09), which is how you pull up everything on the weekly bake.
      // A search that silently ignores a column the table is showing reads as
      // the term not being in the data.
      return (
        r.name.toLowerCase().includes(q) ||
        (r.element_type ?? "").toLowerCase().includes(q) ||
        (r.schedule_class ?? "").toLowerCase().includes(q) ||
        (r.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, tier]);

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
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search elements"
              className="w-64"
              aria-label="Search elements"
            />
            <TabPicker
              ariaLabel="Kind"
              value={tier}
              onChange={setTier}
              options={[
                { key: "all" as Tier, label: "All", count: counts.all },
                { key: "made" as Tier, label: "Made", count: counts.made },
                { key: "purchased" as Tier, label: "Purchased", count: counts.purchased },
                { key: "manual" as Tier, label: "Manual", count: counts.manual },
                { key: "uncosted" as Tier, label: "Uncosted", count: counts.uncosted },
              ]}
            />
          </div>
          {tier === "uncosted" && counts.uncosted > 0 ? (
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
