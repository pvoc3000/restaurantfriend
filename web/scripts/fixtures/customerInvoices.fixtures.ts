// `lib/customerInvoices` — migration 124's pure half: one invoice, one line
// per order, one pay link.
//
// Checked by breaking: `invoiceLinesFor` billing `total` rather than `balance`
// turns the deposit case red; dropping the shop test from `createRefusals`
// turns the two-kitchens case red; letting `sumBreakdowns` accept mixed rates
// turns that case red.

import { test, eq, ok } from "./harness";
import {
  addDays,
  createRefusals,
  invoiceBalance,
  invoiceFileName,
  invoiceLinesFor,
  invoiceNumberText,
  invoiceStatus,
  invoiceTotalsBreakdown,
  groupInvoiceLines,
  groupTotals,
  scaleBreakdown,
  snapshotLines,
  type CustomerInvoiceLine,
  isCustomerInvoiceSnapshot,
  orderLineDescription,
  readInvoiceTerms,
  sumBreakdowns,
  type InvoiceCandidate,
} from "../../src/lib/customerInvoices";

const day = (n: number, over: Partial<InvoiceCandidate> = {}): InvoiceCandidate => ({
  id: `o${n}`,
  number: String(10056 + n),
  kind: "order",
  status: "invoice",
  title: null,
  event_date: `2026-10-${String(4 + n).padStart(2, "0")}`,
  customer_id: "knotted",
  customer_name: "Cafe Knotted",
  shop: "DF02",
  balance: n <= 4 ? 613.5 : 1125,
  ...over,
});
const week = [1, 2, 3, 4, 5, 6, 7].map((n) => day(n));

test("orderLineDescription: Mark's wording, empty parts dropped", () => {
  eq(
    orderLineDescription({ number: "10070", title: "Birthday", event_date: "2026-09-26" }),
    "Order #10070 · Birthday · 9/26/2026"
  );
  eq(
    orderLineDescription({ number: "10057", title: null, customer_name: "Cafe Knotted", event_date: "2026-10-05" }),
    "Order #10057 · Cafe Knotted · 10/5/2026",
    "a standing-order day has no title, so the customer names it"
  );
  eq(orderLineDescription({ number: "1", title: null, event_date: null }), "Order #1");
});

test("createRefusals: Knotted's week is one invoice", () => {
  eq(createRefusals(week), []);
});

test("createRefusals: each rule, in words", () => {
  eq(createRefusals([]), ["Select the orders to invoice."]);
  ok(createRefusals([...week, day(8, { kind: "standing_order" })])[0].includes("standing order"));
  ok(createRefusals([...week, day(8, { status: "cancelled" })])[0].includes("cancelled"));
  ok(createRefusals([...week, day(8, { customer_id: "someone" })])[0].includes("one customer"));
  ok(createRefusals([...week, day(8, { customer_id: null })])[0].includes("no customer"));
  ok(createRefusals([...week, day(8, { shop: "DF01" })])[0].includes("different shops"));
  ok(createRefusals([...week, day(8, { balance: 0 })])[0].includes("nothing owed"));
});

test("invoiceLinesFor: oldest event first, one line per order", () => {
  const lines = invoiceLinesFor([...week].reverse());
  eq(lines.length, 7);
  eq(lines[0].order_id, "o1");
  eq(lines[6].order_id, "o7");
  eq(lines[0].description, "Order #10057 · Cafe Knotted · 10/5/2026");
  eq(lines.reduce((a, l) => a + l.amount, 0), 4 * 613.5 + 3 * 1125);
});

test("invoiceLinesFor: bills what is OWED, so a deposit is not billed twice", () => {
  const [line] = invoiceLinesFor([day(1, { balance: 413.5 })]);
  eq(line.amount, 413.5);
});

