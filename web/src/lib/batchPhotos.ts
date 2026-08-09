// The photograph on a batch log — migration 044. Objects live in the PRIVATE
// `batch-photos` bucket; reads go through short-lived signed URLs minted
// server-side.
//
// A near-twin of `lib/recipeImages`, and separate on purpose rather than
// generalised: the two buckets exist BECAUSE their write rules differ (a
// supervisor may photograph a batch and may not upload a recipe image), so a
// shared module would be one bucket name away from being one bucket, which is
// the coupling 041 declined.

export const BATCH_PHOTO_BUCKET = "batch-photos";

/** Long enough to work a shift, short enough that a URL copied out of the page
 *  stops working by the end of it — `lib/attachments`' figure. */
export const BATCH_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * What may be attached, named rather than wildcarded.
 *
 * `image/*` is wrong for the reason `ATTACHMENT_ACCEPT` sets out: a photo taken
 * on an iPhone arrives as HEIC, which no browser here renders, and naming the
 * formats makes iOS transcode on the way out — so the failure happens at PICK
 * time, in the kitchen, rather than as a broken thumbnail somebody finds later.
 *
 * There is deliberately no `capture` attribute at the call site either: without
 * it iOS offers Photo Library / Take Photo / Choose File in one sheet, and a
 * batch photo is sometimes taken now and sometimes one from earlier.
 */
export const BATCH_PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;

export const BATCH_PHOTO_ACCEPT_ATTR = BATCH_PHOTO_ACCEPT.join(",");

export function batchPhotoRejection(
  rejected: readonly { name: string; type: string }[]
): string {
  if (rejected.length === 0) return "";
  const names = rejected.map((f) => f.name).join(", ");
  const heic = rejected.some((f) => /heic|heif/i.test(f.type || f.name));
  return (
    `${names} can't be used — pick a JPEG, PNG or WebP.` +
    (heic ? " That's an iPhone HEIC photo; the Photo button asks iOS to convert it." : "")
  );
}

/**
 * `{org_id}/{batch_id}/{uuid}.{ext}` — org FIRST, so 044's storage policies
 * authorise from the path alone with no join, the same shape 018, 021 and 041
 * use. The uuid rather than the original filename keeps two files called
 * "IMG_0001.jpg" apart.
 */
export function batchPhotoPath(orgId: string, batchId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : "";
  return `${orgId}/${batchId}/${crypto.randomUUID()}${ext}`;
}
