// `lib/createSpecialOrder` — the pure half: where the order goes.
//
// `createSpecialOrder` itself does I/O and is not fixtured; `deliveryFields` is
// the one RULE inside it that can be wrong on its own, and it is wrong in a way
// nothing on screen would show: an order stored as a pickup carrying a delivery
// address has no Delivery tab to display that address on.

import { test, eq } from "./harness";
import { deliveryFields, startingState, takenByFields } from "../../src/lib/createSpecialOrder";
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

/* -------------------------------------------------------------------------
 * Who took the order (2026-09-21)
 *
 * Two columns say who took an order and only one of them can be right: 053's
 * link, and FileMaker's text. The record's own cell clears the text when you
 * pick a name; the create path has to make the same trade, or an order is born
 * in the state the cell exists to prevent.
 * ---------------------------------------------------------------------- */

test("the signed-in member's EMPLOYEE is linked, and the text is cleared", () => {
  eq(takenByFields("emp-1", "Mark Trombino"), {
    taken_by_employee_id: "emp-1",
    // Not "Mark Trombino" as well: `TakenBy` renders the link where it has
    // one, so a second copy of the name would be invisible AND able to go
    // stale the day that employee's name is corrected.
    taken_by: null,
  });
});

test("no employee to link keeps the typed NAME, which is then the only answer", () => {
  // `employees.user_id` is nullable — an owner or a bookkeeper with an app
  // login and no HR record has no employee to be.
  eq(takenByFields(null, "Mark Trombino"), {
    taken_by_employee_id: null,
    taken_by: "Mark Trombino",
  });
});

test("neither, rather than an empty string, when there is nobody to name", () => {
  eq(takenByFields(null, null), { taken_by_employee_id: null, taken_by: null });
  eq(takenByFields(null, "   "), { taken_by_employee_id: null, taken_by: null });
  eq(takenByFields(null, undefined), { taken_by_employee_id: null, taken_by: null });
});

test("a name is trimmed on the way in", () => {
  eq(takenByFields(null, "  Traci  ").taken_by, "Traci");
});
