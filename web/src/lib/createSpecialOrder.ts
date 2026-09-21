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
  /**
   * Pickup or delivery (Mark, 2026-09-20: "give the user the option for pickup
   * or delivery. If delivery, allow the user to enter the delivery address").
   *
   * IT MAKES THE CUT BY THE CREATE-DIALOG RULE — what BREAKS without it. The
   * column is `not null default 'pickup'`, so an order that is really a
   * delivery starts life claiming to be a pickup, and everything downstream
   * believes it: the Delivery TAB is hidden (`tabsFor`), so there is nowhere to
   * type the address; `stageState` returns null for `delivery_scheduled`, so
   * the attention queue never chases the booking; and both PDFs print "PICK UP
   * TIME" over an order nobody is collecting. Every one of those is silent.
   */
  fulfillment?: string | null;
  /** Only stored on a delivery — see `deliveryFields`. */
  deliveryAddress?: string | null;
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
   * Who took the order — the signed-in member's display name (Mark,
   * 2026-08-19: "'taken by' should default to the name of the employee who
   * started/initiated the order").
   *
   * IT IS A SNAPSHOT OF A NAME, not a link to a user, and that is the column
   * this schema already has: FileMaker's `taken_by` holds "Traci", and 8,330
   * migrated orders carry names of people who mostly no longer work here.
   * Seeding it from the person creating the order is what makes it true
   * without anybody typing it, and it stays free text because the order taken
   * over the phone by somebody who then hands it to you is a real thing.
   */
  takenBy?: string | null;
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

/**
 * WHERE IT GOES, AS IT IS STORED — and the rule that an address belongs to a
 * DELIVERY and to nothing else.
 *
 * Migration 058's inquiry RPC already writes `case when v_fulfillment =
 * 'delivery' then v_address else null end`, and this is the same sentence on
 * the app's side of the wire. It matters because the create dialog keeps what
 * you typed when you flip back to Pickup — a mis-tap should not silently delete
 * an address — so without this the order would be stored as a pickup carrying a
 * delivery address, which is a row that reads true on the Info tab and has no
 * tab to show it on.
 *
 * ANYTHING THAT IS NOT `delivery` IS `pickup`, rather than passed through: the
 * column is `not null check (fulfillment in ('pickup','delivery'))`, and a
 * check-constraint refusal is the one failure `InlineValue` cannot explain.
 */
export function deliveryFields(
  fulfillment: string | null | undefined,
  address: string | null | undefined
): { fulfillment: "pickup" | "delivery"; delivery_address: string | null } {
  const mode = fulfillment === "delivery" ? "delivery" : "pickup";
  return {
    fulfillment: mode,
    delivery_address: mode === "delivery" ? orNull(address) : null,
  };
}

/**
 * WHAT A NEW RECORD STARTS AS, by kind — the pair, because they belong
 * together and were drifting apart in one ternary each.
 *
 * DECISION 3'S BICONDITIONAL, WIDENED BY 112: an order has a status and a
 * standing order has the one its DAYS start with. A template has neither — it
 * is duplicated rather than instantiated, so it has no days to prototype. Get
 * this wrong for a standing order and the INSERT is refused by a CHECK, which
 * is the one refusal the app cannot put into words.
 *
 * A NEW STANDING ORDER STARTS AT `invoice` / "Send Invoice", which is the safe
 * one of the two: its days arrive unpaid and wait for the money before they can
 * reach a kitchen night. `order` is the deliberate choice for an account billed
 * in arrears, and deliberate is what it should be — the other way round, a
 * half-configured wholesale account quietly puts donuts on a schedule.
 *
 * THE TO-DO IS DECISION 4'S STATED EXCEPTION, not a breach of it: the app
 * suggests a to-do and never writes one, except where the to-do is not a guess
 * about a workflow but what the act itself produced. A new lead has been
 * responded to by nobody; a new standing order's days have been invoiced by
 * nobody. 099's materializer makes the same argument in the same words.
 */
export function startingState(kind: SpecialOrderKind): {
  status: string | null;
  todo: string | null;
} {
  if (kind === "order") return { status: "lead", todo: "Respond to Email/Call" };
  if (kind === "standing_order") return { status: "invoice", todo: "Send Invoice" };
  return { status: null, todo: null };
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
      // Decision 3's biconditional and decision 4's exception, both in
      // `startingState` — see its note.
      status: startingState(input.kind).status,
      title: input.title.trim(),
      event_date: input.eventDate ?? null,
      event_time: input.eventTime ?? null,
      location_id: locationId,
      kitchen_location_id: orNull(input.kitchenLocationId),
      ...deliveryFields(input.fulfillment, input.deliveryAddress),
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
      taken_by: orNull(input.takenBy),
      todo: startingState(input.kind).todo,
      source: "app",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "The order could not be created." };
  }
  return { id: data.id as string };
}
