// The signed-quote artifact — decision 17's "same artifact the scan flow
// produced", made without a scanner.
//
// IT IS THE QUOTE, not a new document, and this file is an ADAPTER rather than
// a fourth renderer: `OrderDocumentPdf` draws it, with its `approval` block
// filled in where the pen would have gone. That matters beyond tidiness — the
// thing filed as `signed_quote` has to be recognisably the paper the customer
// read, and a separate renderer would drift from it the first time either
// changed.
//
// WHY AN ADAPTER IS NEEDED AT ALL: the approval page has only the SNAPSHOT
// (migration 052's `document_snapshot`), which is deliberately much smaller
// than `OrderDocData` — it is readable by anyone holding the link, so it
// carries the paper's contents and nothing about the record behind it. The
// fields this fills in with nulls are exactly the ones a customer's copy never
// showed: kitchen, taken-by, delivery tracking, internal notes.
//
// This module is imported DYNAMICALLY from the approval page's Approve
// handler, so a customer merely READING a quote never downloads the renderer.

import { OrderDocumentPdf } from "./SpecialOrderPdfs";
import type { OrderDocData } from "@/lib/specialOrderDocs";
import type { QuoteSnapshot } from "@/lib/specialOrderSend";

/** The snapshot, dressed as the document data the renderer wants. */
function asDocData(quote: QuoteSnapshot): OrderDocData {
  return {
    id: quote.number,
    org_id: "",
    number: quote.number,
    kind: "order",
    status: "quote",
    title: quote.title,
    event_date: quote.event_date,
    event_time: quote.event_time,
    ready_by_time: null,
    fulfillment: quote.fulfillment,
    allergen_info: null,
    taken_by: null,
    date_initiated: null,
    contact_name: quote.contact_name,
    contact_phone: null,
    contact_email: null,
    delivery_address: null,
    delivery_tracking: null,
    delivery_boxes: null,
    // `customerLabel` renders "last, first" from parts, and the snapshot holds
    // the finished string — so it goes in as a last name, which is the one
    // shape that comes back out unchanged.
    customer: { first_name: null, last_name: quote.customer_name, company: null, phone: null, email: null },
    location_code: null,
    location_name: quote.location_name,
    kitchen_code: null,
    notes_quote: quote.notes_quote,
    notes_production: null,
    notes_invoice: null,
    notes_receipt: null,
    lines: quote.lines.map((l, i) => ({
      id: String(i),
      sort: i + 1,
      name: l.name,
      item_donut: null,
      item_type: null,
      item_cut: null,
      item_finish: null,
      item_size: null,
      notes: l.notes,
      qty: l.qty,
      unit_price: l.unit_price,
      taxable: l.taxable,
    })),
    payments: [],
    money: {
      tax_rate: null,
      discount_amount: null,
      discount_rate: null,
      delivery_charge: null,
      rush_fee: null,
    },
    // The totals travel WHOLE rather than being recomputed. The customer signed
    // these figures; re-deriving them here would mean the artifact could
    // disagree with the paper it certifies, which is the one thing it must
    // never do.
    totals: quote.totals,
  };
}

export function SignedQuotePdf({
  quote,
  approval,
}: {
  quote: QuoteSnapshot;
  approval: { name: string; at: string };
}) {
  return (
    <OrderDocumentPdf
      orders={[asDocData(quote)]}
      org={{
        ...quote.org,
        invoiceFooter: "",
        replyTo: null,
      }}
      kind="quote"
      approval={{
        name: approval.name,
        at: approval.at,
        // The last eight characters of the ISO instant are enough to tell two
        // approvals apart in a filing cabinet, and unlike the token itself they
        // are safe to print: a capability URL must not end up on a piece of
        // paper that gets forwarded.
        reference: approval.at.slice(11, 19),
      }}
    />
  );
}
