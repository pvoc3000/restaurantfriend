// CREDIT MEMOS IN QUICKBOOKS (migration 218, docs/customer-credit-memos-brief.md
// §7 and §8). Pure, with no imports: `qbo-sync` and `qbo-webhook` (Deno) and
// the fixtures (Node) all load it.

type Link = { TxnId?: unknown; TxnType?: unknown };
export type QboPaymentLike = {
  TotalAmt?: unknown;
  Line?: { Amount?: unknown; LinkedTxn?: Link[] }[];
};

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/**
 * THE CASH IN A QUICKBOOKS PAYMENT, BY INVOICE (§8a). A Payment is also how
 * QuickBooks applies a credit memo: its lines link the invoice AND the memo,
 * and the money is the difference. Reading every Invoice-linked line as cash —
 * what the payment readers did before 218 — records our own $65.10 credit as
 * $65.10 received and tells the shop the customer paid.
 *
 * - `TotalAmt` 0 is a credit application only: no cash at all.
 * - No CreditMemo line: each Invoice line is its amount, as before.
 * - One Invoice line beside CreditMemo lines: the Invoice line less the memos.
 * - Credit spread over several invoices is not guessed at: a problem.
 */
export function paymentCash(p: QboPaymentLike): {
  invoices: { txnId: string; amount: number }[];
  credit: { txnId: string; amount: number }[];
  problem: string | null;
} {
  const invoiceLines: { txnId: string; cents: number }[] = [];
  const credit: { txnId: string; amount: number }[] = [];
  for (const line of p.Line ?? []) {
    for (const t of line.LinkedTxn ?? []) {
      if (!t.TxnId) continue;
      if (t.TxnType === "Invoice") invoiceLines.push({ txnId: String(t.TxnId), cents: cents(line.Amount) });
      else if (t.TxnType === "CreditMemo") credit.push({ txnId: String(t.TxnId), amount: cents(line.Amount) / 100 });
    }
  }
  const creditCents = credit.reduce((a, c) => a + Math.round(c.amount * 100), 0);
  if (cents(p.TotalAmt) === 0 && p.TotalAmt !== undefined) {
    return { invoices: [], credit, problem: null };
  }
  if (creditCents === 0) {
    return { invoices: invoiceLines.map((l) => ({ txnId: l.txnId, amount: l.cents / 100 })), credit, problem: null };
  }
  if (invoiceLines.length === 1) {
    const net = Math.max(0, invoiceLines[0].cents - creditCents);
    return {
      invoices: net > 0 ? [{ txnId: invoiceLines[0].txnId, amount: net / 100 }] : [],
      credit,
      problem: null,
    };
  }
  return {
    invoices: [],
    credit,
    problem: "this QuickBooks payment spreads credit over several invoices — record it by hand",
  };
}

/** A memo's own line, as 218 stores it. */
export type MemoLine = {
  line_type: "item" | "discount" | "delivery" | "rush" | "tax" | "allowance";
  description: string;
  qty: number | null;
  unit_price: number | null;
  amount: number;
  taxable: boolean;
};

/** The invoice line to copy coding from: its item, tax code and class. */
export type CodingLine = {
  itemRef: string;
  taxable: boolean;
  classRef: string | null;
};

/**
 * THE SALES LINES OF A CREDIT MEMO OR A MEMO'S REFUND RECEIPT (§7, §6a).
 * Each credited item is its own line, on the item, tax code and class of the
 * invoice line it reverses — so the revenue comes back out of the account it
 * went into. Tax is QuickBooks' to compute, from the TAX lines and the
 * header's code; the memo's own tax line is the figure it must come to.
 *
 * A DISCOUNT on the memo cannot sit beside a quantity and price (QuickBooks
 * holds Amount = Qty × UnitPrice), so a memo with one folds it into one line
 * per tax treatment, as the invoice push does. Rush goes on the rush item and
 * delivery on the delivery item (220), both untaxed, as the invoice has them.
 * An allowance is one untaxed line on the order's own sales item.
 */
