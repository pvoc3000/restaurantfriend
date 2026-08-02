"use client";

import { ORDER_TYPE_OPTIONS } from "@/lib/catalog";
import { InlineValue } from "./InlineValue";

export type VendorRecord = {
  id: string;
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
 * No role gate, matching `ItemFields`/`VendorItemFields`: InlineValue tries the
 * write and RLS answers for a role below purchaser+, with the error shown
 * beside the field rather than the control disappearing.
 */
export function VendorFields({
  vendor,
  vendorTypes,
}: {
  vendor: VendorRecord;
  /** Every `vendor_type` already in use across the org — the vocabulary
   *  `allowNew` grows, same as the item category picker. */
  vendorTypes: string[];
}) {
  return (
    <dl className="grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="py-0.5 text-subtle">Type</dt>
      <dd>
        <InlineValue
          table="vendors"
          id={vendor.id}
          column="vendor_type"
          value={vendor.vendor_type}
          placeholder="none"
          kind="pick"
          allowNew
          options={vendorTypes.map((t) => ({ value: t, label: t }))}
        />
      </dd>

      <dt className="py-0.5 text-subtle">Order via</dt>
      <dd>
        {/* A closed set — the DB's own check constraint — so no allowNew. */}
        <InlineValue
          table="vendors"
          id={vendor.id}
          column="order_type"
          value={vendor.order_type}
          kind="pick"
          nullable={false}
          options={ORDER_TYPE_OPTIONS}
        />
      </dd>

      <dt className="py-0.5 text-subtle">Website</dt>
      <dd className="flex items-center gap-2">
        {/* min-w-0 flex-1: InlineValue's own trigger is w-full of ITS parent,
            so this div is what actually shares the row with the open link. */}
        <div className="min-w-0 flex-1">
          <InlineValue
            table="vendors"
            id={vendor.id}
            column="url"
            value={vendor.url}
            placeholder="none"
          />
        </div>
        {vendor.url && (
          <a
            href={vendor.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Open ↗
          </a>
        )}
      </dd>

      <dt className="py-0.5 text-subtle">Description</dt>
      <dd>
        <InlineValue
          table="vendors"
          id={vendor.id}
          column="description"
          value={vendor.description}
          placeholder="none"
        />
      </dd>

      <dt className="py-0.5 text-subtle">Notes</dt>
      <dd>
        {/* Operational constraints — "1pm cutoff" (the column's own comment
            in migration 001). */}
        <InlineValue
          table="vendors"
          id={vendor.id}
          column="notes"
          value={vendor.notes}
          placeholder="none"
        />
      </dd>
    </dl>
  );
}
