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
 * THE KIND FILTER'S VOCABULARY, which is four answers over a column with three
 * values (Mark, 2026-09-17: "is there a way to make a distinction between
 * standing orders and orders that come from standing orders?").
 *
 * There is, and it needs no migration: a day a standing order materialized is
 * an ordinary `kind = 'order'` carrying `standing_order_id` (099), where a
 * hand-typed order carries none. So the filter splits `order` in two and
 * leaves the column alone.
 *
 * `order` KEEPS ITS VALUE AND NARROWS ITS MEANING to a one-off — a remembered
 * `?kind=order` still parses, and it is the half that makes hiding possible:
 * with Order still matching both there would be no way to take the wholesale
 * days off the screen, which is what was asked for.
 */
export type OrderKindFilter = "order" | "standing_day" | "standing_order" | "template";

export const ORDER_KIND_FILTERS: {
  value: OrderKindFilter;
  label: string;
  separatorBefore?: boolean;
}[] = [
  // RENAMED, AND MATCHED BY "SOLD AS" (Mark, 2026-09-23: "change 'regular
  // order' to 'special order', 'Standing Orders' to 'Wholesale Orders'"). The
  // VALUES stay `order` / `standing_day` so saved views and URLs keep working;
  // since 129 the split is each order's own `square_item`, so a one-off
  // wholesale order is listed as wholesale — see `matchesKindFilter`.
  { value: "order", label: "Special Orders" },
  // Mark's words, 2026-09-17: the DAY is the order and the recurrence is the
  // template that makes it. `KIND_LABEL` keeps the schema's own vocabulary for
  // the record screens; this is the filter's.
  { value: "standing_day", label: "Wholesale Orders" },
  // The two templates below the two kinds of real order, ruled off from them
  // and in the same order as the orders above (Mark, 2026-09-17).
  { value: "template", label: "Special Order Templates", separatorBefore: true },
  { value: "standing_order", label: "Standing Order Templates" },
];

/**
 * DOES THIS KIND FILTER SELECT RECORDS THAT HAVE NO DATE? (Mark, 2026-09-21:
 * "since templates do not carry dates, selecting them in the Kind filter
 * requires also changing the 'show' filter to all time. Can the all time filter
 * be inactive when kind is a standing order or regular order template?")
 *
 * Yes, and the fix belongs here rather than in the range: a template and a
 * standing order have no `event_date` by design — 112's conversion strips it,
 * and `inOrderRange` has always said "a record with NO event date… is OUT of
 * every window and IN all time". So asking for them through the Kind menu and
 * then being shown nothing was the list obeying two controls that cannot both
 * be satisfied. The one that gives way is the DATE, because the Kind menu is
 * the more specific answer — you asked for the shapes by name.
 *
 * The other two values stay date-bound: `order` and `standing_day` are real
 * orders and every one of them has a day.
 */
export function kindFilterIsDateless(value: string): boolean {
  return value === "template" || value === "standing_order";
}

export function matchesKindFilter(
  order: { kind: string; standing_order_id?: string | null; square_item?: string | null },
  value: string
): boolean {
  // Sold as (129) decides it; a row read without the column falls back to
  // the old test, made by a standing order.
  const wholesale = order.square_item ? order.square_item === "wholesale" : Boolean(order.standing_order_id);
  if (value === "order") return order.kind === "order" && !wholesale;
  if (value === "standing_day") return order.kind === "order" && wholesale;
  return order.kind === value;
}

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

/**
 * HOW THE MONEY ARRIVED — decision 2's vocabulary, kept as it is in the data:
 * `Square Invoice` on 1,188 of the 1,190 real payments, `Square Online` on one,
 * `comp` on one, plus the `legacy` type the migration synthesizes for the 5,267
 * pre-2022 orders whose payment was a calc field rather than a row.
 *
 * `allowNew` wherever it is offered, because payment methods are a business
 * fact and not a schema one: the day Donut Friend takes a bank transfer, nobody
 * should need a migration.
 *
 * SHARED, since the list's Record Payment dialog started offering the same list
 * (2026-09-20). It lived in `OrderPayments`; two copies is how one door starts
 * offering a method the other cannot show.
 */
export const PAYMENT_TYPE_OPTIONS: PickOption[] = [
  { value: "Square Invoice", label: "Square Invoice", hint: "the usual" },
  { value: "Square Online", label: "Square Online", hint: "the pay link" },
  { value: "Square Refund", label: "Square Refund", hint: "a pay-link refund, negative" },
  { value: "QuickBooks Payments", label: "QuickBooks Payments", hint: "a QuickBooks invoice's pay link" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "comp", label: "Comp" },
  { value: "legacy", label: "Legacy", hint: "migrated from FileMaker's paid total" },
];

/** A payment the Refund… command can give back: written by `square-pay`
 *  (migration 119), so it carries the Square payment id. Hand-typed rows do
 *  not, and are refunded in Square's own dashboard. */
export function isRefundablePayment(p: {
  payment_type: string | null;
  external_ref: string | null;
  amount: number | null;
}): boolean {
  return p.payment_type === "Square Online" && Boolean(p.external_ref) && Number(p.amount) > 0;
}

/** What a new payment offers before anybody chooses — 1,188 of 1,190. */
export const DEFAULT_PAYMENT_TYPE = "Square Invoice";

/**
 * WHAT A SHAPE'S CHIP SAYS (Mark, 2026-09-21: "add a yellow chip next to the
 * page title on the special order detail screen for templates. 'Template' for
 * regular order templates, and 'Standing Order Template' for standing order
 * templates").
 *
 * A THIRD SPELLING, AND IT EARNS ITS PLACE. `KIND_LABEL` is the schema's
 * vocabulary — "Standing order" — which is right in a `dl` beside the word
 * Kind and wrong on a badge, where the one thing the reader has to take away is
 * that this is not a live order. `ORDER_KIND_FILTERS` says "Standing Order
 * Templates" because a menu names a SET; a chip names one record, so it is the
 * singular of that.
 *
 * An ORDER has no entry here: its chip is its STATUS, which is a state a shape
 * does not have.
 */
/**
 * THE RECORD'S OWN NOUN, AS A MENU ROW SAYS IT (Mark, 2026-09-21, on the
 * command menu reading "Duplicate Order" while standing on a template).
 *
 * `KIND_LABEL` IS THE SAME WORDS IN THE WRONG CASE for this job — it is
 * sentence case for record screens and pickers, where "Standing order" is
 * right, and the command menu is Title Case throughout ("Cancel Order",
 * "Schedule Production…"). "Duplicate Standing order" reads like a bug.
 *
 * Kept beside `KIND_LABEL` rather than derived from it: title-casing a string
 * is a guess about words this app already knows the spelling of. A fixture
 * asserts the two carry the same kinds and the same words, so adding a fourth
 * kind to one and not the other fails the suite rather than shipping.
 */
export const KIND_COMMAND_NOUN: Record<SpecialOrderKind, string> = {
  order: "Order",
  template: "Template",
  standing_order: "Standing Order",
};

export const KIND_CHIP_LABEL: Partial<Record<SpecialOrderKind, string>> = {
  template: "Template",
  standing_order: "Standing Order Template",
};

/**
 * WHAT A STANDING ORDER'S DAYS START AS (migration 112, 2026-09-20).
 *
 * Two rungs, not five. A standing order is a PROTOTYPE, and its status is the
 * one its days inherit — so the only answers that mean anything are the two a
 * materialized day can sensibly arrive at: **Invoice**, for an account that
 * pays before the donuts are made (Cafe Knotted), and **Order**, for one billed
 * in arrears whose days should reach the kitchen without waiting.
 *
 * `lead` and `quote` would describe a conversation this arrangement finished
 * long ago. `cancelled` would be a standing order configured to manufacture
 * cancelled days, which is what `paused` is for and says better. The database
 * does not forbid those three here — the widened constraint only says a
 * standing order HAS a status — so this list is the guard, which is why the
 * record's picker reads it rather than `STATUS_OPTIONS`.
 */
export const STANDING_STATUS_OPTIONS: PickOption[] = [
  {
    value: "invoice",
    label: STATUS_LABEL.invoice,
    hint: "days arrive unpaid — they wait for the money before production",
  },
  {
    value: "order",
    label: STATUS_LABEL.order,
    hint: "days arrive committed and can be scheduled straight away",
  },
];

/**
 * THE NINE COMPLETION DATES, in Mark's own arrangement (2026-09-16) — Order
 * initiated alone, then the pairs: quote sent · approved, invoice sent · paid,
 * delivery scheduled · receipt sent, order printed · order scheduled.
 *
 * ONE LIST, TWO SCREENS. The record's block has read this order since it was
 * arranged; the list's batch command offers the same nine (2026-09-20), and a
 * second copy is how one door quietly starts offering a date the other does
 * not. It is NOT `STAGES`, which is the list's seven stage COLUMNS and carries
 * its own short labels for a narrow grid — this one is the record's wording,
 * read beside a field.
 */
export const COMPLETION_DATES: { column: string; label: string }[] = [
  { column: "date_initiated", label: "Order initiated" },
  { column: "quote_sent_at", label: "Quote sent" },
  { column: "quote_returned_at", label: "Quote approved" },
  { column: "invoice_sent_at", label: "Invoice sent" },
  { column: "invoice_paid_at", label: "Invoice paid" },
  { column: "delivery_scheduled_at", label: "Delivery scheduled" },
  { column: "receipt_sent_at", label: "Receipt sent" },
  { column: "order_printed_at", label: "Order printed" },
  { column: "order_scheduled_at", label: "Order scheduled" },
];

/** Decision 4: flagging an order sets this todo, and resolving clears both. */
export const FLAG_TODO = "Resolve Issue";

/**
 * WAS THIS FLAG TYPED BY ONE OF US? (migration 116)
 *
 * The column carries two different facts and always did. A PERSON's flag is a
 * problem somebody chose to record — it outlives an unrelated edit and is
 * cleared on purpose. A SYSTEM flag is a notice that something reached the
 * order from outside — a new inquiry, a customer approving a quote — and it
 * clears itself the moment anyone here touches the record.
 *
 * Only the two places where the difference CHANGES AN ANSWER ask: the to-do
 * suggestion (news is not an issue to resolve) and production readiness (news
 * is not a reason to hold a schedule). Everything that just wants "does this
 * row want a human" — `needsAttention`, the red row, the progress tone, the
 * start page's ordering — reads `flag_reason` and is right to, because both
 * kinds mean exactly that.
 *
 * ABSENT READS AS `person`, which is deliberate: a query that has not been
 * taught to select `flag_source` keeps pre-116 behaviour, and pre-116
 * behaviour is the half that hides nothing.
 */
export function isPersonFlag(order: {
  flag_reason: string | null;
  flag_source?: string | null;
}): boolean {
  return Boolean(order.flag_reason) && order.flag_source !== "system";
}

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
  /**
   * The rush fee as a FRACTION of the subtotal (migration 118), mirroring
   * `discount_rate` — but NOT mirroring its arithmetic. Where a discount's two
   * fields ADD, a rate here RESOLVES: set, the fee is
   * `max(subtotal × rate, minimum)` and `rush_fee` is not added to it; null,
   * `rush_fee` is the fee. Mark's rule, 2026-09-22: "either the user facing
   * percentage, or $25, whichever is greater".
   *
   * REQUIRED, not optional, and that is the whole lesson of 2026-09-22. It
   * shipped optional "so rows written before 118 mean what they meant" — and
   * optional meant the compiler could not see that FIVE hand-built money
   * objects had not been taught the column. The selects all read it; the
   * literals downstream dropped it; the first real rush order showed two blank
   * boxes. `null` already says "no rate" perfectly well, so the only thing
   * optionality bought was silence.
   *
   * Design rule 1's lesson in a second place: a value every construction site
   * must remember is one the type should demand.
   */
  rush_rate: number | null;
  ignore_balance?: boolean | null;
  /** 138: the deposit asked for, as a fraction. Optional, unlike `rush_rate`:
   *  it changes no total, so a construction site that forgets it prints no
   *  deposit rather than a wrong figure. */
  deposit_rate?: number | null;
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
 * WHAT THE RUSH FEE COMES TO (migration 118).
 *
 * A RATE RESOLVES, IT DOES NOT ADD — the one place this pair differs from
 * `discount_amount` / `discount_rate` above. Mark's rule, 2026-09-22: "either
 * the user facing percentage, or $25, whichever is greater". So a rate means
 * the typed amount is not part of the answer; clearing the rate gives it back.
 *
 * That asymmetry is deliberate and is why the record shows the resolved figure
 * beside the two boxes rather than leaving somebody to add them up: two fields
 * that ADD are two contributions, two fields where one WINS need the winner
 * shown.
 *
 * ZERO IS A RATE. `rush_rate = 0` is somebody saying "no rush fee on this one"
 * and must not fall through to the amount — hence a null check rather than a
 * truthiness one. A zero rate still floors at the minimum only if you ask it
 * to; it does not, because `max(0 × subtotal, minimum)` would charge $25 for
 * saying no. The floor applies to a rate ABOVE zero.
 */
export function resolveRushFee(
  order: Pick<MoneyOrder, "rush_fee" | "rush_rate">,
  subtotal: number,
  rush: RushTerms = DEFAULT_RUSH_TERMS
): number {
  const rate = order.rush_rate;
  if (rate === null || rate === undefined) return cents(n(order.rush_fee));
  const asNumber = n(rate);
  if (asNumber <= 0) return 0;
  return cents(Math.max(subtotal * asNumber, rush.minimum));
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
  payments: MoneyPayment[] = [],
  /**
   * The org's rush terms, for the floor under a rate (118). Defaulted rather
   * than required so that adding it could not silently change a total anywhere
   * it was not passed — and the default IS the org's value today, measured:
   * `rush_minimum` is 25, which is `DEFAULT_RUSH_TERMS.minimum`.
   */
  rush: RushTerms = DEFAULT_RUSH_TERMS
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
  const rushFee = resolveRushFee(order, subtotal, rush);
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
 * `ignore_balance` KEEPS AN ORDER OUT OF THE UNPAID QUEUE, which is what its
 * own checkbox says and all this module may rely on. **It is NOT "billed in
 * arrears"** — that reading was written here in August and retracted by Mark on
 * 2026-09-20 ("disregard what you think you know about ignore_balance: it
 * doesn't exist for orders paid in arrears"). What it IS for is not recorded
 * anywhere yet; until it is, read the flag and not a story about it.
 *
 * A CREDIT BALANCE COUNTS AS PAID — `<= 0`, not `=== 0`. An overpayment or a
 * post-hoc discount leaves a negative balance, and "we owe them $4" is not an
 * unpaid order to chase.
 */
export function isSettled(order: MoneyOrder, totals: OrderTotals): boolean {
  return Boolean(order.ignore_balance) || totals.balance <= 0;
}

/**
 * Does this order's balance count as money the customer OWES us?
 *
 * Only once we have BILLED them: status `invoice` (sent, awaiting payment) or
 * `order` (committed). A lead or a quote derives a balance too — it has lines
 * and no payments — but that figure is a price we OFFERED, not a debt, and
 * counting it made the customer book claim $210k outstanding on 764 quotes
 * (measured 2026-09-17) against ~$60k really billed.
 *
 * `kind === "order"` stays load-bearing: a standing order or a template is a
 * shape, never a bill. `ignore_balance` is decision 13's weekly-statement
 * escape hatch. The two customer screens both ask this, so they cannot
 * disagree about one customer's money again.
 */
export function countsAsOwed(order: {
  kind: string;
  status: string | null;
  ignore_balance?: boolean | null;
}): boolean {
  return (
    order.kind === "order" &&
    (order.status === "invoice" || order.status === "order") &&
    !order.ignore_balance
  );
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
  /** Migration 116. OPTIONAL, and absent means 'person' everywhere it is read:
   *  a caller that has not been taught to select it gets the behaviour that
   *  was there before 116, which is the safe half — a flag that stays put. */
  flag_source?: string | null;
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
    // Only a BILLED order can be unpaid (`countsAsOwed`). A lead or quote whose
    // day has gone by was never ordered, not unpaid — 800-odd FileMaker quotes
    // sat in this queue claiming $230k before 2026-09-17.
    if (countsAsOwed(order) && !isSettled(order, totals) && totals.total > 0) {
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
/**
 * THE TO-DO A PAID ORDER GETS (Mark, 2026-09-22): "if the order is set for
 * delivery, when it's paid in full, the to do should be set to 'schedule
 * delivery'". A delivery order whose courier is not booked yet books it first;
 * everything else — and a delivery already booked — goes to the printer.
 *
 * One function, because three places say it and must agree: the offer after a
 * hand-recorded payment (`lib/orderWorkflow`), the derived suggestion below,
 * and migration 122's pay-link payment, which is the SQL copy of this rule.
 */
export function paidTodo(order: {
  fulfillment?: string | null;
  delivery_scheduled_at: string | null;
}): "Schedule Delivery" | "Print Order" {
  return order.fulfillment === "delivery" && !order.delivery_scheduled_at
    ? "Schedule Delivery"
    : "Print Order";
}

export function suggestedTodo(
  order: AttentionOrder,
  /** Today in the org's timezone. Optional: without it the two "chase them"
   *  suggestions simply never fire, which is the quiet answer, not a wrong one. */
  today?: string
): string | null {
  if (order.kind !== "order" || order.status === "cancelled") return null;
  // A PERSON'S FLAG NAMES A PROBLEM, so resolving it IS the next action.
  // A SYSTEM flag (116) does not: "Quote approved online by Jane Doe" is news,
  // and the next action is the one the ladder was already going to suggest —
  // send the invoice. Answering "Resolve Issue" to good news is what made the
  // flag feel like a chore rather than a notice.
  if (isPersonFlag(order)) return FLAG_TODO;

  /**
   * EACH CASE ASKS WHETHER ITS OWN DOCUMENT HAS GONE OUT (Mark, 2026-08-20,
   * with two orders that proved it). The old version only ever looked at the
   * NEXT stage's date, so it could not tell "not sent yet" from "sent and
   * unanswered" and suggested the send either way:
   *
   *   · 9863 — status `invoice`, invoiced on the 6th, unpaid. It suggested
   *     "Send Invoice" for an invoice that had gone out sixteen days earlier.
   *   · 9882 — status `quote`, quoted on the 12th, unreturned. It suggested
   *     "Respond to Email/Call", which is what you do for a LEAD that has
   *     written in, not for a quote sitting with a customer.
   *
   * WHEN THE BALL IS IN THEIR COURT THE SUGGESTION IS NOTHING, until it is
   * genuinely late. There is no action for us while a fresh quote is out, and a
   * to-do suggested on every such row is the noise that teaches people to
   * ignore the column. The strip says "waiting on them" in yellow meanwhile,
   * which is the honest state.
   */
  const late = today ? order.event_date !== null && order.event_date < today : false;

  switch (order.status) {
    case "lead":
      // A quote already out is their move; it is not yet an invoice.
      return order.quote_sent_at ? null : "Send Quote";
    case "quote":
      if (order.quote_returned_at) return "Send Invoice";
      if (!order.quote_sent_at) return "Send Quote";
      return null; // Out, unanswered — theirs.
    case "invoice":
      if (order.invoice_paid_at) return paidTodo(order);
      if (!order.invoice_sent_at) return "Send Invoice";
      // FileMaker's own word for an invoice that has gone out and not come
      // back. Only once the event has passed — before that it is simply
      // outstanding.
      return late ? "Invoice Overdue!" : null;
    case "order":
      // A delivery waiting on its courier books that before printing; once
      // `delivery_scheduled_at` is set, `paidTodo` answers Print Order.
      if (!order.order_printed_at) return paidTodo(order);
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
 * The SQL materializer (migration 099's `ensure_standing_orders_materialized`)
 * is the one that WRITES — three callers, one implementation, 013's precedent —
 * and this is the same rule in TypeScript so the app can SAY what a top-up
 * would do before anyone presses anything. That is a deliberate second
 * implementation of a small rule, and the fixtures pin both ends of it.
 *
 * The two must agree. If this ever disagrees with the function, the RECORD's
 * "next 14 days: 4 orders" line and the orders that actually appear disagree
 * too, which is worse than either being wrong alone.
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

/**
 * What a top-up did — 099's receipt, as the three callers read it.
 *
 * Declared on BOTH SIDES, like every other edge-function and RPC payload in
 * this app: the function is SQL and cannot import from `web/`, so the shape is
 * stated here and the fixtures are what keep the two honest. Every field is
 * optional except the counts, because a `skipped` receipt carries neither
 * window nor rows.
 */
export type MaterializationReceipt = {
  ok: boolean;
  created: number;
  existing: number;
  from?: string;
  through?: string;
  /** `"role"` when the caller is below supervisor+ — see 099's header. */
  skipped?: string;
  orders?: {
    number: string;
    event_date: string;
    standing_number: string;
    title: string | null;
  }[];
  warnings?: { standing_number?: string; title?: string | null; reason: string }[];
};

/**
 * The window a routine top-up covers: today through the org's horizon.
 *
 * ONE FUNCTION FOR BOTH AUTOMATIC CALLERS, because a list and a generate
 * dialog reaching different distances would mean the orders you can see and
 * the orders you can bake are two different sets — and the difference would
 * only show on the days nobody looked at the list.
 *
 * The escape hatch deliberately does NOT use this: its whole job is to reach
 * past the horizon for a one-off, which is why 099 takes the window rather
 * than reading `horizon_days` itself.
 */
export function topUpWindow(today: string, horizonDays: number): { from: string; through: string } {
  // A horizon of nothing still means TODAY — the day whose donuts are being
  // made tonight. Clamped rather than trusted, because it comes out of
  // `orgs.settings` where somebody can type a 0.
  return { from: today, through: addDays(today, Math.max(0, Math.floor(horizonDays))) };
}

/**
 * One sentence for a receipt, for the escape hatch's own panel.
 *
 * NAMES WHAT IT DID AND WHAT IT DID NOT, in that order, because "nothing was
 * made" is the answer people will meet most often — the horizon is usually
 * already full — and it reads as a failure unless the sentence says the days
 * are already there.
 */
export function materializationSummary(receipt: MaterializationReceipt): string {
  if (receipt.skipped === "role") {
    return "You do not have permission to create orders, so nothing was made.";
  }
  const made = receipt.created;
  const already = receipt.existing;
  if (made === 0 && already === 0) return "There were no days to make in that range.";
  if (made === 0) {
    return `Nothing to make — all ${already} day${already === 1 ? "" : "s"} in that range already exist.`;
  }
  const tail = already > 0 ? `, and ${already} already existed` : "";
  return `Made ${made} order${made === 1 ? "" : "s"}${tail}.`;
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
      // SOMEBODY ELSE'S MOVE, and it stays yellow while the event is still
      // ahead (Mark, 2026-08-20, on order 9882: the quote went out on the 12th
      // for an event on the 22nd, and the strip painted it RED). It was
      // `close || past`, and `close` is `printWithinDays` — two days — so every
      // quote still out in the last 48 hours read as overdue when the honest
      // reading is that we are waiting on them.
      //
      // PAST is a different matter and stays red: once the event is behind you,
      // "waiting" is a euphemism. What this deliberately gives up is a warning
      // in the last two days, which the row's own event date and the attention
      // queue both still carry.
      if (!order.quote_sent_at) return null;
      return past ? "overdue" : "waiting";
    case "invoice_sent":
      return close || past ? "overdue" : null;
    case "invoice_paid":
      // The same, on order 9863: invoiced on the 6th for an event on the 22nd.
      if (!order.invoice_sent_at) return null;
      return past ? "overdue" : "waiting";
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
  /** The deposit an order asks for when somebody switches one on, as a
   *  FRACTION (0.1 is 10%) — `special_orders.deposit_rate` (migration 138). */
  depositRate: number;
};

export const DEFAULT_SETTINGS: SpecialOrderSettings = {
  horizonDays: 14,
  rush: DEFAULT_RUSH_TERMS,
  attention: DEFAULT_ATTENTION,
  invoiceFooter: "We appreciate your business!",
  terms: "",
  depositRate: 0.1,
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
    depositRate: validDepositRate(num(raw.deposit_rate, DEFAULT_SETTINGS.depositRate))
      ?? DEFAULT_SETTINGS.depositRate,
  };
}

/* ==========================================================================
 * DEPOSITS (migration 138)
 * ========================================================================== */

/**
 * A deposit rate the database will take: a fraction strictly between 0 and 1
 * (the column's check). Anything else is null — no deposit — rather than a
 * figure somebody did not mean.
 */
export function validDepositRate(rate: unknown): number | null {
  const x = typeof rate === "string" ? Number(rate) : rate;
  return typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1 ? x : null;
}

/**
 * WHAT A DEPOSIT COMES TO: the order's total × its rate, to the cent. The
 * SAME rounding as `special_order_deposit` in SQL — `js_cents`, which is
 * floor(x·100 + 0.5)/100 in double precision — so the order's screen, the
 * paper and what the pay link charges agree. Zero when no deposit is asked.
 */
export function depositAmount(total: number, rate: number | null | undefined): number {
  const r = validDepositRate(rate);
  if (r === null || !(total > 0)) return 0;
  return Math.floor(total * r * 100 + 0.5) / 100;
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
export type OrderTab = "info" | "items" | "payments" | "notes" | "delivery" | "documents";

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
/*
 * PAYMENTS IS ITS OWN TAB (Mark, 2026-09-16), holding the Payments table and
 * the Money block, which sat under the lines on Items. It comes right after
 * Items: what was ordered, then what it costs and what has been paid.
 */
export const ORDER_TABS: OrderTab[] = ["info", "items", "payments", "notes", "delivery", "documents"];

export const ORDER_TAB_LABEL: Record<OrderTab, string> = {
  info: "Info",
  items: "Items",
  payments: "Payments",
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
/**
 * A template and a standing order still carry notes — a wholesale account's
 * packing instruction belongs on the recurrence, so every day it makes
 * inherits it — but they have no delivery to book and no signed quote to file.
 *
 * **DELIVERY ONLY EXISTS FOR A DELIVERY** (Mark, 2026-08-17: "Delivery being on
 * its own is weird but not sure where it fits"). It is weird because for a
 * PICKUP order the tab held a two-cell toggle and a sentence — and pickup is
 * 6,842 of the 8,330 real orders, so four times out of five it was a tab
 * leading to nothing.
 *
 * So the CHOICE moved to the Details quadrant, beside Pickup shop, where it
 * belongs — it is a fact about the order, not a delivery detail — and the tab
 * appears only when there is something on it. Switching the cell to Delivery
 * makes it appear, which is how you get to it; nothing is hidden behind a
 * state you cannot reach.
 */
export function tabsFor(kind: SpecialOrderKind, fulfillment: string | null): OrderTab[] {
  // A template and a standing order keep Payments: it is where their Money
  // block lives — the delivery charge and discount a duplicate inherits.
  if (kind !== "order") return ["info", "items", "payments", "notes"];
  return fulfillment === "delivery"
    ? ORDER_TABS
    : ORDER_TABS.filter((t) => t !== "delivery");
}

/** How an order leaves the shop. A closed set, so it is a `PickList`. */
export const FULFILLMENT_OPTIONS: PickOption[] = [
  { value: "pickup", label: "Pickup", hint: "collected at the shop" },
  { value: "delivery", label: "Delivery", hint: "adds the Delivery tab" },
];

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

/**
 * The customer's own name as a PERSON, for copying into an order's day-of
 * contact — not `customerLabel`, which composes "Company (Person)" for a
 * reader and would put a company's name in a field labelled "Day-of contact
 * name". Company is the FALLBACK rather than the lead: a company-only customer
 * has no person to name, and the company is better than nothing.
 */
export function customerContactName(c: CustomerName | null | undefined): string {
  if (!c) return "";
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return person || (c.company ?? "").trim();
}

/**
 * WHAT "COPY TO CONTACT" WOULD DO, decided here rather than in the component so
 * its edge cases can be asserted (`scripts/fixtures/specialOrders.fixtures.ts`).
 *
 * Three rules, each of which is a bug if you get it backwards:
 *   · ONLY NON-EMPTY SOURCE VALUES TRAVEL. A customer with no email must not
 *     blank an email somebody typed on the order — copying an absence is a
 *     delete wearing a copy's label.
 *   · `changing` DROPS VALUES THAT ALREADY MATCH, so pressing the button twice
 *     is a no-op and the confirm never asks about a field it would not touch.
 *     Compared trimmed, or " Jane" vs "Jane" reads as a change forever.
 *   · `replacing` IS THE SUBSET THAT OVERWRITES SOMETHING. Filling an EMPTY
 *     field is not a replacement and must not raise a confirm, or the common
 *     case — a fresh order with nothing typed yet — costs a dialog for nothing.
 */
export type ContactCopyPlan = {
  /** The columns to write, already trimmed. Empty when there is nothing to do. */
  wanted: { contact_name?: string; contact_phone?: string; contact_email?: string };
  /** The keys of `wanted` whose current value differs. */
  changing: string[];
  /** The subset of `changing` that would overwrite a non-empty value. */
  replacing: string[];
};

export function contactCopyPlan(
  from: { name: string; phone: string | null; email: string | null } | null,
  onto: { name: string | null; phone: string | null; email: string | null },
): ContactCopyPlan {
  const wanted: Record<string, string> = {};
  if (from?.name?.trim()) wanted.contact_name = from.name.trim();
  if (from?.phone?.trim()) wanted.contact_phone = from.phone.trim();
  if (from?.email?.trim()) wanted.contact_email = from.email.trim();

  const current: Record<string, string> = {
    contact_name: (onto.name ?? "").trim(),
    contact_phone: (onto.phone ?? "").trim(),
    contact_email: (onto.email ?? "").trim(),
  };

  const changing = Object.keys(wanted).filter((k) => current[k] !== wanted[k]);
  const replacing = changing.filter((k) => current[k] !== "");
  return { wanted, changing, replacing };
}

/** What the confirm calls each field — the labels the detail screen shows. */
export const CONTACT_FIELD_LABEL: Record<string, string> = {
  contact_name: "Day-of contact",
  contact_phone: "Contact phone",
  contact_email: "Contact email",
};

/** Sortable, and the way a roster is read: last name first. */
export function customerSortKey(c: CustomerName | null | undefined): string {
  if (!c) return "";
  return [c.last_name, c.first_name, c.company]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Does this allergen note say there is NOTHING to worry about?
 *
 * Measured over the 835 real orders that carry one: **446 of them (53%) say
 * some spelling of "no"** — "no" 242, "none" 132, "n/a" 44, "no allergies" 11,
 * "na" 10, "nope" 6. So a screen that marks the field whenever it is filled
 * spends its attention colour on a coin flip, and the mark that matters —
 * PEANUTS — is the one that stops being read.
 *
 * IT FAILS SAFE, and that is the whole design. The test is a WHOLE-STRING match
 * against a closed list of phrases, never a substring: "no nuts" contains "no"
 * and means the opposite of it. Anything this function has not seen before is
 * shown, so a new way of writing nothing costs one redundant chip while a new
 * way of writing an allergy costs nobody a hospital visit.
 */
const NO_ALLERGY = new Set([
  "no", "none", "n/a", "na", "nope", "no allergies", "no allergy",
  "no allergens", "nil", "-", "--", "n a", "not applicable", "no known allergies",
]);

export function meansNoAllergy(text: string | null | undefined): boolean {
  const v = (text ?? "")
    .trim()
    .toLowerCase()
    // Trailing punctuation only — nothing that could join two words.
    .replace(/[.!,;:]+$/, "")
    .trim();
  if (v === "") return true;
  return NO_ALLERGY.has(v);
}
