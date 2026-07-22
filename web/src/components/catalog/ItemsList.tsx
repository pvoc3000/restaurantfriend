"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STALE_ORDER, STALE_LABEL } from "@/lib/lastOrdered";
import { money, qty, vendorItemLabel } from "@/lib/catalog";
import {
  itemDetailHref,
  itemFiltersToQuery,
  type ActiveFilter,
  type ItemFilters,
  type SortKey,
  type StaleFilter,
} from "@/lib/itemFilters";
import { useColumnWidths, type ColumnWidths } from "@/lib/columnWidths";
import type { ItemRow } from "@/app/(app)/items/page";

const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

// The table is `table-fixed` with an explicit <colgroup> so drag-resizing a
// column actually holds — with auto layout the browser re-negotiates every
// width from the content. Widths are in px; `sort: null` = not sortable.
const COLUMNS: {
  key: string;
  label: string;
  width: number;
  sort: SortKey | null;
  align?: "right";
}[] = [
  { key: "select", label: "", width: 32, sort: null },
  { key: "name", label: "Item", width: 260, sort: "name" },
  { key: "category", label: "Category", width: 140, sort: "category" },
  { key: "section", label: "Section", width: 170, sort: "section" },
  { key: "par", label: "Par", width: 72, sort: "par", align: "right" },
  { key: "unit", label: "Unit", width: 72, sort: "unit" },
  { key: "vendor", label: "Default vendor item", width: 300, sort: "vendor" },
  { key: "price", label: "Price", width: 90, sort: "price", align: "right" },
  { key: "last", label: "Last ordered", width: 120, sort: "last" },
];

// Module-level so the widths hook's memo key is stable across renders.
const DEFAULT_WIDTHS: ColumnWidths = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.width])
);

const WIDTHS_STORAGE_KEY = "rf.items.columnWidths.v1";
const MIN_COLUMN_WIDTH = 48;

// Sorting by category or section turns the list into a grouped report: a
// banner row before each run of matching rows. Only these two group — the rest
// (name, par, price, date) have no meaningful repeated value to break on.
const GROUPING_KEYS: SortKey[] = ["category", "section"];

function groupLabel(item: ItemRow, key: SortKey): string {
  if (key === "section") {
    return item.inventory_item_locations[0]?.shop_sections?.display_name ?? "No section";
  }
  return item.category ?? "No category";
}

/**
 * What each sortable column sorts on. Sections sort by their numeric
 * sort_order, not the display name, so the list follows the physical walk order
 * of the shop rather than alphabet.
 */
function sortValue(item: ItemRow, key: SortKey): string | number | null {
  const il = item.inventory_item_locations[0] ?? null;
  const vi = il?.vendor_items ?? null;
  switch (key) {
    case "name":
      return item.name;
    case "category":
      return item.category;
    case "section":
      return il?.shop_sections?.sort_order ?? null;
    case "par":
      return il?.default_par === null || il?.default_par === undefined
        ? null
        : Number(il.default_par);
    case "unit":
      return item.base_unit;
    case "vendor":
      return vi?.vendors?.name ?? null;
    case "price":
      return vi?.price === null || vi?.price === undefined ? null : Number(vi.price);
    case "last":
      // YYYY-MM-DD sorts chronologically as a string.
      return item.last_order_date;
  }
}

/**
 * The general catalog list (brief §D) — search / category / active /
 * last-ordered, with multi-select deactivate. Unlike /cleanup this shows the
 * whole catalog, healthy rows included; it's the way in to item detail.
 *
 * Filters live in the URL so they survive a trip into item detail and back.
 * The URL is written with history.replaceState rather than router.replace on
 * purpose: router.replace would re-run the server component (a full refetch of
 * ~790 items) on every keystroke, and all the filtering here is client-side.
 */
