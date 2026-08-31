"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { PickList } from "@/components/ui/PickList";
import {
  InventoryItemChooser,
  type ChosenItem,
} from "@/components/catalog/InventoryItemChooser";
import {
  REQUEST_PRIORITIES,
  REQUEST_PRIORITY_LABEL,
  type RequestPriority,
} from "@/lib/purchaseRequests";

/**
 * File a request — "we need X".
 *
 * `NewEmployee`'s template, which is the one every create in this app follows:
 * a command right-aligned above the list, a `ui/Dialog`, an insert. What it
 * does NOT do is land you on the new record, because there isn't one — a
 * request is a row in a queue, not a record with a screen.
 *
 * SO IT CLOSES ON SUCCESS (Mark, 2026-08-21). It shipped with
 * `AddShopSection`'s ending — clear the fields, say what was added, leave the
 * panel up with **Done** where Cancel was — and that is the wrong ending here.
 * That one stays open because you seed a shop's whole walk order in a sitting,
 * so the next shelf is always the reason you are still there. Filing a request
 * is the opposite shape: you notice ONE thing is low and you say so. Leaving
 * the panel up asks a question nobody has an answer to, and puts a second
 * thing to press between the person and the list.
 *
 * There is no confirmation strip because there is a better one: the row is on
 * the list behind you the moment the panel goes, and the status tab's count
 * moves with it — which is also the feedback if you happened to be looking at
 * the Ordered or Dismissed tab, where the new row itself wouldn't show.
 *
 * IT IS NEVER ROLE-GATED. 001's `preq_insert` is membership-only and that is
 * the whole point of the feature: the person who notices the shelf is empty is
 * usually not the person who does the ordering. The obvious component to copy
 * here — `NewSpecialOrder`, rendered as `canWrite ? … : undefined` — would
 * quietly invert it into a queue staff can read and never add to.
 */
export function NewPurchaseRequest({
  orgId,
  locationId,
  userId,
  locationCode,
}: {
  orgId: string;
  locationId: string;
  userId: string;
  locationCode: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("normal");
  const [item, setItem] = useState<ChosenItem | null>(null);

  const ready = text.trim().length > 0;

  function reset() {
    setText("");
    setDetails("");
    setPriority("normal");
    setItem(null);
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function add() {
    if (!ready || pending) return;
    setFailed(null);
    const label = text.trim();

    startTransition(async () => {
      /**
       * `org_id` EXPLICITLY — design rule 1, and this insert is the exact case
       * that rule was written for. No table defaults `org_id`, and a WITH CHECK
       * is evaluated BEFORE the NOT NULL constraint, so omitting it reports
       * "new row violates row-level security policy" and sends you off to look
       * at roles when the fault is a missing column.
       *
       * Worth knowing that nothing has ever exercised this path: `load.mjs`
       * only ever WIPED this table, so there is no loader-created row to hide
       * behind. "A create that a loader also performs is a create nobody has
       * tested" — here there isn't even a loader.
       */
      const { error } = await supabase.from("purchase_requests").insert({
        org_id: orgId,
        location_id: locationId,
        requested_by: userId,
        request_text: label,
        details: details.trim() || null,
        priority,
        inventory_item_id: item?.id ?? null,
      });

      if (error) {
        setFailed(
          /priority|inventory_item_id|details/.test(error.message)
            ? `${error.message} — migration 059 or 060 has not been applied yet.`
            : error.code === "42501"
              ? // Measured on the harness: this is what a missing `org_id`
                // looks like, because a WITH CHECK is evaluated before the NOT
                // NULL. We pass it, so reaching this means the session really
                // has no membership in the org any more.
                "Not allowed — you don't have access to this org."
              : error.message
        );
        return;
      }

      // Refresh BEFORE closing, so the list behind the panel already has the
      // row when the panel is out of the way — `NewEmployee`'s order, for its
      // reason.
      router.refresh();
      setOpen(false);
      reset();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New request
      </button>

      {open && (
        <Dialog
          title="New purchase request"
          onClose={close}
          busy={pending}
          // Enter commits, guarded by exactly what the commit button asks. The
          // request text is a textarea, where `Dialog` leaves Enter alone — so
          // this only ever fires from the priority row or the item search.
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-xl"
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
                {pending ? "Filing…" : "File request"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              For {locationCode}. Whoever does the ordering sees this on their
              queue.
            </p>

            <Field label="What do we need" required>
              <textarea
                value={text}
                rows={2}
                autoFocus
                disabled={pending}
                onChange={(e) => setText(e.target.value)}
                placeholder="The big rainbow sprinkles"
                className={FORM_TEXTAREA}
              />
            </Field>

            {/* Optional, and it has to be: most requests genuinely are one
                line, and a form that demands a paragraph for "we're out of
                gloves" is a form people route around. The line above is what
                the queue shows; this is what the purchaser needs before they
                can buy the right thing. */}
            <Field label="Details">
              <textarea
                value={details}
                rows={4}
                disabled={pending}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="The ones we use on the Bacon Maple, not the little ones. Saturday is busy."
                className={FORM_TEXTAREA}
              />
            </Field>

            <Field label="Priority">
              <PickList
                variant="field"
                value={priority}
                options={REQUEST_PRIORITIES.map((p) => ({
                  value: p,
                  label: REQUEST_PRIORITY_LABEL[p],
                }))}
                onPick={(v) => setPriority((v || "normal") as RequestPriority)}
                ariaLabel="Priority"
                className="w-40"
                disabled={pending}
              />
            </Field>

            {/* Optional, and last, because it is the least of it: a request is
                a sentence first. Plenty are for something the catalog doesn't
                stock, and the purchaser is usually the one who knows which item
                it turned out to be — so this can be filled in later from the
                queue instead. */}
            <Field label="Which item, if you know">
              <InventoryItemChooser value={item} onPick={setItem} />
            </Field>

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
