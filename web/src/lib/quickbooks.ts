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
    /** Our key → the QuickBooks `Attachable` id we already sent for it, so a
     *  re-push does not put a second copy of the same paperwork in the books.
     *  Keyed by OUR id (a `purchase_order_attachments` row, or the literal
     *  `INVOICE_SHEET_KEY` for the rendered customer sheet), never by filename,
     *  which somebody can rename inside QuickBooks. */
    attachments?: Record<string, string>;
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
 *
 * IT IS COMPOSED HERE, BY THE CALLER OF `push_invoice`, NOT BY `qbo-sync`.
 * The function shipped (2026-09-01) with an inline copy of this rule and this
 * one had no caller at all — the tested implementation was not the one running,
 * which is 016's `nextDeliveryDate` trap exactly, and the two could drift with
 * nothing going red. `push_invoice` returns the figure QuickBooks decided and
 * the sentence is built from it. The Deno function keeps its `warnings` array
 * for what only IT can see — the coding QuickBooks accepted and then dropped —
 * which is a different kind of claim and genuinely belongs server-side.
 *
 * The figures wear dollar signs because every other amount on that screen does,
 * the confirm two inches above it included.
 */
export function taxDisagreement(
  ourTax: number,
  theirTax: number | null | undefined
): string | null {
  const theirs = Number(theirTax ?? 0);
  if (Math.abs(theirs - Number(ourTax)) < 0.005) return null;
  return (
    `QuickBooks calculated $${theirs.toFixed(2)} of sales tax where this order ` +
    `bills $${Number(ourTax).toFixed(2)}. Its total will differ from the ` +
    `customer's copy.`
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

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Putting the paperwork on the QuickBooks document (Mark, 2026-09-02: "we
 * should add a copy of the invoice to the qbo bills, and a copy of the special
 * order invoice sheet to the qbo invoice").
 *
 * Everything below was MEASURED against the sandbox rather than read, because
 * Intuit's docs render client-side and could not be quoted. `POST /upload` takes
 * multipart with two parts per file — `file_metadata_01` (JSON) and
 * `file_content_01` (the bytes) — and answers with an `AttachableResponse`.
 *
 * THE TWO FINDINGS THAT SHAPE THIS CODE:
 *
 * 1. A SECOND UPLOAD MAKES A SECOND COPY. There is no idempotency and no
 *    upsert: the same file posted twice came back as ids 1000000001 and
 *    1000000011, both attached. So what has already been sent is recorded on
 *    the document's own `external_ref`, and a re-push consults it.
 *
 * 2. A REFUSED FILE RETURNS HTTP 200. The fault is per-item, inside
 *    `AttachableResponse[0].Fault` — the same shape as `extract-invoice`'s
 *    `stop_reason: "refusal"`, where the status line is not the answer. Read
 *    the item, never the status.
 *
 * And one that is latent today: `image/webp` is REFUSED (code 6041) while
 * `ATTACHMENT_ACCEPT` offers it, so a photographed invoice saved as WebP files
 * happily here and cannot go to QuickBooks. All 62 documents on file today are
 * PDFs, so nobody has met it yet.
 */

/**
 * What QuickBooks will take. `application/pdf` and `image/jpeg` are measured;
 * the rest are Intuit's published list. Deliberately NOT a guess at everything
 * it might accept — a type wrongly listed here fails at upload, four seconds
 * after a bill has already reached the books, where a type wrongly missing is
 * refused up front in a sentence naming it.
 */
export const QBO_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/tiff",
  "image/bmp",
] as const;

/** Why this file cannot go to QuickBooks, or null when it can. */
export function attachmentRefusal(
  contentType: string | null | undefined,
  fileName: string | null | undefined
): string | null {
  const type = (contentType ?? "").trim().toLowerCase();
  if (QBO_ATTACHMENT_TYPES.includes(type as (typeof QBO_ATTACHMENT_TYPES)[number])) return null;
  const name = (fileName ?? "").trim() || "that file";
  // WebP gets its own sentence because this app's own file picker offers it,
  // so it is the one refusal somebody can walk into by doing nothing wrong.
  if (type === "image/webp") {
    return `QuickBooks does not accept WebP images, so ${name} was not attached. A PDF or a JPEG would go.`;
  }
  return `QuickBooks does not accept ${type || "that kind of file"}, so ${name} was not attached.`;
}

/** The `file_metadata_01` part. `IncludeOnSend` is always false — QuickBooks
 *  never emails anything on this org's behalf (decision 2), so the only thing
 *  it could do is surprise somebody who pressed send inside QuickBooks. */
export function attachableMetadata(input: {
  entity: QboEntity;
  entityId: string;
  fileName: string;
  contentType: string;
}) {
  return {
    AttachableRef: [
      {
        EntityRef: { type: input.entity, value: String(input.entityId) },
        IncludeOnSend: false,
      },
    ],
    FileName: input.fileName,
    ContentType: input.contentType,
  };
}

/**
 * The id QuickBooks gave the attachment — or a refusal in its own words.
 *
 * Reads the ITEM, not the HTTP status: a rejected file comes back 200 with a
 * `Fault` inside the response array, so a status check alone reports success
 * and stores nothing.
 */
export function attachableFromResponse(
  json: unknown
): { ok: true; id: string; size: number | null } | { ok: false; message: string } {
  const item = (json as { AttachableResponse?: unknown[] } | null)?.AttachableResponse?.[0] as
    | {
        Attachable?: { Id?: unknown; Size?: unknown };
        Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] };
      }
    | undefined;

  const fault = item?.Fault?.Error?.[0];
  if (fault) {
    const code = fault.code ? ` (${fault.code})` : "";
    return { ok: false, message: `${fault.Message ?? "QuickBooks refused the file"}${code}` };
  }
  const id = item?.Attachable?.Id;
  if (id === undefined || id === null || String(id).trim() === "") {
    return { ok: false, message: "QuickBooks accepted the upload but named no attachment." };
  }
  const size = Number(item?.Attachable?.Size);
  return { ok: true, id: String(id), size: Number.isFinite(size) ? size : null };
}

