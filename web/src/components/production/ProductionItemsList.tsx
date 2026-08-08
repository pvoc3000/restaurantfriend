"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn, type DataGroup } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { usePublishRecordSet } from "@/lib/recordSet";
import { formatCost, unresolvedSummary, type Cost } from "@/lib/productionCost";
import { formatMargin, type PriceSource } from "@/lib/productionPrice";

export type ProductionItemRow = {
  id: string;
  name: string;
  item_type: string | null;
  subtype: string | null;
  finish: string | null;
  size: string | null;
  baseName: string | null;
  price_class: string | null;
  price_tier: string | null;
  is_active: boolean;
  componentCount: number;
  cost: Cost;
  price: number | null;
  priceSource: PriceSource;
  margin: number | null;
};

type Tier = "active" | "all" | "uncosted" | "unpriced";

/**
 * The menu — what you assemble and sell, against what it costs to make.
 *
 * FileMaker computed cost, profit and a cost-to-price ratio on every item and
 * FROZE all three; rows still carry figures derived from 2022 prices. These are
 * derived on every load instead, which is decision 11 reaching the layer where
 * it is most visible: a flour price that moved this morning moves the margin on
 * 244 raised donuts this afternoon.
 *
 * Grouped by TYPE — few values, many rows each (Raised 244, Cake 32 of 307),
 * which is the test a column has to pass to earn a band.
 */
export function ProductionItemsList({
  rows,
  editable,
}: {
  rows: ProductionItemRow[];
  editable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<Tier>("active");

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.is_active).length,
      all: rows.length,
      uncosted: rows.filter((r) => r.cost.cost === null).length,
      unpriced: rows.filter((r) => r.price === null).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tier === "active" && !r.is_active) return false;
      if (tier === "uncosted" && r.cost.cost !== null) return false;
      if (tier === "unpriced" && r.price !== null) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        [r.item_type, r.subtype, r.finish, r.size, r.baseName]
          .some((v) => (v ?? "").toLowerCase().includes(q))
      );
    });
  }, [rows, search, tier]);

  // The list publishes what it is showing, so a detail screen walks the found
  // set rather than sending you back here for the next one.
  usePublishRecordSet(
    "/production-items",
    visible.map((r) => ({ id: r.id, href: `/production-items/${r.id}` }))
  );

  const columns: DataColumn<ProductionItemRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.is_active ? 0 : 1),
      render: (r) =>
        editable ? (
          <ActiveToggle table="production_items" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Yes" : "No"}</span>
        ),
    },
    {
      key: "name",
      label: "Item",
      width: 300,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.name,
      sortTiebreaks: [(r) => r.size ?? "", (r) => r.subtype ?? ""],
      // The name alone is ambiguous — "Angry Samoa" is four donuts (038) — so
      // the row carries the taxonomy that distinguishes them underneath it.
      render: (r) => (
        <span className="block">
          <Link href={`/production-items/${r.id}`} className="font-medium hover:underline">
            {r.name}
          </Link>
          <span className="block text-[12px] text-subtle">
            {[r.size, r.item_type, r.subtype].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    {
      key: "finish",
      label: "Finish",
      width: 130,
      hideWhenCompact: true,
      sortValue: (r) => r.finish ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.finish ?? "—"}</span>,
    },
    {
      key: "dough",
      label: "Dough",
      width: 160,
      hideWhenCompact: true,
      sortValue: (r) => r.baseName ?? "",
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="text-muted">{r.baseName ?? "—"}</span>,
    },
    {
      key: "components",
      label: "On it",
      width: 90,
      align: "right",
      sortValue: (r) => r.componentCount,
      sortTiebreaks: [(r) => r.name],
      render: (r) => <span className="tabular-nums text-muted">{r.componentCount}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      width: 130,
      align: "right",
      sortValue: (r) => r.cost.cost,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums" title={unresolvedSummary(r.cost) ?? undefined}>
          {formatCost(r.cost)}
        </span>
      ),
    },
    {
      key: "price",
      label: "Price",
      width: 130,
      align: "right",
      sortValue: (r) => r.price,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span className="tabular-nums">
          {r.price === null ? "—" : `$${r.price.toFixed(2)}`}
          {/* Yellow, not red: an override is worth an eye, never an error. */}
          {r.priceSource === "item" || r.priceSource === "location" ? (
            <span className="ml-1 text-mark" title={`Overridden at this ${r.priceSource === "item" ? "item" : "location"}`}>
              *
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "margin",
      label: "Margin",
      width: 110,
      align: "right",
      sortValue: (r) => r.margin,
      sortTiebreaks: [(r) => r.name],
      render: (r) => (
        <span
          className="tabular-nums"
          // A margin computed from an incomplete cost is an UPPER bound, so it
          // is marked rather than shown as if it were the answer.
          title={r.cost.unresolved.length ? "At most — some components are unpriced" : undefined}
        >
          {r.cost.unresolved.length && r.margin !== null ? "≤ " : ""}
          {formatMargin(r.margin)}
        </span>
      ),
    },
  ];

  const group: DataGroup<ProductionItemRow> = {
    sortKey: "name",
    label: (r) => r.item_type ?? "No type",
  };

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-items"
      compactBelow={1280}
      columnChooser
      group={group}
      leading={
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search the menu"
              className="w-64"
              aria-label="Search items"
            />
            <TabPicker
              ariaLabel="Which items"
              value={tier}
              onChange={setTier}
              options={[
                { key: "active" as Tier, label: "Active", count: counts.active },
                { key: "all" as Tier, label: "All", count: counts.all },
                { key: "uncosted" as Tier, label: "Uncosted", count: counts.uncosted },
                { key: "unpriced" as Tier, label: "Unpriced", count: counts.unpriced },
              ]}
            />
          </div>
          {tier === "unpriced" && counts.unpriced > 0 ? (
            <p className="max-w-[80ch] text-[13px] text-muted">
              These carry no price class or tier, so the grid has no cell for
              them. Setting both gives them a price without touching a number.
            </p>
          ) : null}
        </div>
      }
    />
  );
}
