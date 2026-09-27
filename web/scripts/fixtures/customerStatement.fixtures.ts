// `lib/customerStatement` — migration 144's statement and aging: posted
// invoices against the money that reached the account.
//
// Checked by breaking: naming an invoice once per application turns the
// Knotted case red ("1014, 1014"); counting a day's payment before its
// invoice turns the same-day case red (the running balance dips to credit);
// `agingBucket`'s `<= 30` as `< 30` turns the boundary case red; dropping the
// `paid_on <= to` test from the aging turns the as-of case red; charging a
// void invoice turns the revision case red; `statementPeriod` without the day
// clamp turns the March 31 case red.

import { test, eq, ok } from "./harness";
import {
  agingBucket,
  buildStatement,
  daysBetween,
  statementPeriod,
  type AccountEntry,
  type AccountInvoice,
} from "../../src/lib/customerStatement";

const inv = (id: string, issued_on: string, due_on: string | null, total: number, isVoid = false): AccountInvoice => ({
  id,
  label: id,
  issued_on,
  due_on,
  total,
  void: isVoid,
});
const entry = (
  payment_id: string,
  paid_on: string | null,
  customer_invoice_id: string | null,
  amount: number,
  payment_type = "Cash"
): AccountEntry => ({ payment_id, paid_on, payment_type, customer_invoice_id, amount, created_at: `${paid_on ?? "0000-00-00"}T12:00:00Z` });

test("a Knotted week: billed Sunday, paid Wednesday with $76.50 over — the over is credit", () => {
  const invoices = [inv("1014", "2026-09-27", "2026-10-01", 5288)];
  // One QuickBooks payment across the week: two orders' shares of 1014, and the over.
  const entries = [
    entry("qbo", "2026-09-30", "1014", 2644, "QuickBooks Payment"),
    entry("qbo", "2026-09-30", "1014", 2644, "QuickBooks Payment"),
    entry("qbo", "2026-09-30", null, 76.5, "QuickBooks Payment"),
  ];

  const sept = buildStatement({ invoices, entries, from: "2026-09-01", to: "2026-09-29" });
  eq(sept.opening, 0);
  eq(sept.rows.map((r) => [r.kind, r.charge, r.paid, r.balance]), [["invoice", 5288, 0, 5288]]);
  eq(sept.closing, 5288, "owed before they paid");
  eq(sept.aging.current, 5288, "not due until October 1");

  const all = buildStatement({ invoices, entries, from: "2026-09-01", to: "2026-10-31" });
  eq(all.rows.length, 2, "one payment row, however many places it went");
  eq(all.rows[1].payment, { type: "QuickBooks Payment", paid: ["1014"], credit: 76.5 }, "1014 named once");
  eq(all.rows[1].paid, 5364.5);
  eq(all.closing, -76.5, "they are $76.50 in credit");
  eq(all.credit, 76.5);
  eq(all.open, [], "nothing owing");
});

