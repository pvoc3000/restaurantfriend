"use client";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { InlineValue } from "@/components/catalog/InlineValue";
import { EARNING_COLUMNS } from "@/lib/gustoExport";
import { BENEFIT_UNIT_HINT, BENEFIT_UNIT_LABEL, type BenefitUnit } from "@/lib/payrollBenefits";

export type PayrollBenefitRow = {
  id: string;
  code: string;
  name: string;
  gusto_column: string;
  unit: BenefitUnit;
  default_amount: number | null;
  is_active: boolean;
  notes: string | null;
  /** How many people currently earn it — the figure that says whether a row is
   *  in use before somebody retires it. */
  entitlements: number;
};

/**
 * The benefit catalog.
 *
 * `gusto_column` is a `PickList` over `EARNING_COLUMNS` and not free text, which
 * is the whole reason this screen exists rather than the row being seeded in SQL
 * and left alone. The two fields most likely to be wrong on a new benefit — the
 * column and the unit — are also the two that corrupt a payroll file silently: a
 * column this file does not have drops the money without comment, and pointing
 * one at an hours column would put $12 where 12 hours belongs. A pick list makes
 * the first unenterable; `exportReadiness` catches anything written around it.
 *
 * `code` is deliberately NOT editable. It is what the backfill script and any
 * future migration match on, and renaming it would quietly orphan them.
 */
export function PayrollBenefitsList({
  rows,
  editable,
}: {
  rows: PayrollBenefitRow[];
  editable: boolean;
}) {
  const columns: DataColumn<PayrollBenefitRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 90,
      sortValue: (b) => (b.is_active ? 0 : 1),
      // The house rule: the Active toggle leads every catalog table, and it is
      // why 033 names the column `is_active` rather than `active`.
      render: (b) => (
        <ActiveToggle table="payroll_benefits" id={b.id} active={b.is_active} />
      ),
    },
    {
      key: "name",
      label: "Benefit",
      width: 240,
      pinned: true,
      sortValue: (b) => b.name,
      render: (b) =>
        editable ? (
          <InlineValue table="payroll_benefits" id={b.id} column="name" value={b.name} nullable={false} />
        ) : (
          b.name
        ),
    },
    {
      key: "amount",
      label: "Amount",
      width: 120,
      sortValue: (b) => b.default_amount ?? -1,
      render: (b) =>
        editable ? (
          <InlineValue
            table="payroll_benefits"
            id={b.id}
            column="default_amount"
            kind="number"
            value={b.default_amount}
            format={(v) => (v === null ? "—" : `$${Number(v).toFixed(2)}`)}
          />
        ) : b.default_amount === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="tabular-nums">${b.default_amount.toFixed(2)}</span>
        ),
    },
    {
      key: "unit",
      label: "How often",
      width: 200,
      sortValue: (b) => b.unit,
      render: (b) =>
        editable ? (
          <InlineValue
            table="payroll_benefits"
            id={b.id}
            column="unit"
            kind="pick"
            value={b.unit}
            nullable={false}
            options={(["per_shift", "per_workday", "per_period"] as BenefitUnit[]).map((u) => ({
              value: u,
              label: BENEFIT_UNIT_LABEL[u],
              hint: BENEFIT_UNIT_HINT[u],
            }))}
          />
        ) : (
          BENEFIT_UNIT_LABEL[b.unit]
        ),
    },
    {
      key: "column",
      label: "Gusto column",
      width: 320,
      sortValue: (b) => b.gusto_column,
      render: (b) =>
        editable ? (
          <InlineValue
            table="payroll_benefits"
            id={b.id}
            column="gusto_column"
            kind="pick"
            value={b.gusto_column}
            nullable={false}
            options={EARNING_COLUMNS.map((c) => ({ value: c, label: c }))}
          />
        ) : (
          <span className="text-[13px]">{b.gusto_column}</span>
        ),
    },
    {
      key: "people",
      label: "People",
      width: 90,
      sortValue: (b) => b.entitlements,
      render: (b) =>
        b.entitlements > 0 ? (
          <span className="tabular-nums">{b.entitlements}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "notes",
      label: "Note",
      width: 260,
      hideWhenCompact: true,
      sortValue: (b) => b.notes ?? "",
      render: (b) =>
        editable ? (
          <InlineValue table="payroll_benefits" id={b.id} column="notes" value={b.notes} />
        ) : (
          <span className="text-muted">{b.notes ?? "—"}</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(b) => b.id}
      storageKey="rf.payrollBenefits.v1"
      columnChooser
      compactBelow={1280}
      empty={<p className="text-sm text-muted">No benefits yet.</p>}
    />
  );
}
