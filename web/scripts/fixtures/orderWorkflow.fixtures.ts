// `lib/orderWorkflow` — what should follow when something happens to an order.
//
// Every rule here was checked by BREAKING it. The three that matter most are
// the guards, because each one is a real order that would otherwise be damaged:
// a finished order dragged backwards by a backfilled date, a template given a
// status its own check constraint refuses, and a cancelled order advanced.

import { test, eq } from "./harness";
import {
  afterDateSet,
  afterDocumentSent,
  afterPaymentSettled,
  consequenceSummary,
  isAdvanceable,
  statusCatchUp,
  type Consequence,
  type WorkflowOrder,
} from "../../src/lib/orderWorkflow";

const TODAY = "2026-08-21";

function order(patch: Partial<WorkflowOrder> = {}): WorkflowOrder {
  return {
    kind: "order",
    status: "lead",
    todo: null,
    quote_sent_at: null,
    quote_returned_at: null,
    invoice_sent_at: null,
    invoice_paid_at: null,
    receipt_sent_at: null,
    order_printed_at: null,
    order_scheduled_at: null,
    delivery_scheduled_at: null,
    ...patch,
  };
}

// A payment has no `value` — it has an amount and a date, and printing both is
// what makes a wrong figure fail loudly rather than pass as "a payment".
const cols = (cs: Consequence[]) =>
  cs.map((c) =>
    c.column === "payment" ? [c.column, `${c.amount} on ${c.on}`] : [c.column, c.value]
  );

/* -------------------------------------------------------------------------
 * Mark's six, in his words
 * ---------------------------------------------------------------------- */

test("quote sent date set → move to Quote", () => {
  eq(cols(afterDateSet(order({ quote_sent_at: TODAY }), "quote_sent_at")), [["status", "quote"]]);
});

test("invoice sent date set → move to Invoice", () => {
  eq(
    cols(afterDateSet(order({ status: "quote", invoice_sent_at: TODAY }), "invoice_sent_at")),
    [["status", "invoice"]]
  );
});

test("invoice paid date set → move to Order AND set the Print Order to-do", () => {
  // Mark's own pairing, and the one rule that proposes two things at once.
  eq(
    cols(afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY }), "invoice_paid_at")),
    [["status", "order"], ["todo", "Print Order"]]
  );
});

test("a DELIVERY paid in full → Schedule Delivery, unless it is already booked (2026-09-22)", () => {
  eq(
    cols(afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY, fulfillment: "delivery" }), "invoice_paid_at")),
    [["status", "order"], ["todo", "Schedule Delivery"]]
  );
  eq(
    cols(
      afterDateSet(
        order({ status: "invoice", invoice_paid_at: TODAY, fulfillment: "delivery", delivery_scheduled_at: TODAY }),
        "invoice_paid_at"
      )
    ),
    [["status", "order"], ["todo", "Print Order"]],
    "courier already booked"
  );
  eq(
    cols(afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY, fulfillment: "pickup" }), "invoice_paid_at")),
    [["status", "order"], ["todo", "Print Order"]],
    "pickup"
  );
});

test("printing OFFERS NOTHING about the to-do — 117 does it (2026-09-21)", () => {
  // The rule did not go away, it moved into the database: migration 117 clears
  // the to-do a finished stage ANSWERS, so 'Print Order' goes and "call about
  // the balloons" stays. Offering to do what the trigger has already done is a
  // dialog that changes nothing — and on a client holding a pre-refresh copy of
  // the order it offers it about a value that is already gone.
  eq(
    afterDateSet(
      order({ status: "order", todo: "Print Order", order_printed_at: TODAY }),
      "order_printed_at"
    ),
    []
  );
  eq(
    afterDateSet(
      order({ status: "order", todo: "call about the balloons", order_printed_at: TODAY }),
      "order_printed_at"
    ),
    []
  );
  // And the receipt, which paired with 'Send Receipt' the same way.
  eq(
    afterDateSet(
      order({ status: "order", todo: "Send Receipt", receipt_sent_at: TODAY }),
      "receipt_sent_at"
    ),
    []
  );
});

test("a document going out proposes what its date implies", () => {
  // The date is stamped by the sender, so this reasons about the order as it
  // WILL be — without that it would see the date already set and say nothing.
  eq(cols(afterDocumentSent(order(), "quote", TODAY)), [["status", "quote"]]);
  eq(cols(afterDocumentSent(order({ status: "quote" }), "invoice", TODAY)), [["status", "invoice"]]);
  // The kitchen sheet implies nothing to propose since 117 — see above.
  eq(afterDocumentSent(order({ status: "order", todo: "Print Order" }), "order", TODAY), []);
});

/* -------------------------------------------------------------------------
 * The rungs that fall out of the same reasoning
 * ---------------------------------------------------------------------- */

