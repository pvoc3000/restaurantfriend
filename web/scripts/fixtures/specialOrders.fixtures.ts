// Special Orders — the derived money, the attention queue, the rush fee, the
// recurrence, and the stage grid.
//
// Every case here was checked by BREAKING the rule it covers. What that found,
// and why several of these look over-specified:
//
//   · taxing the UNdiscounted subtotal passes a naive "tax = taxable × rate"
//     test and overcharges every discounted order — hence `discountBeforeTax`;
//   · treating an untyped line as Misc drops 569 real donuts off the kitchen
//     sheet and nothing shows it — hence `untypedLineIsProduction`;
//   · `businessDaysUntil` counting the START day instead of the END day is off
//     by one only across a weekend, which is exactly when a rush fee matters;
//   · `isSettled` written as `=== 0` leaves every overpaid order in the unpaid
//     queue forever.

import { eq, no, ok, test } from "./harness";
import {
  DEFAULT_ATTENTION,
  DEFAULT_RUSH_TERMS,
  STAGES,
  addDays,
  businessDaysUntil,
  customerLabel,
  isProductionLine,
  isSettled,
  isoWeekday,
  lineTotal,
  meansNoAllergy,
  money,
  needsAttention,
  orderTotals,
  readSettings,
  stageState,
  standingMaterializationDates,
  suggestedRushFee,
  suggestedTodo,
  type AttentionOrder,
  type MoneyOrder,
  unschedulableLines,
} from "../../src/lib/specialOrders";

/* -------------------------------------------------------------------------- */
/* Factories                                                                   */
/* -------------------------------------------------------------------------- */

const noMoney: MoneyOrder = {
  tax_rate: null,
  discount_amount: null,
  discount_rate: null,
  delivery_charge: null,
  rush_fee: null,
};

const line = (qty: number, price: number, taxable = true, item_type: string | null = "Raised") => ({
  qty,
  unit_price: price,
  taxable,
  item_type,
});

function order(over: Partial<AttentionOrder> = {}): AttentionOrder {
  return {
    ...noMoney,
    kind: "order",
    status: "order",
    event_date: "2026-08-20",
    fulfillment: "pickup",
    quote_sent_at: null,
    quote_returned_at: null,
    invoice_sent_at: null,
    invoice_paid_at: null,
    order_printed_at: null,
    order_scheduled_at: null,
    delivery_scheduled_at: null,
    receipt_sent_at: null,
    todo: null,
    flag_reason: null,
    ...over,
  };
}

/* ==========================================================================
 * MONEY
 * ========================================================================== */

test("lineTotal multiplies and rounds to cents", () => {
  eq(lineTotal(line(3, 1.75)), 5.25);
  // 6 × 2.175 = 13.05, and a chain that rounded each factor would say 13.02.
  eq(lineTotal({ qty: 6, unit_price: 2.175, taxable: true }), 13.05);
});

test("numeric columns arriving as STRINGS still add up", () => {
  // PostgREST hands `numeric` back as a string often enough that a bare `?? 0`
  // concatenates. Without the coercion in `n`, this subtotal is the string
  // "033" and every figure below it is NaN.
  const strung = [
    { qty: "3" as unknown as number, unit_price: "1.50" as unknown as number, taxable: true },
  ];
  eq(orderTotals(noMoney, strung).subtotal, 4.5);
});

test("subtotal, taxable subtotal and tax", () => {
  const t = orderTotals({ ...noMoney, tax_rate: 0.0975 }, [
    line(10, 2), // 20 taxable
    line(1, 30, false), // 30 not taxable
  ]);
  eq(t.subtotal, 50);
  eq(t.taxableSubtotal, 20);
  eq(t.tax, 1.95);
  eq(t.total, 51.95);
});

test("THE DISCOUNT COMES OFF BEFORE TAX, proportionally", () => {
  // $100 all taxable at 10%, less a 10% discount. Tax is on $90, not $100.
  const t = orderTotals({ ...noMoney, tax_rate: 0.1, discount_rate: 0.1 }, [line(10, 10)]);
  eq(t.discount, 10);
  eq(t.tax, 9); //   <- 10 if the discount were applied after tax
  eq(t.total, 99);
});

test("the discount reduces the TAXABLE base proportionally on a mixed order", () => {
  // Half taxable, 20% off: the taxable base falls to 40, so tax is 4.
  const t = orderTotals({ ...noMoney, tax_rate: 0.1, discount_rate: 0.2 }, [
    line(1, 50),
    line(1, 50, false),
  ]);
  eq(t.discount, 20);
  eq(t.tax, 4);
  eq(t.total, 84);
});

