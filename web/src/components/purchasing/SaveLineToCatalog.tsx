"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import {
  InventoryItemChooser,
  type ChosenItem,
} from "@/components/catalog/InventoryItemChooser";
import type { PoLine } from "@/lib/purchaseOrders";

/**
 * TURN A ONE-OFF LINE INTO A VENDOR ITEM (Mark, 2026-08-24: "enable the ability
 * to turn one-off items into vendor items").
 *
 * The other half of one-off lines, and the reason they are safe to encourage:
 * ordering something for the first time no longer forces a decision about
 * whether it belongs in the catalog, because that decision can be taken later,
 * from the order that proved it.
 *
 * IT WRITES THE CATALOG ROW FROM THE LINE'S OWN SNAPSHOT, which is the whole
 * trick — description, brand, product id, pack and price are already on the
 * line, in the columns migration 013 would have snapshotted them INTO. So this
 * runs 013 backwards, and the line then points at a vendor item that agrees
 * with it in every field.
 *
 * TWO STATEMENTS, catalog row first. If the second fails the vendor item is
 * simply there and unlinked — visible on the vendor's screen, one tap from
 * useful — where writing the link first is not expressible at all (there is
 * nothing to link to yet). Both `.select()` their own result: an insert that
 * matches no RLS policy returns rows, but an UPDATE that matches none changes
 * zero and reports success, which would leave the line looking one-off next to
 * a catalog row nobody asked for.
 *
 * THE INVENTORY ITEM IS OPTIONAL, and saying so is deliberate. A vendor item
 * with no inventory item is a real state — 69 of them came out of FileMaker —
 * it just cannot reach the order guide, which is what the dialog says out loud.
 * Requiring one here would mean either refusing the save or offering to create
 * an inventory item mid-flow, and neither is what somebody filing an order
 * wants to be doing.
 *
 * It is offered on ANY line with no vendor item, not only on the ones this
 * order created: a line whose vendor item was deleted is in exactly the same
 * position, and "put this back in the catalog" is the same act.
 */
export function SaveLineToCatalog({
  line,
  orgId,
  vendorId,
  vendorName,
}: {
  line: PoLine;
  orgId: string;
  vendorId: string;
  vendorName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<ChosenItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Same vendor, same SKU or wording — warned about, never blocked
   *  (`findPossibleRehires`' rule: a near-duplicate is usually a judgement). */
  const [similar, setSimilar] = useState<string[]>([]);

  const label = line.description ?? line.brand ?? "this line";

  async function openDialog() {
    setOpen(true);
    setItem(null);
    setError(null);
    setSimilar([]);

    const filters = [
      line.product_id ? `product_id.eq.${line.product_id}` : null,
      line.description ? `description.ilike.${line.description}` : null,
    ].filter(Boolean) as string[];
    if (!filters.length) return;

    const { data } = await supabase
      .from("vendor_items")
      .select("description, product_id, is_active")
      .eq("vendor_id", vendorId)
      .or(filters.join(","))
      .limit(5);
    setSimilar(
      (data ?? []).map(
        (v) =>
          `${v.description ?? "—"}${v.product_id ? ` · ${v.product_id}` : ""}${
            v.is_active ? "" : " (inactive)"
          }`
      )
    );
  }

  async function save() {
    setBusy(true);
    setError(null);

    const { data: created, error: insertError } = await supabase
      .from("vendor_items")
      .insert({
        org_id: orgId,
        vendor_id: vendorId,
        inventory_item_id: item?.id ?? null,
        product_id: line.product_id,
        brand: line.brand,
        description: line.description,
        // The line's pack is 013's COMPOSED label as often as it is a bare
        // type, and the catalog's `package_desc` is the bare type — so the
        // composed ones are left off rather than written somewhere they would
        // then print wrongly. The vendor-item screen's own pack row is where
        // that gets said properly.
        package_desc:
          line.package_desc && !line.package_desc.includes("×")
            ? line.package_desc
            : null,
        price: line.unit_price,
        notes: line.notes,
        is_active: true,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !created) {
      setBusy(false);
      setError(insertError?.message ?? "Could not create the vendor item.");
      return;
    }

    const { data: linked, error: linkError } = await supabase
      .from("purchase_order_items")
      .update({ vendor_item_id: created.id })
      .eq("id", line.id)
      .select("id");

    setBusy(false);
    if (linkError) {
      setError(
        `Saved to ${vendorName}, but this line could not be pointed at it: ${linkError.message}`
      );
      return;
    }
    if (!linked?.length) {
      setError(
        `Saved to ${vendorName}, but this line could not be pointed at it — you need purchaser access.`
      );
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        title={`Save this line to ${vendorName}'s items`}
        className="text-xs text-muted underline decoration-neutral-400 underline-offset-[3px] hover:text-ink hover:decoration-current"
      >
        + add to catalog
      </button>

      {open && (
        <Dialog
          title="Save to the catalog"
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className={DIALOG_COMMIT_CLASS}
              >
                {busy ? "Saving…" : `Save to ${vendorName}`}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Makes <span className="text-ink">{label}</span> one of{" "}
              {vendorName}&rsquo;s items, exactly as this line has it, and points
              this line at it. Nothing on the order changes.
            </p>

            <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1 border border-hairline px-3 py-2 text-sm">
              <Row label="Description" value={line.description} />
              <Row label="Brand" value={line.brand} />
              <Row label="Product ID" value={line.product_id} />
              <Row label="Sold as" value={line.package_desc} />
              <Row
                label="Price"
                value={line.unit_price === null ? null : `$${Number(line.unit_price).toFixed(2)}`}
              />
            </dl>

            {similar.length > 0 && (
              <div className="border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-sm text-ink">
                <p className="font-semibold">
                  {vendorName} already has {similar.length === 1 ? "an item" : "items"} like
                  this:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {similar.map((sTxt, i) => (
                    <li key={i}>{sTxt}</li>
                  ))}
                </ul>
                <p className="mt-1">
                  Saving anyway makes a second one — which is right for a
                  different pack size, and not for the same thing twice.
                </p>
              </div>
            )}

            <div>
              <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
                Inventory item (optional)
              </span>
              <p className="mb-2 mt-1 text-xs text-muted">
                What this IS in the catalog. Without one the vendor item exists
                and can be ordered from here, but never appears on the order
                guide — you can link it later from the vendor&rsquo;s items.
              </p>
              <InventoryItemChooser value={item} onPick={setItem} />
            </div>

            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-subtle">{label}</dt>
      <dd className={value ? "text-ink" : "text-faint"}>{value ?? "none"}</dd>
    </>
  );
}
