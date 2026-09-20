"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { TimePicker } from "@/components/ui/TimePicker";
import {
  FULFILLMENT_OPTIONS,
  KIND_LABEL,
  type SpecialOrderKind,
} from "@/lib/specialOrders";
import { createSpecialOrder } from "@/lib/createSpecialOrder";
import { CustomerPicker, type CustomerChoice } from "./CustomerPicker";
import { draftIsUsable } from "@/lib/customerSearch";

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
 * PICKUP OR DELIVERY IS THE EXCEPTION, and it earns its place by the rule the
 * conventions state: a field makes the cut when something BREAKS without it
 * (Mark, 2026-09-20). `fulfillment` is `not null default 'pickup'`, so a
 * delivery taken here starts life claiming to be a pickup — and then the
 * Delivery tab is hidden, so there is nowhere to type the address; the
 * attention queue never chases the booking, because `stageState` returns null
 * for `delivery_scheduled` on a pickup; and both PDFs print "PICK UP TIME"
 * over an order nobody is collecting. Each of those is silent, and each is
 * fixed by one tap at the moment the phone call happens.
 *
 * The ADDRESS rides with it because it is the one thing you are told in the
 * same breath — and it is OPTIONAL, because you are often told it later.
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
  today,
  takenBy,
  children,
}: {
  /**
   * Render the command as an `ActionMenu` row instead of a button — the record
   * screen's Actions menu (Mark, 2026-09-20: "add a 'New Order…' option to the
   * nav menu on the special order detail page"). `ScheduleProduction`'s idiom
   * exactly: this component keeps its own dialog, its own state and its own
   * insert, and hands the caller a row rather than drawing a button.
   *
   * It is the same dialog the list opens, which is the whole point — a second
   * create form on the record would be the "second version that never behaves
   * quite like the first" the conventions warn about.
   */
  children?: (items: ActionMenuItem[]) => ReactNode;
  /** Passed down rather than looked up. The old code read `org_members`
   *  UNFILTERED and took `.maybeSingle()`, which is correct for exactly one
   *  member and an error for two — the select policy shows you every member of
   *  your org. It broke the moment this org had colleagues. */
  orgId: string;
  /** Active shops — design rule 3: you cannot plan work at a closed one. */
  kitchens: { id: string; code: string }[];
  /** The shop you are standing in, as the pickup default. */
  defaultLocationId: string | null;
  /** Today in the ORG's timezone — the order's `date_initiated`. Computed on
   *  the server (`lib/today`), never from the browser's clock. */
  today: string;
  /** The signed-in member's display name — the order's `taken_by`. */
  takenBy: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [kind, setKind] = useState<SpecialOrderKind>("order");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [eventTime, setEventTime] = useState<string | null>(null);
  const [kitchenId, setKitchenId] = useState("");
  const [fulfillment, setFulfillment] = useState("pickup");
  const [address, setAddress] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [customer, setCustomer] = useState<CustomerChoice>(null);

  /**
   * WHEN IT IS WANTED IS REQUIRED ON A REAL ORDER (Mark, 2026-08-18: "Event
   * Time should be mandatory").
   *
   * The form used to ask for a title and nothing else, on the reasoning that a
   * lead acquires everything else as the conversation happens. That is true of
   * the customer, the lines and the money, and it is NOT true of when: the
   * kitchen sheet prints the pickup time as its most prominent field, the
   * attention queue measures every threshold in days before the event, and an
   * order nobody can date cannot be scheduled, chased or made ready.
   *
   * THE DATE IS REQUIRED TOO, and that is forced rather than chosen: a time
   * with no date says nothing at all, so making one mandatory without the other
   * would be incoherent.
   *
   * BOTH ARE ASKED ONLY OF A REAL ORDER. A template is a shape with no event,
   * and a standing order recurs by WEEKDAY over a date range — neither has a
   * single date to give, and demanding one would make those two kinds
   * uncreatable.
   */
  const needsWhen = kind === "order";
  /**
   * A customer is OPTIONAL — a lead often is just "somebody rang about a
   * wedding" — but a customer being DESCRIBED has to be describable: a draft
   * with neither a name nor a company would be written as an empty row nobody
   * could ever find again.
   */
  const customerOk = customer?.kind !== "new" || draftIsUsable(customer.draft);
  const ready =
    title.trim() !== "" &&
    customerOk &&
    (!needsWhen || (eventDate !== null && eventTime !== null));

  function reset() {
    setKind("order");
    setTitle("");
    setEventDate(null);
    setEventTime(null);
    setKitchenId("");
    setFulfillment("pickup");
    setAddress("");
    setLocationId(defaultLocationId ?? "");
    setCustomer(null);
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
        eventTime,
        today,
        takenBy,
        locationId,
        kitchenLocationId: kitchenId,
        fulfillment,
        // Kept in state through a flip back to Pickup, and dropped on the way
        // to the database — `deliveryFields` owns that rule, not this form.
        deliveryAddress: address,
        customerId: customer?.kind === "existing" ? customer.id : null,
        newCustomer: customer?.kind === "new" ? customer.draft : null,
      });
      if ("error" in result) {
        setFailed(result.error);
        return;
      }
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  /**
   * "NEW ORDER…" ON THE MENU, "NEW SPECIAL ORDER" ON THE LIST, and the two
   * labels differ on purpose: the list's button stands beside a heading reading
   * SPECIAL ORDERS, where the word would be said twice, and the record's menu
   * row sits above "Duplicate", where it has to say which noun it makes.
   * Title Case with an ellipsis, like every other row that opens a dialog.
   */
  const menuItems: ActionMenuItem[] = [
    { label: "New Order…", onSelect: () => setOpen(true) },
  ];

  return (
    <>
      {children ? (
        children(menuItems)
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
          New special order
        </button>
      )}

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
                fullWidth
              />
            </Field>

            {/* THE TWO SWITCHES LEAD, and they are a pair because they are the
                same kind of thing: each one decides what is asked BELOW it.
                Kind decides whether the two halves of "when" are required at
                all; Pickup / delivery decides whether there is an address to
                give. Everything under them is a real pair too — the two halves
                of "when" and decision 8's two shops — so no row is three fields
                wide with a hole in it.
                Kind sat alone here until 2026-09-20, when the second switch
                arrived and filled the slot beside it. */}
            {/* WHO IS ORDERING, which is what you know when the phone rings.
                This replaced Contact / Phone / Email, and those wrote the
                DAY-OF contact — a different person on a corporate order, and
                genuinely a later detail. The record still has all three. */}
            {/* A DIV, NOT A LABEL (Mark, 2026-09-16: clicking inside the new
                customer box closed it). A click on a label's empty space is
                forwarded to its FIRST control, which in that box is "Find an
                existing one instead" — so any stray click discarded the draft.
                Only pressing that button closes it now. */}
            <Field label="Customer" as="div">
              <CustomerPicker value={customer} onChange={setCustomer} disabled={pending} />
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
              {/* ASKED OF EVERY KIND, unlike the two "when" fields below. The
                  column is `not null` on all three, a template is duplicated
                  WITH its fulfillment, and a standing wholesale account is the
                  most likely delivery in the building.

                  `FULFILLMENT_OPTIONS` rather than a local pair, so the dialog
                  and the record's own cell can never drift apart — the hint
                  under Delivery ("adds the Delivery tab") is the sentence that
                  explains what this choice DOES, which is more than a label
                  here could. */}
              <Field label="Pickup / delivery">
                <PickList
                  value={fulfillment}
                  onPick={(next) => setFulfillment(next || "pickup")}
                  variant="field"
                  ariaLabel="Pickup or delivery"
                  options={FULFILLMENT_OPTIONS}
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Event date" required={needsWhen}>
                {/* `ui/DateField`, never a bare date input: it carries the
                    Safari empty-date apparatus, and this box starts EMPTY,
                    which is exactly where that bug bites. */}
                <DateField
                  value={eventDate}
                  onChange={setEventDate}
                  ariaLabel="Event date"
                  // The solid-bordered box that fills its track, so the pair is
                  // as wide and as tall as the pickers below (Mark, 2026-09-16).
                  boxed
                />
              </Field>
              <Field label="Event time" required={needsWhen}>
                <TimePicker
                  value={eventTime}
                  onChange={setEventTime}
                  ariaLabel="Event time"
                  boxed
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

            {/* THE ADDRESS SITS WITH THE OTHER "WHERE" FIELDS, not under its
                own switch two rows up. Pickup shop, Kitchen and this are one
                question asked three ways, and the address is full width because
                a street address is not a half-column value — "1638 Colorado
                Blvd, Los Angeles, CA 90041" is 44 characters.

                IT IS OPTIONAL, deliberately. Mark asked to "allow" it, and an
                order taken over the phone often has a date and a customer long
                before it has a street — `ready` is untouched, so nothing here
                can stop a delivery being created.

                SINGLE LINE, where the record's own cell is `multiline`: the
                inquiry form asks the public for an address in one line too, and
                a textarea in a dialog invites a paragraph nobody wants to read
                back off a kitchen sheet. `autoComplete` is the browser's own
                street-address hint. */}
            {fulfillment === "delivery" && (
              <Field label="Delivery address">
                <TextInput
                  value={address}
                  onValueChange={setAddress}
                  placeholder="1638 Colorado Blvd, Los Angeles, CA 90041"
                  aria-label="Delivery address"
                  autoComplete="street-address"
                  fullWidth
                />
              </Field>
            )}

            <p className="text-[13px] text-muted">
              The lines, the money and the day-of contact are set on the
              record. An order starts as a <strong>lead</strong>.
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
  as = "label",
  children,
}: {
  label: string;
  required?: boolean;
  /** `div` for a field holding SEVERAL controls — see the Customer field. */
  as?: "label" | "div";
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {required ? <span className="text-accent"> *</span> : null}
      </span>
      {children}
    </Tag>
  );
}
