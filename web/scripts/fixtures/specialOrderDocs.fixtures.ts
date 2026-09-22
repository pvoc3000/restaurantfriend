// Special-order DOCUMENTS — the dates a customer reads, the grouping the
// kitchen works from, the email that carries them, and the four sentences the
// public approval page can say.
//
// Every case here was checked by BREAKING the rule it covers. What that found,
// and why several of these look over-specified:
//
//   · `usDate` written as `new Date(iso).toLocaleDateString()` prints the day
//     BEFORE for everyone west of Greenwich — a wedding misdated on the quote
//     the customer signs, and invisible to whoever wrote it in London;
//   · `sizeClassGroups` written without `isProductionLine` puts "Delivery Fee"
//     on the production sheet as something to make, and written to DROP lines
//     with no size loses a real donut off it silently;
//   · `lastWeek` written as "today minus seven days" produces overlapping
//     statements, which double-bills a wholesale customer for whichever days
//     fall in both;
//   · `fillTemplate` written to blank unknown placeholders swallows a typo in
//     a template into a hole in a sentence a customer reads;
//   · `quoteStateMessage` collapsed to one "this link is not valid" tells a
//     customer who has ALREADY approved that their signature went nowhere.

import { test, eq, ok, no } from "./harness";
import {
  buildDocumentEmail,
  cutoffClause,
  fillFulfillmentNote,
  fulfillmentNote,
  documentCc,
  documentFileName,
  documentRecipient,
  fillTemplate,
  lastWeek,
  orgDocHeader,
  productionCount,
  replySubject,
  sizeClassGroups,
  taxonomyLine,
  templateVars,
  threadHeaders,
  usDate,
  usLongDate,
  usTime,
  usWeekday,
  type DocumentLine,
  type OrderDocData,
} from "../../src/lib/specialOrderDocs";
import {
  approvalUrl,
  mintTokenValue,
  quoteStateMessage,
  resolveAppBase,
} from "../../src/lib/specialOrderSend";
import { orderTotals } from "../../src/lib/specialOrders";
import {
  customerSearchClauses,
  draftIsUsable,
  draftToRow,
  splitName,
} from "../../src/lib/customerSearch";

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

function line(over: Partial<DocumentLine> = {}): DocumentLine {
  return {
    id: over.id ?? "1",
    sort: over.sort ?? 1,
    name: over.name ?? "Give Up the Toast - Letter",
    item_donut: over.item_donut ?? "Give Up the Toast",
    item_type: over.item_type === undefined ? "Raised" : over.item_type,
    item_cut: over.item_cut === undefined ? 'Letter - "W"' : over.item_cut,
    item_finish: over.item_finish === undefined ? "Plain" : over.item_finish,
    item_size: over.item_size === undefined ? "Regular" : over.item_size,
    notes: over.notes === undefined ? null : over.notes,
    qty: over.qty ?? 1,
    unit_price: over.unit_price ?? 5.1,
    taxable: over.taxable ?? true,
  };
}

function order(over: Partial<OrderDocData> = {}): OrderDocData {
  const lines = over.lines ?? [line()];
  const money = over.money ?? {
    tax_rate: 0.0975,
    discount_amount: null,
    discount_rate: null,
    delivery_charge: null,
    rush_fee: null,
  };
  return {
    id: "o1",
    org_id: "org",
    number: "9885",
    kind: "order",
    status: "quote",
    title: "Pregnanacy Revela 8/16/2026",
    event_date: "2026-08-16",
    event_time: "10:00:00",
    ready_by_time: null,
    fulfillment: "pickup",
    allergen_info: null,
    taken_by: "Traci",
    date_initiated: "2026-08-13",
    taken_by_name: "Traci Nguyen",
    contact_name: "Alexandra David",
    contact_phone: "(323) 337-7966",
    contact_email: "alexlandayan@gmail.com",
    delivery_address: null,
    delivery_tracking: null,
    delivery_boxes: null,
    delivery_company: null,
    delivery_company_phone: null,
    delivery_window_start: null,
    delivery_window_end: null,
    customer: {
      first_name: "Alexandra",
      last_name: "David",
      company: null,
      phone: "(323) 337-7966",
      email: "customer@example.com",
    },
    location_code: "DF01",
    location_name: "DONUT FRIEND 01 HIGHLAND PARK",
    kitchen_code: "DF01",
    notes_quote: null,
    notes_production: null,
    notes_invoice: null,
    notes_receipt: null,
    payments: [],
    ...over,
    lines,
    money,
    totals: over.totals ?? orderTotals(money, lines, over.payments ?? []),
  };
}

/* -------------------------------------------------------------------------- */
/* Dates and times                                                             */
/* -------------------------------------------------------------------------- */

test("usDate reads the STRING and never a Date", () => {
  eq(usDate("2026-08-16"), "8/16/2026");
  // Leading zeros come off both parts — FileMaker prints 8/1/2026, not 08/01.
  eq(usDate("2026-01-05"), "1/5/2026");
  // A timestamptz still answers about its date part rather than shifting.
  eq(usDate("2026-08-16T23:30:00Z"), "8/16/2026");
  eq(usDate(null), "");
  // Anything unparseable comes back UNCHANGED rather than as "NaN/NaN/NaN",
  // which on a document is worse than the raw value.
  eq(usDate("soon"), "soon");
});

