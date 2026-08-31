"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TextInput } from "@/components/ui/TextInput";
import { expiryState } from "@/lib/employeeDocuments";

const WIDTHS_KEY = "rf.equipment.columnWidths.v1";

export type EquipmentRow = {
  id: string;
  name: string;
  kind: string | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  installed_on: string | null;
  warranty_ends_on: string | null;
  service_vendor_id: string | null;
  shop_section_id: string | null;
  section_name: string | null;
  is_active: boolean;
  notes: string | null;
  open_tasks: number;
};

export function EquipmentList({
  rows,
  today,
  locationCode,
  editable,
  sections,
  vendors,
}: {
  rows: EquipmentRow[];
  today: string;
  locationCode: string;
  editable: boolean;
  sections: { id: string; display_name: string }[];
  vendors: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.kind, r.make, r.model, r.serial, r.section_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // The vocabulary already in use here — a known set that legitimately grows
  // (a new kind of machine), which is what `allowNew` is for.
  const kinds = useMemo(
    () => [...new Set(rows.map((r) => r.kind).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const columns: DataColumn<EquipmentRow>[] = [
    {
      key: "is_active",
      label: "Active",
      width: 80,
      render: (r) =>
        editable ? (
          <ActiveToggle table="equipment" id={r.id} active={r.is_active} />
        ) : (
          <span className="text-muted">{r.is_active ? "Active" : "Inactive"}</span>
        ),
      sortValue: (r) => (r.is_active ? 0 : 1),
    },
    {
      key: "name",
      label: "Name",
      width: 300,
      pinned: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/equipment/${r.id}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      width: 160,
      sortValue: (r) => r.kind ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="equipment"
            id={r.id}
            column="kind"
            value={r.kind}
            kind="pick"
            allowNew
            ariaLabel={`Kind of ${r.name}`}
            options={kinds.map((k) => ({ value: k, label: k }))}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.kind ?? ""}</span>
        ),
    },
    {
      key: "section",
      label: "Where",
      width: 210,
      sortValue: (r) => r.section_name ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="equipment"
            id={r.id}
            column="shop_section_id"
            value={r.shop_section_id ?? ""}
            kind="pick"
            ariaLabel={`Where ${r.name} stands`}
            options={[
              { value: "", label: "No section" },
              ...sections.map((s) => ({ value: s.id, label: s.display_name })),
            ]}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.section_name ?? ""}</span>
        ),
    },
    {
      key: "warranty_ends_on",
      label: "Warranty",
      width: 170,
      sortValue: (r) => r.warranty_ends_on ?? "",
      // 034's vocabulary reused whole — expired red, expiring-soon yellow, and
      // NULL MEANS "does not lapse", which is the honest reading for most of
      // this register and the reason no backfill was ever needed.
      render: (r) => {
        const state = expiryState(r.warranty_ends_on, today);
        if (state === "none") return <span className="text-muted">Never lapses</span>;
        const tone =
          state === "expired"
            ? "bg-accent px-1 text-white"
            : state === "soon"
              ? "bg-mark-fill px-1"
              : "";
        return <span className={`tabular-nums ${tone}`}>{r.warranty_ends_on}</span>;
      },
    },
    {
      key: "open_tasks",
      label: "Open",
      width: 90,
      align: "right",
      sortValue: (r) => r.open_tasks,
      render: (r) =>
        r.open_tasks > 0 ? (
          <span className="bg-mark-fill px-1 tabular-nums">{r.open_tasks}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "vendor",
      label: "Serviced by",
      width: 200,
      hideWhenCompact: true,
      sortValue: (r) => vendors.find((v) => v.id === r.service_vendor_id)?.name ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="equipment"
            id={r.id}
            column="service_vendor_id"
            value={r.service_vendor_id ?? ""}
            kind="pick"
            ariaLabel={`Who services ${r.name}`}
            options={[
              { value: "", label: "Nobody set" },
              ...vendors.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {vendors.find((v) => v.id === r.service_vendor_id)?.name ?? ""}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search equipment…"
            aria-label="Search equipment"
            clearLabel="Clear the search"
          />
        </div>
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        compactBelow={1280}
        storageKey={WIDTHS_KEY}
        columnChooser
        defaultSort={{ key: "name" }}
        group={{ label: (r) => r.section_name ?? "No section", sortKey: "section" }}
        empty={
          <p className="max-w-[72ch] text-sm text-muted">
            Nothing registered at {locationCode} yet. Add the walk-ins first —
            they are what a temperature reading needs to belong to.
          </p>
        }
      />
    </div>
  );
}
