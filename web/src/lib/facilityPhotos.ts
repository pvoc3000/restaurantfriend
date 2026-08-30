/**
 * Photographs on a checklist answer or a task — migration 077.
 *
 * A deliberate sibling of `lib/attachments` rather than a widening of it. That
 * module is about DOCUMENTS on a purchase order or an invoice: it carries an
 * attachment KIND vocabulary, an extraction, an invoice link and a PDF-shaped
 * accept list, and none of that means anything here. What the two share is the
 * object-key shape and the ordering rules, and those are stated in both places
 * because getting either wrong is silent.
 */

/**
 * PHOTOGRAPHS ONLY, and PDF is deliberately absent.
 *
 * `lib/attachments` takes PDFs because an invoice arrives as one. What a
 * supervisor produces on a walk is a picture of a thing, and an inspection
 * report — which really can be a PDF — is filed on the TASK it raises, through
 * that side of the module.
 *
 * HEIC is the reason this is a list rather than `image/*`: an iPhone photo
 * picked from the library arrives as HEIC, which nothing downstream can render,
 * and NAMING the formats is what asks iOS to transcode on the way out. The
 * failure then happens at pick time rather than after the walk is over.
 */
export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;

export const PHOTO_ACCEPT_ATTR = PHOTO_ACCEPT.join(",");

/** Long enough to walk a shop, short enough not to outlive the page. */
export const PHOTO_URL_TTL_SECONDS = 60 * 60;

/**
 * What to say about a file that cannot be attached.
 *
 * HEIC gets its own sentence for `attachmentRejection`'s reason: it is the
 * PREDICTABLE failure, and "unsupported format" tells somebody standing in a
 * walk-in nothing about what to do next.
 */
export function photoRejection(file: { name: string; type: string }): string | null {
  if ((PHOTO_ACCEPT as readonly string[]).includes(file.type)) return null;
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    return (
      `${file.name} is a HEIC photo, which the app can't read. ` +
      "Use the camera button rather than dragging it in — that asks iOS to " +
      "convert it on the way out."
    );
  }
  return `${file.name} isn't a photo the app can read. JPEG, PNG or WebP.`;
}

/**
 * `{org_id}/{owner_id}/{uuid}.{ext}` — ORG FIRST, because 077's four storage
 * policies authorise off the first folder segment and nothing else. Change this
 * shape and every one of them silently stops matching, which reads as the
 * bucket being empty rather than as a permissions error.
 *
 * The uuid rather than the original name keeps two photos called "IMG_0001.jpg"
 * apart; the real name lives on the row.
 */
export function photoPath(orgId: string, ownerId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : ".jpg";
  return `${orgId}/${ownerId}/${crypto.randomUUID()}${ext}`;
}

export const PHOTO_BUCKET = "facility-photos";

/**
 * THE TWO WRITE ORDERS ARE OPPOSITE, and that is 018's rule restated because
 * getting it wrong is invisible until somebody looks:
 *
 *   upload = STORAGE then ROW  — a row pointing at nothing renders broken
 *   delete = ROW then OBJECT   — an orphaned object is invisible and harmless
 *
 * There is no code here to enforce it; it is a rule the callers follow, and
 * this comment is where it is written down.
 */
export const WRITE_ORDER_NOTE = "storage then row; row then object" as const;