test("usWeekday: ISO 1 = Monday, and 2026-08-16 really is a Sunday", () => {
  eq(usWeekday("2026-08-16"), "SUNDAY");
  eq(usWeekday("2026-08-17"), "MONDAY");
  eq(usWeekday("2026-08-15"), "SATURDAY");
  eq(usWeekday(null), "");
});

test("usTime turns a Postgres time into a clock reading", () => {
  eq(usTime("10:00:00"), "10:00 AM");
  eq(usTime("13:05:00"), "1:05 PM");
  // Both ends of the 12-hour wrap, which is where an off-by-one lives.
  eq(usTime("00:30:00"), "12:30 AM");
  eq(usTime("12:00:00"), "12:00 PM");
  eq(usTime(null), "");
});

test("documentFileName keeps FileMaker's shape", () => {
  eq(documentFileName("quote", "9885", "2026-08-16"), "QUOTE#9885_2026.08.16.pdf");
  eq(documentFileName("invoice", "9885", "2026-08-16"), "INVOICE#9885_2026.08.16.pdf");
  // The kitchen sheet is the one FileMaker names differently, and it is the one
  // that gets printed rather than emailed.
  eq(documentFileName("order", "9885", "2026-08-16"), "Order-9885.pdf");
  eq(
    documentFileName("signed_quote", "9885", "2026-08-16"),
    "QUOTE#9885_signed_2026.08.16.pdf"
  );
  // A suffixed order number survives verbatim — `5689a` is a real one.
  eq(documentFileName("quote", "5689a", "2026-08-16"), "QUOTE#5689a_2026.08.16.pdf");
});

/* -------------------------------------------------------------------------- */
/* The kitchen sheet's lines                                                   */
/* -------------------------------------------------------------------------- */

test("taxonomyLine is donut · type · cut · size · finish, FileMaker's order", () => {
  eq(
    taxonomyLine(line()),
    'Give Up the Toast - Raised - Letter - "W" - Regular - Plain'
  );
  // Missing parts close up rather than leaving " -  - ".
  eq(
    taxonomyLine(line({ item_cut: null, item_finish: null })),
    "Give Up the Toast - Raised - Regular"
  );
});

test("a Misc line NEVER reaches the kitchen, and an untyped one always does", () => {
  const groups = sizeClassGroups([
    line({ id: "a" }),
    // Given the SAME size as the donuts, so this case is about the TYPE and
    // nothing else — with a null size it would also be caught by the
    // no-size rule below, which would hide a broken Misc guard.
    line({ id: "b", name: "Delivery Fee", item_type: "Misc", item_size: "Regular" }),
    // 569 real lines carry no type at all and they are ordinary donuts. If this
    // is treated as money the kitchen never hears about it.
    line({ id: "c", name: "Mystery donut", item_type: null }),
  ]);
  eq(groups.length, 1, "one size class");
  eq(groups[0].label, "REGULAR");
  eq(
    groups[0].lines.map((l) => l.id),
    ["a", "c"]
  );
});

test("a line with NO size still prints, under its own heading", () => {
  const groups = sizeClassGroups([line({ id: "a" }), line({ id: "b", item_size: null })]);
  eq(
    groups.map((g) => g.label),
    ["REGULAR", "UNSPECIFIED"]
  );
});

test("size classes come out in the order they first appear, not alphabetically", () => {
  const groups = sizeClassGroups([
    line({ id: "a", item_size: "Regular" }),
    line({ id: "b", item_size: "Giant" }),
    line({ id: "c", item_size: "Regular" }),
    line({ id: "d", item_size: "Mini" }),
  ]);
  eq(
    groups.map((g) => g.label),
    ["REGULAR", "GIANT", "MINI"]
  );
  eq(groups[0].lines.length, 2, "the second Regular joins the first group");
});

test("productionCount excludes the money lines the kitchen never sees", () => {
  const count = productionCount([
    line({ id: "a", qty: 12 }),
    line({ id: "b", qty: 1, item_type: "Misc- Delivery" }),
    line({ id: "c", qty: 6 }),
  ]);
  eq(count, { lines: 2, qty: 18 });
});

/* -------------------------------------------------------------------------- */
/* The statement's period                                                      */
/* -------------------------------------------------------------------------- */

test("lastWeek is the Monday–Sunday week BEFORE, whatever day you ask on", () => {
  // 2026-08-17 is a Monday: last week is 8/10 – 8/16.
  eq(lastWeek("2026-08-17"), { from: "2026-08-10", to: "2026-08-16" });
  // 2026-08-16 is a Sunday — still in the 8/10 week, so last week is 8/3 – 8/9.
  eq(lastWeek("2026-08-16"), { from: "2026-08-03", to: "2026-08-09" });
  // A Wednesday lands on the same answer as its Monday, which is what makes
  // two consecutive statements neither overlap nor leave a day out.
  eq(lastWeek("2026-08-19"), lastWeek("2026-08-17"));
});