test("a rate and an amount ADD — FileMaker offers both fields at once", () => {
  const t = orderTotals({ ...noMoney, discount_rate: 0.1, discount_amount: 5 }, [line(1, 100)]);
  eq(t.discount, 15);
  eq(t.total, 85);
});

test("delivery and rush are NOT taxed", () => {
  const t = orderTotals(
    { ...noMoney, tax_rate: 0.1, delivery_charge: 30, rush_fee: 25 },
    [line(1, 100)]
  );
  eq(t.tax, 10); //   <- 15.50 if delivery and rush were in the taxable base
  eq(t.total, 165);
});

test("balance is total less payments", () => {
  const t = orderTotals({ ...noMoney }, [line(1, 100)], [{ amount: 40 }, { amount: 10 }]);
  eq(t.paid, 50);
  eq(t.balance, 50);
});

test("a zero-line order does not divide by zero", () => {
  const t = orderTotals({ ...noMoney, tax_rate: 0.1, discount_rate: 0.5 }, []);
  eq(t.subtotal, 0);
  eq(t.tax, 0);
  eq(t.total, 0);
});

test("isSettled: an OVERPAID order is settled", () => {
  const t = orderTotals(noMoney, [line(1, 100)], [{ amount: 120 }]);
  eq(t.balance, -20);
  ok(isSettled(noMoney, t), "a credit balance is not an unpaid order");
});

test("isSettled: ignore_balance keeps a wholesale day out of the queue", () => {
  const t = orderTotals(noMoney, [line(370, 1)]);
  no(isSettled(noMoney, t), "unpaid without the flag");
  ok(isSettled({ ...noMoney, ignore_balance: true }, t), "settled with it");
});

test("money formats a credit with the sign outside the dollar", () => {
  eq(money(-20), "-$20.00");
  eq(money(0), "$0.00");
});

/* ==========================================================================
 * THE KITCHEN LINE
 * ========================================================================== */

test("Misc lines never reach the kitchen, prefix-insensitively", () => {
  no(isProductionLine({ item_type: "Misc" }));
  no(isProductionLine({ item_type: "misc" }));
  // The one real junk variant in 20,605 rows.
  no(isProductionLine({ item_type: "Misc- Cupcake liners" }));
  ok(isProductionLine({ item_type: "Raised" }));
});

test("an UNTYPED line is production, not money", () => {
  // 569 real lines carry no type and they are ordinary donuts. The other way
  // round drops them off the kitchen sheet with nothing on screen to say so.
  ok(isProductionLine({ item_type: null }));
  ok(isProductionLine({ item_type: "  " }));
});

test("unschedulableLines names only the production lines with no link", () => {
  const lines = [
    { name: "Angry Samoa", item_type: "Raised", production_item_id: "a" },
    { name: "Peeps bunny", item_type: "Raised", production_item_id: null },
    // A Misc line with no link is FINE — it never reaches the schedule.
    { name: "Delivery Fee", item_type: "Misc", production_item_id: null },
  ];
  eq(unschedulableLines(lines).map((l) => l.name), ["Peeps bunny"]);
});

/* ==========================================================================
 * DATES AND BUSINESS DAYS
 * ========================================================================== */

test("isoWeekday is 1=Monday, and does not shift west of Greenwich", () => {
  eq(isoWeekday("2026-08-17"), 1); // Monday
  eq(isoWeekday("2026-08-16"), 7); // Sunday
});

test("addDays crosses a month and a year", () => {
  eq(addDays("2026-08-31", 1), "2026-09-01");
  eq(addDays("2026-12-31", 1), "2027-01-01");
  eq(addDays("2026-01-01", -1), "2025-12-31");
});

test("businessDaysUntil skips the weekend", () => {
  // Friday → Monday is ONE business day, not three.
  eq(businessDaysUntil("2026-08-14", "2026-08-17"), 1);
  // Monday → Friday is four.
  eq(businessDaysUntil("2026-08-17", "2026-08-21"), 4);
  eq(businessDaysUntil("2026-08-17", "2026-08-17"), 0);
});

test("businessDaysUntil is NEGATIVE for a past event", () => {
  eq(businessDaysUntil("2026-08-21", "2026-08-17"), -4);
});

/* ==========================================================================
 * THE RUSH FEE
 * ========================================================================== */

