"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { customerLabel } from "@/lib/specialOrders";
import {
  EMPTY_DRAFT,
  MIN_SEARCH,
  draftIsUsable,
  searchCustomers,
  type CustomerDraft,
  type CustomerHit,
} from "@/lib/customerSearch";

/**
 * WHO IS ORDERING, chosen while the order is being created.
 *
 * It replaces the create dialog's Contact / Phone / Email boxes (Mark,
 * 2026-08-18: "we should be able to set the customer when creating a special
 * order. Remove the contact, phone and email and add the ability to link or
 * create a new contact"). Those three wrote `contact_*` — the DAY-OF contact,
 * which on a corporate order is whoever is running the party and is genuinely
 * a later detail. WHO IS ORDERING is the thing you know at the moment the
 * phone rings, and it was the one thing the form could not record.
 *
 * **IT WRITES NOTHING.** A create dialog that has already made a customer
 * record by the time you press Cancel is a dialog that lies about what Cancel
 * means, and this one can be cancelled — so a new customer is held as a DRAFT
 * and `createSpecialOrder` writes it in the same act that writes the order.
 * That also gets the ordering right for free: no order can end up pointing at a
 * customer that failed to save.
 *
 * Three states, and only one is ever on screen: nothing chosen (search), a hit
 * chosen (the name, and a way back), or a new one being described.
 */
export type CustomerChoice =
  | { kind: "existing"; id: string; label: string }
  | { kind: "new"; draft: CustomerDraft }
  | null;

export function CustomerPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CustomerChoice;
  onChange: (next: CustomerChoice) => void;
  disabled?: boolean;
}) {
  const supabase = createClient();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const searching = value === null && term.trim().length >= MIN_SEARCH;

  useEffect(() => {
    // No `setHits([])` on the way out: clearing state from an effect is what
    // the `set-state-in-effect` lint objects to, and it is unnecessary — what
    // renders is DERIVED (`visible` below), so stale hits are simply not shown
    // rather than being erased.
    if (!searching) return;
    let cancelled = false;
    searchCustomers(supabase, term).then(({ hits: found, error: e }) => {
      if (cancelled) return;
      setError(e);
      setHits(found);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, searching, term]);

  /** Shown only while a search is actually live — see the effect. */
  const visible = searching ? hits : [];

  const link =
    "text-[13px] text-ink underline underline-offset-2 hover:text-muted disabled:opacity-35";

  /* ---- a customer has been chosen ------------------------------------- */
  if (value?.kind === "existing") {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <span className="text-[15px]">{value.label}</span>
        <button
          type="button"
          disabled={disabled}
          className={link}
          onClick={() => {
            setTerm("");
            onChange(null);
          }}
        >
          Change
        </button>
      </span>
    );
  }

  /* ---- a new one is being described ------------------------------------ */
  if (value?.kind === "new") {
    const d = value.draft;
    const set = (patch: Partial<CustomerDraft>) =>
      onChange({ kind: "new", draft: { ...d, ...patch } });

    return (
      <div className="space-y-3 border border-hairline p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            New customer
          </span>
          <button
            type="button"
            disabled={disabled}
            className={link}
            onClick={() => onChange(null)}
          >
            Find an existing one instead
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <TextInput
            value={d.name}
            onValueChange={(v) => set({ name: v })}
            placeholder="Their name"
            aria-label="Customer name"
            className="w-full"
            autoFocus
          />
          <TextInput
            value={d.company}
            onValueChange={(v) => set({ company: v })}
            placeholder="Company"
            aria-label="Customer company"
            className="w-full"
          />
          <TextInput
            value={d.phone}
            onValueChange={(v) => set({ phone: v })}
            placeholder="Phone"
            aria-label="Customer phone"
            className="w-full"
          />
          <TextInput
            value={d.email}
            onValueChange={(v) => set({ email: v })}
            placeholder="Email"
            aria-label="Customer email"
            className="w-full"
          />
        </div>

        {/* Says what it needs BEFORE the commit refuses, since the Create
            button is at the far end of a dialog and a disabled button explains
            itself only on hover. */}
        {!draftIsUsable(d) && (
          <p className="text-[12px] text-mark">
            A name or a company — either will do.
          </p>
        )}
        <p className="text-[12px] text-muted">
          They are created when the order is.
        </p>
      </div>
    );
  }

  /* ---- nothing chosen: search ------------------------------------------ */
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          value={term}
          onValueChange={setTerm}
          placeholder="Name, company, email or phone…"
          aria-label="Find a customer"
          clearLabel="Clear the search"
          disabled={disabled}
          className="w-full max-w-sm"
        />
        <button
          type="button"
          disabled={disabled}
          className={link}
          onClick={() =>
            onChange({
              kind: "new",
              // What has been typed is usually their name, so it carries over
              // rather than being thrown away on the way to the form.
              draft: { ...EMPTY_DRAFT, name: term.trim() },
            })
          }
        >
          New customer
        </button>
      </div>

      {error && <p className="text-[13px] text-accent">{error}</p>}

      {visible.length > 0 && (
        <ul className="max-h-56 overflow-auto border border-ink">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({ kind: "existing", id: c.id, label: customerLabel(c) })
                }
                className="block w-full px-2 py-1.5 text-left text-[13px] hover:bg-ink hover:text-white disabled:opacity-40"
              >
                <span className="block">{customerLabel(c)}</span>
                <span className="block text-[11px] text-subtle">
                  {[c.company, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searching && visible.length === 0 && (
        <p className="text-[13px] text-muted">
          Nobody matches — <strong>New customer</strong> makes one.
        </p>
      )}
    </div>
  );
}
