// `supabase/functions/_shared/inquiryNotice.ts` — the email the shop gets when
// the website creates a lead (Mark, 2026-09-24).

import { test, eq, ok, no } from "./harness";
import {
  buildInquiryNotice,
  clockTime,
  longDate,
  type NoticeOrder,
} from "../../../supabase/functions/_shared/inquiryNotice";

const ORDER: NoticeOrder = {
  number: "10123",
  title: "Birthday",
  contact_name: "Victoria Fay",
  contact_email: "vlangfay@gmail.com",
  contact_phone: "(323) 630-0095",
  event_date: "2026-10-30",
  event_time: "10:00:00",
  fulfillment: "pickup",
  delivery_address: null,
  delivery_distance: null,
  delivery_charge: null,
  shop: "Highland Park",
  allergen_info: "Tree nuts",
  details: "Blue sprinkles on the letters, please.",
};

const LINES = [
  { name: "Angry Samoa", qty: 24, unit_price: 5.45, notes: null },
  { name: "Angry Samoa - Letter H", qty: 1, unit_price: 6.6, notes: '"H"' },
  { name: "Utensils (ea)", qty: 20, unit_price: 0, notes: "Price to be quoted" },
];

test("notice: the subject says who, what, and when", () => {
  eq(buildInquiryNotice(ORDER, LINES, null).subject, "New inquiry #10123 — Victoria Fay, Birthday (2026-10-30)");
});

test("notice: every submitted fact is in both parts", () => {
  const n = buildInquiryNotice(ORDER, LINES, "https://app.example.com/special-orders/abc");
  for (const s of ["Victoria Fay", "vlangfay@gmail.com", "(323) 630-0095", "Birthday",
    "Friday, October 30, 2026 at 10:00 AM", "Pickup", "Highland Park", "Tree nuts",
    "Blue sprinkles on the letters, please.", "Angry Samoa", "$130.80"]) {
    ok(n.text.includes(s), `text has ${s}`);
    ok(n.html.includes(s), `html has ${s}`);
  }
  ok(n.html.includes('href="https://app.example.com/special-orders/abc"'), "the button opens the lead");
  ok(n.html.includes('href="mailto:vlangfay@gmail.com"'));
  ok(n.html.includes('href="tel:3236300095"'));
});

test("notice: an unpriced extra is 'to be quoted', never $0.00", () => {
  const n = buildInquiryNotice(ORDER, LINES, null);
  no(n.text.includes("$0.00"));
  no(n.html.includes("$0.00"));
  ok(n.text.includes("Utensils (ea) — price to be quoted"));
  ok(n.text.includes("Estimated subtotal: $137.40 plus items to be quoted"));
});

test("notice: a delivery shows the address and the estimate, not a shop", () => {
  const n = buildInquiryNotice(
    { ...ORDER, fulfillment: "delivery", delivery_address: "5107 York Blvd", delivery_distance: 8.4, delivery_charge: 41, shop: null },
    LINES,
    null
  );
  ok(n.text.includes("Deliver to: 5107 York Blvd"));
  ok(n.text.includes("Delivery: $41.00 for 8.4 mi (estimated)"));
  no(n.text.includes("Pickup at"));
});

test("notice: no order built, no link, no details — it still reads", () => {
  const n = buildInquiryNotice({ ...ORDER, details: null, allergen_info: null }, [], null);
  ok(n.text.includes("They didn't build an order."));
  no(n.html.includes("Open inquiry"), "no button without APP_URL");
  no(n.text.includes("Allergies"));
});

test("notice: what the customer typed is ESCAPED, so it cannot become markup", () => {
  const n = buildInquiryNotice({ ...ORDER, details: '<script>x</script> & "quotes"', contact_name: "<b>Eve</b>" }, [], null);
  no(n.html.includes("<script>"));
  no(n.html.includes("<b>Eve</b>"));
  ok(n.html.includes("&lt;script&gt;x&lt;/script&gt; &amp; &quot;quotes&quot;"));
});

test("notice: a letter line's own \"H\" note is not repeated; a real note is", () => {
  const n = buildInquiryNotice(ORDER, [...LINES, { name: "Mint Town - Mini", qty: 12, unit_price: 2.4, notes: "half with no mint" }], null);
  no(n.text.includes('("H")'));
  no(n.html.includes("&quot;H&quot;"));
  ok(n.text.includes("(half with no mint)"));
});

test("dates and times read off the string", () => {
  eq(longDate("2026-02-01"), "Sunday, February 1, 2026");
  eq(longDate("nope"), null);
  eq(clockTime("00:30"), "12:30 AM");
  eq(clockTime("12:00:00"), "12:00 PM");
  eq(clockTime("18:45"), "6:45 PM");
});
