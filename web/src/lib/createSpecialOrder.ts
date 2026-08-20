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
import {
  contactNameFor,
  draftIsUsable,
  draftToRow,
  splitName,
  type CustomerDraft,
} from "./customerSearch";

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
  /**
   * A customer described in the create dialog but not yet written.
   *
   * IT IS WRITTEN HERE, in the same act as the order, so that a dialog which
   * can be cancelled leaves nothing behind — and so no order can end up
   * pointing at a customer that failed to save. Ignored when `customerId` is
   * set; the picker only ever produces one of the two.
   */
  newCustomer?: CustomerDraft | null;
  /**
   * The DAY-OF contact. Left unset by both doors, and then seeded from the
   * customer — see `contactFrom`. Passing one explicitly wins.
   */
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  /**
   * Today's date in the ORG's timezone, for `date_initiated`.
   *
   * Passed in rather than computed here, because "today" is the org's calendar
   * day and not the host's (`lib/today`, migration 007): a browser in another
   * zone — or a laptop somebody has not corrected — must not decide when an
   * order was taken. Both callers already hold it for other reasons.
   */
  today?: string | null;
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

/** The three `contact_*` values, as they are stored. */
type Contact = { name: string | null; phone: string | null; email: string | null };

/** The columns of a customer this reads. Named so the existing-customer branch
 *  can type its select without casting through the function's own signature. */
type ContactSource = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
};

/**
 * THE CUSTOMER'S DETAILS BECOME THE ORDER'S CONTACT (Mark, 2026-08-19: "The
 * customer contact info should be copied to the contact name, phone, and email
 * if it exists").
 *
 * These are two different facts and they are the same fact nine times out of
 * ten. `customers` holds who the ORDER BELONGS TO — who is billed, who the
 * statement goes to. `special_orders.contact_*` holds who to ring ON THE DAY,
 * which on a corporate order is whoever is running the party and is why the
 * create dialog stopped asking for it. For a person ordering their own
 * birthday donuts the two are one, and re-typing a phone number that is
 * already in the record is exactly the transcription the customer record
 * exists to avoid.
 *
 * SEEDED, NEVER SLAVED. It is a snapshot taken once at creation: the order's
 * own three fields stay editable, so naming a different day-of contact later
 * does not fight with the customer record, and editing the customer next month
 * does not silently rewrite who to call about an order already quoted.
 *
 * "IF IT EXISTS" IS PER FIELD. A customer with a phone and no email seeds the
 * phone and leaves the email empty, rather than either being skipped whole or
 * writing a blank over nothing. And anything the caller passed explicitly wins
 * outright — one door might one day ask.
 */
function contactFrom(
  given: { name?: string | null; phone?: string | null; email?: string | null },
  customer: ContactSource | null
): Contact {
  return {
    name: orNull(given.name) ?? (customer ? contactNameFor(customer) : null),
    phone: orNull(given.phone) ?? orNull(customer?.phone),
    email: orNull(given.email) ?? orNull(customer?.email),
  };
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

  // The customer FIRST, because the order carries its id. A failure here stops
  // the whole thing rather than quietly producing an order with nobody on it,
  // which is the state this argument exists to prevent.
  let customerId = input.customerId ?? null;
  // What the order's day-of contact starts as — see `contactFrom`. Null until
  // a customer is in hand; a lead with nobody on it seeds nothing.
  let contact: Contact = contactFrom(
    { name: input.contactName, phone: input.contactPhone, email: input.contactEmail },
    null
  );

  if (!customerId && input.newCustomer && draftIsUsable(input.newCustomer)) {
    const draft = input.newCustomer;
    const { data: made, error: customerError } = await supabase
      .from("customers")
      .insert(draftToRow(draft, input.orgId))
      .select("id")
      .single();
    if (customerError || !made) {
      return {
        error: customerError?.message ?? "The customer could not be created.",
      };
    }
    customerId = made.id as string;
    // Straight off the draft — the same values that were just written, so no
    // round trip, and the name splits the way `draftToRow` split it.
    const { first, last } = splitName(draft.name);
    contact = contactFrom(
      { name: input.contactName, phone: input.contactPhone, email: input.contactEmail },
      { first_name: first, last_name: last, company: draft.company, phone: draft.phone, email: draft.email }
    );
  } else if (customerId) {
    // An EXISTING customer — the one round trip this costs, and it belongs
    // here rather than in either dialog: "New order for them" on the customer
    // record has the row on screen and the list's picker has only a label, so
    // reading it once in the shared creator is what keeps the two doors
    // agreeing (which is this module's whole reason for existing).
    const { data: found } = await supabase
      .from("customers")
      .select("first_name, last_name, company, phone, email")
      .eq("id", customerId)
      .maybeSingle();
    contact = contactFrom(
      { name: input.contactName, phone: input.contactPhone, email: input.contactEmail },
      (found as ContactSource | null) ?? null
    );
  }

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
      customer_id: customerId,
      contact_name: contact.name,
      contact_phone: contact.phone,
      contact_email: contact.email,
      // WHEN THE ORDER WAS TAKEN (Mark, 2026-08-19: "The 'day initiated'
      // should be set to the creation date"). It is the date the quote's
      // signature band prints and the first of the completion dates on the
      // record, and nothing had ever written it — every app-made order carried
      // a blank where all 8,330 migrated ones carry FileMaker's `Date_Created`.
      // Editable afterwards, for an order taken on the phone yesterday.
      date_initiated: input.today ?? null,
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
