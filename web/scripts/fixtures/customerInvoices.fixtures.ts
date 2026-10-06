// `lib/customerInvoices` — migration 124's pure half: one invoice, one line
// per order, one pay link.
//
// Checked by breaking: `invoiceLinesFor` billing `total` rather than `balance`
// turns the deposit case red; dropping the shop test from `createRefusals`
// turns the two-kitchens case red; letting `sumBreakdowns` accept mixed rates
// turns that case red.

import { test, eq, ok, no } from "./harness";
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
  invoicePaper,
  PAPER_COLUMNS,
  paperColumns,
  paperText,
  paperTotals,
  scaleBreakdown,
  snapshotLines,
  type CustomerInvoiceLine,
  isCustomerInvoiceSnapshot,
  orderLineDescription,
  readInvoiceTerms,
  dueDateFor,
  sumBreakdowns,
  type InvoiceCandidate,
} from "../../src/lib/customerInvoices";
import { missingTaxRate } from "../../src/lib/specialOrders";

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
  eq(readInvoiceTerms({}), { termsDays: 4, dueBusinessDaysBefore: 2, prefix: "" });
  eq(readInvoiceTerms({ customer_invoices: { terms_days: 7, prefix: "DF-" } }), { termsDays: 7, dueBusinessDaysBefore: 2, prefix: "DF-" });
  eq(readInvoiceTerms({ customer_invoices: { due_business_days_before: 3 } }).dueBusinessDaysBefore, 3);
  eq(readInvoiceTerms({ customer_invoices: { due_business_days_before: null } }).dueBusinessDaysBefore, 2, "null is unset, not 0");
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

test("createRefusals: taxable items and no tax rate is refused, naming the order", () => {
  const one = createRefusals([...week, day(8, { no_tax_rate: true })]);
  eq(one.length, 1);
  ok(one[0].includes("#10064") && one[0].includes("no tax rate"));
  const two = createRefusals([day(8, { no_tax_rate: true }), day(9, { no_tax_rate: true })]);
  ok(two[0].includes("#10064, #10065"));
  eq(createRefusals(week.map((r) => ({ ...r, no_tax_rate: false }))), []);
});

