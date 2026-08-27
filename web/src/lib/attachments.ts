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

/**
 * What may be attached, named rather than wildcarded.
 *
 * `image/*` is wrong here: a photo taken from an iPhone's library arrives as
 * HEIC, which the model API won't read, and naming the formats makes iOS
 * transcode on the way out — so the failure happens at PICK time rather than at
 * extraction time with the invoice already filed.
 *
 * One list, two consumers that see files by different routes: the file input's
 * `accept`, and the drop zone, which gets no help from `accept` at all and has
 * to check for itself. They must not drift — a format droppable but not
 * pickable (or the reverse) is a bug nobody would think to look for.
 */
export const ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** The same list in the form an `<input accept>` wants. */
export const ATTACHMENT_ACCEPT_ATTR = ATTACHMENT_ACCEPT.join(",");

/**
 * What to say about files that can't be attached.
 *
 * HEIC gets its own sentence because it is the PREDICTABLE failure — it's what
 * an iPhone photo is, it's the exact case `ATTACHMENT_ACCEPT` was written to
 * head off, and "unsupported format" tells someone holding an invoice nothing
 * about what to do next. It also names the way through that needs no other
 * app: the Attach button asks iOS to transcode, which a drag out of Photos
 * never will.
 */
export function attachmentRejection(
  rejected: readonly { name: string; type: string }[]
): string {
  if (rejected.length === 0) return "";
  const names = rejected.map((f) => f.name).join(", ");
  const heic = rejected.some((f) => /heic|heif/i.test(f.type || f.name));
  return (
    `${names} can't be attached — use a JPEG, PNG, WebP or PDF.` +
    (heic
      ? " That's an iPhone HEIC photo: attach it with the Attach button, which asks iOS to convert it on the way out, or export a JPEG first."
      : "")
  );
}

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
  /** Nullable since migration 026: a document can belong to an invoice with no
   *  purchase order behind it — rent, a plumber, a walk-in receipt. */
  po_id: string | null;
  /** The vendor invoice this document was filed as, if any (migration 026).
   *  Auto-creation fires only while this is null, which is the structural guard
   *  that stops a re-read producing a second invoice record. */
  invoice_id: string | null;
  id: string;
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

/**
 * Documents that have been READ but never recorded as a bill.
 *
 * The gap `closeReadiness` has named since it was written ("the paperwork on
 * file isn't recorded as a bill yet") and which, until now, only PO detail's
 * Paperwork card could act on — the receiving screen, where Complete lives,
 * named it in a confirm and offered no way to settle it. That is the exact trap
 * this codebase warns about twice: a confirm naming something the screen cannot
 * fix teaches people to stop reading confirms.
 *
 * An invoice-KIND document only. A packing slip or a photo may well have been
 * read, and neither is a bill; `kind` is what the person said the document was
 * when they attached it, and it is the only thing that distinguishes them.
 *
 * Measured on the live database 2026-08-27: 8 closed orders are in this state.
 */
export function unfiledReadings<T extends Pick<PoAttachment, "kind" | "extraction" | "invoice_id">>(
  attachments: readonly T[]
): T[] {
  return attachments.filter((a) => a.kind === "invoice" && a.extraction !== null && !a.invoice_id);
}

/** An attachment plus somewhere to look at it — null when signing failed. */
export type SignedAttachment = PoAttachment & { url: string | null };

/**
 * Who a document is filed under, in the object key's second segment.
 *
 * A purchase order is its id; an invoice with no order behind it is the literal
 * `invoices/{id}`, which makes segment 2 a word where the PO form has a uuid.
 * That small irregularity is deliberate and safe: migration 018's storage
 * policies authorise on the FIRST segment only, so both forms are covered with
 * no new policy — verified against 018's own SQL.
 */
export function poOwner(poId: string): string {
  return poId;
}

export function invoiceOwner(invoiceId: string): string {
  return `invoices/${invoiceId}`;
}

/**
 * `{org_id}/{owner}/{uuid}.{ext}`.
 *
 * The org leads because that's what migration 018's storage policies authorise
 * on — they read the first folder segment and check it the same way every table
 * policy checks `org_id`, with no join. The stored name is a uuid rather than
 * the original filename: two invoices called "scan.pdf" must not collide, and a
 * filename typed by a vendor has no business becoming part of an object key.
 * The real name is kept on the row.
 *
 * A file keeps the key it landed at. One attached to an order and later filed
 * as an invoice is NOT moved — the path records where it was uploaded, not a
 * claim about who owns it now.
 */
export function attachmentPath(orgId: string, owner: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  // Only a short, plausible extension — "my.invoice.from.june" must not end up
  // with an extension of "from.june".
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : "";
  return `${orgId}/${owner}/${crypto.randomUUID()}${ext}`;
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
