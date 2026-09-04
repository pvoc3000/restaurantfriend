"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STALE_ORDER, STALE_LABEL } from "@/lib/lastOrdered";
import { qty } from "@/lib/catalog";
import { urlFilterParams } from "@/lib/filterMenus";
import {
  itemDetailHref,
  itemFiltersToQuery,
  parseItemFilters,
  type ActiveFilter,
  type ItemFilters,
  type SortKey,
  type StaleFilter,
} from "@/lib/itemFilters";
import { makeComparator, type SortDir, type SortValue } from "@/lib/tableSort";
import { usePublishRecordSet } from "@/lib/recordSet";
import { DataTable, type DataColumn } from "./DataTable";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { NewInventoryItem } from "./NewInventoryItem";
import { PickList } from "@/components/ui/PickList";
import type { ItemRow } from "@/app/(app)/items/page";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";

const ACTIVE_TABS: { key: ActiveFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

const WIDTHS_STORAGE_KEY = "rf.items.columnWidths.v1";

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
function sortValue(item: ItemRow, key: SortKey): SortValue {
  const il = item.inventory_item_locations[0] ?? null;
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
  orgId,
  editable,
}: {
  items: ItemRow[];
  categories: string[];
  activeLocationCode: string | null;
  initialFilters: ItemFilters;
  orgId: string;
  /** purchaser+ — 001's generic write policy. */
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  // Seeded from the ADDRESS BAR where it can be read, and only from the props
  // otherwise — see `urlFilterParams`. A back or forward restore hands this
  // component the props of whatever query the history entry was created with,
  // which after a `replaceState` is not the query it now shows.
  const [filters, setFilters] = useState<ItemFilters>(() => {
    const live = urlFilterParams("/items");
    return live ? parseItemFilters(live) : initialFilters;
  });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);


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
      return (
        i.name.toLowerCase().includes(t) ||
        (i.category ?? "").toLowerCase().includes(t)
      );
    });
  }, [items, filters]);

  const grouping = GROUPING_KEYS.includes(filters.sort) ? filters.sort : null;

  const sorted = useMemo(
    () =>
      [...visible].sort(
        makeComparator<ItemRow>({
          value: (item) => sortValue(item, filters.sort),
          dir: filters.dir,
          // Two shop sections can share a sort_order; tie-break on the label so
          // each group stays one contiguous run under its header. Name is the
          // final tiebreaker so equal rows keep a stable order.
          tiebreaks: [
            ...(grouping ? [(item: ItemRow) => groupLabel(item, grouping)] : []),
            (item: ItemRow) => item.name,
          ],
        })
      ),
    [visible, filters.sort, filters.dir, grouping]
  );


  // The found set, in the order it's on screen, for the record book on item
  // detail (lib/recordSet). `sorted`, not `items`: what the book walks has to
  // be what you can see, filters, search and sort included.
  usePublishRecordSet(
    "/items",
    useMemo(
      () => sorted.map((i) => ({ id: i.id, href: itemDetailHref(i.id, filters) })),
      [sorted, filters]
    )
  );

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

  const columns: DataColumn<ItemRow>[] = [
    {
      key: "select",
      label: "",
      width: 40,
      // No label and nothing to sort by — the header cell carries the
      // select-all instead. See DataColumn.header.
      header: (
        <Checkbox
          checked={allVisibleChecked}
          onChange={toggleAllVisible}
          label="select all"
          size={18}
        />
      ),
      render: (item) => (
        <Checkbox
          checked={checked.has(item.id)}
          onChange={() => toggleOne(item.id)}
          label={`select ${item.name}`}
          size={18}
        />
      ),
    },
    {
      key: "name",
      label: "Item",
      width: 310,
      // The column that IS the row, and the way into the record.
      pinned: true,
      sortValue: (item) => sortValue(item, "name"),
      render: (item) => (
        <>
          <Link
            href={itemDetailHref(item.id, filters)}
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            {item.name}
          </Link>
          {!item.is_active && (
            <span className="ml-1.5 border border-neutral-300 bg-neutral-100 px-1 text-xs text-muted">
              inactive
            </span>
          )}
          {!item.inventory_item_locations[0] && (
            <span className="ml-1.5 border border-ink bg-mark-fill px-1 text-xs text-ink">
              not stocked here
            </span>
          )}
        </>
      ),
    },
    {
      key: "category",
      label: "Category",
      width: 170,
      sortValue: (item) => sortValue(item, "category"),
      render: (item) => <span className="text-muted">{item.category ?? "—"}</span>,
    },
    {
      key: "section",
      label: "Section",
      width: 205,
      hideWhenCompact: true,
      sortValue: (item) => sortValue(item, "section"),
      render: (item) => (
        <span className="text-muted">
          {item.inventory_item_locations[0]?.shop_sections?.display_name ?? "—"}
        </span>
      ),
    },
    {
      key: "par",
      label: "Par",
      width: 85,
      align: "right",
      sortValue: (item) => sortValue(item, "par"),
      render: (item) => (
        <span className="text-muted">
          {qty(item.inventory_item_locations[0]?.default_par)}
        </span>
      ),
    },
    {
      key: "unit",
      label: "Unit",
      width: 85,
      sortValue: (item) => sortValue(item, "unit"),
      render: (item) => <span className="text-muted">{item.base_unit}</span>,
    },
    {
      key: "last",
      label: "Last ordered",
      width: 145,
      hideWhenCompact: true,
      sortValue: (item) => sortValue(item, "last"),
      render: (item) =>
        item.last_order_date ? (
          <span className="tabular-nums text-muted">{item.last_order_date}</span>
        ) : (
          <span className="tabular-nums text-accent">never</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* The module's model header — see `VendorsList`. */}
      <div>
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Inventory
        </h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
          {activeLocationCode ? `${activeLocationCode} · ` : ""}
          {visible.length} of {items.length} inventory items
        </p>
      </div>

      {/* Search + category */}
      <div className="flex flex-wrap items-end gap-2">
        <TextInput
          value={filters.q}
          onValueChange={(q) => update({ q })}
          placeholder="Search name or category…"
          clearLabel="Clear the search"
          className="w-72"
        />
        {/* A PickList, not a native <select> (Mark, 2026-08-01 — he named this
            one). Past 8 categories it also gains the find box, which the OS
            menu could never offer on an iPad. */}
        <PickList
          variant="field"
          ariaLabel="Category"
          value={filters.category}
          onPick={(category) => update({ category })}
          options={[
            { value: "", label: "All categories" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          className="w-56"
        />

        <TabPicker
          ariaLabel="Active state"
          value={filters.active}
          onChange={(active) => update({ active })}
          options={ACTIVE_TABS}
        />
        {editable ? (
          <div className="ml-auto">
            <NewInventoryItem
              orgId={orgId}
              categories={categories}
              existingNames={items.map((i) => i.name)}
            />
          </div>
        ) : null}
      </div>

      {/* Last-ordered filter — same buckets as the cleanup queue. The label
          sits ON ITS OWN LINE above the tabs (Mark, 2026-08-01): the bar is
          five cells wide and a label beside it pushed the whole thing off the
          left margin every other filter row starts at. */}
      <div className="space-y-1.5">
        <span className="block text-xs uppercase tracking-[0.12em] text-faint">
          Last ordered
        </span>
        <TabPicker
          ariaLabel="Last ordered"
          value={filters.stale}
          onChange={(stale) => update({ stale })}
          options={(["any", ...STALE_ORDER] as StaleFilter[]).map((t) => ({
            key: t,
            label: t === "any" ? "Any age" : STALE_LABEL[t],
            count: t === "any" ? items.length : staleCounts[t] ?? 0,
          }))}
        />
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-ink px-4 py-3 text-sm">
          <span>{checked.size} selected</span>
          <button
            disabled={busy}
            onClick={() => deactivate("here")}
            className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Deactivate here{activeLocationCode ? ` (${activeLocationCode})` : ""}
          </button>
          <button
            disabled={busy}
            onClick={() => deactivate("everywhere")}
            className={DANGER_BUTTON_CLASS}
          >
            Deactivate everywhere
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-muted hover:underline"
          >
            Clear
          </button>
          {error && <span className="text-accent">{error}</span>}
        </div>
      )}

      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(item) => item.id}
        storageKey={WIDTHS_STORAGE_KEY}
        columnChooser
        // Below xl the list sheds Section and Last ordered (Mark, 2026-07-31),
        // taking the row from 1040px to 690 — which fits a portrait iPad's
        // 736px column, so the column labels can stick. Both are still on the
        // item's own screen.
        compactBelow={1280}
        // Inactive items stay in the list but recede; the row still carries an
        // "inactive" badge, because colour alone shouldn't have to say it.
        rowClassName={(item) => (item.is_active ? "" : "text-faint")}
        // Bands only when the sort IS a groupable column — Category or Section.
        // The rows are already contiguous by that label, because `sorted`
        // tie-breaks on it. See DataGroup.
        group={grouping ? { label: (item) => groupLabel(item, grouping) } : undefined}
        sort={{ key: filters.sort, dir: filters.dir }}
        onSortChange={(next) =>
          update({ sort: next.key as SortKey, dir: next.dir as SortDir })
        }
        empty={<p className="text-sm text-muted">No items match these filters.</p>}
      />
    </div>
  );
}