test("a returned quote is an invoice waiting to be sent", () => {
  eq(
    cols(afterDateSet(order({ status: "quote", quote_returned_at: TODAY }), "quote_returned_at")),
    [["todo", "Send Invoice"]]
  );
});

test("a scheduled order that was PRINTED is a receipt waiting to go out", () => {
  eq(
    cols(afterDateSet(
      order({ status: "order", todo: null, order_printed_at: TODAY, order_scheduled_at: TODAY }),
      "order_scheduled_at"
    )),
    [["todo", "Send Receipt"]]
  );
});

test("a scheduled order that was NOT printed asks to be printed", () => {
  // The sixth rung is compound — printed AND scheduled — and since scheduling
  // became a command the order can arrive at it from either side. Offering
  // "Send Receipt" to an order the kitchen has no paper for skips a step.
  eq(
    cols(afterDateSet(
      order({ status: "order", todo: null, order_printed_at: null, order_scheduled_at: TODAY }),
      "order_scheduled_at"
    )),
    [["todo", "Print Order"]]
  );
});

test("a delivery booking implies nothing — 82% of orders are pickups", () => {
  eq(afterDateSet(order({ delivery_scheduled_at: TODAY }), "delivery_scheduled_at"), []);
});

/* -------------------------------------------------------------------------
 * THE GUARDS — each one a real order that would otherwise break
 * ---------------------------------------------------------------------- */

test("FORWARD ONLY: backfilling a quote date onto a paid order proposes nothing", () => {
  // 8,330 orders came out of FileMaker. Setting a quote date on a finished one
  // must not drag it back down the ladder.
  const paid = order({ status: "order", quote_sent_at: TODAY });
  eq(afterDateSet(paid, "quote_sent_at"), []);
  eq(afterDocumentSent(paid, "quote", TODAY), []);
});

test("FORWARD ONLY: an invoice date on an order already paid proposes nothing", () => {
  eq(afterDateSet(order({ status: "order", invoice_sent_at: TODAY }), "invoice_sent_at"), []);
});

test("NEVER A TEMPLATE OR A STANDING ORDER — the check constraint refuses it", () => {
  // 051's `special_orders_status_iff_order` makes status NULL exactly when kind
  // is not `order`, so proposing one is proposing a write the database will
  // reject — and a check constraint is the one refusal InlineValue cannot
  // explain.
  for (const kind of ["template", "standing_order"]) {
    const o = order({ kind, status: null, quote_sent_at: TODAY });
    eq(isAdvanceable(o), false, kind);
    eq(afterDateSet(o, "quote_sent_at"), [], kind);
    eq(afterDocumentSent(o, "quote", TODAY), [], kind);
    eq(afterPaymentSettled(o, TODAY), [], kind);
    eq(statusCatchUp(o), null, kind);
  }
});

test("NEVER A CANCELLED ORDER", () => {
  const o = order({ status: "cancelled", quote_sent_at: TODAY });
  eq(isAdvanceable(o), false);
  eq(afterDateSet(o, "quote_sent_at"), []);
  eq(statusCatchUp(o), null);
});

test("nothing already true is proposed", () => {
  // The dialog must never open saying "move to Quote" on an order that is one.
  eq(afterDateSet(order({ status: "quote", quote_sent_at: TODAY }), "quote_sent_at"), []);
  eq(
    afterDateSet(
      order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }),
      "invoice_paid_at"
    ),
    [],
    "already Order and already told to print"
  );
});

test("a column is never proposed twice", () => {
  const cs = afterDateSet(
    order({ status: "invoice", invoice_paid_at: TODAY }),
    "invoice_paid_at"
  );
  eq(new Set(cs.map((c) => c.column)).size, cs.length);
});

/* -------------------------------------------------------------------------
 * Payments
 * ---------------------------------------------------------------------- */

test("a settling payment offers the date AND what it implies", () => {
  eq(
    cols(afterPaymentSettled(order({ status: "invoice" }), TODAY)),
    [["invoice_paid_at", TODAY], ["status", "order"], ["todo", "Print Order"]]
  );
});

test("…and says nothing when the paid date is already there", () => {
  eq(afterPaymentSettled(order({ status: "order", invoice_paid_at: "2026-08-01" }), TODAY), []);
});

/* -------------------------------------------------------------------------
 * The paid date, when the balance says otherwise (Mark, 2026-09-19)
 * ---------------------------------------------------------------------- */

test("paid date set with a balance outstanding → offer to record it", () => {
  // The money leads the ladder: the whole point is that the date and the
  // balance were about to disagree.
  eq(
    cols(
      afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: 267.09,
      })
    ),
    [["payment", `267.09 on ${TODAY}`], ["status", "order"], ["todo", "Print Order"]]
  );
});