test("missingTaxRate: an empty rate over taxable items, and 0 is a rate", () => {
  eq(missingTaxRate(null, 93.6), true);
  eq(missingTaxRate("", 93.6), true);
  eq(missingTaxRate(0, 93.6), false, "0% is how an untaxed order is stated");
  eq(missingTaxRate("0.00000", 93.6), false);
  eq(missingTaxRate(0.1025, 93.6), false);
  eq(missingTaxRate(null, 0), false, "nothing taxable, nothing to flag");
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

/* The printed invoice's columns (Mark, 2026-09-27: "the numbers do not add up"). */

const columnSums = (rows: ReturnType<typeof invoicePaper>["rows"]) =>
  Object.fromEntries(
    PAPER_COLUMNS.map((c) => [c.key, Math.round(rows.reduce((a, r) => a + (r.parts?.[c.key] ?? 0), 0) * 100) / 100])
  );

test("invoicePaper: several orders print in columns, and each column adds up to its Totals line", () => {
  // A week with a discounted, taxed, rushed day billed partly on an earlier
  // invoice, and a free Delivery Fee.
  const odd = "Order #10060 · Cafe Knotted · 10/7/2026";
  const lines = [
    ...knottedWeek,
    line({ special_order_id: "o3", line_type: "item", description: "Cake", amount: 200, taxable: true, order_label: odd, sort: 0 }),
    line({ special_order_id: "o3", line_type: "discount", description: "Discount", amount: -20, order_label: odd, sort: 1000 }),
    line({ special_order_id: "o3", line_type: "rush", description: "Rush fee", amount: 25, order_label: odd, sort: 1002 }),
    line({ special_order_id: "o3", line_type: "tax", description: "Tax", amount: 17.1, order_label: odd, sort: 1003 }),
    line({ special_order_id: "o3", line_type: "prior_billing", description: "Less invoice INV-10001", amount: -50, order_label: odd, sort: 1004 }),
  ];
  const withO3 = new Map([...orders, ["o3", { number: "10060", event_date: "2026-10-07" }]]);
  const paper = invoicePaper(groupInvoiceLines(lines, withO3));
  ok(paper.columns, "three orders");
  const t = invoiceTotalsBreakdown(lines, 0);
  eq(columnSums(paper.rows), { subtotal: t.subtotal, discount: -t.discount, delivery: t.delivery, rush: t.rush, tax: t.tax });
  eq(paper.rows.map((r) => r.parts?.subtotal), [573.5, 573.5, 200, 0], "an order's Subtotal is its items; the fee is not one");
  eq(paper.rows[3], { description: "Delivery Fee", amount: 40, free: true, parts: { subtotal: 0, discount: 0, delivery: 40, rush: 0, tax: 0 } });
  eq(paper.rows[2].amount, 222.1, "what the order charges, before the earlier invoice — that is the Totals window's");
});

test("invoicePaper: one order is itemized, unless an other charge is Delivery", () => {
  const one = knottedDay("o1", "Order #10057 · Cafe Knotted · 10/5/2026");
  const itemized = invoicePaper(groupInvoiceLines([...one, line({ line_type: "item", description: "Box", amount: 5, sort: 0 })], orders));
  no(itemized.columns);
  eq(itemized.rows[0].detail?.rows, [{ label: "370 × Knotted Bismark - 42g @ $1.55", amount: 573.5 }]);
  eq(itemized.rows[1].amount, 5, "an Item charge adds to the Subtotal the items do");
  const withFee = invoicePaper(groupInvoiceLines([...one, line({ line_type: "delivery", description: "Delivery Fee", amount: 40, sort: 0 })], orders));
  ok(withFee.columns, "a Delivery charge has no place in the itemized Amount column");
  eq(withFee.rows[0].detail, undefined);
  ok(invoicePaper(groupInvoiceLines([line({ line_type: "item", description: "Setup", amount: 30 })], orders)).columns, "no orders: columns");
});

test("paperText: the email says what the columns say, in lines", () => {
  const paper = invoicePaper(groupInvoiceLines(knottedWeek, orders));
  const b = invoiceTotalsBreakdown(knottedWeek, 0);
  eq(
    paperText(paper, b, 100, 1187),
    [
      "Order #10057 · Cafe Knotted · 10/5/2026",
      "   Subtotal $573.50 · Delivery $50.00",
      "Order #10050 · Cafe Knotted · 10/6/2026",
      "   Subtotal $573.50 · Delivery $50.00",
      "",
      "Other charges",
      "Delivery Fee",
      "   Delivery $40.00",
      "",
      "Subtotal: $1147.00",
      "Delivery: $140.00",
      "Paid: -$100.00",
      "Amount due: $1187.00",
    ].join("\n")
  );
  const one = invoicePaper(groupInvoiceLines(knottedDay("o1", "Order #10057 · Cafe Knotted · 10/5/2026"), orders));
  eq(
    paperText(one, invoiceTotalsBreakdown(knottedDay("o1", "x"), 0), 0, 623.5).split("\n").slice(0, 2),
    ["Order #10057 · Cafe Knotted · 10/5/2026", "   370 × Knotted Bismark - 42g @ $1.55 — $573.50"],
    "one order: its items"
  );
});

test("paperTotals / paperColumns: Subtotal always, the rest only when used", () => {
  const b = { subtotal: 100, discount: 0, delivery: 10, rush: 0, tax: 0, prior: 25 };
  eq(paperTotals(b, 0, 85).map((t) => t.label), ["Subtotal", "Delivery", "Invoiced earlier", "Amount due"]);
  eq(paperTotals(b, 0, 85)[2].value, -25);
  eq(paperColumns([{ parts: { subtotal: 0, discount: 0, delivery: 5, rush: 0, tax: 0 } }]).map((c) => c.key), ["subtotal", "delivery"]);
});

// A new invoice's due date (Mark, 2026-09-29: SO-10092's event was 10/1 and
// its invoice said due 10/3). 2026-10-01 is a Thursday.
test("dueDateFor: a special order is due two business days before its event", () => {
  eq(dueDateFor([{ event_date: "2026-10-09" }], "2026-09-29"), "2026-10-07", "Fri event → Wed");
  eq(dueDateFor([{ event_date: "2026-10-05" }], "2026-09-29"), "2026-10-01", "Mon event → Thu, skipping the weekend");
  eq(dueDateFor([{ event_date: "2026-10-03" }], "2026-09-29"), "2026-10-01", "Sat event → Thu");
});
test("dueDateFor: an event too close is due TODAY, never before", () => {
  eq(dueDateFor([{ event_date: "2026-10-01" }], "2026-09-29"), "2026-09-29", "SO-10092: due today, not 10/3");
  eq(dueDateFor([{ event_date: "2026-09-29" }], "2026-09-29"), "2026-09-29");
});
test("dueDateFor: the EARLIEST event governs several orders", () => {
  eq(dueDateFor([{ event_date: "2026-10-16" }, { event_date: "2026-10-09" }, { event_date: null }], "2026-09-29"), "2026-10-07");
});
test("dueDateFor: wholesale keeps the terms, and so does an undated invoice", () => {
  eq(dueDateFor([{ event_date: "2026-10-05", wholesale: true }], "2026-10-04"), "2026-10-08", "Sunday's invoice, due Thursday");
  eq(dueDateFor([{ event_date: "2026-10-20" }, { event_date: "2026-10-05", wholesale: true }], "2026-10-04"), "2026-10-08", "any wholesale order");
  eq(dueDateFor([], "2026-09-29"), "2026-10-03");
});