test("invoiceStatus: derived from the invoice's own dates", () => {
  const base = { sent_at: null, paid_at: null, voided_at: null, due_on: "2026-10-08" };
  eq(invoiceStatus(base, "2026-10-04"), "draft");
  eq(invoiceStatus({ ...base, sent_at: "2026-10-04" }, "2026-10-08"), "sent", "due today is not overdue");
  eq(invoiceStatus({ ...base, sent_at: "2026-10-04" }, "2026-10-09"), "overdue");
  eq(invoiceStatus({ ...base, sent_at: "2026-10-04", paid_at: "2026-10-06" }, "2026-10-09"), "paid");
  eq(invoiceStatus({ ...base, sent_at: "2026-10-04", paid_at: "2026-10-06", voided_at: "2026-10-07" }, "2026-10-09"), "void");
});

test("invoiceBalance: tagged payments and refunds", () => {
  const lines = [{ amount: 613.5 }, { amount: 1125 }];
  eq(invoiceBalance(lines, []), { total: 1738.5, paid: 0, balance: 1738.5 });
  eq(invoiceBalance(lines, [{ amount: 1738.5 }]).balance, 0);
  eq(invoiceBalance(lines, [{ amount: 1738.5 }, { amount: -100 }]).balance, 100, "a refund reopens it");
  eq(invoiceBalance([{ amount: 0.1 }, { amount: 0.2 }], []).total, 0.3, "no floating-point dust");
});

test("invoiceStatus: void wins, then paid, then draft; overdue is sent and past due", () => {
  const base = { sent_at: "2026-10-04", paid_at: null, voided_at: null, due_on: "2026-10-08" };
  eq(invoiceStatus(base, "2026-10-05"), "sent");
  eq(invoiceStatus(base, "2026-10-09"), "overdue");
  eq(invoiceStatus({ ...base, paid_at: "2026-10-06" }, "2026-10-09"), "paid");
  eq(invoiceStatus({ ...base, voided_at: "2026-10-07", paid_at: "2026-10-06" }, "2026-10-07"), "void");
  eq(invoiceStatus({ ...base, sent_at: null }, "2026-10-09"), "draft", "a draft is never overdue");
});

test("readInvoiceTerms: settings, with defaults for what is missing", () => {
  eq(readInvoiceTerms({}), { termsDays: 4, prefix: "" });
  eq(readInvoiceTerms({ customer_invoices: { terms_days: 7, prefix: "DF-" } }), { termsDays: 7, prefix: "DF-" });
  eq(readInvoiceTerms({ customer_invoices: { terms_days: "abc" } }).termsDays, 4);
  eq(readInvoiceTerms({ customer_invoices: { terms_days: 0 } }).termsDays, 0, "due on receipt is a real term");
});

test("addDays: Sunday plus four is Thursday, across a month and a DST night", () => {
  eq(addDays("2026-10-04", 4), "2026-10-08");
  eq(addDays("2026-10-30", 4), "2026-11-03", "US DST ends 2026-11-01");
  eq(addDays("2026-12-30", 4), "2027-01-03");
});

test("invoiceNumberText / invoiceFileName", () => {
  eq(invoiceNumberText(1001, { prefix: "" }), "1001");
  // 143: a revision keeps the number and says which one it is.
  eq(invoiceNumberText(1014, { prefix: "" }, 1), "1014", "the first is just the number");
  eq(invoiceNumberText(1014, { prefix: "" }, 2), "1014-2");
  eq(invoiceNumberText(1014, { prefix: "DF-" }, 3), "DF-1014-3", "the prefix, then the revision");
  eq(invoiceNumberText(1001, { prefix: "DF-" }), "DF-1001");
  eq(invoiceFileName("1001", "2026-10-04"), "INVOICE#1001_2026.10.04.pdf");
});

test("sumBreakdowns: Knotted's untaxed week sums straight", () => {
  const part = (total: number, delivery: number) => ({
    taxable_net: 0, other_net: total - delivery, delivery, tax: 0, tax_rate: 0, total,
  });
  eq(sumBreakdowns([part(613.5, 40), part(1125, 40)]), {
    taxable_net: 0, other_net: 1658.5, delivery: 80, tax: 0, tax_rate: 0, total: 1738.5,
  });
  eq(sumBreakdowns([]), null);
});