test("…and the amount is the WHOLE balance, to the cent", () => {
  const [pay] = afterDateSet(
    order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }),
    "invoice_paid_at",
    { balance: 100 / 3 }
  );
  eq(pay.column, "payment");
  eq(pay.column === "payment" ? pay.amount : null, 33.33);
  eq(pay.label, "Record a $33.33 payment so the balance is clear");
});

test("…nothing when the balance is already clear", () => {
  eq(
    cols(
      afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: 0,
      })
    ),
    [["status", "order"], ["todo", "Print Order"]]
  );
});

test("…nor for a credit balance, which is not a payment to take", () => {
  // An overpayment leaves a negative balance. "Record a -$4.00 payment" is not
  // a thing to offer, and `<=` is what keeps it off the screen.
  eq(
    cols(
      afterDateSet(order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: -4,
      })
    ),
    []
  );
});

test("…nor a third of a cent, which is arithmetic rather than a debt", () => {
  eq(
    cols(
      afterDateSet(order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: 0.004,
      })
    ),
    []
  );
});

test("…NEVER on a wholesale day billed in arrears (`ignore_balance`)", () => {
  // Decision 13's escape hatch. Cafe Knotted has seven of these a week and
  // every one of them carries a balance on purpose.
  eq(
    cols(
      afterDateSet(order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: 613.5,
        ignore_balance: true,
      })
    ),
    []
  );
});

test("…and nothing at all when the caller passes no money", () => {
  // Scheduling and sending a document stamp dates that imply nothing about a
  // balance, and must not start asking about one.
  eq(
    cols(afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY }), "invoice_paid_at")),
    [["status", "order"], ["todo", "Print Order"]]
  );
});

test("a settling payment still never proposes ANOTHER payment", () => {
  // `afterPaymentSettled` reaches the same rule from the other side. The money
  // has just landed; offering to take it again is the one thing that would be
  // worse than saying nothing.
  eq(
    cols(afterPaymentSettled(order({ status: "invoice" }), TODAY)),
    [["invoice_paid_at", TODAY], ["status", "order"], ["todo", "Print Order"]]
  );
});

test("a cancelled order is offered nothing, balance or no balance", () => {
  eq(
    afterDateSet(order({ status: "cancelled", invoice_paid_at: TODAY }), "invoice_paid_at", {
      balance: 500,
    }),
    []
  );
});

test("nor a standing order, whose status its own constraint forbids", () => {
  eq(
    afterDateSet(
      order({ kind: "standing_order", status: null, invoice_paid_at: TODAY }),
      "invoice_paid_at",
      { balance: 613.5 }
    ),
    []
  );
});

/* -------------------------------------------------------------------------
 * The catch-up offer
 * ---------------------------------------------------------------------- */

test("the catch-up reads the DATES and offers the furthest rung they justify", () => {
  eq(statusCatchUp(order({ quote_sent_at: TODAY }))?.value, "quote");
  eq(statusCatchUp(order({ quote_sent_at: TODAY, invoice_sent_at: TODAY }))?.value, "invoice");
  eq(
    statusCatchUp(order({ quote_sent_at: TODAY, invoice_sent_at: TODAY, invoice_paid_at: TODAY }))
      ?.value,
    "order"
  );
});

test("…and is silent when the status already matches or leads", () => {
  eq(statusCatchUp(order({ status: "quote", quote_sent_at: TODAY })), null);
  eq(statusCatchUp(order({ status: "order", quote_sent_at: TODAY })), null, "status leads");
  eq(statusCatchUp(order({})), null, "no dates at all");
});

test("the catch-up ignores the to-do", () => {
  // A stale to-do is somebody's note to themselves; a status behind its own
  // evidence is the record disagreeing with itself. Only the second is offered.
  eq(statusCatchUp(order({ status: "lead", todo: "Print Order" })), null);
});

/* -------------------------------------------------------------------------
 * The sentence
 * ---------------------------------------------------------------------- */

test("the summary reads as a question, however many parts", () => {
  eq(consequenceSummary([]), "");
  eq(
    consequenceSummary(afterDateSet(order({ quote_sent_at: TODAY }), "quote_sent_at")),
    "Move the order to Quote?"
  );
  eq(
    consequenceSummary(
      afterDateSet(order({ status: "invoice", invoice_paid_at: TODAY }), "invoice_paid_at")
    ),
    "Move the order to Order, and set the to-do to Print Order?",
    "only the first part keeps its capital"
  );
  eq(
    consequenceSummary(
      afterDateSet(order({ status: "order", todo: "Print Order", invoice_paid_at: TODAY }), "invoice_paid_at", {
        balance: 267.09,
      })
    ),
    "Record a $267.09 payment so the balance is clear?",
    "a payment reads as a sentence like any other consequence"
  );
});

