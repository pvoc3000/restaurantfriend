// `lib/createSpecialOrder` — the pure half: where the order goes.
//
// `createSpecialOrder` itself does I/O and is not fixtured; `deliveryFields` is
// the one RULE inside it that can be wrong on its own, and it is wrong in a way
// nothing on screen would show: an order stored as a pickup carrying a delivery
// address has no Delivery tab to display that address on.

import { test, eq } from "./harness";
import { deliveryFields } from "../../src/lib/createSpecialOrder";

test("a delivery keeps its address", () => {
  eq(deliveryFields("delivery", "1638 Colorado Blvd"), {
    fulfillment: "delivery",
    delivery_address: "1638 Colorado Blvd",
  });
});

test("a pickup DROPS an address that was typed and then switched away from", () => {
  // The dialog keeps what you typed when you flip back to Pickup, so that a
  // mis-tap does not silently delete an address. This is what makes that safe.
  eq(deliveryFields("pickup", "1638 Colorado Blvd"), {
    fulfillment: "pickup",
    delivery_address: null,
  });
});

test("an address is trimmed, and whitespace is nothing", () => {
  eq(deliveryFields("delivery", "  1638 Colorado Blvd  ").delivery_address, "1638 Colorado Blvd");
  eq(deliveryFields("delivery", "   ").delivery_address, null);
  eq(deliveryFields("delivery", "").delivery_address, null);
  eq(deliveryFields("delivery", null).delivery_address, null);
});

test("anything that is not `delivery` is `pickup`, because the column is checked", () => {
  // `fulfillment text not null check (fulfillment in ('pickup','delivery'))`.
  // A value passed straight through would be a check-constraint refusal, which
  // is the one failure an inline cell cannot explain.
  eq(deliveryFields(undefined, null).fulfillment, "pickup");
  eq(deliveryFields(null, null).fulfillment, "pickup");
  eq(deliveryFields("", null).fulfillment, "pickup");
  eq(deliveryFields("Delivery", null).fulfillment, "pickup", "the stored value is lower case");
  eq(deliveryFields("shipping", null).fulfillment, "pickup");
});

test("…and a mode that falls back to pickup takes no address with it", () => {
  eq(deliveryFields("Delivery", "1638 Colorado Blvd").delivery_address, null);
});
