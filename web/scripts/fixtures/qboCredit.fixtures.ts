// `supabase/functions/_shared/qboCredit.ts` — what of a QuickBooks Payment is
// cash once credit memos can be applied in it (218, brief §8), and the sales
// lines of a credit memo (§7).

import { eq, ok, test } from "./harness";
import { invoiceCoding, memoSalesLines, paymentCash } from "../../../supabase/functions/_shared/qboCredit";

test("paymentCash: a plain payment is its invoice lines, as before 218", () => {
  const r = paymentCash({ TotalAmt: 918, Line: [{ Amount: 918, LinkedTxn: [{ TxnId: "11", TxnType: "Invoice" }] }] });
  eq(JSON.stringify(r.invoices), JSON.stringify([{ txnId: "11", amount: 918 }]), "918 cash on 11");
  eq(r.problem, null, "no problem");
});

test("paymentCash: OUR zero Payment applying a memo is no cash at all", () => {
  const r = paymentCash({
    TotalAmt: 0,
    Line: [
      { Amount: 65.1, LinkedTxn: [{ TxnId: "20", TxnType: "Invoice" }] },
      { Amount: 65.1, LinkedTxn: [{ TxnId: "CM1", TxnType: "CreditMemo" }] },
    ],
  });
  eq(r.invoices.length, 0, "nothing recorded as cash");
  eq(r.credit.length, 1, "the memo line is seen");
});

test("paymentCash: $5,000 cash plus $65.10 credit in one Payment is $5,000", () => {
  const r = paymentCash({
    TotalAmt: 5000,
    Line: [
      { Amount: 5065.1, LinkedTxn: [{ TxnId: "20", TxnType: "Invoice" }] },
      { Amount: 65.1, LinkedTxn: [{ TxnId: "CM1", TxnType: "CreditMemo" }] },
    ],
  });
  eq(JSON.stringify(r.invoices), JSON.stringify([{ txnId: "20", amount: 5000 }]), "5000, not 5065.10");
});

test("paymentCash: credit spread over several invoices is a problem, not a guess", () => {
  const r = paymentCash({
    TotalAmt: 100,
    Line: [
      { Amount: 80, LinkedTxn: [{ TxnId: "1", TxnType: "Invoice" }] },
      { Amount: 30, LinkedTxn: [{ TxnId: "2", TxnType: "Invoice" }] },
      { Amount: 10, LinkedTxn: [{ TxnId: "CM", TxnType: "CreditMemo" }] },
    ],
  });
  eq(r.invoices.length, 0, "nothing recorded");
  ok(!!r.problem, "said so");
});

test("paymentCash: several invoices with no credit stay as they were", () => {
  const r = paymentCash({
    TotalAmt: 110,
    Line: [
      { Amount: 80, LinkedTxn: [{ TxnId: "1", TxnType: "Invoice" }] },
      { Amount: 30, LinkedTxn: [{ TxnId: "2", TxnType: "Invoice" }] },
    ],
  });
  eq(r.invoices.map((i) => i.amount).join(","), "80,30", "each line its amount");
});

const coding = invoiceCoding(
  {
    Line: [
      { DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "SO" }, TaxCodeRef: { value: "TAX" }, ClassRef: { value: "K1" } } },
      { DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "SO" }, TaxCodeRef: { value: "NON" }, ClassRef: { value: "K1" } } },
      { DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "DEL" }, TaxCodeRef: { value: "NON" } } },
      { DetailType: "SubTotalLineDetail" },
    ],
  },
  "RUSH",
  "DEL"
);

test("invoiceCoding: the sales lines, not delivery or subtotal", () => {
  eq(coding.length, 2, "two sales lines");
  ok(coding.every((c) => c.itemRef === "SO" && c.classRef === "K1"), "item and class copied");
});

test("memoSalesLines: the Knotted short — 42 × $1.55, untaxed, itemized", () => {
  const r = memoSalesLines(
    [{ line_type: "item", description: "Knotted Bismark — short 42", qty: 42, unit_price: 1.55, amount: 65.1, taxable: false }],
    coding,
    "RUSH"
  );
  eq(r.error, null, "no error");
  eq(r.lines.length, 1, "one line");
  const d = r.lines[0].SalesItemLineDetail as Record<string, unknown>;
  eq(r.lines[0].Amount, 65.1, "65.10");
  eq(d.Qty, 42, "qty kept");
  eq(d.UnitPrice, 1.55, "price kept");
  eq((d.TaxCodeRef as { value: string }).value, "NON", "untaxed");
  eq(r.taxed, false, "no tax");
});

