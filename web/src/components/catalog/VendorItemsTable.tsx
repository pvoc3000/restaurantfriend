"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { qty, unitPrice, unitPriceLabel, type CatalogVendorItem } from "@/lib/catalog";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import type { StaleBucket } from "@/lib/lastOrdered";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { DataTable, type DataColumn } from "./DataTable";
import { ListFilters, type ActiveFilter, type StaleFilter } from "./ListFilters";

// On the vendor screen each row belongs to a different inventory item, so the
// query embeds the item; on the item screen that column is redundant.
export type VendorItemWithItem = CatalogVendorItem & {
  inventory_items?: {
    id: string;
    name: string;
    base_unit: string;
    category?: string | null;
  } | null;
  // Attached by the vendor screen: when the linked inventory item was last
  // ordered AT THE ACTIVE LOCATION (v_item_last_ordered), same semantics as the
  // Inventory list. Not vendor-item specific — see the note in the page.
  last_order_date?: string | null;
  stale?: StaleBucket;
};

/**
 * Inline-editable vendor-item grid, shared by item detail (all vendors for one
 * item) and vendor detail (all items for one vendor). Sorting and column
 * resizing come from DataTable, same as every other list.
 *
 * Price edits go straight to vendor_items.price — the DB trigger writes the
 * price history, so nothing is logged here (CLAUDE.md rule 6). package_content
 * is in the ITEM's base unit; the cleanup drawer has the amount × size × unit
 * calculator for the cases where that math isn't obvious.
 */