test("no rush fee outside the cutoff", () => {
  // Monday, event the following Monday: 5 business days out.
  eq(suggestedRushFee({ event_date: "2026-08-24", today: "2026-08-17", subtotal: 500 }), null);
});

test("inside the cutoff it is the GREATER of the minimum and the rate", () => {
  // Tuesday, event Wednesday: 1 business day.
  eq(suggestedRushFee({ event_date: "2026-08-19", today: "2026-08-18", subtotal: 500 }), 150);
  // A small order takes the $25 floor rather than 30% of $40.
  eq(suggestedRushFee({ event_date: "2026-08-19", today: "2026-08-18", subtotal: 40 }), 25);
});

test("a FRIDAY order for MONDAY is inside the cutoff — the weekend is the point", () => {
  // 1 business day, so it qualifies. A calendar-day rule would say 3 and miss it.
  eq(suggestedRushFee({ event_date: "2026-08-17", today: "2026-08-14", subtotal: 200 }), 60);
});

test("no rush fee on a past event, or with no date, or with no money", () => {
  eq(suggestedRushFee({ event_date: "2026-08-10", today: "2026-08-17", subtotal: 500 }), null);
  eq(suggestedRushFee({ event_date: null, today: "2026-08-17", subtotal: 500 }), null);
  eq(suggestedRushFee({ event_date: "2026-08-18", today: "2026-08-17", subtotal: 0 }), null);
});

test("the terms are configuration, not constants", () => {
  eq(
    suggestedRushFee(
      { event_date: "2026-08-19", today: "2026-08-18", subtotal: 500 },
      { cutoffBusinessDays: 2, minimum: 50, rate: 0.5 }
    ),
    250
  );
  eq(DEFAULT_RUSH_TERMS.minimum, 25);
});

/* ==========================================================================
 * NEEDS ATTENTION
 * ========================================================================== */

const paid = orderTotals(noMoney, [line(1, 100)], [{ amount: 100 }]);
const unpaid = orderTotals(noMoney, [line(1, 100)]);

test("a healthy order needs nothing", () => {
  eq(
    needsAttention(
      order({ event_date: "2026-09-30", order_printed_at: "2026-08-01", order_scheduled_at: "2026-08-01" }),
      "2026-08-17",
      paid
    ),
    null
  );
});

test("a flag OUTRANKS everything the app worked out", () => {
  eq(
    needsAttention(order({ flag_reason: "Customer disputes the flavour" }), "2026-08-17", unpaid),
    "Customer disputes the flavour"
  );
});

test("templates and standing orders are never in the queue", () => {
  eq(needsAttention(order({ kind: "template", status: null }), "2026-08-17", unpaid), null);
  eq(needsAttention(order({ kind: "standing_order", status: null }), "2026-08-17", unpaid), null);
});

test("a cancelled order is never in the queue", () => {
  eq(needsAttention(order({ status: "cancelled" }), "2026-08-17", unpaid), null);
});

test("an unanswered quote is counted from when it was SENT", () => {
  // Sent 6 business days ago, event still far off — the event date is not the
  // clock here, which is the case a naive "event is close" rule would miss.
  const o = order({
    status: "quote",
    event_date: "2026-12-01",
    quote_sent_at: "2026-08-07",
  });
  eq(needsAttention(o, "2026-08-17", unpaid), "Quote sent 2026-08-07 with no answer");
});

test("an answered quote is not chased", () => {
  const o = order({
    status: "quote",
    event_date: "2026-12-01",
    quote_sent_at: "2026-08-07",
    quote_returned_at: "2026-08-08",
  });
  eq(needsAttention(o, "2026-08-17", unpaid), null);
});

test("paid and unprinted, event close", () => {
  eq(
    needsAttention(order({ event_date: "2026-08-18" }), "2026-08-17", paid),
    "Paid and unprinted, and the event is close"
  );
});

test("printed but unscheduled is the NEXT sentence, not both at once", () => {
  eq(
    needsAttention(order({ event_date: "2026-08-18", order_printed_at: "2026-08-17" }), "2026-08-17", paid),
    "Printed but production is not scheduled"
  );
});

test("an unpaid order close to its event names the balance", () => {
  const o = order({ status: "invoice", event_date: "2026-08-20", invoice_sent_at: "2026-08-10" });
  eq(needsAttention(o, "2026-08-17", unpaid), "Event is close and $100.00 is unpaid");
});

test("…and says so differently when no invoice went out at all", () => {
  const o = order({ status: "invoice", event_date: "2026-08-20" });
  eq(needsAttention(o, "2026-08-17", unpaid), "Event is close and no invoice has been sent");
});

