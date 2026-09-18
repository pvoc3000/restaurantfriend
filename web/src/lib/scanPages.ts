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
 * with the phone held sideways arrives upright — and the ROTATE buttons are
 * for the page the camera still got wrong.
 *
 * THE PREVIEW AND THE PDF ARE DRAWN BY THE SAME FUNCTION (`renderPage`), at two
 * sizes. A CSS `filter` on the thumbnail would have been less code and a
 * different picture: CSS has no threshold, so Black & White could only be
 * imitated, and the page you attached would not be the page you approved.
 *
 * pdf-lib (about a megabyte, see `lib/mergeDocuments`) is imported INSIDE
 * `scanToPdf`, so this module is light enough for the dialog to import
 * statically; the PDF code arrives on the click that attaches.
 */

/** Long edge, in pixels, of a page as stored. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

/** US Letter — the sheet a scanned invoice was printed on, near enough. */
const LETTER = { width: 612, height: 792 };

export type ScanRotation = 0 | 90 | 180 | 270;

export type ScanMode = "color" | "grey" | "bw";

/**
 * How the pages are toned — ONE setting for the whole scan, because the pages
 * of one invoice are shot in one light, one after another. Brightness and
 * contrast run −100…100 with 0 meaning untouched.
 */
export type ScanTone = { mode: ScanMode; brightness: number; contrast: number };

export const NEUTRAL_TONE: ScanTone = { mode: "color", brightness: 0, contrast: 0 };

export function isNeutralTone(tone: ScanTone): boolean {
  return tone.mode === "color" && tone.brightness === 0 && tone.contrast === 0;
}

export function rotateBy(rotation: ScanRotation, quarterTurns: 1 | -1): ScanRotation {
  return (((rotation + quarterTurns * 90) % 360) + 360) % 360 as ScanRotation;
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
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

/**
 * The tone curve as a 256-entry table: contrast about mid-grey (the usual
 * 259/255 formula), then brightness as an offset of up to half the range.
 */
function toneTable(tone: ScanTone): Uint8ClampedArray {
  const c = tone.contrast * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const offset = tone.brightness * 1.28;
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) table[v] = factor * (v - 128) + 128 + offset;
  return table;
}

/**
 * Colour keeps three channels through the curve. Greyscale is luma through it.
 * Black & White is greyscale cut at the middle — so there, brightness is where
 * the cut falls, which is the one control a faint carbon copy needs.
 */
function applyTone(pixels: Uint8ClampedArray, tone: ScanTone) {
  if (isNeutralTone(tone)) return;
  const table = toneTable(tone);
  for (let i = 0; i < pixels.length; i += 4) {
    if (tone.mode === "color") {
      pixels[i] = table[pixels[i]];
      pixels[i + 1] = table[pixels[i + 1]];
      pixels[i + 2] = table[pixels[i + 2]];
      continue;
    }
    const luma = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    let y = table[luma];
    if (tone.mode === "bw") y = y >= 128 ? 255 : 0;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = y;
  }
}

/** One page — turned, shrunk to `maxEdge`, toned — onto `canvas`. */
export function renderPage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  rotation: ScanRotation,
  tone: ScanTone,
  maxEdge: number
) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const sideways = rotation === 90 || rotation === 270;
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(img, -w / 2, -h / 2, w, h);
  context.restore();
  if (!isNeutralTone(tone)) {
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    applyTone(frame.data, tone);
    context.putImageData(frame, 0, 0);
  }
}

async function pageJpeg(
  img: HTMLImageElement,
  rotation: ScanRotation,
  tone: ScanTone
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  renderPage(canvas, img, rotation, tone, MAX_EDGE);
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!jpeg) throw new Error("The browser could not convert that photo.");
  return new Uint8Array(await jpeg.arrayBuffer());
}

/**
 * The pages, in order, as one PDF `File` ready for the ordinary upload path.
 * Each page is a Letter sheet the long way up or across, whichever the turned
 * photo is, with the photo scaled to fit and centred — `mergeDocuments`' rule.
 */
export async function scanToPdf(
  pages: readonly { img: HTMLImageElement; rotation: ScanRotation }[],
  tone: ScanTone,
  fileName: string
): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();

  for (const page of pages) {
    const image = await out.embedJpg(await pageJpeg(page.img, page.rotation, tone));
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