export function VendorItemsTable({
  vendorItems,
  baseUnit,
  showVendor = false,
  showItem = false,
  scroll = false,
  from,
  filters = false,
  showLastOrdered = false,
}: {
  vendorItems: VendorItemWithItem[];
  baseUnit?: string;
  showVendor?: boolean;
  showItem?: boolean;
  /** Own scroll pane with a sticky header — for vendors with hundreds of items. */
  scroll?: boolean;
  /** Where links out of this table should return to. */
  from?: Crumb;
  /** Search + category + active + last-ordered bar, as on the Inventory list. */
  filters?: boolean;
  showLastOrdered?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  // "All" rather than Inventory's "Active" default: this screen has always
  // shown every one of a vendor's items, and silently hiding the inactive ones
  // on load would look like data loss.
  const [active, setActive] = useState<ActiveFilter>("all");
  const [stale, setStale] = useState<StaleFilter>("any");

  const categories = useMemo(
    () =>
      [
        ...new Set(
          vendorItems
            .map((vi) => vi.inventory_items?.category)
            .filter((c): c is string => !!c)
        ),
      ].sort(),
    [vendorItems]
  );

  const staleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const vi of vendorItems) if (vi.stale) counts[vi.stale] = (counts[vi.stale] ?? 0) + 1;
    return counts;
  }, [vendorItems]);

  const visible = useMemo(() => {
    if (!filters) return vendorItems;
    const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return vendorItems.filter((vi) => {
      if (active === "active" && !vi.is_active) return false;
      if (active === "inactive" && vi.is_active) return false;
      if (category && vi.inventory_items?.category !== category) return false;
      if (stale !== "any" && vi.stale !== stale) return false;
      if (words.length === 0) return true;
      // Every word must appear somewhere in the row, so "bag brown" matches
      // regardless of which field each word came from.
      const haystack = [
        vi.inventory_items?.name,
        vi.vendors?.name,
        vi.product_id,
        vi.brand,
        vi.description,
        vi.package_desc,
        vi.notes,
        vi.inventory_items?.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [vendorItems, filters, term, category, active, stale]);

  const unitFor = (vi: VendorItemWithItem) =>
    vi.inventory_items?.base_unit ?? baseUnit ?? "unit";

  const link = (href: string) => (from ? withFrom(href, from) : href);

  const columns: DataColumn<VendorItemWithItem>[] = [
    // Active leads on every catalog table (Mark, 2026-07-23): the on/off state
    // is the first thing scanned, and a fixed first position keeps the toggles
    // aligned across screens.
    {
      key: "is_active",
      label: "Active",
      width: 95,
      sortValue: (vi) => (vi.is_active ? 0 : 1),
      render: (vi) => (
        <ActiveToggle
          table="vendor_items"
          id={vi.id}
          active={vi.is_active}
          label="Vendor item active"
        />
      ),
    },
    ...(showVendor
      ? [
          {
            key: "vendor",
            label: "Vendor",
            width: 180,
            sortValue: (vi: VendorItemWithItem) => vi.vendors?.name ?? null,
            render: (vi: VendorItemWithItem) => (
              <>
                {vi.vendors ? (
                  <Link
                    href={link(`/vendors/${vi.vendors.id}`)}
                    className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                  >
                    {vi.vendors.name}
                  </Link>
                ) : (
                  "—"
                )}
                {vi.vendors && !vi.vendors.is_active && (
                  <span className="ml-1 border border-neutral-300 bg-neutral-100 px-1 text-xs text-muted">
                    vendor inactive
                  </span>
                )}
              </>
            ),
          },
        ]
      : []),
    ...(showItem
      ? [
          {
            key: "item",
            label: "Item",
            width: 205,
            sortValue: (vi: VendorItemWithItem) => vi.inventory_items?.name ?? null,
            render: (vi: VendorItemWithItem) =>
              vi.inventory_items ? (
                <Link
                  href={link(`/items/${vi.inventory_items.id}`)}
                  className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                >
                  {vi.inventory_items.name}
                </Link>
              ) : (
                <span className="text-accent">unlinked</span>
              ),
          },
        ]
      : []),
    {
      key: "product_id",
      label: "Product ID",
      width: 130,
      sortValue: (vi) => vi.product_id,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="product_id" value={vi.product_id} />
      ),
    },
    {
      key: "brand",
      label: "Brand",
      width: 130,
      sortValue: (vi) => vi.brand,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="brand" value={vi.brand} />
      ),
    },
    {
      key: "description",
      label: "Description",
      width: 310,
      sortValue: (vi) => vi.description,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="description" value={vi.description} />
      ),
    },
    {
      key: "package_desc",
      label: "Pack",
      width: 95,
      sortValue: (vi) => vi.package_desc,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="package_desc" value={vi.package_desc} />
      ),
    },
    {
      key: "package_content",
      label: "Content",
      width: 110,
      align: "right",
      sortValue: (vi) => (vi.package_content === null ? null : Number(vi.package_content)),
      // Read-only (Mark, 2026-07-29). It's the base-unit total the ordering
      // math divides by, derivable from the pack structure beside it, and a
      // second hand-typed copy of a derived number is only ever a way for the
      // two to disagree. /cleanup's package editor is the one writer.
      render: (vi) => qty(vi.package_content),
    },
    {
      key: "price",
      label: "Price",
      width: 110,
      align: "right",
      sortValue: (vi) => (vi.price === null ? null : Number(vi.price)),
      render: (vi) => (
        <InlineValue
          table="vendor_items"
          id={vi.id}
          column="price"
          value={vi.price}
          kind="number"
          align="right"
        />
      ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 120,
      align: "right",
      // Sorts on the number, not the formatted string, so $9 < $10.
      sortValue: (vi) => unitPrice(vi),
      render: (vi) => (
        <span className="text-subtle">{unitPriceLabel(vi, unitFor(vi))}</span>
      ),
    },
    {
      key: "notes",
      label: "Notes",
      width: 180,
      sortValue: (vi) => vi.notes,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="notes" value={vi.notes} />
      ),
    },
    ...(showLastOrdered
      ? [
          {
            key: "last_ordered",
            label: "Last ordered",
            width: 145,
            sortValue: (vi: VendorItemWithItem) => vi.last_order_date ?? null,
            render: (vi: VendorItemWithItem) =>
              vi.last_order_date ? (
                <span className="tabular-nums text-muted">{vi.last_order_date}</span>
              ) : (
                <span className="text-accent">never</span>
              ),
          },
        ]
      : []),
  ];

  const table = (
    <DataTable
      rows={visible}
      columns={columns}
      rowKey={(vi) => vi.id}
      storageKey={`rf.vendorItems.columnWidths.v1${showItem ? ".byVendor" : ".byItem"}`}
      rowClassName={(vi) => (vi.is_active ? "" : "text-faint")}
      scroll={scroll}
      // The filter bar eats about 9rem above the pane; without this the page
      // starts scrolling again and the sticky config is pushed off-screen.
      maxHeightClass={filters ? "max-h-[calc(100vh-36rem)]" : undefined}
      empty={
        <p className="text-sm text-muted">
          {vendorItems.length === 0
            ? "No vendor items yet. The cleanup drawer's vendor-item picker can link an existing one to this item."
            : "No vendor items match these filters."}
        </p>
      }
    />
  );

  if (!filters) return table;

  return (
    <div className="space-y-3">
      <ListFilters
        term={term}
        onTerm={setTerm}
        placeholder="Search item, product ID, brand, description…"
        categories={categories}
        category={category}
        onCategory={setCategory}
        active={active}
        onActive={setActive}
        stale={showLastOrdered ? stale : undefined}
        onStale={showLastOrdered ? setStale : undefined}
        staleCounts={staleCounts}
        totalCount={vendorItems.length}
      />
      <p className="text-xs text-subtle">
        {visible.length} of {vendorItems.length}
      </p>
      {table}
    </div>
  );
}