export function memoSalesLines(
  lines: MemoLine[],
  coding: CodingLine[],
  rushItemRef: string | null,
  deliveryItemRef: string | null = null
): { lines: Record<string, unknown>[]; taxed: boolean; error: string | null } {
  const pick = (taxable: boolean) =>
    coding.find((c) => c.taxable === taxable) ?? coding[0] ?? null;
  if (!coding.length) return { lines: [], taxed: false, error: "the invoice it credits has no item lines in QuickBooks" };

  const items = lines.filter((l) => l.line_type === "item");
  const discount = lines.filter((l) => l.line_type === "discount").reduce((a, l) => a + cents(l.amount), 0);
  const rush = lines.filter((l) => l.line_type === "rush").reduce((a, l) => a + cents(l.amount), 0);
  const delivery = lines.filter((l) => l.line_type === "delivery").reduce((a, l) => a + cents(l.amount), 0);
  const allowance = lines.filter((l) => l.line_type === "allowance");
  const out: Record<string, unknown>[] = [];
  const sale = (amountCents: number, description: string, c: CodingLine, taxable: boolean, qty?: number | null, price?: number | null) => {
    if (amountCents <= 0) return;
    out.push({
      Amount: amountCents / 100,
      DetailType: "SalesItemLineDetail",
      Description: description.slice(0, 4000),
      SalesItemLineDetail: {
        ItemRef: { value: c.itemRef },
        TaxCodeRef: { value: taxable ? "TAX" : "NON" },
        ...(c.classRef ? { ClassRef: { value: c.classRef } } : {}),
        ...(qty != null && price != null ? { Qty: qty, UnitPrice: price } : {}),
      },
    });
  };

  if (discount === 0) {
    for (const l of items) {
      const c = pick(l.taxable)!;
      const exact = l.qty != null && l.unit_price != null && Math.round(l.qty * l.unit_price * 100) === cents(l.amount);
      sale(cents(l.amount), l.description, c, l.taxable, exact ? l.qty : null, exact ? l.unit_price : null);
    }
  } else {
    // `discount` is negative cents; it comes off each treatment in proportion.
    const taxedItems = items.filter((l) => l.taxable).reduce((a, l) => a + cents(l.amount), 0);
    const plainItems = items.filter((l) => !l.taxable).reduce((a, l) => a + cents(l.amount), 0);
    const all = taxedItems + plainItems;
    const taxedShare = all > 0 ? Math.round((discount * taxedItems) / all) : 0;
    const label = items.map((l) => l.description).join("; ");
    sale(taxedItems + taxedShare, label, pick(true)!, true);
    sale(plainItems + (discount - taxedShare), taxedItems > 0 ? `${label} — not taxed` : label, pick(false)!, false);
  }
  if (rush > 0) {
    if (!rushItemRef) return { lines: [], taxed: false, error: "no QuickBooks item is set for rush fees" };
    const label = lines.find((l) => l.line_type === "rush")?.description ?? "Rush fee";
    sale(rush, label, { itemRef: rushItemRef, taxable: false, classRef: pick(false)!.classRef }, false);
  }
  if (delivery > 0) {
    if (!deliveryItemRef) return { lines: [], taxed: false, error: "no QuickBooks item is set for delivery" };
    sale(delivery, "Delivery", { itemRef: deliveryItemRef, taxable: false, classRef: pick(false)!.classRef }, false);
  }
  for (const a of allowance) sale(cents(a.amount), a.description, pick(false)!, false);

  return {
    lines: out,
    taxed: out.some((l) => (l.SalesItemLineDetail as { TaxCodeRef: { value: string } }).TaxCodeRef.value === "TAX"),
    error: out.length ? null : "the memo has nothing to credit",
  };
}

/** The coding of a QuickBooks invoice's sales lines, for `memoSalesLines`. */
export function invoiceCoding(inv: {
  Line?: { DetailType?: string; SalesItemLineDetail?: { ItemRef?: { value?: string }; TaxCodeRef?: { value?: string }; ClassRef?: { value?: string } } }[];
}, rushItemRef: string | null, deliveryItemRef: string | null): CodingLine[] {
  const out: CodingLine[] = [];
  for (const l of inv.Line ?? []) {
    const d = l.SalesItemLineDetail;
    if (l.DetailType !== "SalesItemLineDetail" || !d?.ItemRef?.value) continue;
    // Delivery and rush ride on their own items (165): never the sales item.
    if (d.ItemRef.value === rushItemRef || d.ItemRef.value === deliveryItemRef) continue;
    out.push({ itemRef: d.ItemRef.value, taxable: d.TaxCodeRef?.value !== "NON", classRef: d.ClassRef?.value ?? null });
  }
  return out;
}
