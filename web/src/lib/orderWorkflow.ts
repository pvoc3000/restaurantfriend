/**
 * THE WORKFLOW, AS DATA — what should follow when something happens to a
 * special order (Mark, 2026-08-21: "there's a workflow here and the app should
 * help guide the user through it as various events occur").
 *
 * Pure and fixture-tested. Nothing here writes anything; it answers one
 * question — given an event and an order, what would a careful person do next?
 * — and hands back a list of proposals for somebody to accept or decline.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT SIX HANDLERS
 * ---------------------------------------------------------------------------
 * The six behaviours Mark asked for are the same rule seen from two directions:
 *
 *   an ACT implies a DATE      — a quote goes out, so it was sent today;
 *   a DATE implies a STATE     — a quote was sent, so this is a Quote.
 *
 * Wired as six independent handlers they CHAIN: downloading a quote asks "set
 * the sent date?", and the write that answers it asks "move to Quote?" — two
 * dialogs for one act, the second of which looks like the app second-guessing
 * the answer you just gave. So `whatFollows` closes the chain itself and
 * returns everything at once, and the caller asks ONE question.
 *
 * It also means the workflow is READABLE. FileMaker's equivalent lived in
 * script steps scattered across a dozen layouts, which is why nobody could say
 * what the app would do without running it.
 *
 * ---------------------------------------------------------------------------
 * THREE GUARDS, AND EACH ONE IS A REAL ORDER THAT WOULD OTHERWISE BREAK
 * ---------------------------------------------------------------------------
 * · **Forward only.** 8,330 orders came out of FileMaker, and backfilling a
 *   quote date onto a finished one must not drag its status back to Quote.
 *   `STATUS_ORDER` ranks the ladder and nothing may propose a lower rung.
 * · **Never on a template or a standing order.** Migration 051's
 *   `special_orders_status_iff_order` makes `status` NULL exactly when `kind`
 *   is not `order`, so proposing a status on a template is proposing a write
 *   the database will refuse — a check constraint is the one refusal
 *   `InlineValue` cannot explain.
 * · **Never on a cancelled order.** It is not partly done, it is not
 *   happening, and advancing it is meaningless.
 *
 * A fourth guard lives in the CALLERS rather than here: only offer when a date
 * goes EMPTY -> SET. Correcting a typo in a date that is already there should
 * not re-ask, and this module cannot tell the two apart from the new value
 * alone.
 */

import {
  STATUS_ORDER,
  STATUS_LABEL,
  type SpecialOrderStatus,
} from "./specialOrders";

/** The stage dates a document or an act can stamp. */
export type StageColumn =
  | "quote_sent_at"
  | "quote_returned_at"
  | "invoice_sent_at"
  | "invoice_paid_at"
  | "receipt_sent_at"
  | "order_printed_at"
  | "order_scheduled_at"
  | "delivery_scheduled_at";

/** The documents this module can send, and the date each one stamps. */
export const DOCUMENT_STAMPS: Record<string, StageColumn> = {
  quote: "quote_sent_at",
  invoice: "invoice_sent_at",
  receipt: "receipt_sent_at",
  order: "order_printed_at",
};

/** One proposed write, and the sentence offering it. */
export type Consequence = {
  column: "status" | "todo" | StageColumn;
  value: string | null;
  /** What the checkbox says. A sentence, not a field name. */
  label: string;
};

/** Just enough of an order to reason about. */
export type WorkflowOrder = {
  kind: string;
  status: string | null;
  todo: string | null;
  quote_sent_at: string | null;
  quote_returned_at: string | null;
  invoice_sent_at: string | null;
  invoice_paid_at: string | null;
  receipt_sent_at: string | null;
  order_printed_at: string | null;
  order_scheduled_at: string | null;
  delivery_scheduled_at: string | null;
};

/** Where a status sits on the ladder. `cancelled` is off it — see the header. */
function rank(status: string | null): number {
  const i = STATUS_ORDER.indexOf(status as SpecialOrderStatus);
  return i < 0 || status === "cancelled" ? -1 : i;
}

/** May this order be advanced at all? */
export function isAdvanceable(order: WorkflowOrder): boolean {
  return order.kind === "order" && order.status !== "cancelled";
}

/**
 * WHAT A STAGE DATE IMPLIES.
 *
 * The table Mark dictated, plus the rungs that fall out of the same reasoning
 * — a returned quote is an invoice waiting to be sent, a scheduled order is a
 * receipt waiting to go out. Each entry is a function rather than a constant
 * because half of them depend on what the order already says.
 */
const DATE_IMPLIES: Partial<
  Record<StageColumn, (order: WorkflowOrder) => Consequence[]>
> = {
  quote_sent_at: () => [status("quote")],
  // Approved. The ball is ours again, and the next document is the invoice.
  quote_returned_at: () => [todo("Send Invoice")],
  invoice_sent_at: () => [status("invoice")],
  // Mark's own pairing: paid means it is an Order, and the thing left is to
  // print it.
  invoice_paid_at: () => [status("order"), todo("Print Order")],
  // CLEARED ONLY IF IT IS STILL THE PRINT TO-DO. Somebody who has typed
  // "call about the balloons" in there is not asking for it to be thrown away
  // because a sheet came off the printer.
  order_printed_at: (o) => (o.todo === "Print Order" ? [clearTodo("Print Order")] : []),
  // WHICHEVER HALF OF THE SIXTH RUNG IS STILL MISSING. `suggestedTodo` already
  // sequences Print Order before Schedule Production, and scheduling is now a
  // COMMAND rather than only a date somebody types — so the order can reach this
  // rung from either side, and the offer has to know which. Printed already:
  // the ladder is done and the next thing is the receipt.
  order_scheduled_at: (o) =>
    o.order_printed_at ? [todo("Send Receipt")] : [todo("Print Order")],
  receipt_sent_at: (o) => (o.todo === "Send Receipt" ? [clearTodo("Send Receipt")] : []),
};