test("consecutive weeks abut exactly — no overlap, no gap", () => {
  const thisOne = lastWeek("2026-08-17");
  const nextOne = lastWeek("2026-08-24");
  eq(thisOne.to, "2026-08-16");
  eq(nextOne.from, "2026-08-17");
  ok(nextOne.from > thisOne.to, "the next period starts after this one ends");
});

test("lastWeek crosses a month and a year boundary correctly", () => {
  // 2026-01-05 is a Monday, so "last week" is the one that ENDS the day before
  // — Mon 29 Dec to Sun 4 Jan, which spans both the month and the year.
  eq(lastWeek("2026-01-05"), { from: "2025-12-29", to: "2026-01-04" });
  // And the Sunday inside it still points at the week before THAT.
  eq(lastWeek("2026-01-04"), { from: "2025-12-22", to: "2025-12-28" });
});

/* -------------------------------------------------------------------------- */
/* The email                                                                   */
/* -------------------------------------------------------------------------- */

test("an unknown placeholder is LEFT ALONE, never blanked", () => {
  eq(fillTemplate("Hi {first_name}, about {whoops}.", { first_name: "Alex" }),
     "Hi Alex, about {whoops}.");
  // A known key whose value is empty still fills — that is how {approve_line}
  // disappears on an invoice.
  eq(fillTemplate("a{gap}b", { gap: "" }), "ab");
});

test("the CUSTOMER is preferred over the order's day-of contact", () => {
  // Mark, 2026-09-21. The papers belong to whoever the order belongs to; the
  // contact is who to ring on the day. It was the other way round until then.
  eq(documentRecipient(order()), "customer@example.com");
  // The fallback is the whole reason the contact is still read: a lead has no
  // customer linked, and its contact address is the only one it holds.
  eq(documentRecipient(order({ customer: null })), "alexlandayan@gmail.com");
  eq(
    documentRecipient(order({ customer: { ...order().customer!, email: null } })),
    "alexlandayan@gmail.com"
  );
  eq(documentRecipient(order({ contact_email: null, customer: null })), "");
});

test("the greeting names the customer, and never the list label", () => {
  // `{first_name}` off `customerLabel` would read "Cafe" here.
  const corporate = order({
    customer: {
      first_name: "Ji-Yeon",
      last_name: "Kim",
      company: "Cafe Knotted",
      phone: null,
      email: "jiyeon@example.com",
    },
    contact_name: "Traci at the venue",
  });
  eq(templateVars(corporate).full_name, "Ji-Yeon Kim");
  eq(templateVars(corporate).first_name, "Ji-Yeon");
  // Company-only customer: the company is the name there is.
  eq(
    templateVars(
      order({
        customer: {
          first_name: null,
          last_name: null,
          company: "Yeastie Boys",
          phone: null,
          email: "hi@example.com",
        },
      })
    ).full_name,
    "Yeastie Boys"
  );
  // No customer at all falls back to the day-of contact, like the address does.
  eq(templateVars(order({ customer: null })).full_name, "Alexandra David");
  // And with neither, the greeting stays a sentence rather than an em dash.
  eq(
    templateVars(order({ customer: null, contact_name: null })).first_name,
    "there"
  );
});

test("the DAY-OF CONTACT is cc'd, but only when they are somebody else", () => {
  // The base order's contact was seeded from the customer and kept their own
  // address, which is the corporate shape: the customer is billed, the contact
  // is chasing it.
  eq(documentCc(order(), ""), "alexlandayan@gmail.com");
  eq(documentCc(order(), "orders@example.com"),
     "orders@example.com, alexlandayan@gmail.com");

  // SAME ADDRESS, NO SECOND COPY — (n) seeds the contact from the customer, so
  // this is the common case and a Cc to the recipient reads as a bug.
  const same = order({ contact_email: "customer@example.com" });
  eq(documentCc(same, ""), "");
  eq(documentCc(same, "orders@example.com"), "orders@example.com");
  // Case and surrounding space are not a different person.
  eq(documentCc(order({ contact_email: "  Customer@Example.COM " }), ""), "");
  eq(documentCc(order(), " orders@example.com , ALEXLANDAYAN@gmail.com "),
     "orders@example.com, ALEXLANDAYAN@gmail.com");

  // An order with no customer sends TO the contact, so there is nobody to add.
  eq(documentCc(order({ customer: null }), ""), "");
  // No contact at all leaves the configured Cc exactly as it was.
  eq(documentCc(order({ contact_email: null }), "orders@example.com"),
     "orders@example.com");
  eq(documentCc(order({ contact_email: null }), ""), "");
});

