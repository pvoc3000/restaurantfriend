"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { usePublishRecordSet } from "@/lib/recordSet";
import { overlappingPlans, planRange, type PlanSummary } from "@/lib/productionPlans";

export type PlanRow = PlanSummary & {
  sellsCode: string;
  kitchenCode: string | null;
  trayCount: number;
  slotCount: number;
};

type Tier = "active" | "all";

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
export function PlansList({ rows, editable }: { rows: PlanRow[]; editable: boolean }) {
  const [tier, setTier] = useState<Tier>("active");

  const visible = useMemo(
    () => rows.filter((r) => (tier === "active" ? r.is_active : true)),
    [rows, tier]
  );
  const overlaps = useMemo(() => overlappingPlans(rows), [rows]);

  usePublishRecordSet(
    "/plans",
    visible.map((r) => ({ id: r.id, href: `/plans/${r.id}` }))
  );

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
          <Link href={`/plans/${r.id}`} className="font-medium hover:underline">
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
  ];

  return (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="production-plans"
      compactBelow={1100}
      columnChooser
      leading={
        <TabPicker
          ariaLabel="Which plans"
          value={tier}
          onChange={setTier}
          options={[
            { key: "active" as Tier, label: "Active", count: rows.filter((r) => r.is_active).length },
            { key: "all" as Tier, label: "All", count: rows.length },
          ]}
        />
      }
    />
  );
}