function status(next: SpecialOrderStatus): Consequence {
  return {
    column: "status",
    value: next,
    label: `Move the order to ${STATUS_LABEL[next]}`,
  };
}

function todo(next: string): Consequence {
  return { column: "todo", value: next, label: `Set the to-do to ${next}` };
}

function clearTodo(was: string): Consequence {
  return { column: "todo", value: null, label: `Clear the ${was} to-do` };
}

const DATE_LABEL: Record<StageColumn, string> = {
  quote_sent_at: "quote sent",
  quote_returned_at: "quote returned",
  invoice_sent_at: "invoice sent",
  invoice_paid_at: "invoice paid",
  receipt_sent_at: "receipt sent",
  order_printed_at: "order printed",
  order_scheduled_at: "order scheduled",
  delivery_scheduled_at: "delivery scheduled",
};

/** Drop anything the order already says, and anything that would go backwards. */
function keepUseful(order: WorkflowOrder, proposed: Consequence[]): Consequence[] {
  const out: Consequence[] = [];
  for (const c of proposed) {
    if (c.column === "status") {
      // Forward only — see the header.
      if (rank(c.value) <= rank(order.status)) continue;
    } else if (c.column === "todo") {
      if ((order.todo ?? null) === (c.value ?? null)) continue;
    } else {
      // A stage date is only proposed when the order has none.
      if (order[c.column]) continue;
    }
    // Never propose the same column twice; the earlier rule wins.
    if (out.some((o) => o.column === c.column)) continue;
    out.push(c);
  }
  return out;
}

/**
 * A STAGE DATE WAS SET. What else should change?
 *
 * The caller decides WHEN to ask — see the fourth guard in the header — and
 * this decides what to ask for.
 */
export function afterDateSet(order: WorkflowOrder, column: StageColumn): Consequence[] {
  if (!isAdvanceable(order)) return [];
  const rule = DATE_IMPLIES[column];
  return rule ? keepUseful(order, rule(order)) : [];
}

/**
 * A DOCUMENT WENT OUT — emailed, or downloaded to be printed.
 *
 * The date is stamped by whoever sent it (the edge function does it for an
 * email, the caller does it for a download), so this reasons about the order AS
 * IT WILL BE once that stamp lands: the date's own consequences, computed
 * against a copy carrying it. Without that the first thing it would notice is
 * that the date is already set and there is nothing left to say.
 */
export function afterDocumentSent(
  order: WorkflowOrder,
  document: string,
  on: string
): Consequence[] {
  if (!isAdvanceable(order)) return [];
  const column = DOCUMENT_STAMPS[document];
  if (!column) return [];
  const stamped: WorkflowOrder = { ...order, [column]: order[column] ?? on };
  return afterDateSet(stamped, column);
}

/**
 * A PAYMENT WAS RECORDED AND THE BALANCE IS NOW SETTLED (Mark's addition to
 * his own list, 2026-08-21).
 *
 * Recording the money IS the paid event, so this offers the date as well as
 * what the date implies — which is the one case where a proposal includes a
 * stage date, because every other trigger has already stamped its own.
 */
export function afterPaymentSettled(order: WorkflowOrder, on: string): Consequence[] {
  if (!isAdvanceable(order)) return [];
  if (order.invoice_paid_at) return [];
  return keepUseful(order, [
    {
      column: "invoice_paid_at",
      value: on,
      label: `Set the ${DATE_LABEL.invoice_paid_at} date`,
    },
    ...(DATE_IMPLIES.invoice_paid_at?.(order) ?? []),
  ]);
}

/**
 * THE CATCH-UP OFFER — an order whose dates have run ahead of its status.
 *
 * The prompts above catch the moment; this catches everything else, and there
 * is a lot of everything else: 8,330 orders came out of FileMaker with their
 * own idea of the ladder, a date can be set from a screen that does not ask,
 * and somebody who declined a prompt on Tuesday may want it on Thursday. It is
 * the receiving screen's `->` idiom — the app's standing answer to "we can see
 * what this should be, but you decide".
 *
 * It reads the DATES ONLY and never the to-do: a stale to-do is somebody's
 * note to themselves, where a status behind its own evidence is the record
 * disagreeing with itself.
 */
export function statusCatchUp(order: WorkflowOrder): Consequence | null {
  if (!isAdvanceable(order)) return null;
  // The furthest rung the dates justify, taken in ladder order so the LAST
  // match wins.
  let furthest: SpecialOrderStatus | null = null;
  if (order.quote_sent_at) furthest = "quote";
  if (order.invoice_sent_at) furthest = "invoice";
  if (order.invoice_paid_at) furthest = "order";
  if (!furthest) return null;
  const [proposal] = keepUseful(order, [status(furthest)]);
  return proposal ?? null;
}

/**
 * One line of prose for a whole set — the inline offer's own sentence, and the
 * log entry's.
 *
 * Only the FIRST part keeps its capital. Each label is written to stand alone
 * as a checkbox, so joining them raw produces "Move the order to Order, and Set
 * the to-do to Print Order" — a capital in the middle of a sentence, which
 * reads as two sentences badly glued together.
 */
export function consequenceSummary(cs: Consequence[]): string {
  if (cs.length === 0) return "";
  const parts = cs.map((c, i) =>
    i === 0 ? c.label : c.label.charAt(0).toLowerCase() + c.label.slice(1)
  );
  return parts.join(", and ") + "?";
}
