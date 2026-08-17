/**
 * SPECIAL ORDERS — the module's arithmetic, its vocabulary, and its judgement.
 *
 * Pure, and fixture-tested (`scripts/fixtures/specialOrders.fixtures.ts`),
 * because three of the things in here are the module's whole reason for
 * existing and none of them can be eyeballed:
 *
 *   · the MONEY, which is derived on every read and stored nowhere
 *     (decision 6 — FileMaker stored subtotal/tax/total TWICE, by era, with
 *     all the drift that implies);
 *   · NEEDS ATTENTION, which replaces a human remembering (decision 19);
 *   · the RUSH FEE, which makes the terms the quote prints true in the data
 *     (decision 22).
 *
 * Nothing here touches the database, React or the DOM.
 */

import type { PickOption } from "@/components/ui/PickList";

/* ==========================================================================
 * 1. THE VOCABULARY
 * ========================================================================== */

/** Decision 3: what KIND of record this is. */
export type SpecialOrderKind = "order" | "template" | "standing_order";

/** Decision 3: where a real order is on the ladder. Null for the other kinds. */
export type SpecialOrderStatus = "lead" | "quote" | "invoice" | "order" | "cancelled";

export const KIND_LABEL: Record<SpecialOrderKind, string> = {
  order: "Order",
  template: "Template",
  standing_order: "Standing order",
};

/**
 * The ladder, in order. `cancelled` is deliberately last and OFF it — it is
 * where an order stops rather than a rung, which is why `nextStatus` returns
 * null from it and why the list greys those rows rather than colouring them.
 */
export const STATUS_ORDER: SpecialOrderStatus[] = [
  "lead",
  "quote",
  "invoice",
  "order",
  "cancelled",
];

export const STATUS_LABEL: Record<SpecialOrderStatus, string> = {
  lead: "Lead",
  quote: "Quote",
  invoice: "Invoice",
  order: "Order",
  cancelled: "Cancelled",
};

/** What each rung MEANS, in the words Mark used. Shown as PickList hints. */
export const STATUS_HINT: Record<SpecialOrderStatus, string> = {
  lead: "gathering information",
  quote: "quote prepared or sent, awaiting approval",
  invoice: "Square invoice sent, awaiting payment",
  order: "paid — printing and scheduling remain",
  cancelled: "not happening",
};

export const STATUS_OPTIONS: PickOption[] = STATUS_ORDER.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
  hint: STATUS_HINT[s],
}));

/**
 * Decision 4: the to-do is a MANUAL field and the app never writes it. This is
 * FileMaker's own value list, offered through a `PickList` with `allowNew`.
 *
 * `allowNew` is not decoration. Measured over the real export, 8,233 of 8,334
 * orders leave the field empty and the values that DO appear include "ON HOLD",
 * "HOLIDAY", "*" and "Adjust time to 9am or later" — so a closed vocabulary
 * would refuse a quarter of the real data. Never turn this into a check
 * constraint.
 */
export const TODO_OPTIONS: PickOption[] = [
  { value: "Respond to Email/Call", label: "Respond to Email/Call" },
  { value: "Send Quote", label: "Send Quote" },
  { value: "Send Invoice", label: "Send Invoice" },
  { value: "Schedule Delivery", label: "Schedule Delivery" },
  { value: "Print Order", label: "Print Order" },
  { value: "Send Receipt", label: "Send Receipt" },
  { value: "Schedule Production", label: "Schedule Production" },
  { value: "Post Event Followup", label: "Post Event Followup" },
  { value: "Resolve Issue", label: "Resolve Issue" },
  { value: "Invoice Overdue!", label: "Invoice Overdue!" },
];

/** Decision 4: flagging an order sets this todo, and resolving clears both. */
export const FLAG_TODO = "Resolve Issue";

/* ==========================================================================
 * 2. THE MONEY (decision 6)
 * ========================================================================== */

/**
 * A line, reduced to what the arithmetic needs. Deliberately structural rather
 * than the row type — the PDF renderers, the list's totals pass and the record
 * screen all hold slightly different shapes of the same line.
 */