test("usLongDate is FileMaker's wording, and does not slip a day", () => {
  eq(usLongDate("2026-09-22"), "Tuesday September 22, 2026");
  eq(usLongDate("2026-09-26"), "Saturday September 26, 2026");
  // No leading zero on the day, no comma after the weekday, one before the year.
  eq(usLongDate("2026-01-05"), "Monday January 5, 2026");
  // The trap this arithmetic exists for: parsed in local time west of
  // Greenwich, a wall-clock date lands on the day before.
  eq(usLongDate("2026-03-01"), "Sunday March 1, 2026");
  eq(usLongDate(null), "");
  eq(usLongDate("nonsense"), "");
});

test("{fulfillment_note}: PICKUP, word for word from FileMaker", () => {
  eq(
    fulfillmentNote(order({ fulfillment: "pickup", event_date: "2026-09-22", event_time: "09:00:00" }), {},
      templateVars(order({ fulfillment: "pickup", event_date: "2026-09-22", event_time: "09:00:00" }))),
    "You have chosen to pick up your order. It will be ready for you anytime " +
      "after 9:00 AM on Tuesday September 22, 2026."
  );
});

test("{fulfillment_note}: DELIVERY, word for word, tracking and all", () => {
  const o = order({
    fulfillment: "delivery",
    event_date: "2026-09-26",
    delivery_company: "DeliverLA",
    delivery_company_phone: "(310) 478-8000",
    delivery_window_start: "16:30:00",
    delivery_window_end: "18:30:00",
    delivery_tracking: "1696665",
  });
  eq(
    fulfillmentNote(o, {}, templateVars(o)),
    "You have chosen to have your order delivered by our delivery partner " +
      "DeliverLA. It will arrive between 4:30 PM and 6:30 PM on Saturday " +
      "September 26, 2026. Should you encounter any issues with delivery " +
      "please call DeliverLA at (310) 478-8000.\n" +
      "You can reference tracking number 1696665 when you call."
  );
});

test("the tracking line DISAPPEARS when there is no tracking number", () => {
  // 72 of 157 real deliveries since 2025 have none, which is why the line is a
  // line rather than a clause.
  const o = order({
    fulfillment: "delivery",
    event_date: "2026-09-26",
    delivery_company: "DeliverLA",
    delivery_company_phone: "(310) 478-8000",
    delivery_window_start: "16:30:00",
    delivery_window_end: "18:30:00",
    delivery_tracking: null,
  });
  const note = fulfillmentNote(o, {}, templateVars(o));
  no(note.includes("tracking"), "no dangling tracking sentence");
  ok(note.endsWith("(310) 478-8000."), "and it ends cleanly on the sentence before");
});

test("a half-known delivery window still reads as a sentence", () => {
  const win = (from: string | null, to: string | null) => {
    const o = order({
      fulfillment: "delivery", event_date: "2026-09-26",
      delivery_company: "DeliverLA", delivery_company_phone: "(310) 478-8000",
      delivery_window_start: from, delivery_window_end: to, delivery_tracking: null,
    });
    return fulfillmentNote(o, {}, templateVars(o));
  };
  ok(win("16:30:00", "18:30:00").includes("between 4:30 PM and 6:30 PM"));
  ok(win("16:30:00", null).includes("after 4:30 PM"));
  ok(win(null, "18:30:00").includes("by 6:30 PM"));
  // Neither end: the line keeps its other value and still reads.
  ok(win(null, null).includes("It will arrive on Saturday September 26, 2026."),
     "no double space, no dangling preposition");
});

test("fillFulfillmentNote drops only the hollow lines", () => {
  const vars = { a: "A", empty: "" };
  eq(fillFulfillmentNote("one {a}\ntwo {empty}\nthree", vars), "one A\nthree");
  // Prose with no placeholders always survives.
  eq(fillFulfillmentNote("just words", vars), "just words");
  // A line survives when ANYTHING in it filled, and the hole closes up.
  eq(fillFulfillmentNote("{a} and {empty}", vars), "A and");
  // …but a line whose ONLY placeholder is empty is hollow, so it goes entirely
  // rather than leaving "x  y" behind.
  eq(fillFulfillmentNote("x {empty} y", vars), "");
  eq(fillFulfillmentNote("x {a} {empty} y", vars), "x A y");
  eq(fillFulfillmentNote("ends {a} {empty}.", vars), "ends A.");
});

test("an org can replace either note, and a blank one falls back", () => {
  const o = order({ fulfillment: "pickup", event_date: "2026-09-22", event_time: "09:00:00" });
  eq(
    fulfillmentNote(o, { special_orders: { fulfillment_note: { pickup: "Come and get it on {event_day}." } } },
      templateVars(o)),
    "Come and get it on Tuesday September 22, 2026."
  );
  ok(
    fulfillmentNote(o, { special_orders: { fulfillment_note: { pickup: "   " } } }, templateVars(o))
      .startsWith("You have chosen to pick up"),
    "blank means the default, as everywhere else on that screen"
  );
});