test("sumBreakdowns: one tax rate or none — mixed rates fall back to one line", () => {
  const taxed = (rate: number) => ({ taxable_net: 100, other_net: 0, delivery: 0, tax: 100 * rate, tax_rate: rate, total: 100 + 100 * rate });
  eq(sumBreakdowns([taxed(0.0975), taxed(0.0975)])?.tax_rate, 0.0975);
  eq(sumBreakdowns([taxed(0.0975), taxed(0.095)]), null);
  eq(
    sumBreakdowns([taxed(0.0975), { taxable_net: 0, other_net: 50, delivery: 0, tax: 0, tax_rate: 0, total: 50 }])?.tax_rate,
    0.0975,
    "an untaxed order's zero rate does not count as a second rate"
  );
});

test("isCustomerInvoiceSnapshot: tells the two snapshots apart", () => {
  ok(isCustomerInvoiceSnapshot({ kind: "customer_invoice" }));
  eq(isCustomerInvoiceSnapshot({ number: "10070", lines: [] }), false);
  eq(isCustomerInvoiceSnapshot(null), false);
});

test("createRefusals: an order already on an invoice is refused before the database refuses it", () => {
  ok(createRefusals([...week, day(8, { on_invoice: true })])[0].includes("already on an invoice"));
  eq(createRefusals(week.map((r) => ({ ...r, on_invoice: false }))), []);
});

// 141: AN INVOICE OWNS ITS LINES. The figures are the throwaway-Postgres run's:
// two Knotted days (370 × $1.55 + $50 delivery), a $40 Delivery Fee of the
// invoice's own, and the wedding's $547.50 balance less its $100 deposit.
//
// Checked by breaking: summing prior_billing into the subtotal turns "adds to
// Amount due" red; sorting groups by number before date turns "oldest event
// first" red; scaling `other_net` rather than taking it by subtraction turns
// "to the cent" red.
let seq = 0;
const line = (o: Partial<CustomerInvoiceLine>): CustomerInvoiceLine => ({
  id: `l${++seq}`,
  special_order_id: null,
  line_type: "item",
  description: "",
  qty: null,
  unit_price: null,
  amount: 0,
  taxable: false,
  tax_rate: null,
  order_label: null,
  sort: 0,
  square_item: "special_order",
  ...o,
});
const knottedDay = (order: string, label: string) => [
  line({ special_order_id: order, line_type: "item", description: "Knotted Bismark - 42g", qty: 370, unit_price: 1.55, amount: 573.5, order_label: label, sort: 0 }),
  line({ special_order_id: order, line_type: "delivery", description: "Delivery", amount: 50, order_label: label, sort: 1001 }),
];
const knottedWeek = [
  ...knottedDay("o2", "Order #10050 · Cafe Knotted · 10/6/2026"),
  line({ line_type: "delivery", description: "Delivery Fee", qty: 4, unit_price: 10, amount: 40, sort: 0 }),
  ...knottedDay("o1", "Order #10057 · Cafe Knotted · 10/5/2026"),
];
const orders = new Map([
  ["o1", { number: "10057", event_date: "2026-10-05" }],
  // A LOWER number on a LATER day: a split goes by the day, not the number.
  ["o2", { number: "10050", event_date: "2026-10-06" }],
]);

test("groupInvoiceLines: oldest event first, each order once, the invoice's own lines last", () => {
  const g = groupInvoiceLines(knottedWeek, orders);
  eq(g.map((x) => x.key), ["o1", "o2", "free"], "oldest event first");
  eq(g.map((x) => x.net), [623.5, 623.5, 40]);
  eq(g.map((x) => x.kind), ["charges", "charges", "free"]);
  eq(g[0].label, "Order #10057 · Cafe Knotted · 10/5/2026");
  eq(g[2].label, "Other charges");
  eq(g[0].lines.map((l) => l.line_type), ["item", "delivery"], "a group's own order");
});

test("groupInvoiceLines: a deposit, and a one-line order sent before 141, say so", () => {
  const g = groupInvoiceLines(
    [
      line({ special_order_id: "o1", line_type: "deposit", description: "Deposit", amount: 100 }),
      line({ special_order_id: "o2", line_type: "order_total", description: "Order #10068", amount: 623.5 }),
    ],
    orders
  );
  eq(g.map((x) => x.kind), ["deposit", "order_total"]);
});

