"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/catalog";
import { usePublishRecordSet } from "@/lib/recordSet";
import { makeComparator, type SortDir, type SortValue } from "@/lib/tableSort";
import { urlFilterParams } from "@/lib/filterMenus";
import {
  vendorDetailHref,
  vendorFiltersToQuery,
  parseVendorFilters,
  type ActiveFilter,
  type VendorFilters,
  type VendorSortKey,
} from "@/lib/vendorFilters";
import { DataTable, type DataColumn } from "./DataTable";
import { VendorActiveToggle } from "@/components/VendorActiveToggle";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickList } from "@/components/ui/PickList";
import type { VendorRow } from "@/app/(app)/vendors/page";

const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

const WIDTHS_STORAGE_KEY = "rf.vendors.columnWidths.v1";

// ISO weekdays: 1 = Monday … 7 = Sunday.
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function days(list: number[] | null) {
  if (!list || list.length === 0) return "—";
  return [...list]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d - 1] ?? d)
    .join(" ");
}

// Sorting by a weekday set: the canonical "1,3,5" string groups vendors that
// share a schedule, which is what you're scanning for. Empty sorts last.
function daysKey(list: number[] | null): SortValue {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => a - b).join(",");
}

// Only Type groups — the other columns have no meaningfully repeated value.
const GROUPING_KEY: VendorSortKey = "type";

function groupLabel(vendor: VendorRow): string {
  return vendor.vendor_type ?? "No type";
}

/** This vendor's config at the active location — the page queries only one. */
function config(vendor: VendorRow) {
  return vendor.vendor_locations[0] ?? null;
}

/**
 * What each column sorts on. ONE function rather than a `sortValue` per column,
 * because the sort lives in the URL: this list orders `rows` itself and
 * DataTable renders them as given, so the column definitions and the comparator
 * would otherwise be two sources for the same answer. The columns delegate here
 * and pass their key.
 */
function sortValue(vendor: VendorRow, key: VendorSortKey): SortValue {
  const c = config(vendor);
  switch (key) {
    case "name":
      return vendor.name;
    case "type":
      return vendor.vendor_type;
    case "order_type":
      return vendor.order_type;
    case "account":
      return c?.account_number ?? null;
    case "minimum":
      return c?.minimum_order === null || c?.minimum_order === undefined
        ? null
        : Number(c.minimum_order);
    case "order_days":
      return daysKey(c?.order_days ?? null);
    case "delivery_days":
      return daysKey(c?.delivery_days ?? null);
    case "active":
      // Active first when ascending.
      return vendor.is_active ? 0 : 1;
  }
}

/**
 * The vendor list, with the same affordances as Inventory: search, type and
 * active filters, sortable + resizable columns, all persisted the same way
 * (view state in the URL, column widths in localStorage).
 */
