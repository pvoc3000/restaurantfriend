"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { ControlField } from "@/components/ui/ControlField";
import { customerLabel } from "@/lib/specialOrders";
import {
  EMPTY_DRAFT,
  MIN_SEARCH,
  draftIsUsable,
  draftToRow,
  searchCustomers,
  type CustomerDraft,
  type CustomerHit,
} from "@/lib/customerSearch";

/**
 * Point an order at a customer.
 *
 * WHY IT EXISTS. "New order for them" on a customer record set `customer_id` at
 * creation, and that was the only writer in the app (Mark, 2026-08-18: "how am
 * I supposed to link a customer to the order?"). So an order that began as a
 * lead — which is every order taken over the phone, and everything the inquiry
 * form creates — could never acquire a customer at all. The record said "None
 * linked" and offered nothing to do about it.
 *
 * **IT IS A DIALOG SINCE 2026-09-21** (Mark: "instead of doing it inline, let's
 * pop up a dialogue box instead… the sizing and placement of the controls in
 * the inline version are bad. Use a fresh take"). It used to unfold a search
 * box, a result list and a create button INSIDE a `dl` cell — a column sized
 * for a name, so the list was pinned to a hand-typed `w-80`, the three little
 * bordered buttons were a size nothing else in the app uses, and opening it
 * shoved the whole Customer block down the page. Choosing a customer is a task,
 * not a field edit: `ui/Dialog` gives it the room, pins the search in its
 * toolbar, scrolls only the list, and leaves the record's own layout alone.
 * What the row keeps is ONE command at the app's button size; Unlink moved into
 * the dialog, because everything that decides the link now lives in one place.
 *
 * THE SEARCH ITSELF IS `lib/customerSearch` — the same query the create
 * dialog's `CustomerPicker` runs, which is the half with a rule in it (five
 * columns in one `or()`, and the phone matched on its DIGIT RUNS rather than as
 * text, because the number you paste and the number on file are punctuated by
 * different people). This screen had a hand-copied version of those clauses
 * from before that module was extracted; it is gone.
 *
 * THE NEW-CUSTOMER SIDE IS A FORM, not the one-shot button it replaces. That
 * button made a customer out of the order's contact details exactly as typed,
 * which is right for the common case — somebody rings, they turn out to be new,
 * and their name and number are already on the order — and useless the moment
 * the caller gives a company or spells the name a second way. The four fields
 * open SEEDED from the contact, so the common case is still one press, and the
 * others are now possible. Unlike `CustomerPicker` this one really does write:
 * there is already an order to hang the customer on, and the write is the point
 * of the dialog.
 */
