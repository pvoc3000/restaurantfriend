/**
 * FINDING A CUSTOMER — the query, in one place, because two screens ask it.
 *
 * The order record's `LinkCustomer` points an existing order at somebody; the
 * create dialog's `CustomerPicker` chooses one before an order exists. They
 * differ in what they DO with the answer and not at all in how they find it,
 * and the finding is the part with a rule in it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
};

/** Below this a search is noise — two characters of a 5,874-row table. */
export const MIN_SEARCH = 2;

/**
 * The `or()` filter list for a term.
 *
 * FIVE COLUMNS, and the two beyond the obvious earn their place: a repeat
 * customer is found by the PHONE NUMBER on the caller ID far more often than by
 * a name somebody has to spell, and by EMAIL when the order began as an
 * inquiry.
 *
 * **THE PHONE IS MATCHED ON ITS DIGIT RUNS, not as text**, and that is the rule
 * this module exists to keep in one copy. Stored: `(323) 337-7966`. Typed or
 * pasted: `(323) 337`, `323 337`, `337-7966`. A plain `ilike` on the term finds
 * NONE of those — measured — because parentheses and commas have to be stripped
 * to keep them out of PostgREST's comma-separated `or` list, and stripping them
 * leaves spaces where the record has none. Joining the digit runs with a
 * wildcard (`*323*337*`) is indifferent to whatever punctuation either side
 * used. The real data needs that: it holds `3233833742`, `310.721.5994` and
 * `323) 485-2621`.
 *
 * Returned as an array rather than a string so the fixtures can read it.
 */
export function customerSearchClauses(term: string): string[] {
  // A comma or a parenthesis inside the term would break out of the `or` list.
  const safe = term.trim().replace(/[(),]/g, " ");
  const clauses = [
    `last_name.ilike.%${safe}%`,
    `first_name.ilike.%${safe}%`,
    `company.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
  ];
  const runs = term.match(/\d+/g) ?? [];
  // Three digits is the shortest thing worth treating as a number; below that a
  // "phone match" is every customer whose number contains a 7.
  if (runs.join("").length >= 3) {
    clauses.push(`phone.ilike.*${runs.join("*")}*`);
  }
  return clauses;
}

export async function searchCustomers(
  supabase: SupabaseClient,
  term: string,
  limit = 25
): Promise<{ hits: CustomerHit[]; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, company, phone, email")
    .or(customerSearchClauses(term).join(","))
    .order("last_name")
    .limit(limit);
  if (error) return { hits: [], error: error.message };
  return { hits: (data ?? []) as CustomerHit[], error: null };
}

/**
 * What a person typed, split into the columns `customers` keeps.
 *
 * The name splits on the LAST space, so "Mary Jo Alvarez" becomes "Mary Jo" +
 * "Alvarez" rather than losing half of it, and anything unsplittable lands in
 * `last_name` — which is what the roster sorts and searches on, so a one-word
 * name put in `first_name` would be invisible in the place people look.
 */
export function splitName(whole: string): { first: string | null; last: string | null } {
  const t = whole.trim();
  if (!t) return { first: null, last: null };
  const cut = t.lastIndexOf(" ");
  return cut > 0
    ? { first: t.slice(0, cut).trim(), last: t.slice(cut + 1).trim() }
    : { first: null, last: t };
}

/** A customer being described but not yet written. */
export type CustomerDraft = {
  name: string;
  company: string;
  phone: string;
  email: string;
};

export const EMPTY_DRAFT: CustomerDraft = { name: "", company: "", phone: "", email: "" };

/**
 * A person needs a name; a company needs a company. EITHER satisfies it,
 * because Cafe Knotted is a customer whose contact nobody has asked for yet —
 * `NewCustomer`'s own rule, kept identical so the two doors agree on what a
 * customer minimally is.
 */
export function draftIsUsable(d: CustomerDraft): boolean {
  return d.name.trim() !== "" || d.company.trim() !== "";
}

/**
 * WHO TO RING ABOUT THIS ORDER, from a customer.
 *
 * The PERSON, falling back to the company — the opposite emphasis to
 * `customerLabel`, which leads with the company because it is naming a
 * customer in a list. This names a contact, and "Cafe Knotted (Jane Doe)" is
 * not a person you ask for on the phone.
 */
export function contactNameFor(c: {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
}): string | null {
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  const company = (c.company ?? "").trim();
  return person || company || null;
}

/** The row `customers` wants, from a draft. */
export function draftToRow(d: CustomerDraft, orgId: string): Record<string, unknown> {
  const { first, last } = splitName(d.name);
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    org_id: orgId, // Explicit — design rule 1.
    first_name: first,
    last_name: last,
    company: orNull(d.company),
    phone: orNull(d.phone),
    email: d.email.trim() ? d.email.trim().toLowerCase() : null,
    source: "app",
  };
}