test("the opening balance carries what came before the period", () => {
  const s = buildStatement({
    invoices: [inv("1001", "2026-08-02", "2026-08-06", 400), inv("1002", "2026-09-06", "2026-09-10", 300)],
    entries: [entry("a", "2026-08-05", "1001", 150), entry("b", "2026-09-08", "1001", 250)],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.opening, 250, "400 billed less 150 paid in August");
  eq(s.rows.map((r) => r.balance), [550, 300], "the running balance starts from the opening one");
  eq([s.charges, s.payments, s.closing], [300, 250, 300]);
});

test("the period includes both of its days", () => {
  const invoices = [inv("1", "2026-09-01", null, 10), inv("2", "2026-09-30", null, 20), inv("3", "2026-10-01", null, 40)];
  const s = buildStatement({ invoices, entries: [], from: "2026-09-01", to: "2026-09-30" });
  eq(s.rows.map((r) => r.invoice?.label), ["1", "2"]);
  eq(s.closing, 30, "October's invoice is not in September's balance");
});

test("on one day the invoice comes before the money that pays it", () => {
  const s = buildStatement({
    invoices: [inv("1014", "2026-09-27", "2026-10-01", 100)],
    entries: [entry("same-day", "2026-09-27", "1014", 100)],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.rows.map((r) => [r.kind, r.balance]), [["invoice", 100], ["payment", 0]], "never a moment in credit");
});

test("same-day invoices sort by number, a revision before the next number", () => {
  const s = buildStatement({
    invoices: [inv("1015", "2026-09-27", null, 1), inv("1014-2", "2026-09-27", null, 1), inv("999", "2026-09-27", null, 1)],
    entries: [],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.rows.map((r) => r.invoice?.label), ["999", "1014-2", "1015"]);
});

test("a revision: the voided original stays on the paper at no charge, and its money went across", () => {
  const s = buildStatement({
    invoices: [inv("1014", "2026-09-20", "2026-09-24", 623.5, true), inv("1014-2", "2026-09-22", "2026-09-26", 648.5)],
    entries: [entry("sq", "2026-09-21", "1014-2", 623.5, "Square Online")],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.rows.map((r) => [r.kind, r.invoice?.label ?? null, r.charge, r.paid]), [
    ["void", "1014", 0, 0],
    ["payment", null, 0, 623.5],
    ["invoice", "1014-2", 648.5, 0],
  ]);
  eq(s.closing, 25, "the $25 the revision added");
  eq(s.open.map((o) => [o.label, o.balance, o.bucket]), [["1014-2", 25, "days30"]]);
});

test("a refund puts money back on the balance", () => {
  const s = buildStatement({
    invoices: [inv("1012", "2026-09-25", "2026-09-29", 424.43)],
    entries: [entry("sq", "2026-09-25", "1012", 424.43, "Square Online"), entry("rf", "2026-09-26", "1012", -24.43, "Square Refund")],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.rows.map((r) => [r.kind, r.paid, r.balance]), [["invoice", 0, 424.43], ["payment", 424.43, 0], ["refund", -24.43, 24.43]]);
  eq(s.closing, 24.43);
});

test("aging columns: due today is current, 30 days late the first column, 31 the second", () => {
  eq(agingBucket(-3), "current");
  eq(agingBucket(0), "current");
  eq(agingBucket(1), "days30");
  eq(agingBucket(30), "days30");
  eq(agingBucket(31), "days60");
  eq(agingBucket(60), "days60");
  eq(agingBucket(61), "days90");
  eq(agingBucket(90), "days90");
  eq(agingBucket(91), "over90");
  eq(daysBetween("2026-09-30", "2026-10-31"), 31);
  eq(daysBetween("2026-10-31", "2026-09-30"), -31);
  eq(daysBetween("2026-02-28", "2026-03-01"), 1, "across a month end");
});

test("aging counts from the due date, or the issue date when there is none", () => {
  const s = buildStatement({
    invoices: [inv("a", "2026-06-01", "2026-06-05", 10), inv("b", "2026-08-01", null, 20), inv("c", "2026-09-20", "2026-10-04", 40)],
    entries: [],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  eq(s.open.map((o) => [o.label, o.daysPastDue, o.bucket]), [["a", 117, "over90"], ["b", 60, "days60"], ["c", -4, "current"]]);
  eq(s.aging, { current: 40, days30: 0, days60: 20, days90: 0, over90: 10 });
});

test("aging is AS OF the statement's last day: a later payment has not happened yet", () => {
  const invoices = [inv("1014", "2026-09-27", "2026-10-01", 5288)];
  const entries = [entry("late", "2026-10-15", "1014", 5288)];
  const early = buildStatement({ invoices, entries, from: "2026-10-01", to: "2026-10-10" });
  eq(early.aging.days30, 5288, "nine days late on October 10");
  eq(early.closing, 5288);
  const later = buildStatement({ invoices, entries, from: "2026-10-01", to: "2026-10-31" });
  eq(later.open, []);
  eq(later.closing, 0);
});

test("the aging less the credit is the closing balance — a payment before its invoice included", () => {
  const s = buildStatement({
    invoices: [inv("1", "2026-08-01", "2026-08-05", 100), inv("2", "2026-09-28", "2026-10-02", 300), inv("3", "2026-10-05", null, 50)],
    entries: [
      entry("early", "2026-09-10", "3", 50), // held cash, applied when #3 was sent after the period
      entry("part", "2026-09-15", "1", 60),
      entry("over", "2026-09-15", null, 15),
    ],
    from: "2026-09-01",
    to: "2026-09-30",
  });
  const agingTotal = Object.values(s.aging).reduce((a, v) => a + v, 0);
  eq(Math.round((agingTotal - s.credit) * 100) / 100, s.closing);
  eq(s.credit, 65, "the $50 on an invoice not yet issued, and $15 applied to nothing");
  eq(s.closing, 275);
  ok(s.rows.every((r) => r.date !== null && r.date >= "2026-09-01" && r.date <= "2026-09-30"), "only the period's rows");
});

test("statementPeriod: a month back to today, clamped to the shorter month", () => {
  eq(statementPeriod("2026-09-27"), { from: "2026-08-27", to: "2026-09-27" });
  eq(statementPeriod("2026-03-31"), { from: "2026-02-28", to: "2026-03-31" });
  eq(statementPeriod("2026-01-15"), { from: "2025-12-15", to: "2026-01-15" });
});