test("memoSalesLines: a taxed retail item goes on the TAX line's coding", () => {
  const r = memoSalesLines(
    [
      { line_type: "item", description: "Brown Bites — short 4", qty: 4, unit_price: 4.45, amount: 17.8, taxable: true },
      { line_type: "tax", description: "Sales tax", qty: null, unit_price: null, amount: 1.82, taxable: false },
    ],
    coding,
    null
  );
  eq(r.lines.length, 1, "tax is QuickBooks' to compute, not a line");
  eq(r.taxed, true, "taxed");
});

test("memoSalesLines: a discount folds into one line per tax treatment, summing exactly", () => {
  const r = memoSalesLines(
    [
      { line_type: "item", description: "A", qty: 3, unit_price: 2.1, amount: 6.3, taxable: true },
      { line_type: "item", description: "B", qty: 1, unit_price: 5, amount: 5, taxable: false },
      { line_type: "discount", description: "Discount", qty: null, unit_price: null, amount: -1.13, taxable: false },
    ],
    coding,
    null
  );
  const total = r.lines.reduce((a, l) => a + Math.round(Number(l.Amount) * 100), 0);
  eq(total, 630 + 500 - 113, "items less discount, to the cent");
  ok(r.lines.every((l) => !(l.SalesItemLineDetail as Record<string, unknown>).Qty), "no qty beside a folded discount");
});

test("memoSalesLines: rush needs its item; an allowance is untaxed", () => {
  const noRush = memoSalesLines(
    [
      { line_type: "item", description: "A", qty: 1, unit_price: 10, amount: 10, taxable: false },
      { line_type: "rush", description: "Rush", qty: null, unit_price: null, amount: 2.5, taxable: false },
    ],
    coding,
    null
  );
  ok(!!noRush.error, "refused without a rush item");
  const allowance = memoSalesLines(
    [{ line_type: "allowance", description: "Goodwill", qty: null, unit_price: null, amount: 10, taxable: false }],
    coding,
    null
  );
  eq(allowance.lines.length, 1, "one line");
  eq(((allowance.lines[0].SalesItemLineDetail as Record<string, unknown>).TaxCodeRef as { value: string }).value, "NON", "untaxed");
});

test("memoSalesLines: delivery goes on the delivery item, untaxed, and needs it (220)", () => {
  const lines = [
    { line_type: "delivery" as const, description: "Delivery", qty: null, unit_price: null, amount: 25, taxable: false },
    { line_type: "rush" as const, description: "Rush fee", qty: null, unit_price: null, amount: 15, taxable: false },
  ];
  const r = memoSalesLines(lines, coding, "RUSH", "DEL");
  eq(r.error, null, "no error");
  eq(r.lines.length, 2, "rush and delivery");
  const del = r.lines.find((l) => (l.SalesItemLineDetail as { ItemRef: { value: string } }).ItemRef.value === "DEL");
  eq(del?.Amount, 25, "delivery on DEL");
  eq(((del!.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef as { value: string }).value, "NON", "untaxed");
  eq(r.lines.find((l) => l !== del)?.Description, "Rush fee", "rush takes its line's own words");
  ok(!!memoSalesLines(lines, coding, "RUSH", null).error, "refused without a delivery item");
});

test("memoSalesLines: All — every item, the discount, delivery and tax, summing to the memo", () => {
  const lines = [
    { line_type: "item" as const, description: "A", qty: 18, unit_price: 2.1, amount: 37.8, taxable: true },
    { line_type: "item" as const, description: "B", qty: 1, unit_price: 17.6, amount: 17.6, taxable: true },
    { line_type: "discount" as const, description: "Discount", qty: null, unit_price: null, amount: -5.54, taxable: false },
    { line_type: "delivery" as const, description: "Delivery", qty: null, unit_price: null, amount: 30, taxable: false },
    { line_type: "tax" as const, description: "Sales tax", qty: null, unit_price: null, amount: 5.11, taxable: false },
  ];
  const r = memoSalesLines(lines, coding, "RUSH", "DEL");
  const total = r.lines.reduce((a, l) => a + Math.round(Number(l.Amount) * 100), 0);
  eq(total, 3780 + 1760 - 554 + 3000, "everything but the tax, which QuickBooks computes");
  eq(r.taxed, true, "taxed");
});
