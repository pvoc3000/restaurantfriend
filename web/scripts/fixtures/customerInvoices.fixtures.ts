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
  isCustomerInvoiceSnapshot,
  lineDrift,
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

test("lineDrift: a cent or more, either way", () => {
  eq(lineDrift(613.5, 613.5), null);
  eq(lineDrift(613.5, 613.504), null);
  eq(lineDrift(613.5, 700), 86.5);
  eq(lineDrift(613.5, 600), -13.5);
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