/** What this document has already put in QuickBooks: our own key → its
 *  Attachable id. Keyed by OUR id so a second scan filed later is known to be
 *  new, and so nothing depends on a filename somebody may rename in QBO. */
export function recordedAttachments(
  external_ref: AccountingRef | null | undefined
): Record<string, string> {
  const map = external_ref?.qbo?.attachments;
  return map && typeof map === "object" ? map : {};
}

/** The ref to store after attaching. Merges rather than replaces, so a
 *  previously attached document is not forgotten by a push that adds one. */
export function withAttachments(
  external_ref: AccountingRef,
  added: Record<string, string>
): AccountingRef {
  const qbo = external_ref.qbo ?? {};
  return {
    ...external_ref,
    qbo: { ...qbo, attachments: { ...recordedAttachments(external_ref), ...added } },
  };
}

/** Which filed documents still need to go up. A bill's scan never changes, so
 *  one already attached is left alone — re-pushing a bill must not put a
 *  second copy of the same invoice in the books. */
export function attachmentsToSend<T extends { id: string; kind?: string | null }>(
  documents: T[],
  external_ref: AccountingRef | null | undefined,
  kind = "invoice"
): T[] {
  const sent = recordedAttachments(external_ref);
  return documents.filter((d) => (d.kind ?? "") === kind && !sent[d.id]);
}

/** The key the rendered customer sheet is recorded under. A/R attaches ONE
 *  document and re-renders it from live figures, so it has no row id to key on
 *  and its previous copy is replaced rather than added to. */
export const INVOICE_SHEET_KEY = "sheet";

// ---------------------------------------------------------------------------
// Adopting a bill QuickBooks already has
// ---------------------------------------------------------------------------

/**
 * Linking one of our invoices to a Bill that is ALREADY in QuickBooks.
 *
 * WHY THIS EXISTS, and why it is a bridge rather than a feature. Bills reach
 * Mark's books through **Bill.com** today, which syncs them to QuickBooks; the
 * app is meant to replace that eventually, and until it does BOTH systems would
 * create the same bill. Measured 2026-09-02 against the real company: **51 of
 * our 52 unpushed invoices already exist there**, matching on number and amount,
 * with ZERO ambiguous and ZERO unmatched. Pushing them would have doubled every
 * one.
 *
 * So the app's job during the parallel run is not to CREATE the bill — that is
 * handled — it is to find the one already there and add what only this app has:
 * the scan, the receiving reconciliation, the per-shop coding, and what is
 * still owed. When Bill.com goes, there is nothing left to link and this
 * quietly stops proposing anything.
 *
 * IT IS A PROPOSAL AND NEVER A WRITE — `matchInvoiceToOrder`'s posture, and for
 * a stronger reason: the wrong link silently attaches our scan to somebody
 * else's bill and then reports its balance as ours.
 */

