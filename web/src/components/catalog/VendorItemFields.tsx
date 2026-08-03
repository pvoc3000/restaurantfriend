"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { derivedPackContent, vendorItemTitle } from "@/lib/catalog";
import { PACKAGE_DESC_OPTIONS, UNIT_PICK_OPTIONS } from "@/lib/units";
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
 * Restate the content from the pack, without having to nudge a pack field and
 * put it back (Mark, 2026-07-29 — which is what he'd been doing, because the
 * recompute only fires on a pack EDIT).
 *
 * Only rendered when the pack derives a content that differs from what's
 * stored, so its presence is the finding: no button means the two already
 * agree, or the pack can't reach the base unit and only a human can say. It
 * names the number it will write, so it isn't a blind action.
 */
function RecalcContent({
  vendorItemId,
  stored,
  derived,
  unit,
}: {
  vendorItemId: string;
  stored: number | null;
  derived: number | null;
  unit: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (derived === null) return null;
  if (stored !== null && Math.abs(Number(stored) - derived) <= Math.max(0.001, derived * 0.001))
    return null;

  async function save() {
    setBusy(true);
    setError(null);
    const { error: writeError } = await supabase
      .from("vendor_items")
      .update({ package_content: derived })
      .eq("id", vendorItemId);
    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="ml-2 flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={save}
        title={`The pack works out to ${Number(derived.toFixed(3))} ${unit}${
          stored === null ? "" : `, not ${Number(stored)}`
        }`}
        className="border border-ink px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-35"
      >
        {busy ? "…" : `Recalc → ${Number(derived.toFixed(3))}`}
      </button>
      {error && <span className="text-xs text-accent">{error}</span>}
    </span>
  );
}

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

  /**
   * The base-unit total implied by the pack, with one field about to change.
   *
   * Returns null — leaving `package_content` alone — when the new pack can't
   * reach the base unit, because then there is nothing to compute and the
   * stored total may well be a deliberate hand-entered one. That case is
   * visible rather than silent: the total sits in parentheses right beside the
   * fields being edited, so a number that fails to move is on screen at the
   * moment it stops being true.
   */
  function recomputeContent(
    patch: Partial<Record<"pack_count" | "pack_size" | "pack_unit", string | number | null>>
  ) {
    // pack_unit comes off a text cell, so it arrives as a string — but the cell
    // can't stop someone typing a number into it, hence the String().
    const content = derivedPackContent(
      {
        pack_count: patch.pack_count !== undefined ? patch.pack_count : vi.pack_count,
        pack_size: patch.pack_size !== undefined ? patch.pack_size : vi.pack_size,
        pack_unit:
          patch.pack_unit !== undefined
            ? patch.pack_unit === null
              ? null
              : String(patch.pack_unit)
            : vi.pack_unit,
      },
      unit
    );
    return content === null ? null : { package_content: content };
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Composed and read-only: item // brand // pack, the house label
            format (see vendorItemTitle). The vendor's own description has its
            own field below — a title you could type into would be a second box
            writing that same column. */}
        {/* w-full so the toggle always sits on its own row. A composed title
            runs 39 chars at the median against a description's handful, so
            left inline the toggle would sit beside short titles and wrap under
            long ones — placement that moves record to record. */}
        <h1 className="w-full text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
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

        {/* "Pack" and "Pack of" were the same word for two different things and
            read as a pair when they aren't one (Mark, 2026-07-30). This is what
            the vendor SELLS you — one case, one bag — and prints as the PO's
            Pack column; the fields below are what's inside one of them. */}
        <dt className="py-0.5 text-subtle">Sold as</dt>
        <dd>
          <InlineValue
            table="vendor_items"
            id={vi.id}
            column="package_desc"
            value={vi.package_desc}
            placeholder="none"
            kind="pick"
            options={PACKAGE_DESC_OPTIONS}
          />
        </dd>

        {/* The pack as the case is labelled — count × size unit ("12 × 32 oz").
            Three fields rather than one so a packing slip can be checked
            against it, then the base-unit total in parentheses (Mark,
            2026-07-29): it's what the ordering math divides by, so it belongs
            beside the thing it's computed from where a stale one is visible.

            Editing any of the three RECOMPUTES the total — a one-column write
            is what let a 12 × 16 oz case keep a content of 192 after the item
            started being counted in bottles. It stays editable because the
            conversion can't always be done: a case of 16 oz bottles counted in
            `ea` holds 12, and no amount of unit maths gets there from ounces. */}
        {/* "Package", not "Contains" (Mark, 2026-08-03). The row IS the pack —
            count × size unit — and the base-unit total in parentheses is the
            only part of it that answers "contains". */}
        <dt className="py-0.5 text-subtle">Package</dt>
        {/* Each cell is width-boxed. InlineValue's resting state is a `w-full`
            button, so left to themselves in a flex row they all demand 100%
            and either squash to ragged widths or wrap one-per-line. */}
        <dd className="flex items-center gap-0.5">
          <span className="w-10 shrink-0">
            <InlineValue
              table="vendor_items"
              id={vi.id}
              column="pack_count"
              value={vi.pack_count}
              kind="number"
              placeholder="1"
              alsoUpdate={(next) => recomputeContent({ pack_count: next })}
            />
          </span>
          <span className="shrink-0 text-faint">×</span>
          <span className="w-14 shrink-0">
            <InlineValue
              table="vendor_items"
              id={vi.id}
              column="pack_size"
              value={vi.pack_size}
              kind="number"
              placeholder="size"
              alsoUpdate={(next) => recomputeContent({ pack_size: next })}
            />
          </span>
          <span className="w-14 shrink-0">
            <InlineValue
              table="vendor_items"
              id={vi.id}
              column="pack_unit"
              value={vi.pack_unit}
              placeholder={unit}
              kind="pick"
              options={UNIT_PICK_OPTIONS}
              alsoUpdate={(next) => recomputeContent({ pack_unit: next })}
            />
          </span>
          <span className="ml-2 flex shrink-0 items-center text-subtle">
            <span>(</span>
            <span className="w-16">
              <InlineValue
                table="vendor_items"
                id={vi.id}
                column="package_content"
                value={vi.package_content}
                kind="number"
                placeholder="none"
              />
            </span>
            <span>{unit})</span>
          </span>
          <RecalcContent
            vendorItemId={vi.id}
            stored={vi.package_content}
            derived={derivedPackContent(vi, unit)}
            unit={unit}
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
        {/* Explicit {" "}: the space after the interpolation was being eaten,
            and the hint has been reading "how many lbsone package holds". */}
        The number in parentheses is how many {unit}{" "}one package holds — the
        total that turns a par into packages to order. Editing the pack
        recomputes it whenever the units allow; where they don&apos;t, set it
        yourself. Price is the vendor&apos;s global price; a location below may
        override it.
      </p>
    </div>
  );
}