export type MoneyLine = {
  qty: number | null;
  unit_price: number | null;
  taxable: boolean;
  /**
   * Decision 5: a `Misc*` line is MONEY, not production. It still counts
   * toward every figure here — a Delivery Fee is revenue — and is excluded
   * only from the kitchen document and the production schedule, which is why
   * that test lives in `isProductionLine` rather than in this shape.
   */
  item_type?: string | null;
};

/** The stored inputs. Everything else on this page is derived from them. */
export type MoneyOrder = {
  tax_rate: number | null;
  discount_amount: number | null;
  /** A FRACTION: .10 is ten per cent. FileMaker's own convention. */
  discount_rate: number | null;
  delivery_charge: number | null;
  rush_fee: number | null;
  ignore_balance?: boolean | null;
};

export type MoneyPayment = { amount: number | null };

export type OrderTotals = {
  /** Σ qty × unit price, over every line. */
  subtotal: number;
  /** The part of the subtotal that is taxable, BEFORE the discount. */
  taxableSubtotal: number;
  /** What the discount comes to, whichever way it was expressed. */
  discount: number;
  deliveryCharge: number;
  rushFee: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
};

const n = (v: number | null | undefined): number => {
  // PostgREST hands `numeric` back as a STRING often enough that a bare `?? 0`
  // silently concatenates instead of adding — the `labor_rate` lesson, and
  // this module multiplies eleven such columns together.
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/** Round to cents, once, at the end of each figure — never mid-chain. */
const cents = (x: number): number => Math.round(x * 100) / 100;

export function lineTotal(line: MoneyLine): number {
  return cents(n(line.qty) * n(line.unit_price));
}

/**
 * The whole of the order's money, from the inputs and nothing else.
 *
 * TWO ARITHMETIC DECISIONS worth stating, because a rewrite could plausibly go
 * either way on both and the customer would notice:
 *
 * **The discount comes off BEFORE tax**, proportionally across the taxable and
 * non-taxable parts. Taxing the undiscounted amount would charge sales tax on
 * money nobody paid; discounting only the non-taxable part would be arbitrary.
 * A `discount_rate` of .10 on an order that is half taxable therefore reduces
 * the taxable base by 10% too.
 *
 * **Delivery and rush are NOT taxed.** They are services rather than goods, it
 * is what FileMaker did, and the reference invoice for order 9885 shows tax
 * computed on the item subtotal alone.
 *
 * A rate and an amount can both be set — 82 real orders carry `discount_rate`
 * = 1 (a comp) and 8,145 carry an amount — so they ADD rather than one winning.
 * FileMaker's own layout offers both fields at once.
 */
export function orderTotals(
  order: MoneyOrder,
  lines: MoneyLine[],
  payments: MoneyPayment[] = []
): OrderTotals {
  const subtotal = cents(lines.reduce((a, l) => a + n(l.qty) * n(l.unit_price), 0));
  const taxableSubtotal = cents(
    lines.reduce((a, l) => a + (l.taxable ? n(l.qty) * n(l.unit_price) : 0), 0)
  );

  const discount = cents(n(order.discount_amount) + subtotal * n(order.discount_rate));
  // Proportional, so the taxable base falls with the rest. Guarded against a
  // zero subtotal, which is every lead before anyone has added a line.
  const keptFraction = subtotal > 0 ? Math.max(0, (subtotal - discount) / subtotal) : 0;
  const tax = cents(taxableSubtotal * keptFraction * n(order.tax_rate));

  const deliveryCharge = cents(n(order.delivery_charge));
  const rushFee = cents(n(order.rush_fee));
  const total = cents(subtotal - discount + deliveryCharge + rushFee + tax);
  const paid = cents(payments.reduce((a, p) => a + n(p.amount), 0));

  return {
    subtotal,
    taxableSubtotal,
    discount,
    deliveryCharge,
    rushFee,
    tax,
    total,
    paid,
    balance: cents(total - paid),
  };
}

/**
 * Is this order settled?
 *
 * `ignore_balance` is decision 13's escape hatch: a wholesale day is production
 * and record-keeping, billed weekly in arrears, and without this every one of
 * Cafe Knotted's seven orders a week would sit in the unpaid queue until the
 * statement went out.
 *
 * A CREDIT BALANCE COUNTS AS PAID — `<= 0`, not `=== 0`. An overpayment or a
 * post-hoc discount leaves a negative balance, and "we owe them $4" is not an
 * unpaid order to chase.
 */
export function isSettled(order: MoneyOrder, totals: OrderTotals): boolean {
  return Boolean(order.ignore_balance) || totals.balance <= 0;
}

export function money(value: number): string {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

/* ==========================================================================
 * 3. THE KITCHEN LINE (decision 5)
 * ========================================================================== */

/**
 * Does this line reach the kitchen?
 *
 * Decision 5, and the test is PREFIX-INSENSITIVE on purpose: the real data
 * holds `Misc` 495 times and `Misc- Cupcake liners` once, and a Delivery Fee
 * that reached the production schedule would ask a baker to make one.
 *
 * A line with NO type is production — the fallback has to be this way round.
 * 569 real lines carry no `itemType_t`, they are ordinary donuts, and treating
 * an unclassified line as money would silently drop it off the kitchen sheet.
 */
export function isProductionLine(line: { item_type?: string | null }): boolean {
  return !/^misc/i.test((line.item_type ?? "").trim());
}

/**
 * Decision 9's precondition, as a sentence rather than a boolean.
 *
 * `production_schedule_items.item_id` is NOT NULL (migration 040), so a
 * schedulable line MUST link a production item. Returns the lines that block
 * scheduling, so the app can name them — "Peeps bunny has no production item"
 * — rather than refusing with a shrug. The fix is to attach the nearest
 * production item and keep the custom name, which is what the snapshot columns
 * are for. Do NOT widen `item_id` to nullable for this.
 */
export function unschedulableLines<T extends { name: string; item_type?: string | null; production_item_id: string | null }>(
  lines: T[]
): T[] {
  return lines.filter((l) => isProductionLine(l) && !l.production_item_id);
}

/* ==========================================================================
 * 4. BUSINESS DAYS AND THE RUSH FEE (decision 22)
 * ========================================================================== */

/**
 * DATES ARE STRINGS THROUGHOUT THIS MODULE, compared and stepped as strings
 * and UTC-midnight arithmetic — never `new Date("2026-08-16")` in local time,
 * which is UTC midnight and lands on the 15th for everyone west of Greenwich.
 * The production plans module learned this the same way.
 */
function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday — the schema's convention everywhere. */
export function isoWeekday(date: string): number {
  return ((utc(date).getUTCDay() + 6) % 7) + 1;
}

/**
 * Business days from `from` to `to`, counting neither endpoint's weekend.
 *
 * NO HOLIDAY CALENDAR, deliberately: the app has no holiday table, and one
 * invented here would be a second place to maintain a fact the shop already
 * knows. The fee is a SUGGESTION a human takes or ignores (see below), so
 * Thanksgiving week is handled by the human declining it.
 *
 * Negative when the event has passed, which is what makes an overdue order
 * fall out of `needsAttention` naturally rather than by a special case.
 */
export function businessDaysUntil(from: string, to: string): number {
  const forward = to >= from;
  const [start, end] = forward ? [from, to] : [to, from];
  let count = 0;
  for (let d = start; d < end; d = addDays(d, 1)) {
    const wd = isoWeekday(addDays(d, 1));
    if (wd <= 5) count++;
  }
  return forward ? count : -count;
}

/** Decision 22's parameters, from `orgs.settings.special_orders`. */
export type RushTerms = {
  cutoffBusinessDays: number;
  minimum: number;
  /** A FRACTION of the subtotal: 0.30 is thirty per cent. */
  rate: number;
};

export const DEFAULT_RUSH_TERMS: RushTerms = {
  cutoffBusinessDays: 2,
  minimum: 25,
  rate: 0.3,
};

/**
 * What the terms say this order owes in rush fee — "$25 or 30%, whichever is
 * greater", inside two business days.
 *
 * Returns null when the order is outside the cutoff, which is the ordinary
 * case: only 795 of the 5,198 v1 orders ever carried one.
 *
 * **IT IS A SUGGESTION AND NOTHING WRITES IT.** The receiving screen's `→`
 * idiom: the figure appears beside the empty cell, one tap puts it in, and it
 * is dismissible. An automatic write would charge a regular wholesale customer
 * a rush fee every Friday, and would do it silently.
 */
export function suggestedRushFee(
  args: { event_date: string | null; today: string; subtotal: number },
  terms: RushTerms = DEFAULT_RUSH_TERMS
): number | null {
  if (!args.event_date) return null;
  const days = businessDaysUntil(args.today, args.event_date);
  if (days >= terms.cutoffBusinessDays) return null;
  // A past event is not a rush; it is history, and offering a fee on it would
  // put the suggestion on every one of eight thousand old orders.
  if (days < 0) return null;
  if (args.subtotal <= 0) return null;
  return cents(Math.max(terms.minimum, args.subtotal * terms.rate));
}

/* ==========================================================================
 * 5. NEEDS ATTENTION (decision 19)
 * ========================================================================== */

/** Decision 19's thresholds, from `orgs.settings.special_orders`. */
export type AttentionThresholds = {
  quoteUnansweredDays: number;
  unpaidWithinDays: number;
  printWithinDays: number;
};

export const DEFAULT_ATTENTION: AttentionThresholds = {
  quoteUnansweredDays: 5,
  unpaidWithinDays: 7,
  printWithinDays: 2,
};

/** What the module needs to judge an order. A subset of the row. */
export type AttentionOrder = MoneyOrder & {
  kind: SpecialOrderKind;
  status: SpecialOrderStatus | null;
  event_date: string | null;
  fulfillment: string | null;
  quote_sent_at: string | null;
  quote_returned_at: string | null;
  invoice_sent_at: string | null;
  invoice_paid_at: string | null;
  order_printed_at: string | null;
  order_scheduled_at: string | null;
  delivery_scheduled_at: string | null;
  receipt_sent_at: string | null;
  todo: string | null;
  flag_reason: string | null;
};

/**
 * WHY this order wants a human, in words.
 *
 * Decision 19 is explicit that a bare count is not the feature — "each order
 * names its reason in words" — so this returns the sentence, and the list
 * shows it in the row. Null means nothing is wrong.
 *
 * PURE DERIVATION OVER EXISTING COLUMNS. Nothing is stored, so nothing can go
 * stale: an order that gets paid stops being in the queue the moment the
 * payment lands, with no sweeper and no flag to clear.
 *
 * ORDER OF PRECEDENCE IS THE ORDER OF THE CHECKS, and it is chosen so the most
 * ACTIONABLE thing wins rather than the most alarming. A flag is a human
 * saying "look at this", which outranks anything the app worked out.
 */
export function needsAttention(
  order: AttentionOrder,
  today: string,
  totals: OrderTotals,
  thresholds: AttentionThresholds = DEFAULT_ATTENTION
): string | null {
  // Templates and standing orders are not on the ladder; a standing order is
  // judged by whether it materializes, which is a different question.
  if (order.kind !== "order") return null;
  if (order.status === "cancelled") return null;

  if (order.flag_reason) return order.flag_reason;

  const days = order.event_date ? businessDaysUntil(today, order.event_date) : null;
  const past = order.event_date ? order.event_date < today : false;

  // A past event, which is the end of the list and the only branch that can
  // fire for one — so nothing below needs a `past` guard.
  //
  // MONEY BEFORE PAPERWORK. `status = 'order'` is supposed to mean paid, but
  // the status is typed by a human and the balance is derived from payment
  // rows, so the two genuinely disagree — and when they do the money is the
  // authority. Told the other way round, the one order that got away unpaid is
  // asked for a receipt, which is both wrong and the exact thing this queue
  // exists to catch. (A fixture pins it; swapping these two turns it red.)
  if (past) {
    if (!isSettled(order, totals) && totals.total > 0) {
      return `Event has passed and ${money(totals.balance)} is unpaid`;
    }
    if (order.status === "order" && !order.receipt_sent_at && totals.total > 0) {
      return "Event has passed — send the receipt";
    }
    return null;
  }

  // A quote nobody answered. Counted from when it was SENT, not from the
  // event: a quote for a wedding in June still wants chasing in February.
  if (
    order.status === "quote" &&
    order.quote_sent_at &&
    !order.quote_returned_at &&
    businessDaysUntil(order.quote_sent_at, today) >= thresholds.quoteUnansweredDays
  ) {
    return `Quote sent ${order.quote_sent_at} with no answer`;
  }

  if (days !== null && days <= thresholds.printWithinDays && order.status === "order") {
    // Both can be true; naming one at a time keeps the sentence short and the
    // second appears the moment the first is done.
    if (!order.order_printed_at) return "Paid and unprinted, and the event is close";
    if (!order.order_scheduled_at) return "Printed but production is not scheduled";
  }

  if (
    days !== null &&
    days <= thresholds.unpaidWithinDays &&
    !isSettled(order, totals) &&
    totals.total > 0
  ) {
    if (order.status === "lead") return "Event is close and this is still a lead";
    if (!order.invoice_sent_at) return "Event is close and no invoice has been sent";
    return `Event is close and ${money(totals.balance)} is unpaid`;
  }

  if (
    order.fulfillment === "delivery" &&
    days !== null &&
    days <= thresholds.printWithinDays &&
    !order.delivery_scheduled_at
  ) {
    return "Delivery order with no delivery scheduled";
  }

  return null;
}

/**
 * The quiet hint beside the to-do cell — "invoice paid and unprinted, Print
 * Order?".
 *
 * Decision 4: **the app may suggest and must never write.** The manual `todo`
 * always overrides this on display, which is why the caller shows one or the
 * other rather than both.
 */
export function suggestedTodo(order: AttentionOrder): string | null {
  if (order.kind !== "order" || order.status === "cancelled") return null;
  if (order.flag_reason) return FLAG_TODO;
  switch (order.status) {
    case "lead":
      return order.quote_sent_at ? "Send Invoice" : "Send Quote";
    case "quote":
      return order.quote_returned_at ? "Send Invoice" : "Respond to Email/Call";
    case "invoice":
      return order.invoice_paid_at ? "Print Order" : "Send Invoice";
    case "order":
      if (!order.order_printed_at) return "Print Order";
      if (!order.order_scheduled_at) return "Schedule Production";
      if (!order.receipt_sent_at) return "Send Receipt";
      return null;
    default:
      return null;
  }
}

/* ==========================================================================
 * 6. STANDING ORDERS (decision 13)
 * ========================================================================== */

export type StandingOrder = {
  standing_days: number[] | null;
  starts_on: string | null;
  ends_on: string | null;
  paused: boolean;
};

/**
 * Which dates this standing order should exist on, between `from` and `through`
 * inclusive.
 *
 * The SQL materializer (`ensure_standing_orders_materialized`) is the one that
 * writes — two callers, one implementation, 013's precedent — and this is the
 * same rule in TypeScript so the app can SAY what a top-up would do before
 * anyone presses anything. That is a deliberate second implementation of a
 * small rule, and the fixtures pin both ends of it.
 *
 * String dates and string comparison throughout: see `utc` above.
 */
export function standingMaterializationDates(
  standing: StandingOrder,
  from: string,
  through: string
): string[] {
  if (standing.paused) return [];
  const days = standing.standing_days ?? [];
  if (!days.length) return [];

  const start = standing.starts_on && standing.starts_on > from ? standing.starts_on : from;
  const end = standing.ends_on && standing.ends_on < through ? standing.ends_on : through;

  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (days.includes(isoWeekday(d))) out.push(d);
  }
  return out;
}

/* ==========================================================================
 * 7. THE STAGE GRID (the list's right-hand columns)
 * ========================================================================== */

/**
 * One cell of the list's stage grid.
 *
 * `done` is a date and reads as one. Otherwise the cell has a STATE, and the
 * colours are this app's, not FileMaker's:
 *
 *   · **red** = overdue — this stage is blocking and the event is near or past;
 *   · **yellow** = waiting on somebody else, which is FMP's green. Colour here
 *     means record state and yellow is this app's "worth your eye" mark; green
 *     means GO everywhere else in the app (the order guide's should-order), so
 *     reusing it for "waiting" would say the opposite of what it means.
 *   · **null** = not yet due, and the cell is simply empty. An empty cell IS
 *     the to-do list, which is the thing FileMaker got right.
 */
export type StageState = "done" | "overdue" | "waiting" | null;

export type Stage = {
  key: string;
  label: string;
  /** Which date column this stage stamps. */
  field: keyof AttentionOrder & string;
};

/**
 * SEVEN COLUMNS IN A NARROW GRID, so the labels are SHORT ONES — measured, not
 * chosen: at the width seven stage columns can have beside the to-do, customer
 * and event columns, "Invoiced", "Delivery" and "Scheduled" clipped to
 * "INV…", "DE…" and "SC…", which CLAUDE.md's column rule says reads as a
 * rendering fault rather than as "there's more".
 *
 * They are real words rather than abbreviations with full stops. "Billed" and
 * "Booked" are arguably clearer than the FileMaker phrases they replace: the
 * pair "Invoiced / Paid" made you read twice to see which was which.
 */
export const STAGES: Stage[] = [
  { key: "quote_sent", label: "Quote", field: "quote_sent_at" },
  { key: "quote_returned", label: "Signed", field: "quote_returned_at" },
  { key: "invoice_sent", label: "Billed", field: "invoice_sent_at" },
  { key: "invoice_paid", label: "Paid", field: "invoice_paid_at" },
  { key: "delivery_scheduled", label: "Booked", field: "delivery_scheduled_at" },
  { key: "order_scheduled", label: "Sched", field: "order_scheduled_at" },
  { key: "order_printed", label: "Print", field: "order_printed_at" },
];

export function stageState(
  order: AttentionOrder,
  stage: Stage,
  today: string,
  thresholds: AttentionThresholds = DEFAULT_ATTENTION
): StageState {
  const value = order[stage.field];
  if (value) return "done";
  if (order.kind !== "order" || order.status === "cancelled") return null;

  // A pickup order is never waiting on a delivery booking.
  if (stage.key === "delivery_scheduled" && order.fulfillment !== "delivery") return null;

  const days = order.event_date ? businessDaysUntil(today, order.event_date) : null;
  const close = days !== null && days <= thresholds.printWithinDays;
  const past = order.event_date ? order.event_date < today : false;

  switch (stage.key) {
    case "quote_sent":
      return close || past ? "overdue" : null;
    case "quote_returned":
      // The one stage that is genuinely somebody else's move.
      if (!order.quote_sent_at) return null;
      return close || past ? "overdue" : "waiting";
    case "invoice_sent":
      return close || past ? "overdue" : null;
    case "invoice_paid":
      if (!order.invoice_sent_at) return null;
      return close || past ? "overdue" : "waiting";
    case "delivery_scheduled":
    case "order_scheduled":
    case "order_printed":
      return close || past ? "overdue" : null;
    default:
      return null;
  }
}

/* ==========================================================================
 * 8. SETTINGS (design rule 2)
 * ========================================================================== */

/** The shape of `orgs.settings.special_orders`. Every value has a default in
 *  code so a fresh org works before anybody has configured anything. */
export type SpecialOrderSettings = {
  horizonDays: number;
  rush: RushTerms;
  attention: AttentionThresholds;
  invoiceFooter: string;
  terms: string;
};

export const DEFAULT_SETTINGS: SpecialOrderSettings = {
  horizonDays: 14,
  rush: DEFAULT_RUSH_TERMS,
  attention: DEFAULT_ATTENTION,
  invoiceFooter: "We appreciate your business!",
  terms: "",
};

/**
 * Read the module's settings out of `orgs.settings`.
 *
 * Every field falls back individually rather than the object falling back
 * whole: an org that has set only `horizon_days` must not lose the rush terms,
 * which is what `settings.special_orders ?? DEFAULT_SETTINGS` would do.
 */
export function readSettings(orgSettings: Record<string, unknown>): SpecialOrderSettings {
  const raw = (orgSettings?.special_orders ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : fallback;
  };
  const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
  return {
    horizonDays: num(raw.horizon_days, DEFAULT_SETTINGS.horizonDays),
    rush: {
      cutoffBusinessDays: num(raw.rush_cutoff_business_days, DEFAULT_RUSH_TERMS.cutoffBusinessDays),
      minimum: num(raw.rush_minimum, DEFAULT_RUSH_TERMS.minimum),
      rate: num(raw.rush_rate, DEFAULT_RUSH_TERMS.rate),
    },
    attention: {
      quoteUnansweredDays: num(raw.attention_quote_unanswered_days, DEFAULT_ATTENTION.quoteUnansweredDays),
      unpaidWithinDays: num(raw.attention_unpaid_within_days, DEFAULT_ATTENTION.unpaidWithinDays),
      printWithinDays: num(raw.attention_print_within_days, DEFAULT_ATTENTION.printWithinDays),
    },
    invoiceFooter: str(raw.invoice_footer, DEFAULT_SETTINGS.invoiceFooter),
    terms: str(raw.terms, DEFAULT_SETTINGS.terms),
  };
}

/* ==========================================================================
 * 9. THE RECORD'S TABS
 * ========================================================================== */

/**
 * `ui/SectionNav`, the employee record's pattern — reused rather than
 * re-derived, which is what Mark asked for when that shipped.
 *
 * The tab lives in the URL like every other piece of view state, and `info`
 * writes NO parameter so the record keeps one canonical address.
 */
export type OrderTab = "info" | "items" | "notes" | "delivery" | "documents";

/**
 * FileMaker's own tabs, minus the two this module retires: EVENT INFO · ITEMS ·
 * NOTES · DELIVERY · PICS · QUOTE · OLD. `PICS` merges into Documents
 * (decision 14) and `QUOTE`/`OLD` were the v1 repeating-field layouts, which
 * have no successor.
 *
 * NOTES IS ITS OWN TAB because FileMaker made it one and the reason still
 * holds: five multiline fields are a screenful, they are all about which
 * DOCUMENT a sentence prints on, and on the Info tab they pushed the log —
 * the thing you actually read — below the fold.
 */
export const ORDER_TABS: OrderTab[] = ["info", "items", "notes", "delivery", "documents"];

export const ORDER_TAB_LABEL: Record<OrderTab, string> = {
  info: "Info",
  items: "Items",
  notes: "Notes",
  delivery: "Delivery",
  documents: "Documents",
};

/** Anything unrecognised falls back to `info`: a stale bookmark should show
 *  you the record, not an error. */
export function parseOrderTab(raw: string | string[] | undefined): OrderTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ORDER_TABS as string[]).includes(value ?? "") ? (value as OrderTab) : "info";
}

