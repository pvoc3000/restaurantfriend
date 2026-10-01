// The delivery quote request (Mark, 2026-10-01): FileMaker's script as a
// template, filled from the order's delivery fields.

import { test, eq, ok, no } from "./harness";
import {
  buildDeliveryQuoteEmail,
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
  delivery_window_start: "16:30:00",
  delivery_window_end: "18:30:00",
  pickup_address: "543 S Broadway, Los Angeles, CA 90013",
};

test("the request reads like FileMaker's, signed by the org, never hardcoded", () => {
  const { subject, body } = buildDeliveryQuoteEmail(facts, {}, "Donut Friend");
  eq(subject, "Delivery quote request — order #SO-10093, 10/3/2026");
  ok(body.startsWith("Dear DeliverLA,\n\n"));
  ok(body.includes("Donut Friend would like to request a quote for a delivery on 10/3/2026."));
  ok(body.includes("Pickup location: 543 S Broadway, Los Angeles, CA 90013\n"));
  ok(body.includes("Pieces: 4\nWeight: 12 lbs\nOrder #: SO-10093\n"));
  ok(body.includes("Destination: 1000 Vin Scully Ave Los Angeles, CA 90012\n"), "the address on one line");
  ok(body.includes("Delivery time: 6:30 PM\n"), "the window's END, as FileMaker sent");
  ok(body.trimEnd().endsWith("Thank you!\n\nDonut Friend"));
  no(body.includes("{"), "every token filled");
});

test("a template in Settings replaces the default; a blank one does not", () => {
  const custom = { special_orders: { email: { delivery_quote: { subject: "Quote? {number}", body: "Hi {delivery_company} — {delivery_window}" } } } };
  eq(buildDeliveryQuoteEmail(facts, custom, "DF"), { subject: "Quote? SO-10093", body: "Hi DeliverLA — between 4:30 PM and 6:30 PM" });
  const blank = { special_orders: { email: { delivery_quote: { subject: " ", body: "" } } } };
  eq(buildDeliveryQuoteEmail(facts, blank, "DF").subject, "Delivery quote request — order #SO-10093, 10/3/2026");
});

test("an unknown field prints as nothing after its label, so the carrier sees it is unknown", () => {
  const v = deliveryQuoteVars({ ...facts, delivery_boxes: null, delivery_weight_lbs: null, delivery_window_end: null, delivery_window_start: null }, "DF");
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
