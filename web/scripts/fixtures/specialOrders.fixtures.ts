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
  isRefundablePayment,
  KIND_COMMAND_NOUN,
  KIND_LABEL,
  contactCopyPlan,
  customerContactName,
  DEFAULT_ATTENTION,
  DEFAULT_RUSH_TERMS,
  STAGES,
  addDays,
  businessDaysUntil,
  customerLabel,
  isProductionLine,
  isSettled,
  countsAsOwed,
  matchesKindFilter,
  ORDER_KIND_FILTERS,
  isoWeekday,
  lineTotal,
  meansNoAllergy,
  money,
  needsAttention,
  orderTotals,
  readSettings,
  stageState,
  materializationSummary,
  standingMaterializationDates,
  resolveRushFee,
  suggestedRushFee,
  topUpWindow,
  isPersonFlag,
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
  rush_rate: null,
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

test("a past QUOTE is not 'unpaid' — it was never billed", () => {
  eq(needsAttention(order({ status: "quote", event_date: "2026-08-16" }), "2026-08-17", unpaid), null);
  eq(needsAttention(order({ status: "lead", event_date: "2026-08-16" }), "2026-08-17", unpaid), null);
  eq(
    needsAttention(order({ status: "invoice", event_date: "2026-08-16" }), "2026-08-17", unpaid),
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

test("suggestedTodo: a delivery books its courier before it is printed (2026-09-22)", () => {
  eq(suggestedTodo(order({ status: "invoice", invoice_paid_at: "2026-08-01", fulfillment: "delivery" })), "Schedule Delivery");
  eq(suggestedTodo(order({ status: "order", fulfillment: "delivery" })), "Schedule Delivery");
  eq(
    suggestedTodo(order({ status: "order", fulfillment: "delivery", delivery_scheduled_at: "2026-08-01" })),
    "Print Order",
    "booked → the printer is next"
  );
  eq(
    suggestedTodo(order({ status: "order", fulfillment: "delivery", order_printed_at: "2026-08-01" })),
    "Schedule Production",
    "an order already printed is not sent back for its courier"
  );
  eq(suggestedTodo(order({ status: "order", fulfillment: "pickup" })), "Print Order");
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

test("a rush RATE resolves to the greater of the percentage and the floor", () => {
  // Mark's rule, 2026-09-22: "either the user facing percentage (i.e. 35%), or
  // $25, whichever is greater". Terms: 35% with a $25 minimum.
  const terms = { cutoffBusinessDays: 2, minimum: 25, rate: 0.35 };
  const fee = (o: Partial<typeof noMoney> & { rush_rate?: number | null }, subtotal: number) =>
    resolveRushFee({ rush_fee: null, ...o } as never, subtotal, terms);

  eq(fee({ rush_rate: 0.35 }, 800), 280, "35% of 800 beats the floor");
  eq(fee({ rush_rate: 0.35 }, 50), 25, "35% of 50 is 17.50, so the floor wins");
  // The crossover, both sides: 25 / 0.35 = 71.43.
  eq(fee({ rush_rate: 0.35 }, 71), 25);
  eq(fee({ rush_rate: 0.35 }, 72), 25.2);

  // NO RATE: the typed amount is the fee, exactly as before 118.
  eq(resolveRushFee({ rush_fee: 40, rush_rate: null }, 800, terms), 40);
  eq(resolveRushFee({ rush_fee: 40 } as never, 800, terms), 40, "absent reads as null");

  // A RATE WINS — it does not add to the amount, which is where this pair
  // differs from discount_amount/discount_rate.
  eq(resolveRushFee({ rush_fee: 40, rush_rate: 0.35 }, 800, terms), 280);

  // ZERO IS A RATE, and it means no fee — never the floor, or saying "no rush
  // fee on this one" would charge $25 for saying it.
  eq(resolveRushFee({ rush_fee: 40, rush_rate: 0 }, 800, terms), 0);

  // A lead with no lines: the floor, which is what a rate can mean before
  // anybody has priced anything.
  eq(fee({ rush_rate: 0.35 }, 0), 25);
});

test("the rush rate reaches the TOTAL, and is not taxed", () => {
  const terms = { cutoffBusinessDays: 2, minimum: 25, rate: 0.35 };
  // $100 of taxable donuts at 10% tax, 35% rush.
  const t = orderTotals(
    { ...noMoney, tax_rate: 0.1, rush_rate: 0.35 },
    [line(10, 10)],
    [],
    terms
  );
  eq(t.subtotal, 100);
  eq(t.rushFee, 35);
  eq(t.tax, 10, "tax is on the goods alone — delivery and rush are services");
  eq(t.total, 145);
});

test("a flagged order's suggestion is Resolve Issue", () => {
  eq(suggestedTodo(order({ flag_reason: "wrong date" })), "Resolve Issue");
  // Absent `flag_source` reads as a person's flag, which is what keeps every
  // caller that has not been taught to select it on pre-116 behaviour.
  eq(suggestedTodo(order({ flag_reason: "wrong date", flag_source: "person" })), "Resolve Issue");
});

test("a SYSTEM flag is news, so the ladder keeps suggesting (116)", () => {
  // "Resolve Issue" over "Quote approved online by Jane Doe" calls good news a
  // problem. The suggestion is the step that news unlocks.
  eq(
    suggestedTodo(
      order({
        status: "quote",
        quote_returned_at: "2026-08-01",
        flag_reason: "Quote approved online by Jane Doe",
        flag_source: "system",
      })
    ),
    "Send Invoice"
  );
  // A new inquiry, likewise: still a lead with no quote out.
  eq(
    suggestedTodo(order({ status: "lead", flag_reason: "New Inquiry", flag_source: "system" })),
    "Send Quote"
  );
});

test("isPersonFlag: the two columns, and what absent means", () => {
  ok(isPersonFlag({ flag_reason: "wrong date" }), "no source is a person's flag");
  ok(isPersonFlag({ flag_reason: "wrong date", flag_source: "person" }));
  no(isPersonFlag({ flag_reason: "New Inquiry", flag_source: "system" }));
  // No flag at all is not a person's flag — it is no flag.
  no(isPersonFlag({ flag_reason: null, flag_source: null }));
  no(isPersonFlag({ flag_reason: null, flag_source: "person" }));
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

/* --------------------------------------------------------------------------
 * THE TWO RULES MUST AGREE — this half in TypeScript, migration 099's half in
 * SQL. Both of these were taken off the HARNESS, by running the real function
 * against the same standing orders, so a change to either side that stops them
 * agreeing turns one of these red rather than showing up as a record saying
 * "next 14 days: 4 orders" over a list that holds three.
 * -------------------------------------------------------------------------- */

test("099 and this agree: Mon/Thu over 2026-09-08 … 2026-09-22", () => {
  // The harness made exactly these four, in this order, and numbered them
  // 10000–10003.
  eq(
    standingMaterializationDates(
      { standing_days: [1, 4], starts_on: null, ends_on: null, paused: false },
      "2026-09-08",
      "2026-09-22"
    ),
    ["2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21"]
  );
});

test("099 and this agree: a starts_on in the PAST never backfills", () => {
  // The window opens at `from`, NOT at `starts_on`. Getting this backwards is
  // how Cafe Knotted's sixteen already-gone days would be ordered again.
  eq(
    standingMaterializationDates(
      { standing_days: [1, 2, 3, 4, 5, 6, 7], starts_on: "2020-01-01", ends_on: "2026-09-11", paused: false },
      "2026-09-08",
      "2026-09-22"
    ),
    ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]
  );
});

test("099 and this agree: December Mon/Thu is nine days", () => {
  eq(
    standingMaterializationDates(
      { standing_days: [1, 4], starts_on: null, ends_on: null, paused: false },
      "2026-12-01",
      "2026-12-31"
    ).length,
    9
  );
});

/* --------------------------------------------------------------------------
 * THE HORIZON WINDOW
 * -------------------------------------------------------------------------- */

test("the horizon runs from TODAY, inclusive, to today + n", () => {
  eq(topUpWindow("2026-09-08", 14), { from: "2026-09-08", through: "2026-09-22" });
});

test("a horizon of zero still covers today — tonight's bake is not optional", () => {
  eq(topUpWindow("2026-09-08", 0), { from: "2026-09-08", through: "2026-09-08" });
});

test("a nonsense horizon out of orgs.settings cannot reach backwards", () => {
  // `horizon_days` is a number somebody types into /settings. Negative, it
  // would ask 099 for a range whose end precedes its start — which makes
  // nothing, but says something false on the record's own "next N days" line.
  eq(topUpWindow("2026-09-08", -5), { from: "2026-09-08", through: "2026-09-08" });
  eq(topUpWindow("2026-09-08", 14.7), { from: "2026-09-08", through: "2026-09-22" });
});

/* --------------------------------------------------------------------------
 * THE RECEIPT'S SENTENCE — "nothing was made" is the ANSWER, not a failure
 * -------------------------------------------------------------------------- */

test("a full horizon says the days already exist rather than going quiet", () => {
  eq(
    materializationSummary({ ok: true, created: 0, existing: 8 }),
    "Nothing to make — all 8 days in that range already exist."
  );
});

test("an empty range says so, and does not claim anything already exists", () => {
  eq(materializationSummary({ ok: true, created: 0, existing: 0 }), "There were no days to make in that range.");
});

test("what it made, and what it found", () => {
  eq(materializationSummary({ ok: true, created: 1, existing: 0 }), "Made 1 order.");
  eq(materializationSummary({ ok: true, created: 4, existing: 3 }), "Made 4 orders, and 3 already existed.");
});

test("below supervisor+ the sentence says why, because the receipt is an OK", () => {
  // 099 answers staff with `ok: true, skipped: "role"` so the list does not
  // break for them. A summary reading "there were no days to make" would then
  // be a false explanation of a permission refusal.
  eq(
    materializationSummary({ ok: true, created: 0, existing: 0, skipped: "role" }),
    "You do not have permission to create orders, so nothing was made."
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

test("countsAsOwed: only a BILLED order is money owed, never a lead or a quote", () => {
  const o = (status: string | null, kind = "order", ignore_balance = false) => ({ kind, status, ignore_balance });
  ok(countsAsOwed(o("invoice")));
  ok(countsAsOwed(o("order")));
  no(countsAsOwed(o("quote")));
  no(countsAsOwed(o("lead")));
  no(countsAsOwed(o("cancelled")));
  no(countsAsOwed(o(null, "standing_order")));
  no(countsAsOwed(o("order", "order", true)));
});

test("the kind filter tells a standing order from the days it makes", () => {
  const day = { kind: "order", standing_order_id: "s1" };
  const oneOff = { kind: "order", standing_order_id: null };
  const recurrence = { kind: "standing_order", standing_order_id: null };

  ok(matchesKindFilter(oneOff, "order"));
  no(matchesKindFilter(day, "order"), "hiding the wholesale days is the point");
  ok(matchesKindFilter(day, "standing_day"));
  no(matchesKindFilter(oneOff, "standing_day"));
  ok(matchesKindFilter(recurrence, "standing_order"));
  no(matchesKindFilter(day, "standing_order"), "a day is not its own recurrence");
  ok(matchesKindFilter({ kind: "template" }, "template"));
  // 129: Sold as decides it, so a one-off wholesale order is Wholesale and a
  // standing day switched to Special Order is Special.
  const oneOffWholesale = { kind: "order", standing_order_id: null, square_item: "wholesale" };
  const daySoldSpecial = { kind: "order", standing_order_id: "s1", square_item: "special_order" };
  ok(matchesKindFilter(oneOffWholesale, "standing_day"));
  no(matchesKindFilter(oneOffWholesale, "order"));
  ok(matchesKindFilter(daySoldSpecial, "order"));
  // Every order matches exactly one option, or the four cannot sum to the list.
  for (const r of [day, oneOff, recurrence, { kind: "template" }, oneOffWholesale, daySoldSpecial]) {
    eq(ORDER_KIND_FILTERS.filter((f) => matchesKindFilter(r, f.value)).length, 1);
  }
});

// ---------------------------------------------------------------------------
// "Copy to contact" — the customer's details onto the order's day-of contact.
//
// Each case here was checked by BREAKING the rule it covers:
//   · dropping the non-empty guard blanks a typed contact email whenever the
//     customer record has none — a delete wearing a copy's label;
//   · comparing untrimmed makes " Jane" vs "Jane" a permanent "change", so the
//     confirm asks about a field it would not move;
//   · counting an EMPTY target as a replacement puts a dialog in front of the
//     commonest case, a fresh order with nothing typed yet.

const CUST = { name: "Jane Doe", phone: "555-0100", email: "jane@example.com" };
const EMPTY_CONTACT = { name: null, phone: null, email: null };

test("copy: an empty contact takes all three and asks nothing", () => {
  const p = contactCopyPlan(CUST, EMPTY_CONTACT);
  eq(p.wanted, {
    contact_name: "Jane Doe",
    contact_phone: "555-0100",
    contact_email: "jane@example.com",
  });
  eq(p.changing.length, 3, "all three change");
  eq(p.replacing.length, 0, "filling empties is not replacing");
});

test("copy: a customer's MISSING field never blanks a typed one", () => {
  const p = contactCopyPlan(
    { name: "Jane Doe", phone: null, email: "   " },
    { name: null, phone: "555-0199", email: "someone@example.com" },
  );
  no("contact_phone" in p.wanted, "a null phone must not travel");
  no("contact_email" in p.wanted, "a blank email must not travel");
  eq(p.wanted, { contact_name: "Jane Doe" });
});

test("copy: pressing it twice is a no-op", () => {
  const p = contactCopyPlan(CUST, {
    name: "Jane Doe",
    phone: "555-0100",
    email: "jane@example.com",
  });
  eq(p.changing.length, 0, "nothing differs");
  eq(p.replacing.length, 0, "so nothing is replaced");
});

test("copy: whitespace is not a difference", () => {
  const p = contactCopyPlan({ name: "Jane Doe", phone: null, email: null }, {
    name: "  Jane Doe  ",
    phone: null,
    email: null,
  });
  eq(p.changing.length, 0, "a trimmed match is a match");
});

test("copy: only the fields that really move are offered for confirming", () => {
  const p = contactCopyPlan(CUST, {
    name: "Bob Other",        // differs, non-empty -> replacing
    phone: "555-0100",        // identical         -> neither
    email: null,              // empty             -> changing, not replacing
  });
  eq(p.changing.sort(), ["contact_email", "contact_name"]);
  eq(p.replacing, ["contact_name"]);
});

test("copy: nothing linked means nothing to do", () => {
  const p = contactCopyPlan(null, EMPTY_CONTACT);
  eq(p.wanted, {});
  eq(p.changing.length, 0);
});

test("contact name is the PERSON, with company only as a fallback", () => {
  eq(customerContactName({ first_name: "Jane", last_name: "Doe", company: "Acme" }), "Jane Doe");
  eq(customerContactName({ first_name: null, last_name: null, company: "Acme" }), "Acme");
  eq(customerContactName({ first_name: null, last_name: null, company: null }), "");
  eq(customerContactName(null), "");
});

// The command menu's Title Case noun and the record screens' sentence-case one
// are two maps of the same fact. Adding a kind to one and not the other should
// fail here, not ship a menu row reading "Duplicate undefined".
test("every order kind has a command noun, and it matches KIND_LABEL's words", () => {
  const kinds = Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[];
  eq(Object.keys(KIND_COMMAND_NOUN).sort(), kinds.slice().sort(), "same kinds");
  for (const k of kinds) {
    eq(
      KIND_COMMAND_NOUN[k].toLowerCase(),
      KIND_LABEL[k].toLowerCase(),
      `${k}: the two maps must differ only in CASE`,
    );
    // Title Case is the menu's convention — every word starts capitalised.
    ok(
      KIND_COMMAND_NOUN[k].split(" ").every((w) => w[0] === w[0].toUpperCase()),
      `${k}: "${KIND_COMMAND_NOUN[k]}" should be Title Case`,
    );
  }
});

test("isRefundablePayment: only a pay-link payment, with its Square id, for money received", () => {
  ok(isRefundablePayment({ payment_type: "Square Online", external_ref: "ff4oOrh", amount: 1.1 }));
  no(isRefundablePayment({ payment_type: "Square Invoice", external_ref: null, amount: 248 }), "hand-typed");
  no(isRefundablePayment({ payment_type: "Square Online", external_ref: null, amount: 248 }), "no Square id");
  no(isRefundablePayment({ payment_type: "Square Refund", external_ref: "r1", amount: -1.1 }), "a refund itself");
  no(isRefundablePayment({ payment_type: "Square Online", external_ref: "x", amount: 0 }), "nothing to give back");
});