/**
 * A link to one tab of the record you are already on, CARRYING THE CURRENT
 * PARAMS — `from` and `fromLabel` above all, or moving between tabs would
 * strip the breadcrumb trail that led here and the record book would lose its
 * found set.
 */
export function orderTabHref(
  id: string,
  tab: OrderTab,
  params: Record<string, string | string[] | undefined> = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab") continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  if (tab !== "info") search.set("tab", tab);
  const query = search.toString();
  return `/special-orders/${id}${query ? `?${query}` : ""}`;
}

/**
 * Which tabs a record of this KIND actually has.
 *
 * A template and a standing order have no delivery to schedule and no signed
 * quote to file — they are shapes, not events — so those two tabs are absent
 * rather than empty. An empty Documents tab on a standing order would invite
 * somebody to file this week's invoice against the recurrence itself.
 */
export function tabsForKind(kind: SpecialOrderKind): OrderTab[] {
  // A template and a standing order still carry notes — a wholesale account's
  // packing instruction is exactly the kind of thing that belongs on the
  // recurrence, so every day it makes inherits it.
  return kind === "order" ? ORDER_TABS : ["info", "items", "notes"];
}

/* ==========================================================================
 * 10. NAMES
 * ========================================================================== */

export type CustomerName = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
};

/**
 * How a customer is named on screen and on paper.
 *
 * COMPANY IS PART OF THE NAME, not a separate column to check: Cafe Knotted is
 * a company with a contact, and a list showing only "Kim, Ji-Yeon" makes the
 * wholesale rows unfindable by the name everybody uses.
 */
export function customerLabel(c: CustomerName | null | undefined): string {
  if (!c) return "—";
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  const company = (c.company ?? "").trim();
  if (company && person) return `${company} (${person})`;
  return company || person || "—";
}

/** Sortable, and the way a roster is read: last name first. */
export function customerSortKey(c: CustomerName | null | undefined): string {
  if (!c) return "";
  return [c.last_name, c.first_name, c.company]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
