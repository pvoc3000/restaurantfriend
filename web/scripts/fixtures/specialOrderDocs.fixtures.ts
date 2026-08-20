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
  documentFileName,
  documentRecipient,
  fillTemplate,
  lastWeek,
  orgDocHeader,
  productionCount,
  replySubject,
  sizeClassGroups,
  taxonomyLine,
  threadHeaders,
  usDate,
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
    contact_name: "Alexandra David",
    contact_phone: "(323) 337-7966",
    contact_email: "alexlandayan@gmail.com",
    delivery_address: null,
    delivery_tracking: null,
    delivery_boxes: null,
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

test("the DAY-OF CONTACT is preferred over the customer's own address", () => {
  // Filled on 7,735 of the 8,330 real orders, and on a corporate order it is
  // the person who placed it while the customer record is accounts payable.
  eq(documentRecipient(order()), "alexlandayan@gmail.com");
  eq(documentRecipient(order({ contact_email: null })), "customer@example.com");
  eq(documentRecipient(order({ contact_email: null, customer: null })), "");
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
  eq(quote.cc, "orders@example.com");
  // The INVOICE keeps the built-in template — overriding one document must not
  // silently change the others.
  eq(
    buildDocumentEmail("invoice", order(), settings).subject,
    "Your invoice #9885 — Pregnanacy Revela 8/16/2026"
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
  // Each clause is one `column.op.value` — a stray comma would split it into
  // two filters and change what the query means.
  for (const clause of customerSearchClauses("a,b)c( 999")) {
    const value = clause.slice(clause.indexOf(".ilike.") + 7);
    no(value.includes(","), `no comma in ${clause}`);
    no(value.includes("("), `no paren in ${clause}`);
    no(value.includes(")"), `no paren in ${clause}`);
  }
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
