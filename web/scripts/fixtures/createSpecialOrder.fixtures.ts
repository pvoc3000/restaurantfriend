// `lib/createSpecialOrder` — the pure half: where the order goes.
//
// `createSpecialOrder` itself does I/O and is not fixtured; `deliveryFields` is
// the one RULE inside it that can be wrong on its own, and it is wrong in a way
// nothing on screen would show: an order stored as a pickup carrying a delivery
// address has no Delivery tab to display that address on.

import { test, eq } from "./harness";
import { deliveryFields, startingState } from "../../src/lib/createSpecialOrder";
import { STANDING_STATUS_OPTIONS } from "../../src/lib/specialOrders";

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

/* -------------------------------------------------------------------------
 * What a new record starts as (migration 112, 2026-09-20)
 *
 * The biconditional is a CHECK, and a CHECK refusal is the one failure the app
 * cannot put into words — so getting this wrong is an insert that fails with a
 * message about a constraint nobody was thinking about.
 * ---------------------------------------------------------------------- */

test("an order starts as a lead with something to do", () => {
  eq(startingState("order"), { status: "lead", todo: "Respond to Email/Call" });
});

test("a standing order starts INVOICED, which is the safe one of the two", () => {
  // Its days arrive unpaid and wait for the money before a kitchen night.
  // `order` is the deliberate choice for an account billed in arrears.
  eq(startingState("standing_order"), { status: "invoice", todo: "Send Invoice" });
});

test("a template has NEITHER, because it has no days to prototype", () => {
  // And the widened constraint still refuses one: 112 added `standing_order`
  // to decision 3's biconditional and stopped there.
  eq(startingState("template"), { status: null, todo: null });
});

test("the standing-order default is one the record's own picker offers", () => {
  // Two vocabularies that disagree is a record you cannot edit back to the
  // state it was created in.
  const offered = STANDING_STATUS_OPTIONS.map((o) => o.value);
  eq(offered.includes(startingState("standing_order").status ?? ""), true, offered.join("/"));
});
