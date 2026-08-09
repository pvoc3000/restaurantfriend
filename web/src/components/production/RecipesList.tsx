"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";

export type RecipeRow = {
  id: string;
  name: string;
  recipe_type: string | null;
  is_active: boolean;
  elementId: string;
  elementName: string;
  versionCount: number;
  masterLabel: string | null;
  /** What one batch of the master version costs, live. */
  batchCost: Cost;
  yieldAmount: number | null;
  yieldUnit: string | null;
};

type Tier = "active" | "all" | "no-master";

/**
 * The recipe families.
 *
 * A row is the FAMILY, not a version — decision 3's whole point. FileMaker had
 * no family row at all: it kept 493 version records and grouped them by name,
 * which is why four elements carry two spellings of one recipe across their
 * history and read as two recipes from the list.
 */
export function RecipesList({ rows, editable }: { rows: RecipeRow[]; editable: boolean }) {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<Tier>("active");

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.is_active).length,
      all: rows.length,
      "no-master": rows.filter((r) => !r.masterLabel).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "active" && !r.is_active) return false;
      if (tier === "no-master" && r.masterLabel) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.elementName.toLowerCase().includes(q) ||
        (r.recipe_type ?? "").toLowerCase().includes(q) ||
        // The Master column prints "v11", so "v11" should find it. The other
        // thing that column says — "none" — is deliberately NOT matched here:
        // the no-master tier beside the box already answers that, and a search
        // term that secretly means a filter is a worse way to ask.
        (r.masterLabel ? `v${r.masterLabel}`.toLowerCase().includes(q) : false)
      );
    });
  }, [rows, search, tier]);

  usePublishRecordSet(
    "/recipes",
    visible.map((r) => ({ id: r.id, href: `/recipes/${r.id}` }))
  );

  const columns: DataColumn<RecipeRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_recipes" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "name",
      label: "Recipe",
      width: 300,
      pinned: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/recipes/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "element",
      label: "Makes",
      width: 240,
      sortValue: (r) => r.elementName,
      render: (r) => (
        <Link href={`/elements/${r.elementId}`} className="text-muted hover:underline">
          {r.elementName}
        </Link>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 140,
      sortValue: (r) => r.recipe_type ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.recipe_type ?? "—"}</span>,
    },
    {
      key: "versions",
      label: "Versions",
      width: 110,
      align: "right",
      sortValue: (r) => r.versionCount,
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="tabular-nums text-muted">{r.versionCount}</span>,
    },
    {
      key: "master",
      label: "Master",
      width: 110,
      sortValue: (r) => r.masterLabel ?? "",
      sortTiebreaks: [(r) => r.name],
      // A family with no master is the one state that breaks costing, so it is
      // marked rather than left blank — yellow, because it is worth an eye
      // rather than wrong (the receiving screen's rule).
      render: (r) =>
        r.masterLabel ? (
          <span className="text-muted">v{r.masterLabel}</span>
        ) : (
          <span className="text-mark">none</span>
        ),
    },
    {
      key: "yield",
      label: "Yield",
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => r.yieldAmount,
      render: (r) => (
        <span className="tabular-nums text-muted">
          {r.yieldAmount === null ? "—" : `${r.yieldAmount} ${r.yieldUnit ?? ""}`.trim()}
        </span>
      ),
    },
    {
      key: "cost",
      label: "Batch cost",
      width: 150,
      align: "right",
      sortValue: (r) => r.batchCost.cost,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums" title={unresolvedSummary(r.batchCost) ?? undefined}>
          {formatCost(r.batchCost)}
        </span>
      ),
    },
  ];

  const group: DataGroup<RecipeRow> = {
    sortKey: "type",
    label: (r) => r.recipe_type ?? "No type",
  };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-recipes"
      compactBelow={1280}
      columnChooser
      group={group}
      empty={<p className="text-sm text-muted">No recipes match these filters.</p>}
      leading={
        <div className="flex flex-wrap items-end gap-3">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search recipes"
            className="w-64"
            aria-label="Search recipes"
          />
          <TabPicker
            ariaLabel="Which recipes"
            value={tier}
            onChange={setTier}
            options={[
              { key: "active" as Tier, label: "Active", count: counts.active },
              { key: "all" as Tier, label: "All", count: counts.all },
              { key: "no-master" as Tier, label: "No master", count: counts["no-master"] },
            ]}
          />
        </div>
      }
    />
  );
}
