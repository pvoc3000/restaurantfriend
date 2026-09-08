"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PACKAGE_DESC_OPTIONS, UNIT_PICK_OPTIONS } from "@/lib/units";
import { derivedPackContent, qty } from "@/lib/catalog";
import { withFrom, type Crumb } from "@/lib/breadcrumbs";
import { InventoryItemChooser, type ChosenItem } from "./InventoryItemChooser";

/**
 * Add a vendor item — and until 2026-09-07 there was no way to (Mark: "we seem
 * to have lost a way to add a vendor item").
 *
 * The only `insert` into `vendor_items` anywhere in `web/src` was the ⋯ menu's
 * DUPLICATE, so a vendor's first item could not be created at all: with nothing
 * to duplicate the command has nothing to copy. Every other row in the catalog
 * came out of the FileMaker load, which is why this went unnoticed for months —
 * design rule 1's lesson in a second costume ("a create that a loader also
 * performs is a create nobody has tested"), except here the loader was the only
 * one there had ever been.
 *
 * WHAT IT ASKS FOR IS ONE LINE OF A VENDOR'S PRICE LIST, which is what you have
 * in your hand: their SKU, their brand, their wording, the pack and the price.
 * The convention is to ask for the fields the rest of the app reads and stop;
 * here that reduces to the same thing.
 *
 * IT HAS TWO DOORS AND ONE IMPLEMENTATION (Mark, 2026-09-08: "add a new vendor
 * item from the vendor item tab of the inventory detail screen"). A vendor item
 * is the join of a vendor and an inventory item, so it can be created from
 * either end — from the VENDOR, where you hold their price list and choose the
 * item, or from the ITEM, where you are adding a second source and choose the
 * vendor. Pass `vendor` or `item`, never both: whichever end you fix, the
 * dialog asks for the other and everything after it is identical. Two
 * components would be the `ui/Dialog` story again — the pack derivation, the
 * `org_id`, the landing and the duplicate warning are all things that get
 * remembered in one copy and forgotten in the other.
 *
 * THE OTHER END IS THE ONLY REQUIRED FIELD. An unlinked vendor item is a real
 * state — 71 came out of FileMaker that way — but it is on NO order guide until
 * it is linked, so deliberately creating one is creating a row that does
 * nothing. Everything else is editable in the grid you came from and on the
 * record you land on.
 *
 * THE PACK IS ASKED FOR RATHER THAN THE CONTENT, which is the one field choice
 * with an argument behind it: `package_content` is what the guide divides by
 * (design rule 5), and it is DERIVED here exactly as the record derives it —
 * "1 x 50 lbs" on an item counted in lbs writes 50. Where the pack cannot reach
 * the base unit (a `box` on an `ea` item, `lbs` on one counted in `gal`) the
 * derivation refuses rather than guessing, and the content is left for the
 * record's own cell — which is where its Recalc button lives too.
 */
