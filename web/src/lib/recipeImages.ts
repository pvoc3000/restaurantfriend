// The picture on a procedure step — FileMaker's container field, migration 041.
// Objects live in the PRIVATE `recipe-images` bucket; reads go through
// short-lived signed URLs minted server-side.

export const RECIPE_IMAGE_BUCKET = "recipe-images";

/** Long enough to work through a recipe, short enough that a URL copied out of
 *  the page stops working by the end of the shift — `lib/attachments`' figure. */
export const RECIPE_IMAGE_TTL_SECONDS = 60 * 60;

/**
 * What may be attached, named rather than wildcarded.
 *
 * `image/*` is wrong here for the reason `ATTACHMENT_ACCEPT` sets out: a photo
 * picked from an iPhone's library arrives as HEIC, which no browser here can
 * render, and naming the formats makes iOS transcode on the way out — so the
 * failure happens at PICK time rather than as a broken thumbnail in the binder.
 */
export const RECIPE_IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;

export const RECIPE_IMAGE_ACCEPT_ATTR = RECIPE_IMAGE_ACCEPT.join(",");

export function recipeImageRejection(rejected: readonly { name: string; type: string }[]): string {
  if (rejected.length === 0) return "";
  const names = rejected.map((f) => f.name).join(", ");
  const heic = rejected.some((f) => /heic|heif/i.test(f.type || f.name));
  return (
    `${names} can't be used — pick a JPEG, PNG or WebP.` +
    (heic ? " That's an iPhone HEIC photo; the Picture button asks iOS to convert it." : "")
  );
}

/**
 * `{org_id}/{version_id}/{uuid}.{ext}` — org FIRST, so 041's storage policies
 * authorise from the path alone with no join, the same shape 018 and 021 use.
 * The uuid rather than the original filename keeps two files called "IMG_1.jpg"
 * apart.
 */
export function recipeImagePath(orgId: string, versionId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : "";
  return `${orgId}/${versionId}/${crypto.randomUUID()}${ext}`;
}
