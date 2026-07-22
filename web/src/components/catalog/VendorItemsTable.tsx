"use client";

import Link from "next/link";
import { unitPrice, unitPriceLabel, type CatalogVendorItem } from "@/lib/catalog";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { DataTable, type DataColumn } from "./DataTable";

// On the vendor screen each row belongs to a different inventory item, so the
// query embeds the item; on the item screen that column is redundant.
export type VendorItemWithItem = CatalogVendorItem & {
  inventory_items?: { id: string; name: string; base_unit: string } | null;
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
}: {
  vendorItems: VendorItemWithItem[];
  baseUnit?: string;
  showVendor?: boolean;
  showItem?: boolean;
  /** Own scroll pane with a sticky header — for vendors with hundreds of items. */
  scroll?: boolean;
  /** Where links out of this table should return to. */
  from?: Crumb;
}) {
  const unitFor = (vi: VendorItemWithItem) =>
    vi.inventory_items?.base_unit ?? baseUnit ?? "unit";

  const link = (href: string) => (from ? withFrom(href, from) : href);

  const columns: DataColumn<VendorItemWithItem>[] = [
    ...(showVendor
      ? [
          {
            key: "vendor",
            label: "Vendor",
            width: 150,
            sortValue: (vi: VendorItemWithItem) => vi.vendors?.name ?? null,
            render: (vi: VendorItemWithItem) => (
              <>
                {vi.vendors ? (
                  <Link
                    href={link(`/vendors/${vi.vendors.id}`)}
                    className="text-blue-700 hover:underline"
                  >
                    {vi.vendors.name}
                  </Link>
                ) : (
                  "—"
                )}
                {vi.vendors && !vi.vendors.is_active && (
                  <span className="ml-1 rounded bg-neutral-200 px-1 text-xs text-neutral-600">
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
            width: 170,
            sortValue: (vi: VendorItemWithItem) => vi.inventory_items?.name ?? null,
            render: (vi: VendorItemWithItem) =>
              vi.inventory_items ? (
                <Link
                  href={link(`/items/${vi.inventory_items.id}`)}
                  className="text-blue-700 hover:underline"
                >
                  {vi.inventory_items.name}
                </Link>
              ) : (
                <span className="text-amber-700">unlinked</span>
              ),
          },
        ]
      : []),
    {
      key: "product_id",
      label: "Product ID",
      width: 110,
      sortValue: (vi) => vi.product_id,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="product_id" value={vi.product_id} />
      ),
    },
    {
      key: "brand",
      label: "Brand",
      width: 110,
      sortValue: (vi) => vi.brand,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="brand" value={vi.brand} />
      ),
    },
    {
      key: "description",
      label: "Description",
      width: 260,
      sortValue: (vi) => vi.description,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="description" value={vi.description} />
      ),
    },
    {
      key: "package_desc",
      label: "Pack",
      width: 80,
      sortValue: (vi) => vi.package_desc,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="package_desc" value={vi.package_desc} />
      ),
    },
    {
      key: "package_content",
      label: "Content",
      width: 90,
      align: "right",
      sortValue: (vi) => (vi.package_content === null ? null : Number(vi.package_content)),
      render: (vi) => (
        <InlineValue
          table="vendor_items"
          id={vi.id}
          column="package_content"
          value={vi.package_content}
          kind="number"
          align="right"
        />
      ),
    },
    {
      key: "price",
      label: "Price",
      width: 90,
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
      width: 100,
      align: "right",
      // Sorts on the number, not the formatted string, so $9 < $10.
      sortValue: (vi) => unitPrice(vi),
      render: (vi) => (
        <span className="text-neutral-500">{unitPriceLabel(vi, unitFor(vi))}</span>
      ),
    },
    {
      key: "notes",
      label: "Notes",
      width: 150,
      sortValue: (vi) => vi.notes,
      render: (vi) => (
        <InlineValue table="vendor_items" id={vi.id} column="notes" value={vi.notes} />
      ),
    },
    {
      key: "is_active",
      label: "Active",
      width: 80,
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
  ];

  return (
    <DataTable
      rows={vendorItems}
      columns={columns}
      rowKey={(vi) => vi.id}
      storageKey={`rf.vendorItems.columnWidths.v1${showItem ? ".byVendor" : ".byItem"}`}
      rowClassName={(vi) => (vi.is_active ? "" : "text-neutral-400")}
      scroll={scroll}
      empty={
        <p className="text-sm text-neutral-600">
          No vendor items yet. The cleanup drawer&apos;s vendor-item picker can link
          an existing one to this item.
        </p>
      }
    />
  );
}
