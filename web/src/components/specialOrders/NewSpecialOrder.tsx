"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { KIND_LABEL, type SpecialOrderKind } from "@/lib/specialOrders";
import { createSpecialOrder } from "@/lib/createSpecialOrder";

/**
 * Start an order — `NewEmployee`'s template, which CLAUDE.md names as the one
 * every create in this app follows: a command right-aligned in the list's
 * filter row, a `ui/Dialog`, an insert, and you land on the new record.
 *
 * IT ASKS FOR ALMOST NOTHING, and that is the design rather than an unfinished
 * form. An order acquires a customer, a date, lines, money and a kitchen as
 * the conversation happens; the record screen edits every one of those in
 * place. What this needs is enough to exist and be findable — which for a
 * LEAD is the title somebody will search for.
 *
 * The three paths that are NOT this button, so nobody adds them here:
 *   · the public inquiry form (decision 18) creates a lead with no login;
 *   · pasting an inquiry email (decision 10) creates one from a parse;
 *   · Duplicate on an existing order (decision 13) covers templates, standing
 *     orders and "same as last year".
 */
export function NewSpecialOrder({
  orgId,
  kitchens,
  defaultLocationId,
}: {
  /** Passed down rather than looked up. The old code read `org_members`
   *  UNFILTERED and took `.maybeSingle()`, which is correct for exactly one
   *  member and an error for two — the select policy shows you every member of
   *  your org. It broke the moment this org had colleagues. */
  orgId: string;
  /** Active shops — design rule 3: you cannot plan work at a closed one. */
  kitchens: { id: string; code: string }[];
  /** The shop you are standing in, as the pickup default. */
  defaultLocationId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [kind, setKind] = useState<SpecialOrderKind>("order");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [kitchenId, setKitchenId] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // A title is the only thing asked for, because it is the only thing that
  // makes the row findable before anything else is known.
  const ready = title.trim() !== "";

  function reset() {
    setKind("order");
    setTitle("");
    setEventDate(null);
    setKitchenId("");
    setLocationId(defaultLocationId ?? "");
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      // One creator, shared with "New order for them" on the customer record —
      // which is where the pickup shop and the tax snapshot were being missed.
      const result = await createSpecialOrder(supabase, {
        orgId,
        kind,
        title,
        eventDate,
        locationId,
        kitchenLocationId: kitchenId,
        contactName,
        contactPhone,
        contactEmail,
      });
      if ("error" in result) {
        setFailed(result.error);
        return;
      }
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New special order
      </button>

      {open && (
        <Dialog
          title="New special order"
          onClose={close}
          busy={pending}
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Creating…" : "Create"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="What is it" required>
              <TextInput
                value={title}
                onValueChange={setTitle}
                placeholder="Ruiz wedding, 8/30"
                aria-label="What the order is for"
                autoFocus
                className="w-full"
              />
            </Field>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Kind">
                <PickList
                  value={kind}
                  onPick={(next) => setKind((next || "order") as SpecialOrderKind)}
                  variant="field"
                  ariaLabel="Kind of record"
                  options={(["order", "template", "standing_order"] as SpecialOrderKind[]).map((k) => ({
                    value: k,
                    label: KIND_LABEL[k],
                    hint:
                      k === "order"
                        ? "a real order, starting as a lead"
                        : k === "template"
                          ? "a shape to duplicate from"
                          : "recurring wholesale, materialized by weekday",
                  }))}
                  className="w-full"
                />
              </Field>
              <Field label="Event date">
                {/* A lead routinely has no date yet — that is often the first
                    question. `ui/DateField`, never a bare date input: it
                    carries the Safari empty-date apparatus, and this box
                    starts EMPTY, which is exactly where that bug bites. */}
                <DateField
                  value={eventDate}
                  onChange={setEventDate}
                  ariaLabel="Event date"
                  className="w-full"
                />
              </Field>
            </div>

            {/* DECISION 8's PAIR, side by side, because they are two different
                questions that look like one: the PICKUP shop is where the
                customer collects — it decides the tax rate, the menu's prices
                and the LOCATION line on the quote — and the KITCHEN is where
                it gets made.

                Pickup DEFAULTS to the shop you are standing in and the kitchen
                does not, and that asymmetry is deliberate: an order taken at
                DF01 is usually collected at DF01, while which kitchen bakes it
                is a decision somebody makes later. Leaving pickup empty was
                not neutral — it meant no tax and org-grid prices. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Pickup shop">
                <PickList
                  value={locationId}
                  onPick={setLocationId}
                  variant="field"
                  placeholder="Not set"
                  ariaLabel="Pickup shop"
                  options={[
                    { value: "", label: "Not set" },
                    ...kitchens.map((k) => ({ value: k.id, label: k.code })),
                  ]}
                  className="w-full"
                />
              </Field>
              <Field label="Kitchen">
                <PickList
                  value={kitchenId}
                  onPick={setKitchenId}
                  variant="field"
                  placeholder="Not decided"
                  ariaLabel="Kitchen"
                  options={[
                    { value: "", label: "Not decided" },
                    ...kitchens.map((k) => ({ value: k.id, label: k.code })),
                  ]}
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Contact">
                <TextInput
                  value={contactName}
                  onValueChange={setContactName}
                  placeholder="Who to call"
                  aria-label="Contact name"
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Phone">
                <TextInput value={contactPhone} onValueChange={setContactPhone} aria-label="Contact phone" className="w-full" />
              </Field>
              <Field label="Email">
                <TextInput value={contactEmail} onValueChange={setContactEmail} aria-label="Contact email" className="w-full" />
              </Field>
            </div>

            <p className="text-[13px] text-muted">
              The customer, the lines and the money are set on the record. An
              order starts as a <strong>lead</strong>.
            </p>

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
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {required ? <span className="text-accent"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