test("a delivery with no booking, close to the event", () => {
  const o = order({
    event_date: "2026-08-18",
    fulfillment: "delivery",
    order_printed_at: "2026-08-01",
    order_scheduled_at: "2026-08-01",
  });
  eq(needsAttention(o, "2026-08-17", paid), "Delivery order with no delivery scheduled");
});

test("a PICKUP order is never asked about a delivery booking", () => {
  const o = order({
    event_date: "2026-08-18",
    fulfillment: "pickup",
    order_printed_at: "2026-08-01",
    order_scheduled_at: "2026-08-01",
  });
  eq(needsAttention(o, "2026-08-17", paid), null);
});

test("yesterday's event wants its receipt", () => {
  eq(
    needsAttention(order({ event_date: "2026-08-16" }), "2026-08-17", paid),
    "Event has passed — send the receipt"
  );
});

test("a past event that is still unpaid says THAT instead", () => {
  eq(
    needsAttention(order({ event_date: "2026-08-16" }), "2026-08-17", unpaid),
    "Event has passed and $100.00 is unpaid"
  );
});

test("a past, settled, receipted order is finished", () => {
  eq(
    needsAttention(order({ event_date: "2026-08-16", receipt_sent_at: "2026-08-16" }), "2026-08-17", paid),
    null
  );
});

test("an ignore_balance wholesale day is never chased for money", () => {
  const o = order({ ...noMoney, ignore_balance: true, event_date: "2026-08-16", receipt_sent_at: "2026-08-16" });
  eq(needsAttention(o, "2026-08-17", unpaid), null);
});

test("thresholds are configuration", () => {
  const o = order({ status: "quote", event_date: "2026-12-01", quote_sent_at: "2026-08-14" });
  // 1 business day old: quiet at the default 5, loud at a threshold of 1.
  eq(needsAttention(o, "2026-08-17", unpaid), null);
  eq(
    needsAttention(o, "2026-08-17", unpaid, { ...DEFAULT_ATTENTION, quoteUnansweredDays: 1 }),
    "Quote sent 2026-08-14 with no answer"
  );
});

/* ==========================================================================
 * THE SUGGESTED TO-DO
 * ========================================================================== */

/* -- the suggestion asks whether ITS OWN document has gone out ------------ */

test("a quote that is out and unanswered suggests NOTHING", () => {
  // Order 9882 verbatim — status `quote`, quoted on the 12th for the 22nd. It
  // used to suggest "Respond to Email/Call", which is what you do for a LEAD
  // that has written in, not for a quote sitting with a customer. There is no
  // action for us while the ball is in their court, and a to-do on every such
  // row is the noise that teaches people to ignore the column.
  eq(
    suggestedTodo(
      order({ status: "quote", quote_sent_at: "2026-08-12", event_date: "2026-08-22" }),
      "2026-08-20"
    ),
    null
  );
});

test("an invoice that is out and unpaid suggests NOTHING until the event passes", () => {
  // Order 9863 verbatim — invoiced on the 6th for the 22nd, and it suggested
  // "Send Invoice" for an invoice that had gone out sixteen days earlier.
  const o = {
    status: "invoice" as const,
    quote_sent_at: "2026-08-06",
    quote_returned_at: "2026-08-06",
    invoice_sent_at: "2026-08-06",
  };
  eq(suggestedTodo(order({ ...o, event_date: "2026-08-22" }), "2026-08-20"), null);
  // …and once it has, FileMaker's own word for it.
  eq(suggestedTodo(order({ ...o, event_date: "2026-08-18" }), "2026-08-20"), "Invoice Overdue!");
});

test("the send is still suggested when the document has NOT gone out", () => {
  eq(suggestedTodo(order({ status: "quote", event_date: "2026-08-22" }), "2026-08-20"), "Send Quote");
  eq(
    suggestedTodo(
      order({ status: "invoice", quote_returned_at: "a", event_date: "2026-08-22" }),
      "2026-08-20"
    ),
    "Send Invoice"
  );
});

test("a lead with a quote already out is their move, not an invoice", () => {
  // It used to answer "Send Invoice" — you do not invoice a quote nobody has
  // agreed to.
  eq(suggestedTodo(order({ status: "lead", quote_sent_at: "2026-08-12" }), "2026-08-20"), null);
});