test("{fulfillment_note} cannot recurse into itself", () => {
  const o = order({ fulfillment: "pickup", event_date: "2026-09-22", event_time: "09:00:00" });
  // It is not in the map the note is filled from, so it resolves EMPTY rather
  // than expanding — and a line whose only placeholder is empty is then
  // dropped, which is a better thing to send a customer than a raw token.
  eq(
    fulfillmentNote(o, { special_orders: { fulfillment_note: { pickup: "x {fulfillment_note} y" } } },
      templateVars(o)),
    ""
  );
  // Beside real content the line survives, with the hole closed up.
  eq(
    fulfillmentNote(o, { special_orders: { fulfillment_note: { pickup: "on {event_day} {fulfillment_note}" } } },
      templateVars(o)),
    "on Tuesday September 22, 2026"
  );
});

test("{fulfillment_note} reaches a receipt template", () => {
  const o = order({ fulfillment: "pickup", event_date: "2026-09-22", event_time: "09:00:00" });
  const email = buildDocumentEmail("receipt", o, {
    special_orders: { email: { receipt: { body: "Thanks!\n\n{fulfillment_note}" } } },
  });
  eq(
    email.body,
    "Thanks!\n\nYou have chosen to pick up your order. It will be ready for you " +
      "anytime after 9:00 AM on Tuesday September 22, 2026."
  );
});

test("{employee_name} is the FIRST name of whoever took the order", () => {
  // The roster leads with the nickname where there is one, so this follows it.
  eq(templateVars(order()).employee_name, "Traci");
  eq(templateVars(order({ taken_by_name: "Bee Ferrer" })).employee_name, "Bee");
  // A one-word name — FileMaker's text is often just this.
  eq(templateVars(order({ taken_by_name: "Vilma" })).employee_name, "Vilma");
  // Nobody recorded: empty, which is the honest answer and is what the key
  // warns about. It does NOT fall back to the customer or the org.
  eq(templateVars(order({ taken_by_name: null })).employee_name, "");
  // And it never borrows the customer's first name by accident.
  no(templateVars(order({ taken_by_name: null })).employee_name === "Alexandra");
});

test("{cutoff_clause}: 5pm two days before, and never in the past", () => {
  // Mark's two cases, 2026-09-22. The event is the 16th.
  eq(cutoffClause("2026-08-16", "2026-08-10"), "5pm on 8/14/2026");
  eq(cutoffClause("2026-08-16", "2026-08-15"), "5pm TODAY", "event tomorrow");

  // The two he did not name, which fall out of the same rule. The cutoff IS
  // today on the 14th — printing today's own date there reads as a machine
  // talking — and it is behind us on the 16th and after.
  eq(cutoffClause("2026-08-16", "2026-08-14"), "5pm TODAY", "cutoff is today");
  eq(cutoffClause("2026-08-16", "2026-08-16"), "5pm TODAY", "event today");
  eq(cutoffClause("2026-08-16", "2026-08-20"), "5pm TODAY", "event gone");
  // The day before the cutoff still names it.
  eq(cutoffClause("2026-08-16", "2026-08-13"), "5pm on 8/14/2026");

  // MONTH AND YEAR BOUNDARIES, because the arithmetic is string-based UTC.
  eq(cutoffClause("2026-03-01", "2026-02-01"), "5pm on 2/27/2026", "leap-less February");
  eq(cutoffClause("2024-03-01", "2024-02-01"), "5pm on 2/28/2024", "a leap year");
  eq(cutoffClause("2026-01-01", "2025-12-01"), "5pm on 12/30/2025", "across the year");

  // NO DATE — the sentence still has to read. An empty expansion would leave
  // "paid in full by  for it to be placed".
  eq(cutoffClause(null, "2026-08-10"), "5pm two days before your event");
  eq(cutoffClause("2026-08-16", null), "5pm two days before your event");
  eq(cutoffClause(null, null), "5pm two days before your event");
});

test("{cutoff_clause} reaches a template, and reads as Mark wrote it", () => {
  const sentence =
    "The order needs to be paid in full by {cutoff_clause} for it to be placed " +
    "into our production queue!";
  // The base order's event is 2026-08-16.
  eq(
    fillTemplate(sentence, templateVars(order(), {}, "2026-08-10")),
    "The order needs to be paid in full by 5pm on 8/14/2026 for it to be placed " +
      "into our production queue!"
  );
  eq(
    fillTemplate(sentence, templateVars(order(), {}, "2026-08-15")),
    "The order needs to be paid in full by 5pm TODAY for it to be placed " +
      "into our production queue!"
  );
  // And with no day given at all, which is what an unmigrated caller passes.
  eq(
    fillTemplate(sentence, templateVars(order())),
    "The order needs to be paid in full by 5pm two days before your event for " +
      "it to be placed into our production queue!"
  );
});

test("the quote email carries the totals and the approval paragraph", () => {
  const email = buildDocumentEmail("quote", order(), {}, {
    approve_line: "\nApprove here: https://example.com/q/abc\n",
  });
  eq(email.subject, "Your quote #9885 — Pregnanacy Revela 8/16/2026");
  ok(email.body.includes("$5.60"), "the total is in the body");
  ok(email.body.includes("https://example.com/q/abc"), "the approval link is in the body");
  ok(email.body.includes("Alexandra"), "greeted by first name");
});