export type QboCandidate = {
  id: string;
  sync_token: string;
  doc_number: string | null;
  entity: QboEntity;
  total: number;
  vendor_ref: string | null;
  vendor_name: string | null;
  txn_date: string | null;
  balance: number | null;
};

export type BillLinkProposal =
  | { ok: true; candidate: QboCandidate; exact: boolean; caveat: string | null }
  | { ok: false; reason: string };

/**
 * The bill in QuickBooks that IS this invoice, or why we will not say.
 *
 * The vendor is a REFUSAL and the amount is a CAVEAT, which is the asymmetry to
 * keep: a number that turns up under a different vendor is a different document
 * and linking it would be wrong, where the same number and vendor at a
 * different amount is the case a human most needs to look at — a credit, a
 * short delivery, or a bill somebody corrected on one side only.
 */
export function proposeBillLink(
  invoice: {
    invoice_number: string | null;
    total: number | null;
    is_credit: boolean;
    external_ref?: AccountingRef | null;
  },
  candidates: QboCandidate[],
  /** The QBO vendor this invoice's shop is mapped to, when it is mapped. */
  vendorRef: string | null,
  normalize: (raw: string | null) => string | null
): BillLinkProposal {
  if (qboRef(invoice.external_ref)) {
    return { ok: false, reason: "This is already linked to QuickBooks." };
  }
  const number = normalize(invoice.invoice_number);
  if (!number) {
    return {
      ok: false,
      reason: "This bill has no number, so there is nothing to match it on.",
    };
  }

  const wanted: QboEntity = invoice.is_credit ? "VendorCredit" : "Bill";
  const matches = candidates.filter(
    (c) => c.entity === wanted && normalize(c.doc_number) === number
  );
  if (matches.length === 0) {
    return { ok: false, reason: "QuickBooks has no bill with this number." };
  }

  // The vendor decides before anything else. Two suppliers can print the same
  // invoice number in the same month and nothing about the amount would tell
  // you which is which.
  const byVendor = vendorRef ? matches.filter((c) => c.vendor_ref === vendorRef) : matches;
  if (vendorRef && byVendor.length === 0) {
    const other = matches[0];
    return {
      ok: false,
      reason:
        `QuickBooks has ${other.entity} ${other.doc_number ?? other.id} under ` +
        `${other.vendor_name ?? "another vendor"}, which is not the vendor this bill is mapped to.`,
    };
  }
  if (byVendor.length > 1) {
    return {
      ok: false,
      reason: `That number matches ${byVendor.length} documents in QuickBooks, so it has to be picked by hand.`,
    };
  }

  const candidate = byVendor[0];
  const ours = Number(invoice.total ?? 0);
  const exact = Math.abs(candidate.total - ours) < 0.005;
  return {
    ok: true,
    candidate,
    exact,
    caveat: exact
      ? null
      : `QuickBooks has $${candidate.total.toFixed(2)} where this bill is $${ours.toFixed(2)}.`,
  };
}

/** The ref to store when a proposal is accepted — the same shape a push
 *  records, so everything downstream (attachments, the balance, "In QuickBooks
 *  as…") cannot tell an adopted bill from one we created. That is the point. */
export function linkedRef(candidate: QboCandidate): AccountingRef {
  return {
    qbo: {
      id: candidate.id,
      sync_token: candidate.sync_token,
      doc_number: candidate.doc_number,
      entity: candidate.entity,
    },
  };
}

/**
 * The words for what QuickBooks says is owed — ONE implementation for
 * `refresh_status`'s reading and for the balance a LINK already arrives with
 * (Mark, 2026-09-03: "is it possible to check to see if it's paid and set
 * the status then, rather than forcing the user to check in a separate
 * step?"). `find_bills` already asks QuickBooks for `Balance` on every
 * candidate it returns — accepting a proposal is adopting a document
 * QuickBooks has already answered about, so there is nothing left to ask a
 * second time. Half a cent, matching the `exact` check a few lines up and
 * `MONEY_EPSILON` in lib/invoices — one epsilon for money, everywhere.
 */
export function balanceLabel(
  entity: QboEntity,
  balance: number,
  money: (n: number) => string
): string {
  if (Math.abs(balance) < 0.005) {
    return entity === "VendorCredit" ? "fully applied in QuickBooks" : "paid in QuickBooks";
  }
  return `${money(balance)} still owed`;
}
