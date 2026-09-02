/**
 * The QuickBooks Online payload builder.
 *
 * PURE — no fetch, no Supabase client, no tokens. `qbo-sync` does network and
 * credentials and nothing else, which is `lib/gustoExport` / `lib/poProcessing`'s
 * split and is what makes the two rules below testable without a QuickBooks
 * account.
 *
 * ---------------------------------------------------------------------------
 * ONE SUMMARY LINE PER DOCUMENT
 *
 * Mark's decision, 2026-09-01. Each bill becomes a single QBO line at its total
 * against one expense account, so there is no account-mapping table and no
 * screen to maintain one. The app keeps the fifteen lines, the reconciliation
 * and the document; QuickBooks gets the money.
 *
 * ---------------------------------------------------------------------------
 * A CREDIT IS ITS OWN ENTITY, AND ITS AMOUNT IS POSITIVE
 *
 * This is the rule a rewrite is most likely to break, because everything else
 * in this app reaches for `signedTotal()`. QBO models a vendor credit as
 * `VendorCredit` with POSITIVE amounts — the entity carries the sign, exactly
 * as `is_credit` does on our side (025: "magnitudes stored positive"). Sending
 * a `Bill` with a negative Amount instead would post a credit as a bill for
 * minus money and reconcile perfectly on every report we look at.
 *
 * So `signedTotal` is deliberately NOT used here, and the fixtures assert
 * against the emitted JSON rather than an object shape so a helpful refactor
 * that reintroduces the minus goes red.
 *
 * ---------------------------------------------------------------------------
 * CREATE AND UPDATE ARE THE SAME POST
 *
 * QBO has no PATCH: an update is the entity posted back with `Id`, `SyncToken`
 * and `sparse: true`. Both come out of our own `external_ref`, so a second push
 * of the same bill updates rather than duplicating — which is what makes
 * "press it again because you weren't sure" harmless, the same property 063's
 * upsert gives the Square sync.
 *
 * The SyncToken is QBO's optimistic-concurrency counter and it moves on every
 * write, ours or a human's in the QuickBooks UI. A stale one is refused with
 * fault 5010, which is correct and recoverable — re-read and push again.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Every QuickBooks document this app writes — the two accounts-payable ones and
 * A/R's `Invoice`.
 *
 * `Invoice` was missing until 2026-09-02, a day after phase 4 shipped writing
 * it: `qbo-sync` is Deno and imports nothing from here, so it stored an entity
 * this union did not admit and tsc had no way to see it. Anything reading the
 * stored value must widen WITH the writer, or the type quietly describes the
 * data as it was rather than as it is.
 */
export type QboEntity = "Bill" | "VendorCredit" | "Invoice";

/**
 * What we remember about a pushed document, and what `record_accounting_push`
 * merges into `vendor_invoices.external_ref`. 025 wrote this shape down before
 * anything could read it: `{"qbo": {"id": "1234", "sync_token": "3"}}`.
 */
export type AccountingRef = {
  qbo?: {
    id?: string;
    sync_token?: string;
    /** What QBO shows in its own register, for the "In QuickBooks as…" line. */
    doc_number?: string | null;
    entity?: QboEntity;
  };
};

export type BillInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total: number | null;
  is_credit: boolean;
  status: "open" | "approved" | "void";
  external_ref: AccountingRef | null;
};

export type BillPushInputs = {
  invoice: BillInvoice;
  /** `vendors.external_ref -> qbo -> id`. Null when nobody has mapped it. */
  vendorRef: string | null;
  /** Only ever used to word a refusal. */
  vendorName: string;
  /** `accounting_connections.bill_expense_account_ref`. */
  accountRef: string | null;
  /** Overrides the default line description. */
  description?: string | null;
  /** QuickBooks Location — `DepartmentRef`, on the HEADER. */
  department?: QboRefValue | null;
  /** QuickBooks Class — `ClassRef`, on the LINE. A bill takes its class per
   *  line, not on the header; putting it on the header is silently ignored. */
  klass?: QboRefValue | null;
};

/** QBO truncates past this and says nothing, so we do it deliberately. */
export const DOC_NUMBER_MAX = 21;

// ---------------------------------------------------------------------------
// Reading our own reference back
// ---------------------------------------------------------------------------