test("an order with no title gets no dangling em dash in the subject", () => {
  const email = buildDocumentEmail("invoice", order({ title: null }), {});
  eq(email.subject, "Your invoice #9885");
});

test("a configured template overrides the generic one, per document", () => {
  const settings = {
    special_orders: {
      email: { quote: { subject: "Quote {number} for {full_name}" } },
      email_cc: "orders@example.com",
    },
  };
  const quote = buildDocumentEmail("quote", order(), settings);
  eq(quote.subject, "Quote 9885 for Alexandra David");
  eq(quote.cc, "orders@example.com, alexlandayan@gmail.com");
  // The INVOICE keeps the built-in template — overriding one document must not
  // silently change the others.
  eq(
    buildDocumentEmail("invoice", order(), settings).subject,
    "Your invoice #9885 — Pregnanacy Revela 8/16/2026"
  );
});

test("a BLANK stored template falls back to the default, never sends empty", () => {
  // The settings screen has always rendered `configured || fallback`; this read
  // was `??`, so a stored "" showed the default and sent nothing. Since the
  // fields hold the defaults, clearing one IS the way back to them — so the two
  // reads have to agree.
  const blank = { special_orders: { email: { quote: { subject: "", body: "   " } } } };
  const email = buildDocumentEmail("quote", order(), blank);
  eq(email.subject, "Your quote #9885 — Pregnanacy Revela 8/16/2026");
  ok(email.body.includes("Thanks for your order!"), "the default body came back");
  // A real override still wins, including one that is only whitespace-padded.
  eq(
    buildDocumentEmail("quote", order(), {
      special_orders: { email: { quote: { subject: " Hello " } } },
    }).subject,
    " Hello "
  );
});

test("threading headers exist only where there is something to thread onto", () => {
  eq(threadHeaders({ inbound_message_id: null }), null);
  eq(threadHeaders({}), null);
  // Bracketed on the wire — sending `<<id>>` threads with nothing.
  eq(threadHeaders({ inbound_message_id: "abc@mail.example" }), {
    inReplyTo: "<abc@mail.example>",
    references: "<abc@mail.example>",
  });
  eq(threadHeaders({ inbound_message_id: "<abc@mail.example>" }), {
    inReplyTo: "<abc@mail.example>",
    references: "<abc@mail.example>",
  });
});

test("replySubject does not stack a second Re:", () => {
  eq(replySubject("Special Order Inquiry"), "Re: Special Order Inquiry");
  eq(replySubject("Re: Special Order Inquiry"), "Re: Special Order Inquiry");
  eq(replySubject("RE: shouting"), "RE: shouting");
  eq(replySubject(null), null);
});

/* -------------------------------------------------------------------------- */
/* The masthead                                                                */
/* -------------------------------------------------------------------------- */

test("the document masthead is the TRADE name, not the billing entity", () => {
  const header = orgDocHeader("Donut Friend", {
    billing: {
      entity_name: "DONUT FRIEND, INC.",
      address1: "543 S Broadway",
      city: "Los Angeles",
      state: "CA",
      zip: "90013",
      phone: "(213) 908-2743",
      email: "info@donutfriend.com",
    },
  });
  // A purchase order's Bill-to names the legal person who pays; a customer's
  // quote is the shop's letter, and FileMaker's own quote says DONUT FRIEND.
  eq(header.name, "DONUT FRIEND");
  eq(header.addressLine, "543 S BROADWAY LOS ANGELES CA 90013");
  eq(header.contactLine, "(213) 908-2743 / info@donutfriend.com");
});

test("the module's provider reply_to reaches the masthead on its own", () => {
  // Configuring the mailbox sets `reply_to` INSIDE `email_provider`, and that
  // is the whole of a correct setup — so the documents must print it without
  // anybody also writing the same address at the top level. Reading only the
  // top-level key left every document printing the BILLING address after a
  // setup that was right.
  const header = orgDocHeader("Donut Friend", {
    billing: { phone: "(213) 908-2743", email: "info@donutfriend.com" },
    special_orders: {
      email_provider: {
        kind: "gmail",
        secret_ref: "SPECIALORDERS",
        from: "Donut Friend <specialorders@donutfriend.com>",
        reply_to: "specialorders@donutfriend.com",
      },
    },
  });
  eq(header.contactLine, "(213) 908-2743 / specialorders@donutfriend.com");
  eq(header.replyTo, "specialorders@donutfriend.com");

  // An EXPLICIT top-level reply_to still wins over the provider's, so an org
  // that publishes a different address than it sends from can say so.
  const explicit = orgDocHeader("Donut Friend", {
    billing: { email: "info@donutfriend.com" },
    special_orders: {
      reply_to: "events@donutfriend.com",
      email_provider: { reply_to: "specialorders@donutfriend.com" },
    },
  });
  eq(explicit.replyTo, "events@donutfriend.com");

  // And with neither, the billing address is still the honest fallback.
  eq(
    orgDocHeader("Donut Friend", { billing: { email: "info@donutfriend.com" } }).replyTo,
    "info@donutfriend.com"
  );
});

