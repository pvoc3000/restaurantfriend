// The delivery quote request (Mark, 2026-10-01): FileMaker's script as a
// template, filled from the order's delivery fields.

import { test, eq, ok, no } from "./harness";
import {
  buildCarrierEmail,
  deliveryQuoteVars,
  shopStreetAddress,
  type DeliveryQuoteFacts,
} from "../../src/lib/specialOrderDocs";

const facts: DeliveryQuoteFacts = {
  number: "SO-10093",
  event_date: "2026-10-03",
  delivery_company: "DeliverLA",
  delivery_address: "1000 Vin Scully Ave\nLos Angeles, CA 90012",
  delivery_boxes: 4,
  delivery_weight_lbs: 12,
  // The window is the ready time to the event time (170).
  ready_by_time: "16:30:00",
  event_time: "18:30:00",
  pickup_address: "543 S Broadway, Los Angeles, CA 90013",
};

test("the request reads like FileMaker's, signed by the org, never hardcoded", () => {
  const { subject, body } = buildCarrierEmail("delivery_quote", facts, {}, "Donut Friend");
  eq(subject, "Delivery quote request — order #SO-10093, 10/3/2026");
  ok(body.startsWith("Dear DeliverLA,\n\n"));
  ok(body.includes("Donut Friend would like to request a quote for a delivery on 10/3/2026."));
  ok(body.includes("Pickup location: 543 S Broadway, Los Angeles, CA 90013\n"));
  ok(body.includes("Pieces: 4\nWeight: 12 lbs\nOrder #: SO-10093\n"));
  ok(body.includes("Destination: 1000 Vin Scully Ave Los Angeles, CA 90012\n"), "the address on one line");
  ok(body.includes("Delivery time: 6:30 PM\n"), "the window's END — the event time — as FileMaker sent");
  ok(body.trimEnd().endsWith("Thank you!\n\nDonut Friend"));
  no(body.includes("{"), "every token filled");
});

test("a template in Settings replaces the default; a blank one does not", () => {
  const custom = { special_orders: { email: { delivery_quote: { subject: "Quote? {number}", body: "Hi {delivery_company} — {delivery_window}" } } } };
  eq(buildCarrierEmail("delivery_quote", facts, custom, "DF"), { subject: "Quote? SO-10093", body: "Hi DeliverLA — between 4:30 PM and 6:30 PM" });
  const blank = { special_orders: { email: { delivery_quote: { subject: " ", body: "" } } } };
  eq(buildCarrierEmail("delivery_quote", facts, blank, "DF").subject, "Delivery quote request — order #SO-10093, 10/3/2026");
});

test("an unknown field prints as nothing after its label, so the carrier sees it is unknown", () => {
  const v = deliveryQuoteVars({ ...facts, delivery_boxes: null, delivery_weight_lbs: null, event_time: null, ready_by_time: null }, "DF");
  eq(v.boxes, "");
  eq(v.weight, "");
  eq(v.delivery_time, "");
  eq(v.delivery_window, "");
});

test("shopStreetAddress: the shop's SHIPPING address, on one line", () => {
  eq(
    shopStreetAddress({ shipping: { street1: "5107 York Blvd", city: "Los Angeles", state: "CA", zip: "90042" }, billing: { street1: "x" } }),
    "5107 York Blvd, Los Angeles, CA 90042"
  );
  eq(shopStreetAddress({ billing: { street1: "x" } }), null);
  eq(shopStreetAddress(null), null);
});

test("the delivery REQUEST books it: pickup time and phone, contact, notification emails", () => {
  const { subject, body } = buildCarrierEmail(
    "delivery_request",
    {
      ...facts,
      pickup_phone: "(213) 908-2743",
      contact_name: "Jane Doe",
      contact_phone: "(323) 555-0100",
      customer_email: "jane@example.com",
      org_email: "info@donutfriend.com",
    },
    {},
    "Donut Friend"
  );
  eq(subject, "Delivery request — order #SO-10093, 10/3/2026");
  ok(body.includes("Donut Friend would like to schedule a delivery for 10/3/2026."));
  ok(body.includes("Pickup time: 4:30 PM\nPickup phone: (213) 908-2743\n"), "the window's START, as FileMaker sent");
  ok(body.includes("Contact: Jane Doe\nContact phone: (323) 555-0100\n"));
  ok(body.includes("Email notifications:\ninfo@donutfriend.com, jane@example.com\n"));
  ok(body.includes("Please respond with a tracking number and cost."));
  no(body.includes("{"), "every token filled");
});

test("notification emails: the org's first, no duplicate, no dangling comma", () => {
  eq(deliveryQuoteVars({ ...facts, org_email: "info@df.com", customer_email: null }, "DF").notify_emails, "info@df.com");
  eq(deliveryQuoteVars({ ...facts, org_email: "Info@DF.com", customer_email: "info@df.com" }, "DF").notify_emails, "Info@DF.com");
  eq(deliveryQuoteVars({ ...facts }, "DF").notify_emails, "");
});
