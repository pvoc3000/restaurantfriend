"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/catalog";
import { makeComparator, nextSortDir, type SortValue } from "@/lib/tableSort";
import { useResizableColumns, type ColumnWidths } from "@/lib/columnWidths";
import {
  vendorDetailHref,
  vendorFiltersToQuery,
  type ActiveFilter,
  type VendorFilters,
  type VendorSortKey,
} from "@/lib/vendorFilters";
import { ColumnHeader } from "./ColumnHeader";
import { VendorActiveToggle } from "@/components/VendorActiveToggle";
import { TextInput } from "@/components/ui/TextInput";
import type { VendorRow } from "@/app/(app)/vendors/page";

const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

const COLUMNS: {
  key: VendorSortKey;
  label: string;
  width: number;
  align?: "right";
}[] = [
  // Active leads on every catalog table (Mark, 2026-07-23).
  { key: "active", label: "Active", width: 95 },
  { key: "name", label: "Name", width: 265 },
  { key: "type", label: "Type", width: 145 },
  { key: "order_type", label: "Order via", width: 130 },
  { key: "account", label: "Account", width: 155 },
  { key: "minimum", label: "Minimum", width: 140, align: "right" },
  { key: "order_days", label: "Order days", width: 180 },
  { key: "delivery_days", label: "Delivery days", width: 180 },
];

const DEFAULT_WIDTHS: ColumnWidths = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.width])
);

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

function sortValue(vendor: VendorRow, key: VendorSortKey): SortValue {
  const config = vendor.vendor_locations[0] ?? null;
  switch (key) {
    case "name":
      return vendor.name;
    case "type":
      return vendor.vendor_type;
    case "order_type":
      return vendor.order_type;
    case "account":
      return config?.account_number ?? null;
    case "minimum":
      return config?.minimum_order === null || config?.minimum_order === undefined
        ? null
        : Number(config.minimum_order);
    case "order_days":
      return daysKey(config?.order_days ?? null);
    case "delivery_days":
      return daysKey(config?.delivery_days ?? null);
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
  const [filters, setFilters] = useState<VendorFilters>(initialFilters);
  const { widths, startResize, setWidth, reset, customized, totalWidth } =
    useResizableColumns(WIDTHS_STORAGE_KEY, DEFAULT_WIDTHS);

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

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (grouping) {
      for (const v of sorted) {
        const label = groupLabel(v);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return counts;
  }, [sorted, grouping]);

  function toggleSort(key: VendorSortKey) {
    update({ sort: key, dir: nextSortDir(filters.sort === key, filters.dir) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Vendors</h1>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          {visible.length} of {vendors.length}
          {activeLocationCode ? ` · ${activeLocationCode}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs text-faint">
          <span>Drag the dividers between column headers to resize</span>
          {customized && (
            <button
              onClick={reset}
              title="Restore the default column widths"
              className="text-muted hover:underline"
            >
              Reset column widths
            </button>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          value={filters.q}
          onValueChange={(q) => update({ q })}
          placeholder="Search name, type, account…"
          clearLabel="Clear the search"
          className="h-9 w-72 text-sm"
        />
        <select
          value={filters.type}
          onChange={(e) => update({ type: e.target.value })}
          className="h-9 border border-ink bg-white px-2 text-sm"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm">
          {ACTIVE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => update({ active: t.key })}
              className={`border-b-2 px-1 pb-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] ${
                filters.active === t.key
                  ? "border-ink text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted">No vendors match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="table-fixed border-collapse text-sm"
            style={{ width: totalWidth(COLUMNS) }}
          >
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: widths[col.key] ?? col.width }} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-left text-muted [&>th]:shadow-[inset_0_-2px_0_var(--rf-neutral-900)]">
                {COLUMNS.map((col) => (
                  <ColumnHeader
                    key={col.key}
                    label={col.label}
                    align={col.align}
                    sorted={filters.sort === col.key ? filters.dir : false}
                    onSort={() => toggleSort(col.key)}
                    onResizeStart={(e) => startResize(e, col.key)}
                    onResizeReset={() => setWidth(col.key, col.width)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((v, i) => {
                const config = v.vendor_locations[0] ?? null;
                const label = grouping ? groupLabel(v) : null;
                const startsGroup =
                  label !== null && (i === 0 || groupLabel(sorted[i - 1]) !== label);

                const row = (
                  <tr
                    className={`hover:bg-neutral-50 ${
                      v.is_active ? "" : "text-faint"
                    }`}
                  >
                    <td className="truncate px-4 py-4">
                      <VendorActiveToggle vendorId={v.id} active={v.is_active} />
                    </td>
                    <td className="truncate px-4 py-4">
                      <Link
                        href={vendorDetailHref(v.id, filters)}
                        className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td className="truncate px-4 py-4 text-muted">
                      {v.vendor_type ?? "—"}
                    </td>
                    <td className="truncate px-4 py-4 text-muted">{v.order_type}</td>
                    <td className="truncate px-4 py-4 text-muted">
                      {config?.account_number ?? "—"}
                    </td>
                    <td className="truncate px-4 py-4 text-right tabular-nums text-muted">
                      {money(config?.minimum_order ?? null)}
                    </td>
                    <td className="truncate px-4 py-4 tabular-nums text-muted">
                      {days(config?.order_days ?? null)}
                    </td>
                    <td className="truncate px-4 py-4 tabular-nums text-muted">
                      {days(config?.delivery_days ?? null)}
                    </td>
                  </tr>
                );

                if (!startsGroup) return <Fragment key={v.id}>{row}</Fragment>;

                return (
                  <Fragment key={v.id}>
                    <tr className="border-b border-hairline bg-neutral-100">
                      <td
                        colSpan={COLUMNS.length}
                        className="px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-body"
                      >
                        {label}
                        <span className="ml-2 font-normal normal-case tracking-normal text-subtle">
                          {groupCounts.get(label!) ?? 0}
                        </span>
                      </td>
                    </tr>
                    {row}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
