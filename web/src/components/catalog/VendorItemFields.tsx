"use client";

import Link from "next/link";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { vendorItemTitle } from "@/lib/catalog";
import { InlineValue } from "./InlineValue";
import { ActiveToggle } from "./ActiveToggle";
import { InventoryItemPicker } from "./InventoryItemPicker";

export type VendorItemRecord = {
  id: string;
  brand: string | null;
  description: string | null;
  product_id: string | null;
  package_desc: string | null;
  package_content: number | null;
  pack_count: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  price: number | null;
  notes: string | null;
  is_active: boolean;
  vendors: { id: string; name: string; is_active: boolean } | null;
  inventory_items: { id: string; name: string; base_unit: string } | null;
};

/**
 * The vendor item master header: what this vendor calls the product, what a
 * package holds, and what it costs. Every field is inline-editable, matching
 * the density of the grids these rows normally live in — the detail view adds
 * the per-location context a grid row can't hold, it doesn't replace the grid.
 *
 * Price edits fire the DB history trigger, so the history section below stays
 * true without any logging in app code (CLAUDE.md rule 6).
 */
export function VendorItemFields({
  vi,
  here,
}: {
  vi: VendorItemRecord;
  here: Crumb;
}) {
  const unit = vi.inventory_items?.base_unit ?? "unit";
  const title = vendorItemTitle(vi, vi.inventory_items?.name, unit);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Read-only: the description now has its own field below, and a title
            you could type into would be a second box writing the same column.
            Without a description this composes brand + item + pack, so the
            record still names itself. */}
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {title ?? <span className="text-faint">Untitled vendor item</span>}
        </h1>
        <span className="flex items-center gap-2 text-sm text-muted">
          <ActiveToggle
            table="vendor_items"
            id={vi.id}
            active={vi.is_active}
            label="Vendor item active"
          />
          {vi.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="py-0.5 text-subtle">Vendor</dt>
        <dd className="py-0.5">
          {vi.vendors ? (
            <Link
              href={withFrom(`/vendors/${vi.vendors.id}`, here)}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {vi.vendors.name}
            </Link>
          ) : (
            <span className="text-faint">none</span>
          )}
          {vi.vendors && !vi.vendors.is_active && (
            <span className="ml-1 border border-neutral-300 bg-neutral-100 px-1 text-xs text-muted">
              vendor inactive
            </span>
          )}
        </dd>

        <dt className="py-0.5 text-subtle">Inventory item</dt>
        <dd className="flex flex-wrap items-start gap-2 py-0.5">
          {vi.inventory_items ? (
            <Link
              href={withFrom(`/items/${vi.inventory_items.id}`, here)}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {vi.inventory_items.name}
            </Link>
          ) : (
            <span className="text-accent">unlinked</span>
          )}
          <InventoryItemPicker
            vendorItemId={vi.id}
            currentItemId={vi.inventory_items?.id ?? null}
          />
        </dd>

        {/* The vendor's own words for the product — what they'd match against
            their product list, so it leads the PO line (§4.9) and the title
            above. Sits with the inventory item because the two together are
            "their name for our thing". */}
        <dt className="py-0.5 text-subtle">Description</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="description"
            value={vi.description}
            placeholder="none"
          />
        </dd>

        <dt className="py-0.5 text-subtle">Brand</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="brand"
            value={vi.brand}
            placeholder="none"
          />
        </dd>

        <dt className="py-0.5 text-subtle">Product ID</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="product_id"
            value={vi.product_id}
            placeholder="none"
          />
        </dd>

        <dt className="py-0.5 text-subtle">Pack</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="package_desc"
            value={vi.package_desc}
            placeholder="none"
          />
        </dd>

        {/* The pack as the case is labelled — count × size unit ("12 × 32 oz").
            Three fields rather than one so a packing slip can be checked
            against it; `Content` below stays the base-unit total the ordering
            math divides by. */}
        <dt className="py-0.5 text-subtle">Pack of</dt>
        <dd className="flex items-center gap-1">
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="pack_count"
            value={vi.pack_count}
            kind="number"
            placeholder="1"
          />
          <span className="text-faint">×</span>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="pack_size"
            value={vi.pack_size}
            kind="number"
            placeholder="size"
          />
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="pack_unit"
            value={vi.pack_unit}
            placeholder={unit}
          />
        </dd>

        <dt className="py-0.5 text-subtle">Price</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="price"
            value={vi.price}
            kind="number"
            placeholder="none"
          />
        </dd>

        <dt className="py-0.5 text-subtle">Notes</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="notes"
            value={vi.notes}
            placeholder="none"
          />
        </dd>
      </dl>

      <p className="text-xs text-subtle">
        One package holds some number of {unit}, and that total is what turns a
        par into packages to order — it&apos;s set in the cleanup queue rather
        than typed here, so the pack above is the one place this record
        describes its packaging. Price is the vendor&apos;s global price; a
        location below may override it.
      </p>
    </div>
  );
}
