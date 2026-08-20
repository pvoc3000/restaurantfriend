/**
 * CREATING A SPECIAL ORDER — one implementation, because there are two doors.
 *
 * "New special order" on the list and "New order for them" on a customer both
 * make the same kind of row, and before this they made it two slightly
 * different ways. That is how the three bugs below survived: each door had a
 * bit of the truth and neither had all of it.
 *
 *   · **The pickup shop was never asked for.** Decision 8 splits `location_id`
 *     (where it is COLLECTED) from `kitchen_location_id` (where it is MADE),
 *     and the create form offered only the kitchen. A quote then printed no
 *     LOCATION, and the Items tab priced the menu at the org grid rather than
 *     at the selling shop.
 *   · **`tax_rate` was never written.** Migration 051 calls it "snapshotted
 *     from the pickup shop, editable" and nothing did the snapshotting — every
 *     reference in `web/src` was a SELECT. So every order created in the app
 *     derived ZERO TAX, silently, on a document a customer pays from.
 *   · **The org was resolved by reading `org_members` unfiltered.** That works
 *     while you are the only member and stops the moment you have colleagues —
 *     `.maybeSingle()` over three rows is "JSON object requested, multiple (or
 *     no) rows returned" (Mark, 2026-08-18, with three members). The caller
 *     passes the org it already knows instead.
 *
 * Client-safe (the `poProcessing` idiom): every write goes through the
 * caller's own supabase client, so RLS applies exactly as it would from any
 * screen.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SpecialOrderKind } from "./specialOrders";

export type NewSpecialOrderInput = {
  /** EXPLICIT, always. No table in this schema defaults `org_id`, and a WITH
   *  CHECK is evaluated before the NOT NULL — so omitting it reports an RLS
   *  violation and sends you looking at roles (design rule 1). */
  orgId: string;
  kind: SpecialOrderKind;
  title: string;
  eventDate?: string | null;
  /** `HH:MM`. Required of a real order by the create form — see its `ready`. */
  eventTime?: string | null;
  /** Decision 8: where the customer COLLECTS. Drives the tax rate, the menu's
   *  prices and the LOCATION line on the quote. */
  locationId?: string | null;
  /** Decision 8: where it is MADE. Genuinely undecided on most new leads. */
  kitchenLocationId?: string | null;
  customerId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

export type CreateResult = { id: string } | { error: string };

const orNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/**
 * The tax rate a new order starts at: the PICKUP shop's.
 *
 * Which shop is a real question and this is the answer: sales tax is charged
 * where the goods change hands, which is where the customer collects — the
 * same reasoning that makes the pickup shop decide the menu's prices. The
 * kitchen is a cost question.
 *
 * A NULL RATE IS LEFT NULL rather than defaulted to something. There is no
 * honest fallback — a rate invented in code would be wrong in a way nobody
 * could see — and the record's own Tax rate cell is right there to fill in.
 * DF01, DF02 and DF03 all carry 0.0975 today, so in practice this is only null
 * when no shop has been chosen.
 */
async function pickupTaxRate(
  supabase: SupabaseClient,
  locationId: string | null
): Promise<number | null> {
  if (!locationId) return null;
  const { data } = await supabase
    .from("locations")
    .select("tax_rate")
    .eq("id", locationId)
    .maybeSingle();
  const raw = (data as { tax_rate: number | string | null } | null)?.tax_rate;
  // PostgREST hands `numeric` back as a STRING often enough that storing it
  // unconverted would put a string into a numeric column's insert payload.
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export async function createSpecialOrder(
  supabase: SupabaseClient,
  input: NewSpecialOrderInput
): Promise<CreateResult> {
  // The number first: `next_special_order_number` is a definer that re-checks
  // supervisor+ membership, so a refusal here reads as a role problem in plain
  // words rather than as an RLS insert failure.
  const { data: number, error: numberError } = await supabase.rpc(
    "next_special_order_number",
    { p_org_id: input.orgId }
  );
  if (numberError || !number) {
    return { error: numberError?.message ?? "Could not allocate an order number." };
  }

  const locationId = orNull(input.locationId);
  const taxRate = await pickupTaxRate(supabase, locationId);

  const { data, error } = await supabase
    .from("special_orders")
    .insert({
      org_id: input.orgId,
      number,
      kind: input.kind,
      // Decision 3's biconditional: status exists exactly when kind is
      // `order`. The database enforces it; this is the app agreeing.
      status: input.kind === "order" ? "lead" : null,
      title: input.title.trim(),
      event_date: input.eventDate ?? null,
      event_time: input.eventTime ?? null,
      location_id: locationId,
      kitchen_location_id: orNull(input.kitchenLocationId),
      tax_rate: taxRate,
      customer_id: input.customerId ?? null,
      contact_name: orNull(input.contactName),
      contact_phone: orNull(input.contactPhone),
      contact_email: orNull(input.contactEmail),
      // Decision 4: the app suggests and never writes the to-do. This is the
      // exception that proves it — a brand-new lead's to-do is not a guess
      // about a workflow, it is what the button just created.
      todo: input.kind === "order" ? "Respond to Email/Call" : null,
      source: "app",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "The order could not be created." };
  }
  return { id: data.id as string };
}
