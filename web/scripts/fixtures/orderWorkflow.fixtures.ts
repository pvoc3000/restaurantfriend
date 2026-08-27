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

const cols = (cs: { column: string; value: string | null }[]) =>
  cs.map((c) => [c.column, c.value]);

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

test("order printed date set → clear the Print Order to-do", () => {
  eq(
    cols(afterDateSet(
      order({ status: "order", todo: "Print Order", order_printed_at: TODAY }),
      "order_printed_at"
    )),
    [["todo", null]]
  );
});

test("…but NOT somebody else's to-do", () => {
  // "call about the balloons" is a note to themselves and is not thrown away
  // because a sheet came off the printer.
  eq(
    afterDateSet(
      order({ status: "order", todo: "call about the balloons", order_printed_at: TODAY }),
      "order_printed_at"
    ),
    []
  );
});

test("a document going out proposes what its date implies", () => {
  // The date is stamped by the sender, so this reasons about the order as it
  // WILL be — without that it would see the date already set and say nothing.
  eq(cols(afterDocumentSent(order(), "quote", TODAY)), [["status", "quote"]]);
  eq(cols(afterDocumentSent(order({ status: "quote" }), "invoice", TODAY)), [["status", "invoice"]]);
  eq(
    cols(afterDocumentSent(order({ status: "order", todo: "Print Order" }), "order", TODAY)),
    [["todo", null]]
  );
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
});