export function VendorsList({
  vendors,
  types,
  activeLocationCode,
  initialFilters,
}: {
  vendors: VendorRow[];
  types: string[];
  activeLocationCode: string | null;
  initialFilters: VendorFilters;
}) {
  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
  const [filters, setFilters] = useState<VendorFilters>(() => {
    const live = urlFilterParams("/vendors");
    return live ? parseVendorFilters(live) : initialFilters;
  });

  function update(patch: Partial<VendorFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = vendorFiltersToQuery(next);
    window.history.replaceState(null, "", query ? `/vendors?${query}` : "/vendors");
  }

  const visible = useMemo(() => {
    const t = filters.q.trim().toLowerCase();
    return vendors.filter((v) => {
      if (filters.active === "active" && !v.is_active) return false;
      if (filters.active === "inactive" && v.is_active) return false;
      if (filters.type && v.vendor_type !== filters.type) return false;
      if (!t) return true;
      const config = v.vendor_locations[0] ?? null;
      return (
        v.name.toLowerCase().includes(t) ||
        (v.vendor_type ?? "").toLowerCase().includes(t) ||
        v.order_type.toLowerCase().includes(t) ||
        (config?.account_number ?? "").toLowerCase().includes(t)
      );
    });
  }, [vendors, filters]);

  // Sorting is CONTROLLED: it lives in the URL so it survives a trip into a
  // vendor and back, so this list owns both the order of `rows` and the arrow
  // in the header. DataTable leaves an already-ordered list alone.
  const columns: DataColumn<VendorRow>[] = [
      // Active leads on every catalog table (Mark, 2026-07-23).
      {
        key: "active",
        label: "Active",
        width: 95,
        sortValue: (v) => sortValue(v, "active"),
        render: (v) => <VendorActiveToggle vendorId={v.id} active={v.is_active} />,
      },
      {
        key: "name",
        label: "Name",
        width: 265,
        pinned: true,
        sortValue: (v) => sortValue(v, "name"),
        render: (v) => (
          <Link
            href={vendorDetailHref(v.id, filters)}
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            {v.name}
          </Link>
        ),
      },
      {
        key: "type",
        label: "Type",
        width: 145,
        sortValue: (v) => sortValue(v, "type"),
        render: (v) => <span className="text-muted">{v.vendor_type ?? "—"}</span>,
      },
      {
        key: "order_type",
        label: "Order via",
        width: 130,
        hideWhenCompact: true,
        sortValue: (v) => sortValue(v, "order_type"),
        render: (v) => <span className="text-muted">{v.order_type}</span>,
      },
      {
        key: "account",
        label: "Account",
        width: 155,
        hideWhenCompact: true,
        sortValue: (v) => sortValue(v, "account"),
        render: (v) => (
          <span className="text-muted">{config(v)?.account_number ?? "—"}</span>
        ),
      },
      {
        key: "minimum",
        label: "Minimum",
        width: 140,
        align: "right",
        sortValue: (v) => sortValue(v, "minimum"),
        render: (v) => (
          <span className="text-muted">{money(config(v)?.minimum_order ?? null)}</span>
        ),
      },
      {
        key: "order_days",
        label: "Order days",
        width: 180,
        sortValue: (v) => sortValue(v, "order_days"),
        render: (v) => (
          <span className="tabular-nums text-muted">{days(config(v)?.order_days ?? null)}</span>
        ),
      },
      {
        key: "delivery_days",
        label: "Delivery days",
        width: 180,
        sortValue: (v) => sortValue(v, "delivery_days"),
        render: (v) => (
          <span className="tabular-nums text-muted">
            {days(config(v)?.delivery_days ?? null)}
          </span>
        ),
      },
  ];

  const grouping = filters.sort === GROUPING_KEY;

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<VendorRow>({
          value: (v) => sortValue(v, filters.sort),
          dir: filters.dir,
          tiebreaks: [(v) => v.name],
        })
      ),
    [visible, filters.sort, filters.dir]
  );

  // The found set, for the record book on vendor detail (lib/recordSet).
  usePublishRecordSet(
    "/vendors",
    useMemo(
      () => sorted.map((v) => ({ id: v.id, href: vendorDetailHref(v.id, filters) })),
      [sorted, filters]
    )
  );


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Vendors</h1>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {visible.length} of {vendors.length}
          {activeLocationCode ? ` · ${activeLocationCode}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          value={filters.q}
          onValueChange={(q) => update({ q })}
          placeholder="Search name, type, account…"
          clearLabel="Clear the search"
          className="w-72"
        />
        {/* A PickList, not a native <select> (Mark, 2026-08-01 — he named this
            one): the OS menu was the last thing on this row that didn't look
            like the app. "All types" is a real choice with a real label, so it
            reads at full strength rather than as a placeholder. */}
        <PickList
          variant="field"
          ariaLabel="Vendor type"
          value={filters.type}
          onPick={(type) => update({ type })}
          options={[
            { value: "", label: "All types" },
            ...types.map((t) => ({ value: t, label: t })),
          ]}
          className="w-48"
        />

        <TabPicker
          ariaLabel="Active state"
          value={filters.active}
          onChange={(active) => update({ active })}
          options={ACTIVE_TABS}
        />
      </div>

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(v) => v.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        // Sheds Order via and Account below xl (Mark, 2026-07-31). Now that
        // columns are proportional this is purely about how many you can READ
        // on a tablet — the table fits either way — so it's the app's ordinary
        // breakpoint rather than a width derived from the column sums.
        compactBelow={1280}
        // Inactive vendors stay in the list but recede — the Active toggle in
        // the first column is how you bring one back.
        rowClassName={(v) => (v.is_active ? "" : "text-faint")}
        // Bands only when the sort IS the grouped column, or you'd get a
        // heading every few rows. See DataGroup.
        group={grouping ? { label: groupLabel } : undefined}
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as VendorSortKey, dir: next.dir as SortDir })
        }
        empty={<p className="text-sm text-muted">No vendors match these filters.</p>}
      />
    </div>
  );
}