test("without a date the chase never fires, which is quiet rather than wrong", () => {
  eq(
    suggestedTodo(order({ status: "invoice", invoice_sent_at: "a", event_date: "2020-01-01" })),
    null
  );
});

test("suggestedTodo walks the ladder", () => {
  eq(suggestedTodo(order({ status: "lead" })), "Send Quote");
  eq(suggestedTodo(order({ status: "quote", quote_returned_at: "2026-08-01" })), "Send Invoice");
  eq(suggestedTodo(order({ status: "invoice", invoice_paid_at: "2026-08-01" })), "Print Order");
  eq(suggestedTodo(order({ status: "order", order_printed_at: "2026-08-01" })), "Schedule Production");
  eq(
    suggestedTodo(order({ status: "order", order_printed_at: "2026-08-01", order_scheduled_at: "2026-08-01" })),
    "Send Receipt"
  );
  eq(
    suggestedTodo(
      order({
        status: "order",
        order_printed_at: "2026-08-01",
        order_scheduled_at: "2026-08-01",
        receipt_sent_at: "2026-08-02",
      })
    ),
    null
  );
});

test("a flagged order's suggestion is Resolve Issue", () => {
  eq(suggestedTodo(order({ flag_reason: "wrong date" })), "Resolve Issue");
});

/* ==========================================================================
 * STANDING ORDERS
 * ========================================================================== */

const knottedMonThu = { standing_days: [1, 2, 3, 4], starts_on: null, ends_on: null, paused: false };

test("Cafe Knotted M–Th over a fortnight", () => {
  eq(standingMaterializationDates(knottedMonThu, "2026-08-17", "2026-08-30"), [
    "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
  ]);
});

test("a PAUSED standing order makes nothing", () => {
  eq(standingMaterializationDates({ ...knottedMonThu, paused: true }, "2026-08-17", "2026-08-30"), []);
});

test("starts_on and ends_on clip the window at both ends", () => {
  eq(
    standingMaterializationDates(
      { ...knottedMonThu, starts_on: "2026-08-19", ends_on: "2026-08-25" },
      "2026-08-17",
      "2026-08-30"
    ),
    ["2026-08-19", "2026-08-20", "2026-08-24", "2026-08-25"]
  );
});

test("a standing order with no days makes nothing", () => {
  eq(standingMaterializationDates({ ...knottedMonThu, standing_days: null }, "2026-08-17", "2026-08-30"), []);
  eq(standingMaterializationDates({ ...knottedMonThu, standing_days: [] }, "2026-08-17", "2026-08-30"), []);
});

test("Yeastie Boys' Sunday-only order picks Sundays and nothing else", () => {
  eq(
    standingMaterializationDates(
      { standing_days: [7], starts_on: null, ends_on: null, paused: false },
      "2026-08-17",
      "2026-08-30"
    ),
    ["2026-08-23", "2026-08-30"]
  );
});

/* ==========================================================================
 * THE STAGE GRID
 * ========================================================================== */

const stage = (key: string) => STAGES.find((s) => s.key === key)!;

test("a stamped stage is done whatever else is true", () => {
  eq(stageState(order({ quote_sent_at: "2026-08-01", event_date: "2026-08-01" }), stage("quote_sent"), "2026-08-17"), "done");
});

test("waiting on the customer is YELLOW, and only after we sent something", () => {
  // Quote sent, event far off: theirs to answer.
  eq(
    stageState(order({ status: "quote", quote_sent_at: "2026-08-01", event_date: "2026-12-01" }), stage("quote_returned"), "2026-08-17"),
    "waiting"
  );
  // Nothing sent: not waiting on anyone, so the cell is simply empty.
  eq(stageState(order({ event_date: "2026-12-01" }), stage("quote_returned"), "2026-08-17"), null);
});

test("close to the event, waiting on THEM is still waiting", () => {
  // Changed 2026-08-20 on Mark's report of order 9882 — quoted on the 12th for
  // an event on the 22nd, and the strip painted it RED. It was `close || past`,
  // and `close` is `printWithinDays`, two days, so every quote still out inside
  // 48 hours read as overdue when the honest reading is that we are waiting on
  // somebody else.
  eq(
    stageState(order({ status: "quote", quote_sent_at: "2026-08-01", event_date: "2026-08-18" }), stage("quote_returned"), "2026-08-17"),
    "waiting"
  );
});

test("…but once the event has PASSED, waiting is a euphemism", () => {
  eq(
    stageState(order({ status: "quote", quote_sent_at: "2026-08-01", event_date: "2026-08-16" }), stage("quote_returned"), "2026-08-17"),
    "overdue"
  );
});