/**
 * The QBO id and sync token, or null when this bill has never been pushed.
 *
 * BOTH or NEITHER: an id with no sync token cannot be updated, so treating it
 * as pushed would send an update QBO refuses, forever. Reporting it as unpushed
 * instead creates a duplicate, which is visible and fixable — the better of two
 * bad outcomes, and it should never happen because they are written together.
 */
export function qboRef(
  external_ref: AccountingRef | null | undefined
): { id: string; syncToken: string } | null {
  const qbo = external_ref?.qbo;
  const id = qbo?.id?.trim();
  const syncToken = qbo?.sync_token?.trim();
  if (!id || !syncToken) return null;
  return { id, syncToken };
}

/** Whether this push will create a new QBO document or update one. */
export function pushMode(invoice: Pick<BillInvoice, "external_ref">): "create" | "update" {
  return qboRef(invoice.external_ref) ? "update" : "create";
}

/** The entity a bill becomes. The sign lives here, not on the amount. */
export function billEntity(invoice: Pick<BillInvoice, "is_credit">): QboEntity {
  return invoice.is_credit ? "VendorCredit" : "Bill";
}

/**
 * The API path segment. QBO lower-cases entity names in URLs, so `VendorCredit`
 * is `vendorcredit` — one word, no separator, which is what its own API wants.
 */
