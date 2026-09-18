"use client";

/**
 * SCANNED PAGES → ONE PDF (Mark, 2026-09-18: "scan invoices directly into a
 * purchase order or invoice record").
 *
 * A scan is a stack of camera photos, one per page, and it lands as ONE file
 * for two reasons that are both about reading it afterwards:
 *
 * - **Each document read is an Opus call.** A three-page invoice attached as
 *   three photos is three reads, and each of them sees a third of the lines and
 *   none of them sees the total. One PDF is one read of the whole invoice.
 * - **A page is a page of the same document.** Three files would file as three
 *   documents on the record, and the second and third would have to be told
 *   apart from the first by eye.
 *
 * Each photo is DOWNSCALED on the way in. A phone camera page is 12 MP and
 * 3–5 MB, a four-page invoice would pass `extract-invoice`'s 8 MB ceiling, and
 * the model reads print just as well at 2,000px on the long edge. Drawing
 * through an `<img>` rather than `createImageBitmap` is what applies the
 * photo's EXIF orientation in every Safari this app supports, so a page shot
 * with the phone held sideways arrives upright.
 *
 * IMPORT THIS DYNAMICALLY from the click that commits, like every PDF path in
 * the app — pdf-lib is about a megabyte (see `lib/mergeDocuments`).
 */

/** Long edge, in pixels, of a page as stored. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

/** US Letter — the sheet a scanned invoice was printed on, near enough. */
const LETTER = { width: 612, height: 792 };

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // `decode()` has the pixels by now; the URL is no longer needed.
    URL.revokeObjectURL(url);
  }
}

/** One page, shrunk to `MAX_EDGE` and re-encoded as JPEG. */
async function pageJpeg(file: Blob): Promise<Uint8Array> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!jpeg) throw new Error("The browser could not convert that photo.");
  return new Uint8Array(await jpeg.arrayBuffer());
}

/**
 * The pages, in order, as one PDF `File` ready for the ordinary upload path.
 * Each page is a Letter sheet the long way up or across, whichever the photo
 * is, with the photo scaled to fit and centred — `mergeDocuments`' rule.
 */
export async function scanToPdf(pages: readonly Blob[], fileName: string): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();

  for (const page of pages) {
    const image = await out.embedJpg(await pageJpeg(page));
    const landscape = image.width > image.height;
    const width = landscape ? LETTER.height : LETTER.width;
    const height = landscape ? LETTER.width : LETTER.height;
    const sheet = out.addPage([width, height]);
    const scale = Math.min(width / image.width, height / image.height);
    const drawn = { width: image.width * scale, height: image.height * scale };
    sheet.drawImage(image, {
      x: (width - drawn.width) / 2,
      y: (height - drawn.height) / 2,
      width: drawn.width,
      height: drawn.height,
    });
  }

  const bytes = await out.save();
  return new File([bytes as unknown as BlobPart], fileName, { type: "application/pdf" });
}

/** "Scan 2026-09-18 14.32.pdf" — the moment it was taken, which is what tells
 *  two scans on one order apart. Local time, because that is what's on the
 *  clock in the shop. */
export function scanFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Scan ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(
    now.getHours()
  )}.${p(now.getMinutes())}.pdf`;
}
