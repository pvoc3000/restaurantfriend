// Invoices and packing slips attached to a purchase order — the last piece of
// spec §2 step 5, and the thing that turns a received quantity into a checkable
// claim. Objects live in the PRIVATE `po-attachments` bucket (migration 018);
// reads go through short-lived signed URLs.

import type { PickOption } from "@/components/ui/PickList";
import type { InvoiceExtraction } from "./invoiceExtraction";

export const ATTACHMENT_BUCKET = "po-attachments";

/** How long a signed URL lasts. Long enough to read an invoice, short enough
 *  that a URL copied out of the page stops working by the end of the shift. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type AttachmentKind = "invoice" | "packing_slip" | "photo" | "other";

/** Exactly 001's check constraint — a value outside it is a failed insert. */
export const ATTACHMENT_KIND_OPTIONS: PickOption[] = [
  { value: "invoice", label: "Invoice", hint: "what you were billed" },
  { value: "packing_slip", label: "Packing slip", hint: "what was in the boxes" },
  { value: "photo", label: "Photo", hint: "a short case, damage" },
  { value: "other", label: "Other" },
];

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  invoice: "Invoice",
  packing_slip: "Packing slip",
  photo: "Photo",
  other: "Other",
};

export type PoAttachment = {
  id: string;
  po_id: string;
  storage_path: string;
  kind: AttachmentKind;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
  /** What the invoice says, once someone has had it read (migration 019).
   *  A proposal, never a measurement — see lib/invoiceExtraction. */
  extraction: InvoiceExtraction | null;
  extracted_at: string | null;
  extraction_model: string | null;
};

/** An attachment plus somewhere to look at it — null when signing failed. */
export type SignedAttachment = PoAttachment & { url: string | null };

/**
 * `{org_id}/{po_id}/{uuid}.{ext}`.
 *
 * The org leads because that's what migration 018's storage policies authorise
 * on — they read the first folder segment and check it the same way every table
 * policy checks `org_id`, with no join. The stored name is a uuid rather than
 * the original filename: two invoices called "scan.pdf" must not collide, and a
 * filename typed by a vendor has no business becoming part of an object key.
 * The real name is kept on the row.
 */
export function attachmentPath(orgId: string, poId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  // Only a short, plausible extension — "my.invoice.from.june" must not end up
  // with an extension of "from.june".
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : "";
  return `${orgId}/${poId}/${crypto.randomUUID()}${ext}`;
}

/** Whether to draw a thumbnail or a document row. */
export function isImage(attachment: Pick<PoAttachment, "content_type" | "file_name">) {
  if (attachment.content_type) return attachment.content_type.startsWith("image/");
  // A file picked on iOS sometimes arrives with an empty type; fall back to the
  // name rather than showing a broken thumbnail.
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(attachment.file_name ?? "");
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
