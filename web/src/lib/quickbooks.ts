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

/** The two accounts-payable documents. A/R's `Invoice` arrives with phase 4. */
export type QboEntity = "Bill" | "VendorCredit";

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

/** The API path segment. QBO lower-cases entity names in URLs. */
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

/** "In QuickBooks as Bill 1043" — what the record and the list say. */
export function pushedLabel(external_ref: AccountingRef | null | undefined): string | null {
  const qbo = external_ref?.qbo;
  const ref = qboRef(external_ref);
  if (!ref) return null;
  const kind = qbo?.entity === "VendorCredit" ? "Credit" : "Bill";
  const shown = qbo?.doc_number?.trim() || ref.id;
  return `In QuickBooks as ${kind} ${shown}`;
}

// ---------------------------------------------------------------------------
// Which account a vendor's bills post to
// ---------------------------------------------------------------------------

/**
 * The vendor's side of the mapping: who they are in QuickBooks, and — since
 * migration 082 — which account their bills post to.
 */
export type VendorAccounting = {
  external_ref: AccountingRef | null;
  expense_account_ref: string | null;
  expense_account_name: string | null;
};

/** The QBO Vendor id, or null when nobody has mapped this vendor yet. */
export function qboVendorId(external_ref: AccountingRef | null | undefined): string | null {
  const id = external_ref?.qbo?.id?.trim();
  return id ? id : null;
}

/** 083's row: this vendor, at this shop. */
export type VendorLocationAccounting = {
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
  source: "vendor_location" | "vendor" | "org";
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
  vendor:
    | Pick<VendorAccounting, "expense_account_ref" | "expense_account_name">
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
  const own = vendor?.expense_account_ref?.trim();
  if (own) {
    return { ref: own, name: vendor?.expense_account_name?.trim() || null, source: "vendor" };
  }
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