export function qboEntityPath(entity: QboEntity): string {
  return entity.toLowerCase();
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Everything that stops this bill reaching QuickBooks, in the words the person
 * pressing the button reads.
 *
 * `closeReadiness`'s posture inverted, and deliberately: that one names what is
 * unresolved and lets you through, because a delivery still happened. This one
 * BLOCKS, because there is nothing to push to — a Bill with no VendorRef is not
 * a worse bill, it is a request QBO rejects with a fault nobody can act on.
 */
export function billPushRefusals(inputs: BillPushInputs): string[] {
  const { invoice, vendorRef, vendorName, accountRef } = inputs;
  const out: string[] = [];

  if (invoice.status !== "approved") {
    out.push(
      invoice.status === "void"
        ? "This invoice is void."
        : "Only an approved invoice goes to QuickBooks — approve it first."
    );
  }
  if (!vendorRef) {
    out.push(
      `No QuickBooks vendor is linked to ${vendorName}. Pick one on the vendor's record.`
    );
  }
  if (!accountRef) {
    out.push("No expense account is set. Choose one in Settings → Accounting.");
  }
  if (invoice.total === null || invoice.total === undefined) {
    out.push("This invoice has no total.");
  } else if (Number(invoice.total) < 0) {
    // The sign belongs to `is_credit` (025). A negative here means the column
    // and the flag disagree, and guessing which one is right would post real
    // money the wrong way round.
    out.push(
      "This invoice's total is negative. Amounts are stored positive — mark it a credit instead."
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

/** Trimmed, capped, and omitted rather than sent empty. */
export function docNumberFor(invoiceNumber: string | null | undefined): string | undefined {
  const n = invoiceNumber?.trim();
  if (!n) return undefined;
  return n.slice(0, DOC_NUMBER_MAX);
}

/** What QBO's own register shows on the line. */
export function billLineDescription(
  invoice: Pick<BillInvoice, "invoice_number">,
  override?: string | null
): string {
  const o = override?.trim();
  if (o) return o;
  const n = invoice.invoice_number?.trim();
  return n ? `Invoice ${n}` : "Vendor bill";
}

/**
 * The body to POST. `Bill` and `VendorCredit` take the same shape, which is why
 * one builder serves both — only the entity and the URL differ.
 */
export function buildBillPayload(
  inputs: BillPushInputs
): { entity: QboEntity; path: string; body: Record<string, unknown> } {
  const refusals = billPushRefusals(inputs);
  if (refusals.length > 0) {
    // Never build a payload we know QBO will reject. The caller shows the
    // refusals; reaching here means it didn't ask.
    throw new Error(refusals[0]);
  }

  const { invoice, vendorRef, accountRef } = inputs;
  const entity = billEntity(invoice);
  const amount = Number(invoice.total);

  const body: Record<string, unknown> = {
    VendorRef: { value: vendorRef },
    Line: [
      {
        // POSITIVE on both entities. See the header.
        Amount: amount,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: billLineDescription(invoice, inputs.description),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountRef },
          // ON THE LINE, deliberately. A Bill carries its class per expense
          // line; a ClassRef on the header is accepted and ignored, which is
          // the worst kind of wrong — it looks like it worked.
          ...(inputs.klass ? { ClassRef: { value: inputs.klass.ref } } : {}),
        },
      },
    ],
    // Ours, so a bill in QuickBooks can be traced back to the scan it was read
    // from. Never shown to a vendor — a Bill is not a document we send.
    PrivateNote: `restaurantfriend ${invoice.id}`,
  };

  // On the HEADER, which is where a Bill takes its location.
  if (inputs.department) body.DepartmentRef = { value: inputs.department.ref };

  const docNumber = docNumberFor(invoice.invoice_number);
  if (docNumber) body.DocNumber = docNumber;
  if (invoice.invoice_date) body.TxnDate = invoice.invoice_date;
  // A VendorCredit has no due date — QBO ignores it, and sending one implies a
  // payment schedule for money flowing the other way.
  if (invoice.due_date && entity === "Bill") body.DueDate = invoice.due_date;

  const existing = qboRef(invoice.external_ref);
  if (existing) {
    body.Id = existing.id;
    body.SyncToken = existing.syncToken;
    body.sparse = true;
  }

  return { entity, path: qboEntityPath(entity), body };
}

// ---------------------------------------------------------------------------
// Reading QBO's answer back
// ---------------------------------------------------------------------------

/**
 * The jsonb handed to `record_accounting_push`.
 *
 * The whole `qbo` branch is replaced in one merge, so an id can never outlive
 * the sync token it was stored with — which is the pair `qboRef` refuses to
 * split.
 */
export function accountingRefFromResponse(
  entity: QboEntity,
  saved: { Id?: unknown; SyncToken?: unknown; DocNumber?: unknown } | null | undefined
): AccountingRef {
  const id = saved?.Id === undefined || saved?.Id === null ? "" : String(saved.Id);
  const syncToken =
    saved?.SyncToken === undefined || saved?.SyncToken === null ? "" : String(saved.SyncToken);
  if (!id || !syncToken) {
    throw new Error("QuickBooks saved the document but did not return an id and sync token.");
  }
  const docNumber =
    saved?.DocNumber === undefined || saved?.DocNumber === null
      ? null
      : String(saved.DocNumber);

  return { qbo: { id, sync_token: syncToken, doc_number: docNumber, entity } };
}

/**
 * "In QuickBooks as Bill 1043" — what the record and the list say.
 *
 * IT READS THE STORED ENTITY rather than deciding between two. Written as a
 * `VendorCredit ? "Credit" : "Bill"` ternary when A/P was the only caller, it
 * then labelled the first real customer invoice "Bill 8797" — the one word on
 * the line that says which of Mark's two ledgers a document landed in, wrong.
 * Found by pushing one (2026-09-02), not by reading.
 *
 * `VendorCredit` keeps its own word: it is a credit note, and "as VendorCredit
 * 1043" reads like machine output where the rest of this sentence is English.
 * The fallback is "Bill" only for a row written before `entity` was recorded —
 * every one carries it today, and A/P is the older path.
 */
export function pushedLabel(external_ref: AccountingRef | null | undefined): string | null {
  const qbo = external_ref?.qbo;
  const ref = qboRef(external_ref);
  if (!ref) return null;
  const entity = qbo?.entity?.trim();
  const kind = entity === "VendorCredit" ? "Credit" : entity || "Bill";
  const shown = qbo?.doc_number?.trim() || ref.id;
  return `In QuickBooks as ${kind} ${shown}`;
}

// ---------------------------------------------------------------------------
// Which account a vendor's bills post to
// ---------------------------------------------------------------------------

/** The QBO Vendor id, or null when nobody has mapped this vendor yet. */
export function qboVendorId(external_ref: AccountingRef | null | undefined): string | null {
  const id = external_ref?.qbo?.id?.trim();
  return id ? id : null;
}

/**
 * Everything QuickBooks knows about one vendor at one shop.
 *
 * ALL OF IT LIVES HERE (Mark, 2026-09-01: "All QBO settings should be in the
 * Vendor per location config. Even the Vendor.") — the mapping in 026's
 * `external_ref`, which was added for exactly this and had never had a reader,
 * and the three settings 083 added beside it. One screen, one row, one place to
 * look.
 *
 * `vendors.external_ref` (081) and `vendors.expense_account_ref` (082) are
 * consequently UNREAD. They are left in place rather than dropped: the columns
 * cost nothing, and a migration whose only purpose is tidiness is a migration
 * that can go wrong for no gain.
 */
export type VendorLocationAccounting = {
  external_ref: AccountingRef | null;
  expense_account_ref: string | null;
  expense_account_name: string | null;
  qbo_location_ref: string | null;
  qbo_location_name: string | null;
  qbo_class_ref: string | null;
  qbo_class_name: string | null;
};

export type ResolvedAccount = {
  ref: string;
  name: string | null;
  /** Which level answered — what the screen says beside the field. */
  source: "vendor_location" | "org";
};

/**
 * Vendor override → org default, and null when neither is set.
 *
 * Design rule 6's cascade, the one this schema already uses for money
 * (`vendor_item_location_prices` over `vendor_items.price`). Mark's case is
 * exactly why the override exists: BakeMark's bills belong in
 * "Cost of Goods Sold:Baker Items COGs" and Vesta's in "…:Produce Items COGs",
 * and a single org-wide account throws that distinction away at the moment it
 * is cheapest to keep.
 *
 * The vendor wins on a NON-EMPTY ref only. A blank string is what an emptied
 * text field leaves behind, and treating it as an override would post those
 * bills nowhere rather than falling back.
 */
export function expenseAccountFor(
  vendorLocation:
    | Pick<VendorLocationAccounting, "expense_account_ref" | "expense_account_name">
    | null
    | undefined,
  orgDefault: { ref: string | null; name?: string | null } | null | undefined
): ResolvedAccount | null {
  const atShop = vendorLocation?.expense_account_ref?.trim();
  if (atShop) {
    return {
      ref: atShop,
      name: vendorLocation?.expense_account_name?.trim() || null,
      source: "vendor_location",
    };
  }
  // The org's floor, from Settings → Accounting, so a vendor nobody has
  // configured still posts somewhere rather than refusing.
  const fallback = orgDefault?.ref?.trim();
  if (fallback) {
    return { ref: fallback, name: orgDefault?.name?.trim() || null, source: "org" };
  }
  return null;
}

/**
 * The QuickBooks Location and Class for a bill, which is how one company file
 * tells DF01's flour from DF02's.
 *
 * ONE TIER, not three (Mark's choice): set on the vendor sub-location or not
 * sent at all. Unlike the account there is no sensible fallback — an org-wide
 * default location would put every shop's bills in the same place, which is the
 * exact opposite of what tracking them is for.
 *
 * Blank is not a value, same rule as the account: an emptied field must not
 * send an empty ref that QuickBooks would refuse.
 */
export function qboTrackingFor(
  vendorLocation: VendorLocationAccounting | null | undefined
): { location: QboRefValue | null; klass: QboRefValue | null } {
  return {
    location: refOrNull(vendorLocation?.qbo_location_ref, vendorLocation?.qbo_location_name),
    klass: refOrNull(vendorLocation?.qbo_class_ref, vendorLocation?.qbo_class_name),
  };
}

export type QboRefValue = { ref: string; name: string | null };

function refOrNull(
  ref: string | null | undefined,
  name: string | null | undefined
): QboRefValue | null {
  const r = ref?.trim();
  return r ? { ref: r, name: name?.trim() || null } : null;
}

/**
 * A sub-account reads as its LEAF in QuickBooks' `Name` and as
 * "Cost of Goods Sold:Baker Items COGs" in `FullyQualifiedName`. We store and
 * show the qualified form — a bare "Baker Items COGs" is indistinguishable from
 * a top-level account, which is how a bill posts to the wrong one — and this is
 * the pair of parts a picker renders.
 */
export function splitAccountName(name: string | null | undefined): {
  parent: string | null;
  leaf: string;
} {
  const n = (name ?? "").trim();
  const at = n.lastIndexOf(":");
  if (at < 0) return { parent: null, leaf: n };
  return { parent: n.slice(0, at), leaf: n.slice(at + 1) };
}


// ---------------------------------------------------------------------------
// Customer invoices (A/R)
// ---------------------------------------------------------------------------

/**
 * A customer invoice, as QuickBooks needs it.
 *
 * ONE SUMMARY LINE, like the bill — the app keeps the twenty donut lines, the
 * taxonomy and the document; QuickBooks gets the money.
 *
 * BUT THE LINE IS THE NET AMOUNT AND THE TAX IS STATED SEPARATELY (Mark,
 * 2026-09-02). A single gross line would book the sales tax as revenue:
 * income overstated by the tax and no liability recorded anywhere, which is
 * wrong on the return rather than merely coarse. So the line carries
 * `total − tax` and `TxnTaxDetail.TotalTax` carries the rest, and the two sum
 * to what the customer was billed.
 *
 * `TxnTaxDetail` is also what tells QuickBooks to tax the transaction at all:
 * its ABSENCE is read as an intent not to tax. That is why an untaxed order
 * omits it entirely rather than sending a zero.
 */
export type InvoiceOrder = {
  id: string;
  number: string | null;
  /** `date_initiated` — when the order was written, which is the invoice's
   *  own date. Not the event date, which is when the donuts are due. */
  invoice_date: string | null;
  due_date: string | null;
  kind: string;
  status: string | null;
  ignore_balance: boolean;
  external_ref: AccountingRef | null;
};

export type InvoicePushInputs = {
  order: InvoiceOrder;
  /** `customers.external_ref → qbo → id`. */
  customerRef: string | null;
  customerName: string;
  /** `accounting_connections.invoice_item_ref`. */
  itemRef: string | null;
  /**
   * `accounting_connections.tax_code_ref` (084). QuickBooks computes the tax
   * ITSELF from this; ours is only compared against what it decides.
   *
   * Null sends no `TxnTaxDetail`, which is how QuickBooks is told not to tax —
   * and with the detail present but EMPTY it computed nothing at all, measured.
   */
  taxCodeRef: string | null;
  /**
   * From `orderTotals`. The push sends the two NET amounts and lets QuickBooks
   * work the tax out from its own rate; `tax` is what WE billed, kept only so
   * the push can say when the two disagree.
   */
  total: number;
  tax: number;
  /** The discounted taxable portion — what QuickBooks should tax. */
  taxableNet: number;
  /** Everything else net of tax: non-taxable items, delivery and rush. */
  nonTaxableNet: number;
};

/** The statuses an order may be sent at, and why the others may not. */
export function invoicePushRefusals(inputs: InvoicePushInputs): string[] {
  const { order, customerRef, customerName, itemRef, total } = inputs;
  const out: string[] = [];

  // 051 makes `status` NULL exactly when `kind` is not `order`, so a template
  // or a standing order excludes itself by having nothing to be at.
  if (order.kind !== "order") {
    out.push(
      order.kind === "standing_order"
        ? "A standing order is a recurrence, not an invoice. Send the days it produces."
        : "A template is not an invoice."
    );
  } else if (order.status === "cancelled") {
    out.push("This order was cancelled.");
  } else if (order.status !== "invoice" && order.status !== "order") {
    // A lead or a quote is not money anybody has agreed to pay, and putting one
    // on the books is the A/P "approved only" rule from the other direction.
    out.push("Only an invoiced or committed order goes to QuickBooks — it is still a " +
      `${order.status ?? "lead"}.`);
  }

  // 45 real orders carry this. It means "billed weekly by statement, not per
  // order", so sending each day would invoice the customer seven times a week.
  if (order.ignore_balance) {
    out.push(
      `${customerName} is billed by statement rather than per order, so this day is not sent on its own.`
    );
  }
  if (!customerRef) {
    out.push(`No QuickBooks customer is linked to ${customerName}. Pick one on their record.`);
  }
  if (!itemRef) {
    out.push("No QuickBooks item is set. Choose one in Settings → Accounting.");
  }
  // Only when there is tax to charge: an untaxed order needs no code, and
  // demanding one would block every order for a customer who pays none.
  if (!inputs.taxCodeRef && Number(inputs.tax) > 0) {
    out.push("No QuickBooks tax code is set. Choose one in Settings → Accounting.");
  }
  if (!Number.isFinite(total)) out.push("This order has no total.");
  else if (total < 0) {
    // A negative total is a credit, which QuickBooks models as a CreditMemo —
    // its own entity, not an invoice for minus money. Not built.
    out.push("This order's total is negative. A refund is a credit memo, which is not sent yet.");
  }
  return out;
}

export function buildInvoicePayload(
  inputs: InvoicePushInputs
): { entity: "Invoice"; path: string; body: Record<string, unknown> } {
  const refusals = invoicePushRefusals(inputs);
  if (refusals.length > 0) throw new Error(refusals[0]);

  const { order, customerRef, itemRef, taxableNet, nonTaxableNet } = inputs;

  // TWO LINES, AND THE SPLIT IS THE POINT. QuickBooks computes the tax from
  // the lines it is given, and `orderTotals` does NOT tax delivery or rush —
  // so one combined taxable line would have QuickBooks tax them and inflate
  // its own figure against ours. This is still one summary per document; it is
  // a tax split, not itemisation.
  //
  // A US line's TaxCodeRef may only be TAX or NON — a real code id is refused
  // ("Valid line TaxCodes for US should be TAX or NON"), measured.
  const lines: Record<string, unknown>[] = [];
  const push = (amount: number, taxable: boolean, label: string) => {
    if (round2(amount) <= 0) return;
    lines.push({
      Amount: round2(amount),
      DetailType: "SalesItemLineDetail",
      Description: label,
      SalesItemLineDetail: {
        ItemRef: { value: itemRef },
        TaxCodeRef: { value: taxable ? "TAX" : "NON" },
      },
    });
  };
  const name = order.number ? `Special order ${order.number}` : "Special order";
  push(taxableNet, true, name);
  push(nonTaxableNet, false, `${name} — not taxed`);

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerRef },
    Line: lines,
    PrivateNote: `restaurantfriend ${order.id}`,
  };

  // NAMES A CODE, because an empty detail computed nothing — measured — and no
  // customer in the company carried a `DefaultTaxCodeRef` to fall back on.
  // Supplying a TotalTax instead is either dropped or overwritten, which is why
  // this hands QuickBooks the code and lets it do the arithmetic.
  if (round2(taxableNet) > 0 && inputs.taxCodeRef) {
    body.TxnTaxDetail = { TxnTaxCodeRef: { value: inputs.taxCodeRef } };
  }

  const docNumber = docNumberFor(order.number);
  if (docNumber) body.DocNumber = docNumber;
  if (order.invoice_date) body.TxnDate = order.invoice_date;
  if (order.due_date) body.DueDate = order.due_date;

  const existing = qboRef(order.external_ref);
  if (existing) {
    body.Id = existing.id;
    body.SyncToken = existing.syncToken;
    body.sparse = true;
  }

  return { entity: "Invoice", path: "invoice", body };
}