test("special-orders settings override the billing phone and address", () => {
  const header = orgDocHeader("Donut Friend", {
    billing: { phone: "(213) 908-2743", email: "info@donutfriend.com" },
    special_orders: {
      document_name: "Donut Friend Events",
      document_phone: "213 995 6191",
      reply_to: "specialorders@donutfriend.com",
    },
  });
  eq(header.name, "DONUT FRIEND EVENTS");
  eq(header.contactLine, "213 995 6191 / specialorders@donutfriend.com");
  // A customer replying to a quote must not land in accounts payable.
  eq(header.replyTo, "specialorders@donutfriend.com");
});

/* -------------------------------------------------------------------------- */
/* The approval link                                                           */
/* -------------------------------------------------------------------------- */

test("a token is 128 bits, URL-safe, and never repeats", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = mintTokenValue();
    eq(t.length, 22, "22 base64url characters carry 128 bits");
    ok(/^[A-Za-z0-9_-]+$/.test(t), `URL-safe: ${t}`);
    no(seen.has(t), "no repeat");
    seen.add(t);
  }
});

test("approvalUrl survives an origin with a trailing slash", () => {
  eq(approvalUrl("abc", "https://app.example.com"), "https://app.example.com/q/abc");
  eq(approvalUrl("abc", "https://app.example.com/"), "https://app.example.com/q/abc");
});

test("each token state gets its OWN sentence", () => {
  const unknown = quoteStateMessage("unknown");
  const superseded = quoteStateMessage("superseded");
  const approved = quoteStateMessage("approved");

  ok(unknown.title && superseded.title && approved.title, "all three say something");
  // The one that matters: a customer who has already approved must not be told
  // their link is invalid.
  no(approved.title === unknown.title, "approved reads differently from unknown");
  no(superseded.title === unknown.title, "superseded reads differently from unknown");
  ok(superseded.body.includes("email"), "superseded says where the live one is");
  eq(quoteStateMessage("already_approved"), approved, "the two approved states agree");
  // `open` is the page itself, so it has nothing to say.
  eq(quoteStateMessage("open"), { title: "", body: "" });
});


test("an approval link is NEVER built on a developer's own machine", () => {
  // The bug this exists for (Mark, 2026-08-17): a real quote went out carrying
  // `http://localhost:3000/q/…`, which works for nobody but the laptop that
  // sent it — and it is the one thing on the page the customer is asked to tap.
  for (const origin of [
    "http://localhost:3000",
    "https://localhost:8443",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
    "http://[::1]:3000",
    "http://marks-mac.local:3000",
  ]) {
    const r = resolveAppBase(origin);
    ok("error" in r, `${origin} must be refused`);
    ok(
      "error" in r && r.error.includes("NEXT_PUBLIC_APP_URL"),
      "the refusal names the thing to set"
    );
  }
});

test("a real deployment origin is used as-is", () => {
  // In production the browser's own origin IS the deployment, so nothing has
  // to be configured for the ordinary case to be right.
  const r = resolveAppBase("https://restaurantfriend.vercel.app");
  eq(r, { base: "https://restaurantfriend.vercel.app" });
});

test("approvalUrl survives a trailing slash on either source", () => {
  eq(
    approvalUrl("abc", "https://restaurantfriend.vercel.app"),
    "https://restaurantfriend.vercel.app/q/abc"
  );
  eq(
    approvalUrl("abc", "https://restaurantfriend.vercel.app/"),
    "https://restaurantfriend.vercel.app/q/abc"
  );
});

/* -------------------------------------------------------------------------- */
/* Finding a customer                                                          */
/* -------------------------------------------------------------------------- */

test("a phone number is matched on its DIGIT RUNS, not as text", () => {
  // The bug (measured 2026-08-18): stored `(323) 337-7966`, pasted
  // `(323) 337` — a plain ilike found NOTHING, because the parentheses have to
  // come out to keep them from breaking PostgREST's comma-separated `or` list,
  // and taking them out leaves spaces the record does not have.
  const phoneClause = (t: string) =>
    customerSearchClauses(t).find((c) => c.startsWith("phone."));

  eq(phoneClause("(323) 337-7966"), "phone.ilike.*323*337*7966*");
  eq(phoneClause("(323) 337"), "phone.ilike.*323*337*");
  eq(phoneClause("323 337"), "phone.ilike.*323*337*");
  eq(phoneClause("337-7966"), "phone.ilike.*337*7966*");
  // All four are the SAME pattern shape, which is the point: whatever
  // punctuation either side used, the digits line up.
  eq(phoneClause("(323) 337"), phoneClause("323 337"));
});

test("a name is not treated as a phone, and two digits are not either", () => {
  no(customerSearchClauses("David").some((c) => c.startsWith("phone.")));
  // Under three digits a "phone match" is every customer whose number
  // contains a 7.
  no(customerSearchClauses("77").some((c) => c.startsWith("phone.")));
  ok(customerSearchClauses("777").some((c) => c.startsWith("phone.")));
});

