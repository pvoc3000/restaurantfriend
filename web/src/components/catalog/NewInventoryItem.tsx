"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { UNIT_PICK_OPTIONS } from "@/lib/units";

/**
 * Add an inventory item — `NewVendor`'s sibling, and the first thing in this app
 * that has ever inserted an `inventory_items` row.
 *
 * NAME, CATEGORY and BASE UNIT, and it stops. The base unit is asked for
 * because design rule 5 rests on it: pars and on-hand counts are in it, and
 * `package_content` converts a vendor's pack into it — so an item created in
 * the wrong unit produces a suggested order quantity that is wrong by whatever
 * the conversion factor is. It is changed afterwards through
 * `catalog/BaseUnitEditor`, which recomputes package contents and warns about
 * pars; there is no such apparatus at create time and none is needed, because
 * nothing is linked to it yet.
 *
 * Where it is STOCKED, its par and its vendor items are all per shop and per
 * vendor, and are set on the record.
 */
export function NewInventoryItem({
  orgId,
  categories,
  existingNames,
}: {
  orgId: string;
  /** The `category` vocabulary already in use. */
  categories: string[];
  existingNames: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [baseUnit, setBaseUnit] = useState("each");

  const ready = name.trim() !== "" && baseUnit.trim() !== "";
  const duplicate =
    ready && existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setCategory("");
    setBaseUnit("each");
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .insert({
          // EXPLICITLY — design rule 1.
          org_id: orgId,
          name: name.trim(),
          category: category.trim() === "" ? null : category.trim(),
          base_unit: baseUnit.trim(),
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The item could not be created.");
        return;
      }

      router.refresh();
      router.push(`/items/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New inventory item
      </button>

      {open && (
        <Dialog
          title="New inventory item"
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
            <Field label="Name">
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Flour, All Purpose"
                aria-label="Item name"
                autoFocus
              />
              {duplicate ? (
                <p className="text-sm">
                  <span className="bg-mark-fill px-1">
                    There is already an item with this name.
                  </span>
                </p>
              ) : null}
            </Field>

            <Field label="Category">
              <PickList
                variant="field"
                value={category}
                onPick={setCategory}
                options={categories.map((c) => ({ value: c, label: c }))}
                allowNew
                clearable
                ariaLabel="Category"
                placeholder="Dry Goods, Paper Supplies…"
              />
            </Field>

            <Field label="Counted in">
              <PickList
                variant="field"
                value={baseUnit}
                onPick={setBaseUnit}
                options={UNIT_PICK_OPTIONS}
                allowNew
                ariaLabel="Base unit"
              />
            </Field>

            <p className="text-[13px] text-muted">
              Pars and on-hand counts are in this unit, and a vendor&rsquo;s pack
              converts into it. Which shops stock it, and from whom, are set on
              the record.
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