export function LinkCustomer({
  orderId,
  orgId,
  currentCustomerId,
  currentCustomerLabel,
  /** The order's day-of contact — the best search term, and the makings of the
   *  customer record when nobody matches. */
  contact,
  canWrite,
}: {
  orderId: string;
  orgId: string;
  currentCustomerId: string | null;
  /** Who is linked now, for the line the dialog opens on. */
  currentCustomerLabel: string | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  /** Which half of the dialog is on screen. Never both. */
  const [mode, setMode] = useState<"find" | "new">("find");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searching = mode === "find" && term.trim().length >= MIN_SEARCH;

  /**
   * The search runs from typing rather than from an effect.
   *
   * An effect keyed on the term would fire once per keystroke and once more on
   * every unrelated re-render; this fires where the term actually changes. The
   * LAST request wins — a slow "sm" landing after "smith" would otherwise
   * replace the right answer with a stale one, which reads as the list
   * flickering back.
   */
  const latest = useRef(0);
  async function runSearch(next: string) {
    setTerm(next);
    if (next.trim().length < MIN_SEARCH) {
      setHits([]);
      return;
    }
    const mine = ++latest.current;
    const { hits: found, error: e } = await searchCustomers(supabase, next);
    if (mine !== latest.current) return;
    setError(e);
    setHits(found);
  }

  function openDialog() {
    // Seeded on OPEN, so a search you cleared and abandoned does not come back
    // empty next time, and a contact typed since the last look is picked up.
    const seed = (contact.name ?? contact.email ?? contact.phone ?? "").trim();
    setMode("find");
    setDraft({
      ...EMPTY_DRAFT,
      name: contact.name?.trim() ?? "",
      phone: contact.phone?.trim() ?? "",
      email: contact.email?.trim() ?? "",
    });
    setHits([]);
    setError(null);
    setOpen(true);
    void runSearch(seed);
  }

  /**
   * `.select("id")` AND a row count, never a bare update: an update matching no
   * RLS policy changes zero rows and PostgREST returns NO error, so the link
   * would appear to have been made and then silently not be there.
   */
  async function link(customerId: string | null) {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("special_orders")
      .update({ customer_id: customerId })
      .eq("id", orderId)
      .select("id");
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (!data?.length) {
      setError("Not allowed — you need supervisor access to change this.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  /** Write the described customer, then point the order at it. */
  async function createAndLink() {
    if (!draftIsUsable(draft)) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("customers")
      .insert(draftToRow(draft, orgId)) // `draftToRow` passes org_id — design rule 1.
      .select("id")
      .single();
    if (e || !data) {
      setBusy(false);
      setError(e?.message ?? "The customer could not be created.");
      return;
    }
    setBusy(false);
    await link(data.id as string);
  }

  if (!canWrite) return null;

  const setField = (patch: Partial<CustomerDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={openDialog}>
        {currentCustomerId ? "Change customer" : "Link a customer"}
      </button>

      {open && (
        <Dialog
          title={mode === "new" ? "New customer for this order" : "Link a customer"}
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-2xl"
          // A DEFINITE height for the LIST, because it grows and shrinks with
          // every keystroke and a shrink-wrapped panel would jump under the
          // pointer as you type. The form is four boxes and never changes size,
          // so it takes the cap and comes out the height of what it holds —
          // 70vh of white under a name and a phone number is a panel pretending
          // to have more to say.
          height={mode === "new" ? "max-h-[85vh]" : "h-[60vh]"}
          bodyClassName="px-6 py-5"
          // Enter commits the FORM half only. In the find half there is nothing
          // for it to commit — choosing a row is the commit — and a keystroke
          // that picks whichever customer sorted first is not a shortcut.
          onSubmit={mode === "new" && draftIsUsable(draft) && !busy ? createAndLink : undefined}
          toolbar={
            mode === "find" ? (
              // `flex-1` on the row: the Dialog's toolbar is itself a flex row,
              // so without it this one is content-sized and the search cannot
              // grow. `AddOrderLine`'s shape.
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <div className="min-w-[14rem] flex-1">
                  <TextInput
                    autoFocus
                    value={term}
                    onValueChange={runSearch}
                    aria-label="Find a customer by name, company, email or phone"
                    clearLabel="Clear the search"
                    disabled={busy}
                    fullWidth
                    search
                    icon={<SearchGlyph />}
                  />
                </div>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={busy}
                  onClick={() => {
                    // What has been typed is usually their name, so it carries
                    // over — but never over a seeded contact name.
                    setDraft((d) => ({ ...d, name: d.name || term.trim() }));
                    setMode("new");
                  }}
                >
                  New customer
                </button>
              </div>
            ) : undefined
          }
          footer={
            <>
              {mode === "find" && currentCustomerId ? (
                // `mr-auto` puts it at the far left of a footer that is
                // otherwise right-aligned: it is neither the commit nor the way
                // out, and it should not sit next to either.
                <button
                  type="button"
                  className={`${DANGER_BUTTON_CLASS} mr-auto`}
                  disabled={busy}
                  onClick={() => link(null)}
                >
                  Unlink
                </button>
              ) : null}
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                disabled={busy}
                onClick={() => (mode === "new" ? setMode("find") : setOpen(false))}
              >
                {mode === "new" ? "Back" : "Cancel"}
              </button>
              {mode === "new" ? (
                <button
                  type="button"
                  className={DIALOG_COMMIT_CLASS}
                  disabled={busy || !draftIsUsable(draft)}
                  onClick={createAndLink}
                >
                  {busy ? "Saving…" : "Create & link"}
                </button>
              ) : null}
            </>
          }
        >
          {error && <p className="mb-4 text-[13px] text-accent">{error}</p>}

          {mode === "find" ? (
            <>
              {/* WHO IS LINKED NOW, said once at the top. The search opens
                  seeded with the order's CONTACT, who is often not the
                  customer — so on a linked order the dialog would otherwise
                  open reading "Nobody matches" with nothing on screen naming
                  the person it is about to replace. */}
              {currentCustomerLabel && (
                <p className="mb-4 text-[13px] text-muted">
                  Linked now: <span className="text-ink">{currentCustomerLabel}</span>
                </p>
              )}

              {hits.length > 0 && (
                <ul className="border border-ink">
                  {hits.map((c) => {
                    const linked = c.id === currentCustomerId;
                    const body = (
                      <>
                        <span className="min-w-0">
                          <span className="block text-[15px]">{customerLabel(c)}</span>
                          <span className="block text-[12px] text-subtle">
                            {[c.company, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        {linked && (
                          <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-subtle">
                            Linked now
                          </span>
                        )}
                      </>
                    );
                    const row = "flex w-full items-baseline justify-between gap-4 px-3 py-2.5 text-left";
                    return (
                      <li key={c.id} className="border-b border-hairline last:border-0">
                        {/* THE ONE ALREADY LINKED IS NOT A BUTTON. A disabled
                            button still looks like the others and says nothing;
                            plain text under its tag says why it cannot be
                            pressed. */}
                        {linked ? (
                          <span className={row}>{body}</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => link(c.id)}
                            className={`${row} hover:bg-ink hover:text-white disabled:opacity-40`}
                          >
                            {body}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {searching && hits.length === 0 && (
                <p className="text-[13px] text-muted">
                  Nobody matches — <strong>New customer</strong> makes one.
                </p>
              )}

              {!searching && (
                <p className="text-[13px] text-muted">
                  Search by name, company, email or phone.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {/* Seeded from the order's contact, so the common case — somebody
                  rings and turns out to be new — is still one press. */}
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <ControlField label="Name">
                  <TextInput
                    autoFocus
                    value={draft.name}
                    onValueChange={(v) => setField({ name: v })}
                    aria-label="Customer name"
                    disabled={busy}
                    fullWidth
                  />
                </ControlField>
                <ControlField label="Company">
                  <TextInput
                    value={draft.company}
                    onValueChange={(v) => setField({ company: v })}
                    aria-label="Customer company"
                    disabled={busy}
                    fullWidth
                  />
                </ControlField>
                <ControlField label="Phone">
                  <TextInput
                    value={draft.phone}
                    onValueChange={(v) => setField({ phone: v })}
                    aria-label="Customer phone"
                    disabled={busy}
                    fullWidth
                  />
                </ControlField>
                <ControlField label="Email">
                  <TextInput
                    value={draft.email}
                    onValueChange={(v) => setField({ email: v })}
                    aria-label="Customer email"
                    disabled={busy}
                    fullWidth
                  />
                </ControlField>
              </div>

              {/* Says what it needs BEFORE the commit refuses — the create
                  dialog's rule, since a disabled button explains itself only on
                  hover. Either will do: Cafe Knotted is a customer whose
                  contact nobody has asked for yet. */}
              {!draftIsUsable(draft) && (
                <p className="text-[12px] text-muted">A name or a company — either will do.</p>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

