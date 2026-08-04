/**
 * Does a file match an `accept` list?
 *
 * This exists because a DROP gets no help from the browser. An `<input>`'s
 * `accept` attribute governs the file picker and nothing else, so a dropped
 * file arrives unvetted and whatever the picker was protecting against is back.
 *
 * Kept pure — a name and a type, not a `File` — so it can be tested without a
 * DOM and so the drop zone that uses it stays a general control.
 */
export function fileMatchesAccept(
  file: { name: string; type: string },
  accept: readonly string[]
): boolean {
  const allowed = accept.map((a) => a.toLowerCase());
  if (file.type) return allowed.includes(file.type.toLowerCase());

  // Only when the file states NO type, which is what a browser reports when the
  // OS gives it no hint. Refusing a perfectly good PDF over a missing MIME type
  // would be its own bug — but this is a fallback, never an override: a file
  // that states a type is judged on the type it states.
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return false;
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  const mapped = byExtension[ext];
  return mapped !== undefined && allowed.includes(mapped);
}