test("commas and parentheses can never break out of the or() list", () => {
  // A stray comma or paren in a VALUE would split a filter in two and change
  // what the query means. The `and(…)` pair has parens and a comma of its own,
  // which are PostgREST's syntax — so the test reads the values rather than the
  // whole clause: everything between `.ilike.` and the next delimiter.
  const values = (term: string) =>
    customerSearchClauses(term).flatMap((clause) =>
      [...clause.matchAll(/\.ilike\.([^,)]*)/g)].map((m) => m[1])
    );
  for (const value of values("a,b)c( 999")) {
    no(value.includes(","), `no comma in ${value}`);
    no(value.includes("("), `no paren in ${value}`);
    no(value.includes(")"), `no paren in ${value}`);
  }
  // And the pair is still well formed after the stripping — one `and(`, one
  // `)`, one comma between two filters.
  for (const clause of customerSearchClauses("a,b)c( 999")) {
    if (!clause.startsWith("and(")) continue;
    ok(/^and\([a-z_]+\.ilike\.[^,()]*,[a-z_]+\.ilike\.[^,()]*\)$/.test(clause), clause);
  }
});

test("A FULL NAME IS MATCHED ACROSS THE TWO NAME COLUMNS", () => {
  // Mark, 2026-09-21: "the app doesn't find 'Alyssa Rosario' even though they
  // exist". Every other clause puts the whole term against ONE column, and a
  // person's name lives in two — so the most natural thing to type was the one
  // thing that could not match, and the box said the customer did not exist.
  const pairs = (term: string) =>
    customerSearchClauses(term).filter((c) => c.startsWith("and("));

  eq(pairs("Alyssa Rosario"), [
    "and(first_name.ilike.%Alyssa%,last_name.ilike.%Rosario%)",
    // Reversed too: a list sorted by surname trains people to type it that way.
    "and(first_name.ilike.%Rosario%,last_name.ilike.%Alyssa%)",
  ]);

  // FIRST AND LAST WORD, not `splitName`'s last-space cut: the columns hold
  // whatever was typed into them, so "Mary Jo Alvarez" has to find a
  // `first_name` of either "Mary" or "Mary Jo" — and `%Mary%` finds both.
  eq(pairs("Mary Jo Alvarez"), [
    "and(first_name.ilike.%Mary%,last_name.ilike.%Alvarez%)",
    "and(first_name.ilike.%Alvarez%,last_name.ilike.%Mary%)",
  ]);

  // One word is not a pair — "Alyssa" already finds every Alyssa through the
  // whole-term clauses, and pairing it with itself would demand a surname too.
  eq(pairs("Alyssa"), []);
  eq(pairs("   "), []);

  // A dot or a colon ENDS A VALUE inside a logic tree, so they come out of the
  // words: "St. John Smith" must still parse.
  eq(pairs("St. John Smith"), [
    "and(first_name.ilike.%St%,last_name.ilike.%Smith%)",
    "and(first_name.ilike.%Smith%,last_name.ilike.%St%)",
  ]);

  // The whole-term clauses are untouched — this ADDS a way to match, it does
  // not replace one. A company is one column and "Cafe Knotted" still finds it.
  ok(customerSearchClauses("Cafe Knotted").includes("company.ilike.%Cafe Knotted%"));
});

test("a name splits on the LAST space, and a lone word is a SURNAME", () => {
  eq(splitName("Alexandra David"), { first: "Alexandra", last: "David" });
  // Not "Mary" + "Jo Alvarez" — the middle name stays with the first.
  eq(splitName("Mary Jo Alvarez"), { first: "Mary Jo", last: "Alvarez" });
  // The roster sorts and searches on `last_name`, so a one-word name put in
  // `first_name` would be invisible in the place people look for it.
  eq(splitName("Cher"), { first: null, last: "Cher" });
  eq(splitName("   "), { first: null, last: null });
});

test("a customer needs a name OR a company — either will do", () => {
  // `NewCustomer`'s own rule, kept identical so the two doors agree: Cafe
  // Knotted is a customer whose contact nobody has asked for yet.
  ok(draftIsUsable({ name: "Alexandra David", company: "", phone: "", email: "" }));
  ok(draftIsUsable({ name: "", company: "Cafe Knotted", phone: "", email: "" }));
  no(draftIsUsable({ name: "", company: "", phone: "(323) 337-7966", email: "x@y.z" }));
  no(draftIsUsable({ name: "  ", company: " ", phone: "", email: "" }));
});

test("a draft becomes a row with the email folded and blanks nulled", () => {
  const row = draftToRow(
    { name: "Alexandra David", company: "", phone: " (323) 337-7966 ", email: " Alex@Example.COM " },
    "org-1"
  );
  eq(row.org_id, "org-1", "explicit — design rule 1");
  eq(row.first_name, "Alexandra");
  eq(row.last_name, "David");
  eq(row.company, null, "an empty box is null, not an empty string");
  eq(row.phone, "(323) 337-7966");
  // Folded, so the same address typed two ways is one customer to a search.
  eq(row.email, "alex@example.com");
  eq(row.source, "app");
});
