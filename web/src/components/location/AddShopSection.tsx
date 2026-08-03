"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";

/**
 * The composed name, offered rather than imposed: FileMaker's own 168 rows
 * disagree about the dash ("02 Walk In R1 S1" at DF01, "02 Storage - R1 S3" at
 * DF02), so the field stays editable and whatever you type wins.
 */
function compose(sort: string, area: string, subArea: string): string {
  const prefix = sort.trim();
  const tail = [area.trim(), subArea.trim()].filter(Boolean).join(" - ");
  return [prefix, tail].filter(Boolean).join(" ");
}

/**
 * Add a shelf to this shop's walk order.
 *
 * A button at the top of the screen opening a dialog (Mark, 2026-08-02),
 * replacing the inline form strip that used to sit under the table. Two things
 * came with the move: the trigger is outlined like every other button in the
 * app — the old strip's black one was a straggler the button sweep had missed —
 * and the commit is `DIALOG_COMMIT_CLASS`, which is black because a panel that
 * exists to produce one outcome genuinely has a primary.
 *
 * **It stays open after each add**, clearing everything but the Area. That's
 * the `AddPoLines` posture and it's the same reason: you don't add one shelf,
 * you seed a shop's whole walk order in a sitting, and the area is what the
 * next few will share. The inline strip did exactly this; a dialog that closed
 * on success would have quietly made the task longer than it was before.
 *
 * `display_name` is unique per location (migration 017) — it is the identity
 * the order guide groups by — so a duplicate is refused by the database and
 * reported here rather than quietly splitting a shelf in two.
 */
export function AddShopSection({
  orgId,
  locationId,
  areas,
}: {
  orgId: string;
  locationId: string;
  areas: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("");
  const [area, setArea] = useState("");
  const [subArea, setSubArea] = useState("");
  const [name, setName] = useState("");
  const [touchedName, setTouchedName] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // Until you edit it yourself, the name follows the other three fields.
  const displayName = touchedName ? name : compose(sort, area, subArea);
  // Empty is NOT zero here. A blank field would insert sort_order 0 and put the
  // new shelf at the head of the walk, which is a position nobody chose.
  const sortValue = sort.trim() === "" ? NaN : Number(sort);
  const ready =
    area.trim() !== "" && displayName.trim() !== "" && Number.isFinite(sortValue);

  function close() {
    if (pending) return;
    setOpen(false);
    // Everything, this time — the next visit is a fresh task.
    setSort("");
    setArea("");
    setSubArea("");
    setName("");
    setTouchedName(false);
    setFailed(null);
    setAdded(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    const label = displayName.trim();
    startTransition(async () => {
      const { error } = await supabase.from("shop_sections").insert({
        org_id: orgId,
        location_id: locationId,
        area: area.trim(),
        sub_area: subArea.trim() || null,
        display_name: label,
        sort_order: sortValue,
      });
      if (error) {
        setFailed(
          error.code === "23505"
            ? `"${label}" already exists at this location.`
            : error.message
        );
        return;
      }
      // Everything but the area, which is usually the same for the next shelf.
      setSort("");
      setSubArea("");
      setName("");
      setTouchedName(false);
      setAdded(label);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New section
      </button>

      {open && (
        <Dialog
          title="New shop section"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Done
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Add section"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            {/* The three parts on one row at their own natural widths — a
                sort order is three characters and an area is a word, so a
                half-panel box for either just looks broken. Roughly the
                proportions the inline strip had. */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Field label="Sort" required>
                <TextInput
                  value={sort}
                  onValueChange={setSort}
                  inputMode="decimal"
                  aria-label="Sort order"
                  autoFocus
                  className="h-9 w-24 text-sm"
                />
              </Field>
              <Field label="Area" required>
                <PickList
                  value={area || null}
                  options={areas.map((a) => ({ value: a, label: a }))}
                  allowNew
                  variant="field"
                  placeholder="choose or type"
                  ariaLabel="Area"
                  onPick={setArea}
                  className="w-56"
                />
              </Field>
              <Field label="Sub area">
                <TextInput
                  value={subArea}
                  onValueChange={setSubArea}
                  aria-label="Sub area"
                  className="h-9 w-44 text-sm"
                />
              </Field>
            </div>

            {/* Full width, because this one IS the row's identity. */}
            <Field label="Display name" required>
              <TextInput
                value={displayName}
                onValueChange={(next) => {
                  setTouchedName(true);
                  setName(next);
                }}
                aria-label="Display name"
                className="h-9 w-full text-sm"
              />
            </Field>

            <p className="text-sm text-muted">
              The display name follows the other three until you edit it.
              It&rsquo;s what the order guide groups by and what the in-person
              shopping list prints, so it has to be unique at this shop.
            </p>

            {added && !failed && (
              <p className="border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
                Added <strong>{added}</strong>. Add another, or Done when
                you&rsquo;ve finished.
              </p>
            )}
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
