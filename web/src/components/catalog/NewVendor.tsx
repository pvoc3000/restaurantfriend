"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ORDER_TYPE_OPTIONS } from "@/lib/catalog";

/** 001's own check constraint, and the reason Order via is asked for here. */
type OrderType = "email_po" | "online" | "in_person" | "none";

/**
 * Add a vendor — `NewElement`'s template, and the first thing in this app that
 * has ever inserted a `vendors` row. 001 gave the table a generic purchaser+
 * write policy; what was missing was a door.
 *
 * NAME, TYPE and ORDER VIA, and it stops. Order via is asked for because it
 * decides what the PO screen OFFERS — email a PDF, open a website, print a
 * shopping list, or nothing at all for a landlord — so a vendor created without
 * it would default to `email_po` and produce a Process card that cannot work.
 * The account number, minimum, order and delivery days are per LOCATION and are
 * set on the record's own config table, which is where they are edited.
 *
 * The duplicate check WARNS and never blocks (`findPossibleRehires`' rule):
 * there is no unique index on the name, and two entries for one supplier is a
 * real thing a shop does — a food account and a paper account with the same
 * distributor.
 */
export function NewVendor({
  orgId,
  types,
  existingNames,
}: {
  orgId: string;
  /** The `vendor_type` vocabulary already in use. */
  types: string[];
  existingNames: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [vendorType, setVendorType] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("email_po");

  const ready = name.trim() !== "";
  const duplicate =
    ready && existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setVendorType("");
    setOrderType("email_po");
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("vendors")
        .insert({
          // EXPLICITLY — design rule 1.
          org_id: orgId,
          name: name.trim(),
          vendor_type: vendorType.trim() === "" ? null : vendorType.trim(),
          order_type: orderType,
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The vendor could not be created.");
        return;
      }

      router.refresh();
      router.push(`/vendors/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New vendor
      </button>

      {open && (
        <Dialog
          title="New vendor"
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
                {pending ? "Adding…" : "Add vendor"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Name">
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Chefs Warehouse"
                aria-label="Vendor name"
                autoFocus
              />
              {duplicate ? (
                <p className="text-sm">
                  <span className="bg-mark-fill px-1">
                    There is already a vendor with this name.
                  </span>
                </p>
              ) : null}
            </Field>

            <Field label="Type">
              <PickList
                variant="field"
                value={vendorType}
                onPick={setVendorType}
                options={types.map((t) => ({ value: t, label: t }))}
                allowNew
                clearable
                ariaLabel="Vendor type"
                placeholder="Goods, Services…"
              />
            </Field>

            <Field label="Order via">
              <PickList
                variant="field"
                value={orderType}
                onPick={(v) => setOrderType(v as OrderType)}
                options={ORDER_TYPE_OPTIONS}
                ariaLabel="How orders are placed"
              />
            </Field>

            <p className="text-[13px] text-muted">
              The account number, minimum, order days and delivery days are per
              shop and are set on the vendor&rsquo;s own record.
            </p>

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