test("snapshotLines: the pay page lists each order once and each free line as itself", () => {
  eq(snapshotLines(groupInvoiceLines(knottedWeek, orders)), [
    { description: "Order #10057 · Cafe Knotted · 10/5/2026", amount: 623.5 },
    { description: "Order #10050 · Cafe Knotted · 10/6/2026", amount: 623.5 },
    { description: "Delivery Fee", amount: 40 },
  ]);
  eq(
    snapshotLines(groupInvoiceLines([line({ special_order_id: "o1", line_type: "deposit", description: "Deposit", amount: 100, order_label: "Order #10080 · Smith wedding · 12/12/2026" })], orders)),
    [{ description: "Deposit · Order #10080 · Smith wedding · 12/12/2026", amount: 100 }]
  );
});

const wedding = [
  line({ special_order_id: "w", line_type: "item", description: "Glazed dozen", qty: 10, unit_price: 50, amount: 500, taxable: true }),
  line({ special_order_id: "w", line_type: "tax", description: "Sales tax", amount: 47.5, tax_rate: 0.095 }),
  line({ special_order_id: "w", line_type: "prior_billing", description: "Less invoice 1004", amount: -100 }),
];

test("groupTotals: the order's money in orderTotals' shape, from its own lines", () => {
  eq(groupTotals(wedding), {
    subtotal: 500, taxableSubtotal: 500, discount: 0, deliveryCharge: 0, rushFee: 0, tax: 47.5, total: 547.5,
  });
  eq(groupTotals(knottedDay("o1", "x")).total, 623.5);
});

test("scaleBreakdown: a group's split scaled to what it bills here, to the cent", () => {
  const whole = { taxable_net: 500, other_net: 0, delivery: 0, tax: 47.5, tax_rate: 0.095, total: 547.5 };
  const b = scaleBreakdown(whole, 447.5);
  eq(Math.round((b.taxable_net + b.other_net + b.delivery + b.tax) * 100) / 100, 447.5, "to the cent");
  eq(b.total, 447.5);
  ok(b.taxable_net < 500 && b.tax < 47.5, "every part scaled down");
  eq(scaleBreakdown(whole, 547.5), whole, "nothing to scale");
  eq(scaleBreakdown({ ...whole, total: 0, taxable_net: 0, tax: 0 }, 100).other_net, 100, "no breakdown: untaxed goods");
  // Half of each part rounds UP twice; the untaxed goods by subtraction keep the sum.
  const mixed = scaleBreakdown({ taxable_net: 100.01, other_net: 100.01, delivery: 0, tax: 9.5, tax_rate: 0.095, total: 209.52 }, 104.76);
  eq(Math.round((mixed.taxable_net + mixed.other_net + mixed.delivery + mixed.tax) * 100) / 100, 104.76, "to the cent, mixed");
});

test("invoiceTotalsBreakdown: a week, a free delivery fee and a payment add to Amount due", () => {
  const b = invoiceTotalsBreakdown(knottedWeek, 300);
  eq(b, { subtotal: 1147, discount: 0, delivery: 140, rush: 0, tax: 0, prior: 0, payments: 300 });
  const adds = Math.round((b.subtotal - b.discount + b.delivery + b.rush + b.tax - b.prior - b.payments) * 100) / 100;
  eq(adds, 1287 - 300, "adds to Amount due");
});

test("invoiceTotalsBreakdown: a balance after its deposit shows the deposit as invoiced earlier", () => {
  const b = invoiceTotalsBreakdown(wedding, 50);
  eq(b, { subtotal: 500, discount: 0, delivery: 0, rush: 0, tax: 47.5, prior: 100, payments: 50 });
  const adds = Math.round((b.subtotal - b.discount + b.delivery + b.rush + b.tax - b.prior - b.payments) * 100) / 100;
  eq(adds, 397.5, "adds to Amount due");
});
