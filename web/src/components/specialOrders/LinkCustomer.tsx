"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { customerLabel } from "@/lib/specialOrders";

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Point an order at a customer — `InventoryItemPicker`'s shape, and built for
 * the same reason it was: the link existed in ONE direction and there was no
 * way to make it from the other side.
 *
 * "New order for them" on a customer record set `customer_id` at creation, and
 * that was the only writer in the app (Mark, 2026-08-18: "how am I supposed to
 * link a customer to the order?"). So an order that began as a lead — which is
 * every order taken over the phone, and every one the inquiry form will
 * create — could never acquire a customer at all. The record said "None
 * linked" and offered nothing to do about it.
 *
 * WHY A SEARCH BOX RATHER THAN A `PickList`. There are 5,874 customers. A
 * picker loads its options up front, so it would pull the whole table onto a
 * screen that mostly does not need it; this queries the server once the term is
 * worth running, exactly as the inventory picker does over 790 items.
 *
 * IT SEARCHES FIVE COLUMNS, and the two beyond the obvious earn their place:
 * a repeat customer is found by the PHONE NUMBER on the caller ID far more
 * often than by a name somebody has to spell, and by EMAIL when the order
 * began as an inquiry. `or()` rather than five round trips.
 *
 * THE PHONE IS MATCHED ON ITS DIGIT RUNS, not as text, because the number you
 * paste and the number on file are formatted by different people. Stored:
 * `(323) 337-7966`. Typed or pasted: `(323) 337`, `323 337`, `337-7966`. A
 * plain `ilike` on the term finds NONE of those — measured — because the
 * parentheses have to be stripped to keep them out of PostgREST's `or` list,
 * and stripping them leaves spaces where the record has none. Joining the digit
 * runs with a wildcard (`*323*337*`) is indifferent to whatever punctuation
 * either side used, and all four forms then find the row.
 */
export function LinkCustomer({
  orderId,
  orgId,
  currentCustomerId,
  /** The order's day-of contact, which is both the best search term and — when
   *  nobody matches — the makings of the customer record itself. */
  contact,
  canWrite,
}: {
  orderId: string;
  orgId: string;
  currentCustomerId: string | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seed = (contact.name ?? contact.email ?? contact.phone ?? "").trim();

  const canSearch = open && term.trim().length >= 2;
  useEffect(() => {
    if (!canSearch) return;
    let cancelled = false;

    // PostgREST's `or` takes a comma-separated filter list, and a comma or a
    // parenthesis inside the term would break out of it — so they come out of
    // the TEXT clauses, and the phone gets a pattern of its own (see above).
    const safe = term.trim().replace(/[(),]/g, " ");
    const digitRuns = term.match(/\d+/g) ?? [];
    const clauses = [
      `last_name.ilike.%${safe}%`,
      `first_name.ilike.%${safe}%`,
      `company.ilike.%${safe}%`,
      `email.ilike.%${safe}%`,
    ];
    // Three digits is the shortest thing worth treating as a number; below that
    // a "phone match" is every customer whose number contains a 7.
    if (digitRuns.join("").length >= 3) {
      clauses.push(`phone.ilike.*${digitRuns.join("*")}*`);
    }

    supabase
      .from("customers")
      .select("id, first_name, last_name, company, phone, email")
      .or(clauses.join(","))
      .order("last_name")
      .limit(25)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setResults((data ?? []) as CustomerRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, canSearch, term]);

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
    setTerm("");
    router.refresh();
  }

  /**
   * Make the customer from the order's own contact details, and link it.
   *
   * The common case this exists for: somebody rings, you take the order, and
   * they turn out to be new. Their name, phone and email are already typed into
   * the order — sending you to `/customers` to type them a second time is the
   * transcription the customer record exists to avoid.
   *
   * The name is split on the LAST space, so "Mary Jo Alvarez" becomes
   * "Mary Jo" + "Alvarez" rather than losing half of it. Anything unsplittable
   * lands in `last_name`, which is what the roster sorts and searches on.
   */
  async function createFromContact() {
    const whole = (contact.name ?? "").trim();
    const cut = whole.lastIndexOf(" ");
    setBusy(true);
    setError(null);

    const { data, error: e } = await supabase
      .from("customers")
      .insert({
        org_id: orgId, // Explicit — design rule 1.
        first_name: cut > 0 ? whole.slice(0, cut) : null,
        last_name: cut > 0 ? whole.slice(cut + 1) : whole || null,
        phone: contact.phone?.trim() || null,
        email: contact.email?.trim().toLowerCase() || null,
        source: "app",
      })
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

  const btn =
    "border border-ink px-1.5 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35";

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className={btn}
          onClick={() =>
            setOpen((v) => {
              // Re-seed on OPEN, so a search you cleared and abandoned does not
              // come back empty next time.
              if (!v) setTerm(seed);
              return !v;
            })
          }
        >
          {open ? "Cancel" : currentCustomerId ? "Change" : "Link…"}
        </button>
        {currentCustomerId && !open ? (
          <button type="button" disabled={busy} className={btn} onClick={() => link(null)}>
            Unlink
          </button>
        ) : null}
        {busy && <span className="text-xs text-subtle">saving…</span>}
      </span>

      {error && <span className="text-xs text-accent">{error}</span>}

      {open && (
        <span className="flex flex-col gap-1">
          <TextInput
            autoFocus
            value={term}
            onValueChange={setTerm}
            placeholder="Name, company, email or phone…"
            clearLabel="Clear the search"
            className="w-80"
          />

          {canSearch && results.length > 0 && (
            <ul className="max-h-64 w-80 overflow-auto border border-ink">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy || c.id === currentCustomerId}
                    onClick={() => link(c.id)}
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

          {canSearch && results.length === 0 && (
            <span className="text-xs text-subtle">Nobody matches.</span>
          )}

          {/* Offered whenever the order names somebody, not only when the
              search comes up empty: you often know they are new before you
              have finished typing. */}
          {(contact.name || contact.email || contact.phone) && (
            <button
              type="button"
              disabled={busy}
              onClick={createFromContact}
              className={`${btn} w-80 py-1`}
            >
              New customer from this order&rsquo;s contact
              {contact.name ? ` — ${contact.name}` : ""}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