export function ItemsList({
  items,
  categories,
  activeLocationCode,
  initialFilters,
}: {
  items: ItemRow[];
  categories: string[];
  activeLocationCode: string | null;
  initialFilters: ItemFilters;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [filters, setFilters] = useState<ItemFilters>(initialFilters);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { widths, setWidth, reset: resetWidths, customized } = useColumnWidths(
    WIDTHS_STORAGE_KEY,
    DEFAULT_WIDTHS
  );
  // Live widths during a drag; committed to storage on pointer-up so we're not
  // writing localStorage on every mouse move.
  const [dragWidths, setDragWidths] = useState<ColumnWidths | null>(null);
  const effectiveWidths = dragWidths ?? widths;
  const tableWidth = COLUMNS.reduce((sum, c) => sum + (effectiveWidths[c.key] ?? c.width), 0);

  function startResize(event: React.PointerEvent, columnKey: string) {
    event.preventDefault();
    const startX = event.clientX;
    const base = { ...effectiveWidths };
    const startWidth = base[columnKey] ?? MIN_COLUMN_WIDTH;
    const widthAt = (clientX: number) =>
      Math.max(MIN_COLUMN_WIDTH, startWidth + clientX - startX);

    const onMove = (e: PointerEvent) => {
      setDragWidths({ ...base, [columnKey]: widthAt(e.clientX) });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragWidths(null);
      setWidth(columnKey, widthAt(e.clientX));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function update(patch: Partial<ItemFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    const query = itemFiltersToQuery(next);
    window.history.replaceState(null, "", query ? `/items?${query}` : "/items");
  }

  const visible = useMemo(() => {
    const t = filters.q.trim().toLowerCase();
    return items.filter((i) => {
      if (filters.active === "active" && !i.is_active) return false;
      if (filters.active === "inactive" && i.is_active) return false;
      if (filters.category && i.category !== filters.category) return false;
      if (filters.stale !== "any" && i.stale !== filters.stale) return false;
      if (!t) return true;
      const vi = i.inventory_item_locations[0]?.vendor_items ?? null;
      return (
        i.name.toLowerCase().includes(t) ||
        (i.category ?? "").toLowerCase().includes(t) ||
        (vi?.vendors?.name ?? "").toLowerCase().includes(t) ||
        (vi !== null && vendorItemLabel(vi).toLowerCase().includes(t))
      );
    });
  }, [items, filters]);

  const grouping = GROUPING_KEYS.includes(filters.sort) ? filters.sort : null;

  // Empty cells sink to the bottom in BOTH directions — flipping the sort to
  // find the biggest par shouldn't fill the top with items that have no par.
  const sorted = useMemo(() => {
    const dir = filters.dir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const va = sortValue(a, filters.sort);
      const vb = sortValue(b, filters.sort);
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      let c =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
      // Two shop sections can share a sort_order; tie-break on the label so
      // each group stays one contiguous run under its header.
      if (c === 0 && grouping) {
        c = groupLabel(a, grouping).localeCompare(groupLabel(b, grouping));
      }
      // Name is the final tiebreaker so equal rows keep a stable order.
      if (c === 0) c = a.name.localeCompare(b.name);
      return c * dir;
    });
  }, [visible, filters.sort, filters.dir, grouping]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (grouping) {
      for (const item of sorted) {
        const label = groupLabel(item, grouping);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return counts;
  }, [sorted, grouping]);

  function toggleSort(key: SortKey) {
    update(
      filters.sort === key
        ? { dir: filters.dir === "asc" ? "desc" : "asc" }
        : { sort: key, dir: "asc" }
    );
  }

  // A plain function, not a nested component: <Foo/> defined inside a render
  // would be a new component type each pass and remount the header every time.
  function columnHeader(col: (typeof COLUMNS)[number]) {
    const on = col.sort !== null && filters.sort === col.sort;
    const arrow = on ? (filters.dir === "asc" ? "▲" : "▼") : "";
    return (
      <th
        key={col.key}
        className={`relative px-2 py-1 font-medium ${col.align === "right" ? "text-right" : ""}`}
        aria-sort={on ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {col.key === "select" ? (
          <input
            type="checkbox"
            checked={allVisibleChecked}
            onChange={toggleAllVisible}
            aria-label="select all"
          />
        ) : (
          <button
            type="button"
            onClick={() => col.sort && toggleSort(col.sort)}
            title={`Sort by ${col.label.toLowerCase()}`}
            className={`inline-flex max-w-full items-center gap-1 truncate rounded px-1 hover:bg-neutral-100 ${
              on ? "font-semibold text-neutral-900" : ""
            }`}
          >
            <span className="truncate">{col.label}</span>
            {/* Reserve the arrow's width so headers don't jump when sort moves. */}
            <span className={`w-3 shrink-0 text-xs ${on ? "" : "text-neutral-300"}`}>
              {arrow || "↕"}
            </span>
          </button>
        )}

        {/* Drag handle on the column's right edge. */}
        <span
          onPointerDown={(e) => startResize(e, col.key)}
          onDoubleClick={() => setWidth(col.key, col.width)}
          title="Drag to resize · double-click to reset this column"
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400"
        />
      </th>
    );
  }

  const staleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.stale] = (c[i.stale] ?? 0) + 1;
    return c;
  }, [items]);

  const visibleIds = visible.map((i) => i.id);
  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "Here" deactivates the item-location rows at the current location; the
  // catalog master stays active elsewhere. "Everywhere" deactivates the item
  // itself — same two scopes the cleanup drawer offers, one item at a time.
  async function deactivate(scope: "here" | "everywhere") {
    const rows = items.filter((i) => checked.has(i.id));
    if (rows.length === 0) return;
    setBusy(true);
    setError(null);

    if (scope === "here") {
      const ilIds = rows
        .map((r) => r.inventory_item_locations[0]?.id)
        .filter((id): id is string => !!id);
      if (ilIds.length === 0) {
        setError("None of the selected items are stocked at this location.");
        setBusy(false);
        return;
      }
      const { error } = await supabase
        .from("inventory_item_locations")
        .update({ is_active: false })
        .in("id", ilIds);
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("inventory_items")
        .update({ is_active: false })
        .in(
          "id",
          rows.map((r) => r.id)
        );
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    setChecked(new Set());
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Inventory Items</h1>
        <span className="text-sm text-neutral-500">
          {visible.length} of {items.length}
          {activeLocationCode ? ` · ${activeLocationCode}` : ""}
        </span>
        {customized && (
          <button
            onClick={resetWidths}
            title="Restore the default column widths"
            className="ml-auto text-sm text-neutral-600 hover:underline"
          >
            Reset column widths
          </button>
        )}
      </div>

      {/* Search + category */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search name, category, vendor…"
          className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <select
          value={filters.category}
          onChange={(e) => update({ category: e.target.value })}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm">
          {ACTIVE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => update({ active: t.key })}
              className={`rounded px-2 py-1 ${
                filters.active === t.key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Last-ordered filter — same buckets as the cleanup queue */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          Last ordered
        </span>
        {(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => {
          const count = t === "any" ? items.length : staleCounts[t] ?? 0;
          const label = t === "any" ? "Any age" : STALE_LABEL[t];
          const on = filters.stale === t;
          return (
            <button
              key={t}
              onClick={() => update({ stale: t })}
              className={`rounded-full border px-3 py-1 text-sm ${
                on
                  ? "border-amber-700 bg-amber-700 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 ${on ? "text-amber-200" : "text-neutral-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>{checked.size} selected</span>
          <button
            disabled={busy}
            onClick={() => deactivate("here")}
            className="rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100 disabled:opacity-50"
          >
            Deactivate here{activeLocationCode ? ` (${activeLocationCode})` : ""}
          </button>
          <button
            disabled={busy}
            onClick={() => deactivate("everywhere")}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-800 disabled:opacity-50"
          >
            Deactivate everywhere
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-neutral-600 hover:underline"
          >
            Clear
          </button>
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-neutral-600">No items match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="table-fixed border-collapse text-sm"
            style={{ width: tableWidth }}
          >
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: effectiveWidths[col.key] ?? col.width }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                {COLUMNS.map(columnHeader)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => {
                const il = item.inventory_item_locations[0] ?? null;
                const vi = il?.vendor_items ?? null;
                // A banner row starts each new run of the grouped column.
                const label = grouping ? groupLabel(item, grouping) : null;
                const startsGroup =
                  label !== null &&
                  (i === 0 || groupLabel(sorted[i - 1], grouping!) !== label);

                const row = (
                  <tr
                    className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                      item.is_active ? "" : "text-neutral-400"
                    }`}
                  >
                    <td className="truncate px-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        aria-label={`select ${item.name}`}
                      />
                    </td>
                    <td className="truncate px-2 py-1">
                      <Link
                        href={itemDetailHref(item.id, filters)}
                        className="text-blue-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                      {!item.is_active && (
                        <span className="ml-1.5 rounded bg-neutral-200 px-1 text-xs text-neutral-600">
                          inactive
                        </span>
                      )}
                      {!il && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs text-amber-800">
                          not stocked here
                        </span>
                      )}
                    </td>
                    <td className="truncate px-2 py-1 text-neutral-600">
                      {item.category ?? "—"}
                    </td>
                    <td className="truncate px-2 py-1 text-neutral-600">
                      {il?.shop_sections?.display_name ?? "—"}
                    </td>
                    <td className="truncate px-2 py-1 text-right tabular-nums text-neutral-600">
                      {qty(il?.default_par)}
                    </td>
                    <td className="truncate px-2 py-1 text-neutral-600">{item.base_unit}</td>
                    <td className="truncate px-2 py-1 text-neutral-600">
                      {vi ? (
                        <>
                          <span className="font-medium text-neutral-700">
                            {vi.vendors?.name ?? "—"}
                          </span>{" "}
                          {vendorItemLabel(vi)}
                          {vi.package_desc ? (
                            <span className="text-neutral-500"> · {vi.package_desc}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-400">none</span>
                      )}
                    </td>
                    <td className="truncate px-2 py-1 text-right tabular-nums text-neutral-600">
                      {money(vi?.price)}
                    </td>
                    <td className="truncate px-2 py-1 tabular-nums">
                      {item.last_order_date ? (
                        <span className="text-neutral-600">{item.last_order_date}</span>
                      ) : (
                        <span className="text-amber-700">never</span>
                      )}
                    </td>
                  </tr>
                );

                if (!startsGroup) return <Fragment key={item.id}>{row}</Fragment>;

                return (
                  <Fragment key={item.id}>
                    <tr className="border-b border-neutral-300 bg-neutral-100">
                      <td
                        colSpan={COLUMNS.length}
                        className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-700"
                      >
                        {label}
                        <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">
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
