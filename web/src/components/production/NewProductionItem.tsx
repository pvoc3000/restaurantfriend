"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";

/** 038's identity, normalised — see the duplicate warning below. */
function identity(parts: (string | null)[]): string {
  return parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
}

/**
 * Add a production item — `NewElement`'s template.
 *
 * It asks for the NAME and the taxonomy, and stops. The dough, the components,
 * the tally box and the per-shop pars are all set on the item's own record,
 * where `InlineValue` already edits every one of them; a create form that also
 * chose them would be a second editor to keep in step with the first.
 *
 * THE DUPLICATE CHECK WARNS AND NEVER BLOCKS. 038 dropped `unique (org, name)`
 * because "Angry Samoa" is four different donuts, and it declined to replace it
 * with a composite index on (name, size, type, subtype) for a stated reason:
 * those are four separate `InlineValue` cells, so changing a Regular to a Mini
 * when that Mini exists would fail on the first edit with no order that works.
 * The check is `findPossibleRehires`' treatment instead — say so, let them
 * through.
 */
export function NewProductionItem({
  orgId,
  types,
  subtypes,
  finishes,
  sizes,
  priceClasses,
  priceTiers,
  existing,
}: {
  orgId: string;
  types: string[];
  subtypes: string[];
  finishes: string[];
  sizes: string[];
  priceClasses: string[];
  priceTiers: string[];
  /** Every item's `identity()`, so a repeat can be named before it is made. */
  existing: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [itemType, setItemType] = useState("");
  const [subtype, setSubtype] = useState("");
  const [finish, setFinish] = useState("");
  const [size, setSize] = useState("");
  const [priceClass, setPriceClass] = useState("");
  const [priceTier, setPriceTier] = useState("");

  const ready = name.trim() !== "";
  const duplicate =
    ready && existing.includes(identity([name, size, itemType, subtype]));

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setItemType("");
    setSubtype("");
    setFinish("");
    setSize("");
    setPriceClass("");
    setPriceTier("");
    setFailed(null);
  }

  function blank(v: string): string | null {
    return v.trim() === "" ? null : v.trim();
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("production_items")
        .insert({
          // EXPLICITLY (design rule 1): a WITH CHECK is evaluated before the
          // NOT NULL, so an omitted org_id reports as an RLS violation and
          // sends you looking at roles.
          org_id: orgId,
          name: name.trim(),
          item_type: blank(itemType),
          subtype: blank(subtype),
          finish: blank(finish),
          size: blank(size),
          price_class: blank(priceClass),
          price_tier: blank(priceTier),
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The item could not be created.");
        return;
      }

      router.refresh();
      router.push(`/production-items/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New item
      </button>

      {open && (
        <Dialog
          title="New item"
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
                placeholder="Angry Samoa"
                aria-label="Item name"
                autoFocus
              />
              {duplicate ? (
                <p className="text-sm">
                  <span className="bg-mark-fill px-1">
                    There is already an item with this name, size, type and cut.
                  </span>
                </p>
              ) : null}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <Vocab value={itemType} onPick={setItemType} options={types} hint="Raised, Cake…" />
              </Field>
              <Field label="Size">
                <Vocab value={size} onPick={setSize} options={sizes} hint="Regular, Mini…" />
              </Field>
              <Field label="Cut">
                <Vocab
                  value={subtype}
                  onPick={setSubtype}
                  options={subtypes}
                  hint="Promise Ring…"
                />
              </Field>
              <Field label="Finish">
                <Vocab value={finish} onPick={setFinish} options={finishes} hint="Plain…" />
              </Field>
              <Field label="Price class">
                <Vocab
                  value={priceClass}
                  onPick={setPriceClass}
                  options={priceClasses}
                  hint="Regular…"
                />
              </Field>
              <Field label="Price tier">
                <Vocab
                  value={priceTier}
                  onPick={setPriceTier}
                  options={priceTiers}
                  hint="Tier 1…"
                />
              </Field>
            </div>

            {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** One of the six free-text vocabularies — `allowNew`, because a kitchen
 *  invents a cut faster than a migration can be written (037's own words). */
function Vocab({
  value,
  onPick,
  options,
  hint,
}: {
  value: string;
  onPick: (next: string) => void;
  options: string[];
  hint: string;
}) {
  return (
    <PickList
      variant="field"
      value={value}
      onPick={onPick}
      options={options.map((o) => ({ value: o, label: o }))}
      allowNew
      clearable
      ariaLabel={hint}
      placeholder={hint}
    />
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