export function NewVendorItem({
  orgId,
  vendor = null,
  item: fixedItem = null,
  vendors = [],
  existingProductIds = [],
  existingVendorIds = [],
  from,
}: {
  orgId: string;
  /**
   * The vendor's own screen: this vendor is fixed and the dialog asks which
   * inventory item. Exactly one of `vendor` / `item` is given.
   */
  vendor?: { id: string; name: string } | null;
  /**
   * The item's own screen: this item is fixed and the dialog asks which vendor.
   * Its `base_unit` is what the pack is derived against, so it is required
   * here where `ChosenItem` leaves it optional.
   */
  item?: { id: string; name: string; base_unit: string } | null;
  /** With `item`: every vendor, inactive ones marked — see the render. */
  vendors?: { id: string; name: string; inactive?: boolean }[];
  /** With `vendor`: this vendor's SKUs, for the duplicate warning. */
  existingProductIds?: string[];
  /** With `item`: the vendors already sourcing it, for the duplicate warning. */
  existingVendorIds?: string[];
  /** Where the new record's breadcrumb should come back to. */
  from?: Crumb;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [chosenItem, setChosenItem] = useState<ChosenItem | null>(null);
  const [chosenVendor, setChosenVendor] = useState("");
  const [productId, setProductId] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [soldAs, setSoldAs] = useState("");
  const [price, setPrice] = useState("");
  const [packCount, setPackCount] = useState("1");
  const [packSize, setPackSize] = useState("");
  const [packUnit, setPackUnit] = useState("");

  // Whichever end the caller fixed stands in for the chosen one from the start.
  const item = fixedItem ?? chosenItem;
  const vendorId = vendor?.id ?? chosenVendor;

  const baseUnit = item?.base_unit ?? "";
  // The pack's unit follows the item's until somebody says otherwise: a case of
  // flour is nearly always sized in the unit the flour is counted in.
  const unitInForce = packUnit || baseUnit;
  const content = derivedPackContent(
    { pack_count: packCount, pack_size: packSize, pack_unit: unitInForce },
    baseUnit || "unit"
  );

  const ready = item !== null && vendorId !== "";

  // Both warnings COST NO QUERY and neither blocks — `findPossibleRehires`'
  // rule. A second pack size from the same vendor is an ordinary thing to
  // record, so "they already supply this" is a question, not a refusal.
  const duplicateSku =
    vendor !== null &&
    productId.trim() !== "" &&
    existingProductIds.some(
      (p) => p.trim().toLowerCase() === productId.trim().toLowerCase()
    );
  const duplicateVendor =
    fixedItem !== null && vendorId !== "" && existingVendorIds.includes(vendorId);

  function close() {
    if (pending) return;
    setOpen(false);
    setChosenItem(null);
    setChosenVendor("");
    setProductId("");
    setBrand("");
    setDescription("");
    setSoldAs("");
    setPrice("");
    setPackCount("1");
    setPackSize("");
    setPackUnit("");
    setFailed(null);
  }

  /** "" for a field nobody filled in, never an empty string in the column. */
  const text = (v: string) => (v.trim() === "" ? null : v.trim());
  const num = (v: string) => {
    const n = Number(v.trim());
    return v.trim() === "" || Number.isNaN(n) ? null : n;
  };

  function add() {
    if (!ready || !item) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("vendor_items")
        .insert({
          // EXPLICITLY — design rule 1. No table in this schema defaults it,
          // and an omitted one arrives as null, fails the insert policy's
          // WITH CHECK and is reported as an RLS refusal rather than as the
          // missing column it is.
          org_id: orgId,
          vendor_id: vendorId,
          inventory_item_id: item.id,
          product_id: text(productId),
          brand: text(brand),
          description: text(description),
          package_desc: text(soldAs),
          price: num(price),
          pack_count: num(packCount),
          pack_size: num(packSize),
          pack_unit: text(unitInForce),
          package_content: content,
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The vendor item could not be created.");
        return;
      }

      router.refresh();
      // Land on the record — the app's create convention, and here it is also
      // the screen holding what this dialog deliberately left out: the
      // per-location prices and favorite days, and the price history.
      const href = `/vendor-items/${data.id as string}`;
      router.push(from ? withFrom(href, from) : href);
    });
  }

  // Neither end fixed is a caller bug, not a state to render a dialog for.
  if (!vendor && !fixedItem) return null;

  const vendorName =
    vendor?.name ?? vendors.find((v) => v.id === vendorId)?.name ?? "This vendor";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New vendor item
      </button>

      {open && (
        <Dialog
          title={
            vendor ? `New item from ${vendor.name}` : `New vendor item for ${fixedItem!.name}`
          }
          onClose={close}
          busy={pending}
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Add item"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            {vendor ? (
              <Field label="Inventory item">
                <InventoryItemChooser value={chosenItem} onPick={setChosenItem} autoFocus />
                {item ? null : (
                  <p className="text-[13px] text-muted">
                    It is on no order guide until this is set.
                  </p>
                )}
              </Field>
            ) : (
              <Field label="Vendor">
                {/* Every vendor, inactive ones marked and sunk, with
                    `activateTable` so choosing one offers to revive it first —
                    `NewInvoice`'s pairing. Filtering them out instead would
                    leave a shop that has just been reopened unreachable from
                    the one screen where you would look for it, and would also
                    let a new item land under a vendor whose items this tab
                    hides. */}
                <PickList
                  variant="field"
                  value={chosenVendor}
                  onPick={setChosenVendor}
                  options={vendors.map((v) => ({
                    value: v.id,
                    label: v.name,
                    inactive: v.inactive,
                  }))}
                  activateTable="vendors"
                  ariaLabel="Vendor"
                  placeholder="Who sells it?"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Product ID">
                <TextInput
                  value={productId}
                  onValueChange={setProductId}
                  placeholder="08843"
                  aria-label="Product ID"
                  fullWidth
                />
              </Field>
              <Field label="Brand">
                <TextInput
                  value={brand}
                  onValueChange={setBrand}
                  placeholder="Bakemark"
                  aria-label="Brand"
                  fullWidth
                />
              </Field>
            </div>

            <Field label="Description">
              <TextInput
                value={description}
                onValueChange={setDescription}
                placeholder="All Purpose Flour"
                aria-label="Vendor's description"
                fullWidth
              />
            </Field>

            <Field label="Package">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16">
                  <TextInput
                    value={packCount}
                    onValueChange={setPackCount}
                    aria-label="Packages per case"
                    fullWidth
                  />
                </span>
                <span className="text-muted">×</span>
                <span className="w-20">
                  <TextInput
                    value={packSize}
                    onValueChange={setPackSize}
                    placeholder="50"
                    aria-label="Package size"
                    fullWidth
                  />
                </span>
                <span className="w-28">
                  <PickList
                    variant="field"
                    value={unitInForce}
                    onPick={setPackUnit}
                    options={UNIT_PICK_OPTIONS}
                    allowNew
                    ariaLabel="Package unit"
                    placeholder={baseUnit || "unit"}
                  />
                </span>
                {content !== null ? (
                  <span className="text-[13px] text-subtle">
                    = {qty(content)} {baseUnit}
                  </span>
                ) : null}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Sold as">
                <PickList
                  variant="field"
                  value={soldAs}
                  onPick={setSoldAs}
                  options={PACKAGE_DESC_OPTIONS}
                  clearable
                  ariaLabel="Sold as"
                  placeholder="CS, BAG…"
                />
              </Field>
              <Field label="Price">
                <TextInput
                  value={price}
                  onValueChange={setPrice}
                  placeholder="22.50"
                  aria-label="Price"
                  fullWidth
                />
              </Field>
            </div>

            {duplicateSku ? (
              <p className="text-sm">
                <span className="bg-mark-fill px-1">
                  {vendorName} already has an item with this product ID.
                </span>
              </p>
            ) : null}

            {duplicateVendor ? (
              <p className="text-sm">
                <span className="bg-mark-fill px-1">
                  {vendorName} already supplies {fixedItem!.name}. Add this one for a
                  second pack size; otherwise edit the item they already have.
                </span>
              </p>
            ) : null}

            {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
