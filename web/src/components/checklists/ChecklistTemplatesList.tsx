"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { SHIFT_SLOT_LABEL } from "@/lib/employeeEvents";
import {
  CHECKLIST_KIND_LABEL,
  shiftSetLabel,
  weekdaySetLabel,
  type ChecklistKind,
} from "@/lib/checklists";
import { NewChecklistTemplate } from "./NewChecklistTemplate";

const WIDTHS_KEY = "rf.checklistTemplates.columnWidths.v1";

export type TemplateRow = {
  id: string;
  kind: ChecklistKind;
  name: string;
  weekdays: number[] | null;
  shifts: string[] | null;
  is_active: boolean;
  notes: string | null;
  item_count: number;
};

const KINDS: ChecklistKind[] = ["checklist", "walkthrough", "inspection"];

/**
 * The master lists.
 *
 * ONE dimension — kind — so it is a `TabPicker` and not `ui/FilterMenus`, which
 * is for three or more ANDed together. The counts sit on the tabs and describe
 * the SEARCHED set, so searching narrows the tabs rather than leaving them
 * claiming a total the table isn't showing.
 *
 * Local state rather than the URL: this is one small list read in one sitting,
 * and unlike `/items` there is no detail round trip deep enough to lose.
 */
export function ChecklistTemplatesList({
  rows,
  orgId,
  locationId,
  locationCode,
  editable,
}: {
  rows: TemplateRow[];
  orgId: string;
  locationId: string;
  locationCode: string;
  editable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ChecklistKind | "all">("all");

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const shown = useMemo(
    () => (kind === "all" ? searched : searched.filter((r) => r.kind === kind)),
    [searched, kind],
  );

  const columns: DataColumn<TemplateRow>[] = [
    {
      key: "is_active",
      label: "Active",
      width: 90,
      // The Active toggle leads every catalog table in this app.
      // No `disabled` on this control by design: below purchaser+ the row
      // renders the WORD instead, so nobody is offered a write RLS would
      // silently swallow (076 changes 0 rows and returns no error).
      render: (r) =>
        editable ? (
          <ActiveToggle table="checklist_templates" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Active" : "Inactive"}</span>
        ),
      sortValue: (r) => (r.is_active ? 0 : 1),
    },
    {
      key: "name",
      label: "Name",
      width: 340,
      pinned: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/checklist-templates/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 140,
      sortValue: (r) => r.kind,
      render: (r) => CHECKLIST_KIND_LABEL[r.kind],
    },
    {
      key: "item_count",
      label: "Items",
      width: 90,
      align: "right",
      sortValue: (r) => r.item_count,
      render: (r) => <span className="tabular-nums">{r.item_count}</span>,
    },
    {
      key: "weekdays",
      label: "Days",
      width: 200,
      sortValue: (r) => weekdaySetLabel(r.weekdays),
      render: (r) => (
        <span className={r.weekdays ? "" : "text-muted"}>
          {weekdaySetLabel(r.weekdays)}
        </span>
      ),
    },
    {
      key: "shifts",
      label: "Shifts",
      width: 200,
      hideWhenCompact: true,
      sortValue: (r) => shiftSetLabel(r.shifts, (s) => s),
      render: (r) => (
        <span className={r.shifts ? "" : "text-muted"}>
          {shiftSetLabel(r.shifts, (s) => SHIFT_SLOT_LABEL[s as never] ?? s)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* The create command right-aligned ABOVE the filter row — `ui/FilterMenus`'
          `trailing` rule, which this list follows by hand because one dimension
          keeps it a TabPicker. */}
      {editable && (
        <div className="flex justify-end">
          <NewChecklistTemplate
            orgId={orgId}
            locationId={locationId}
            locationCode={locationCode}
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search master lists…"
            aria-label="Search master lists"
            clearLabel="Clear the search"
          />
        </div>
        <TabPicker
          ariaLabel="Kind"
          value={kind}
          options={[
            { key: "all" as const, label: "All", count: searched.length },
            ...KINDS.map((k) => ({
              key: k,
              label: CHECKLIST_KIND_LABEL[k],
              count: searched.filter((r) => r.kind === k).length,
            })),
          ]}
          onChange={(v) => setKind(v as ChecklistKind | "all")}
        />
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        compactBelow={1280}
        storageKey={WIDTHS_KEY}
        columnChooser
        defaultSort={{ key: "name" }}
        empty={
          <p className="max-w-[72ch] text-sm text-muted">
            No master lists at {locationCode} yet. A checklist is what a
            supervisor walks at the end of a shift; a walkthrough is a
            manager’s round; an inspection log records an outside visit.
          </p>
        }
      />
    </div>
  );
}
