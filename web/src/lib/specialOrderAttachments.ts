/**
 * Decision 14: PICS AND DOCUMENTS ARE ONE CARD.
 *
 * FileMaker had them on two tabs — a photo strip and a file list — which meant
 * the picture of last year's cake and the signed quote for this year's lived in
 * different places for no reason anybody could state. One bucket, one card,
 * one list, and the KIND is a field on the row rather than which tab it landed
 * on.
 *
 * `special-order-attachments` is its own bucket (migration 051), on 021's test:
 * the AUDIENCE decides. These are supervisor+, which is neither
 * `po-attachments` (purchaser+) nor `employee-documents` (owner/admin), so a
 * third bucket is the honest answer rather than a convenience.
 *
 * The object key is `{org_id}/{order_id}/{uuid}.{ext}` — the first segment is
 * what 018's four-policy pattern authorises on, with no join.
 */

import type { PickOption } from "@/components/ui/PickList";

export const SO_ATTACHMENT_BUCKET = "special-order-attachments";

/** Long enough to read a quote, short enough that a URL copied out of the page
 *  stops working by the end of the shift. */
export const SO_SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Exactly migration 051's check constraint — a value outside it is a failed
 * insert.
 *
 * THREE ARE PICKED AND TWO ARE PRODUCED. `signed_quote`, `picture` and
 * `document` are what a person files; `quote_document` and `invoice_document`
 * are what the app files when it sends one, and they exist so the artifact a
 * customer actually received is on the record rather than only in somebody's
 * Sent folder. That is also what decision 17's token binds to: approval signs
 * the exact PDF that went out, not whatever the order says today.
 */
export type SoAttachmentKind =
  | "signed_quote"
  | "quote_document"
  | "invoice_document"
  | "picture"
  | "document";

export const SO_ATTACHMENT_KIND_LABEL: Record<SoAttachmentKind, string> = {
  signed_quote: "Signed quote",
  quote_document: "Quote sent",
  invoice_document: "Invoice sent",
  picture: "Picture",
  document: "Document",
};

/**
 * What the Add-as picker offers — the three a HUMAN files.
 *
 * The two the app produces are deliberately absent: offering "Quote sent" as a
 * thing to upload invites somebody to file a document as having been sent when
 * it never was, and the stage date beside it would then be a lie nobody wrote.
 */
export const SO_ATTACHMENT_KIND_OPTIONS: PickOption[] = [
  { value: "signed_quote", label: "Signed quote", hint: "returned by the customer" },
  { value: "picture", label: "Picture", hint: "the cake, the reference photo" },
  { value: "document", label: "Document", hint: "anything else on file" },
];

/** Filing a signed quote is what `quote_returned_at` records — decision 14
 *  says the stamp is OFFERED, never forced, which is what this predicate is
 *  for rather than a write buried in the upload. */
export function stampsQuoteReturned(kind: SoAttachmentKind): boolean {
  return kind === "signed_quote";
}

export type SoAttachment = {
  id: string;
  order_id: string;
  kind: SoAttachmentKind;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};

export type SignedSoAttachment = SoAttachment & { url: string | null };