/**
 * What to say when QuickBooks' tax differs from the one on the document the
 * customer holds. Null when they agree.
 *
 * This is the accepted cost of letting QuickBooks compute: its rate comes from
 * its own setup, ours from `special_orders.tax_rate`, and nothing keeps them in
 * step. Surfacing the difference is the whole reason that trade was acceptable.
 */
export function taxDisagreement(
  ourTax: number,
  theirTax: number | null | undefined
): string | null {
  const theirs = Number(theirTax ?? 0);
  if (Math.abs(theirs - Number(ourTax)) < 0.005) return null;
  return (
    `QuickBooks calculated ${theirs.toFixed(2)} of sales tax where this order bills ` +
    `${Number(ourTax).toFixed(2)}. Its total will differ from the customer's copy.`
  );
}

/** Money rounds ONCE, at the edge. Two figures each rounded and then summed is
 *  how a total ends up a cent away from the document the customer holds. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


/**
 * The two net amounts a customer invoice is sent as.
 *
 * Structurally typed rather than importing `OrderTotals`, so this module stays
 * free of `lib/specialOrders` and the fixture build stays a leaf.
 *
 * THE SPLIT IS THE WHOLE REASON THIS EXISTS: `orderTotals` taxes the discounted
 * taxable subtotal and does NOT tax delivery or rush, so sending one combined
 * taxable line would have QuickBooks tax those too and inflate its figure
 * against the customer's copy. Verified against a real company — 120 TAX plus
 * 27.40 NON produced tax on the 120 alone.
 */
export function invoiceSplit(totals: {
  subtotal: number;
  taxableSubtotal: number;
  discount: number;
  deliveryCharge: number;
  rushFee: number;
  tax: number;
  total: number;
}): { taxableNet: number; nonTaxableNet: number } {
  const afterDiscount = totals.subtotal - totals.discount;
  // The discount comes off proportionally across the taxable and non-taxable
  // parts, which is what `orderTotals` does when it computes the tax — the two
  // must use the same fraction or the split will not reproduce its figure.
  const keptFraction = totals.subtotal > 0 ? afterDiscount / totals.subtotal : 0;
  const taxableNet = round2(totals.taxableSubtotal * keptFraction);
  // Everything else, by subtraction, so the two ALWAYS sum to total − tax
  // however the discount fell. Deriving both independently is how a cent goes
  // missing.
  const nonTaxableNet = round2(totals.total - totals.tax - taxableNet);
  return { taxableNet, nonTaxableNet };
}