test("an unpaid invoice reads the same way", () => {
  // Order 9863: invoiced on the 6th for an event on the 22nd.
  const sent = {
    status: "invoice" as const,
    quote_sent_at: "a",
    quote_returned_at: "a",
    invoice_sent_at: "2026-08-06",
  };
  eq(stageState(order({ ...sent, event_date: "2026-08-18" }), stage("invoice_paid"), "2026-08-17"), "waiting");
  eq(stageState(order({ ...sent, event_date: "2026-08-16" }), stage("invoice_paid"), "2026-08-17"), "overdue");
});

test("OUR move is still overdue as the event nears — only theirs changed", () => {
  // `quote_sent`, `invoice_sent`, `order_printed` and `order_scheduled` are all
  // things WE do, and `close || past` is right for them.
  eq(stageState(order({ event_date: "2026-08-18" }), stage("quote_sent"), "2026-08-17"), "overdue");
  eq(stageState(order({ event_date: "2026-08-18" }), stage("order_printed"), "2026-08-17"), "overdue");
});

test("a pickup order's delivery cell is blank, not overdue", () => {
  eq(stageState(order({ event_date: "2026-08-18" }), stage("delivery_scheduled"), "2026-08-17"), null);
  eq(
    stageState(order({ event_date: "2026-08-18", fulfillment: "delivery" }), stage("delivery_scheduled"), "2026-08-17"),
    "overdue"
  );
});

test("a cancelled order's empty cells stay empty", () => {
  eq(stageState(order({ status: "cancelled", event_date: "2026-08-18" }), stage("order_printed"), "2026-08-17"), null);
});

/* ==========================================================================
 * SETTINGS AND NAMES
 * ========================================================================== */

test("settings fall back FIELD BY FIELD, not as a whole object", () => {
  // An org that has set only the horizon must keep the rush terms. `?? DEFAULT`
  // on the object would wipe them.
  const s = readSettings({ special_orders: { horizon_days: 21 } });
  eq(s.horizonDays, 21);
  eq(s.rush.minimum, 25);
  eq(s.attention.printWithinDays, 2);
});

test("settings read numbers that arrive as strings", () => {
  eq(readSettings({ special_orders: { horizon_days: "30" } }).horizonDays, 30);
});

test("an org with no settings at all still works", () => {
  eq(readSettings({}).horizonDays, 14);
});

test("customerLabel puts the company first and keeps the person", () => {
  eq(customerLabel({ first_name: "Ji-Yeon", last_name: "Kim", company: "Cafe Knotted" }), "Cafe Knotted (Ji-Yeon Kim)");
  eq(customerLabel({ first_name: "Alexandra", last_name: "David", company: null }), "Alexandra David");
  eq(customerLabel({ first_name: null, last_name: null, company: "Yeastie Boys" }), "Yeastie Boys");
  eq(customerLabel(null), "—");
});

/* ==========================================================================
 * meansNoAllergy — the chip that must not cry wolf
 * ========================================================================== */

test("meansNoAllergy: the six spellings that cover 446 of 835 real orders", () => {
  for (const v of ["no", "none", "n/a", "na", "nope", "no allergies"]) {
    ok(meansNoAllergy(v), v);
  }
  eq(meansNoAllergy("  NONE. "), true, "cased, spaced and punctuated");
  eq(meansNoAllergy(null), true, "null");
  eq(meansNoAllergy("   "), true, "blank");
});

test("meansNoAllergy: a real allergy is NEVER suppressed", () => {
  for (const v of ["nuts", "dairy", "peanuts", "egg", "tree nuts", "nut allergy", "vegan"]) {
    no(meansNoAllergy(v), v);
  }
});

test("meansNoAllergy: 'no nuts' is an ALLERGY, not a no", () => {
  // The whole reason this is a whole-string match against a closed list rather
  // than a substring test. Getting this backwards sends somebody to hospital.
  no(meansNoAllergy("no nuts"), "no nuts");
  no(meansNoAllergy("none except dairy"), "none except dairy");
  no(meansNoAllergy("no gluten please"), "no gluten please");
});

test("meansNoAllergy: anything unrecognised is SHOWN", () => {
  // Fails safe: a new way of writing nothing costs one redundant chip, a new
  // way of writing an allergy costs a great deal more.
  no(meansNoAllergy("¯\\_(ツ)_/¯"), "unknown");
  no(meansNoAllergy("ask the customer"), "unknown phrase");
});
