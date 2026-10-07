"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { BUTTON_CLASS, SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
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
 * ONE ITEM A REQUEST, AND THE ITEM COMES FIRST (Mark, 2026-10-06). It opened
 * on a two-line "What do we need" box with the catalog search last and
 * optional, and people did what that shape asks for: typed the week's whole
 * list into one request and never touched the search. A request like that
 * cannot be linked to an item, cannot jump to its shelf on the guide, and
 * cannot be marked ordered until every line of it is. So the dialog is now
 * built around the unit instead of saying so in a sentence:
 * - the SEARCH is the first field and has the focus, and choosing an item IS
 *   the request — its name is what the queue shows;
 * - something the catalog doesn't stock is one tap further ("Not in the
 *   list") and is a SINGLE-LINE box, not a textarea, carrying over whatever
 *   was typed into the search;
 * - **File and add another** makes the second request cost one tap, which is
 *   the real reason lists got typed — a separate request for each thing meant
 *   reopening the dialog each time. It is the one case where the panel stays
 *   up, and it says what it just filed because the list is behind it.
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
  trigger,
}: {
  orgId: string;
  locationId: string;
  userId: string;
  locationCode: string;
  /**
   * What opens the panel, in place of the queue's "New request" button — the
   * tablet landing page's tile (`tablet/RequestTile`), which is this same
   * command dressed as a door.
   */
  trigger?: (open: () => void) => ReactNode;
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
  // The catalog doesn't stock it, so `text` is the request instead of an item.
  const [notListed, setNotListed] = useState(false);
  // What "File and add another" just filed, and how many times — the count
  // re-keys the item field so each round opens with the focus in the search.
  const [filed, setFiled] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const detailsRef = useRef<HTMLTextAreaElement>(null);

  const label = item ? item.name : notListed ? text.trim() : "";
  const ready = label.length > 0;

  function reset() {
    setText("");
    setDetails("");
    setPriority("normal");
    setItem(null);
    setNotListed(false);
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
    setFiled(null);
  }

  function add(another: boolean) {
    if (!ready || pending) return;
    setFailed(null);

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
      reset();
      if (another) {
        setFiled(label);
        setRound((n) => n + 1);
      } else {
        setOpen(false);
        setFiled(null);
      }
    });
  }

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
          New request
        </button>
      )}

      {open && (
        <Dialog
          title="New purchase request"
          onClose={close}
          busy={pending}
          // Enter commits, guarded by exactly what the commit button asks — so
          // in the search box, where nothing is chosen yet, it does nothing.
          onSubmit={() => {
            if (ready && !pending) add(false);
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
                onClick={() => add(true)}
                disabled={!ready || pending}
                className={DIALOG_CANCEL_CLASS}
              >
                File and add another
              </button>
              <button
                type="button"
                onClick={() => add(false)}
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

            {filed && <p className="text-sm text-ink">Filed: {filed}</p>}

            <Field label="Item" required group key={round}>
              {notListed ? (
                <>
                  {/* ONE LINE, not a textarea: the box is the size of one
                      item's name, which is the whole instruction. */}
                  <TextInput
                    autoFocus
                    value={text}
                    onValueChange={setText}
                    clearLabel="Clear the item"
                    fullWidth
                    disabled={pending}
                    aria-label="Item not in the list"
                  />
                  <button
                    type="button"
                    onClick={() => setNotListed(false)}
                    disabled={pending}
                    className={`self-start ${SMALL_BUTTON_CLASS}`}
                  >
                    Search the list
                  </button>
                </>
              ) : (
                <InventoryItemChooser
                  value={item}
                  onPick={(next) => {
                    setItem(next);
                    // Chosen, so the next thing to say is how much — and the
                    // button that was pressed has just left the screen, taking
                    // the focus with it.
                    if (next) setTimeout(() => detailsRef.current?.focus(), 0);
                  }}
                  onNotListed={(term) => {
                    setNotListed(true);
                    setText(term);
                  }}
                  autoFocus
                />
              )}
            </Field>

            {/* Optional, and it has to be: a form that demands a paragraph for
                "we're out of gloves" is a form people route around. */}
            <Field label="Details">
              <textarea
                ref={detailsRef}
                value={details}
                rows={2}
                disabled={pending}
                onChange={(e) => setDetails(e.target.value)}
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
  group = false,
  children,
}: {
  label: string;
  required?: boolean;
  /**
   * The field holds SEVERAL controls (the item search and its buttons), so it
   * must not be a `<label>`: a label forwards a click to its first control,
   * whichever one was pressed.
   */
  group?: boolean;
  children: ReactNode;
}) {
  const caption = (
    <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
      {label}
      {required && <span className="text-accent"> *</span>}
    </span>
  );
  if (group) {
    return (
      <div className="flex flex-col gap-1">
        {caption}
        {children}
      </div>
    );
  }
  return (
    <label className="block space-y-1">
      {caption}
      {children}
    </label>
  );
}
