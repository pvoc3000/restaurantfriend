"use client";

import Link from "next/link";
import { unitPriceLabel, type CatalogVendorItem } from "@/lib/catalog";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";

// On the vendor screen each row belongs to a different inventory item, so the
// query embeds the item; on the item screen that column is redundant.
export type VendorItemWithItem = CatalogVendorItem & {
  inventory_items?: { id: string; name: string; base_unit: string } | null;
};

/**
 * Inline-editable vendor-item grid, shared by item detail (all vendors for one
 * item) and vendor detail (all items for one vendor).
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
}: {
  vendorItems: VendorItemWithItem[];
  baseUnit?: string;
  showVendor?: boolean;
  showItem?: boolean;
}) {
  if (vendorItems.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No vendor items yet. The cleanup drawer&apos;s vendor-item picker can link
        an existing one to this item.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-neutral-600">
            {showVendor && <th className="px-2 py-1 font-medium">Vendor</th>}
            {showItem && <th className="px-2 py-1 font-medium">Item</th>}
            <th className="px-2 py-1 font-medium">Product ID</th>
            <th className="px-2 py-1 font-medium">Brand</th>
            <th className="px-2 py-1 font-medium">Description</th>
            <th className="px-2 py-1 font-medium">Pack</th>
            <th className="px-2 py-1 font-medium text-right">Content</th>
            <th className="px-2 py-1 font-medium text-right">Price</th>
            <th className="px-2 py-1 font-medium text-right">Unit price</th>
            <th className="px-2 py-1 font-medium">Notes</th>
            <th className="px-2 py-1 font-medium">Active</th>
          </tr>
        </thead>
        <tbody>
          {vendorItems.map((vi) => {
            // Unit price is per the ITEM's base unit, which differs per row on
            // the vendor screen.
            const unit = vi.inventory_items?.base_unit ?? baseUnit ?? "unit";
            return (
              <tr
                key={vi.id}
                className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                  vi.is_active ? "" : "text-neutral-400"
                }`}
              >
                {showVendor && (
                  <td className="px-2 py-1">
                    {vi.vendors ? (
                      <Link
                        href={`/vendors/${vi.vendors.id}`}
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
                  </td>
                )}
                {showItem && (
                  <td className="px-2 py-1">
                    {vi.inventory_items ? (
                      <Link
                        href={`/items/${vi.inventory_items.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {vi.inventory_items.name}
                      </Link>
                    ) : (
                      <span className="text-amber-700">unlinked</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-1 text-neutral-600">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="product_id"
                    value={vi.product_id}
                  />
                </td>
                <td className="px-2 py-1 text-neutral-600">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="brand"
                    value={vi.brand}
                  />
                </td>
                <td className="px-2 py-1">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="description"
                    value={vi.description}
                  />
                </td>
                <td className="px-2 py-1 text-neutral-600">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="package_desc"
                    value={vi.package_desc}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="package_content"
                    value={vi.package_content}
                    kind="number"
                    align="right"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="price"
                    value={vi.price}
                    kind="number"
                    align="right"
                  />
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-neutral-500">
                  {unitPriceLabel(vi, unit)}
                </td>
                <td className="max-w-48 px-2 py-1 text-neutral-600">
                  <InlineValue
                    table="vendor_items"
                    id={vi.id}
                    column="notes"
                    value={vi.notes}
                  />
                </td>
                <td className="px-2 py-1">
                  <ActiveToggle
                    table="vendor_items"
                    id={vi.id}
                    active={vi.is_active}
                    label="Vendor item active"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
