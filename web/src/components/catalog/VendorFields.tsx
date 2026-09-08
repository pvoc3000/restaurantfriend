"use client";

import { ORDER_TYPE_OPTIONS } from "@/lib/catalog";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { InlineValue } from "./InlineValue";

export type VendorRecord = {
  id: string;
  name: string;
  vendor_type: string | null;
  description: string | null;
  order_type: string;
  url: string | null;
  notes: string | null;
};

/**
 * The vendor master fields — type, order via, website, description, notes
 * (Mark, 2026-08-01: these "are not reachable/visible on the vendor detail
 * page and should be"). `description` and `notes` weren't even QUERIED before
 * this; `vendor_type`, `order_type` and `url` were plain text with no way to
 * change them here. Every other detail screen (item, vendor item, location)
 * has had an inline-editable field block since it shipped — vendor detail was
 * the one record you couldn't touch without leaving the page.
 *
 * `editable` is the Page Permissions sheet's cell (2026-09-04). Before that,
 * no role gate, matching `ItemFields`/`VendorItemFields`: InlineValue tried the
 * write and RLS answers for a role below purchaser+, with the error shown
 * beside the field rather than the control disappearing.
 */
/**
 * The vendor's NAME, as the record's `h1` (Mark, 2026-09-08: "I need to be able
 * to edit the name of a vendor" — he was setting up a service vendor for trash
 * collection). It had been plain text since the screen shipped: `NewVendor`
 * asks for a name and nothing here could correct a typo in it, so the only way
 * back was to delete the vendor and file it again.
 *
 * `ItemTitle`'s shape, copied rather than re-derived, including the one thing
 * that looks like an oversight and is not: THE TITLE KEEPS THE UNDERLINE where
 * every other editable field on a record wears a box (Mark, 2026-08-28, having
 * tried it boxed). A box is what tells a field from a label, and an `h1` is
 * neither.
 */
export function VendorTitle({
  vendor,
  editable,
}: {
  vendor: { id: string; name: string };
  editable: boolean;
}) {
  return (
    <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
      <InlineValue
        readOnly={!editable}
        table="vendors"
        id={vendor.id}
        column="name"
        value={vendor.name}
        // Named, or a screen reader announces the raw column ("name") — the
        // record's own heading is the one cell with no `<dt>` beside it.
        ariaLabel="Vendor name"
        placeholder="Untitled vendor"
        className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
      />
    </h1>
  );
}

export function VendorFields({
  vendor,
  vendorTypes,
  editable,
}: {
  /** The Page Permissions sheet's cell for /vendors — staff and supervisors
   *  READ this block. */
  editable: boolean;
  vendor: VendorRecord;
  /** Every `vendor_type` already in use across the org — the vocabulary
   *  `allowNew` grows, same as the item category picker. */
  vendorTypes: string[];
}) {
  return (
    <dl className="grid max-w-2xl grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
      <dt className="text-subtle">Type</dt>
      <dd>
        <InlineValue
          readOnly={!editable}
          boxed={BOXED_FIELDS}
          table="vendors"
          id={vendor.id}
          column="vendor_type"
          value={vendor.vendor_type}
          kind="pick"
          allowNew
          options={vendorTypes.map((t) => ({ value: t, label: t }))}
        />
      </dd>

      <dt className="text-subtle">Order via</dt>
      <dd>
        {/* A closed set — the DB's own check constraint — so no allowNew. */}
        <InlineValue
          readOnly={!editable}
          boxed={BOXED_FIELDS}
          table="vendors"
          id={vendor.id}
          column="order_type"
          value={vendor.order_type}
          kind="pick"
          nullable={false}
          options={ORDER_TYPE_OPTIONS}
        />
      </dd>

      {/* THE OPEN LINK RIDES WITH THE LABEL, not beside the field. Anything
          hung to a field's right breaks the column's right edge, which is
          half of what the boxes are for; the label side has room to spare. */}
      <dt className="text-subtle">
        Website
        {vendor.url && (
          <>
            {" "}
            <a
              href={vendor.url}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              Open ↗
            </a>
          </>
        )}
      </dt>
      <dd>
        <InlineValue
          readOnly={!editable}
          boxed={BOXED_FIELDS}
          table="vendors"
          id={vendor.id}
          column="url"
          value={vendor.url}
        />
      </dd>

      <dt className="text-subtle">Description</dt>
      <dd>
        <InlineValue
          readOnly={!editable}
          boxed={BOXED_FIELDS}
          table="vendors"
          id={vendor.id}
          column="description"
          value={vendor.description}
        />
      </dd>

      <dt className="text-subtle">Notes</dt>
      <dd>
        {/* Operational constraints — "1pm cutoff" (the column's own comment
            in migration 001). */}
        <InlineValue
          readOnly={!editable}
          boxed={BOXED_FIELDS}
          table="vendors"
          id={vendor.id}
          column="notes"
          value={vendor.notes}
        />
      </dd>
    </dl>
  );
}
