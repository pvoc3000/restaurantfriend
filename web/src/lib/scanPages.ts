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

import { useSyncExternalStore } from "react";

/** Long edge, in pixels, of a page as stored. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

/** US Letter — the sheet a scanned invoice was printed on, near enough. */
const LETTER = { width: 612, height: 792 };

export type ScanRotation = 0 | 90 | 180 | 270;

/**
 * The part of the TURNED page to keep, as fractions of its width and height —
 * so it means the same thing at preview size and at full size. Null keeps the
 * whole page. A rectangle only: pulling four corners to square up a page shot
 * at an angle is perspective correction, a different and much larger job.
 */
export type ScanCrop = { x: number; y: number; w: number; h: number };

/** The smallest crop, as a fraction of a side — a sliver is a mis-drag. */
export const MIN_CROP = 0.05;

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

/**
 * A crop turned WITH its page, so rotating a cropped page keeps the same part
 * of the paper rather than a rectangle in the same place on the screen.
 */
export function rotateCrop(crop: ScanCrop | null, quarterTurns: 1 | -1): ScanCrop | null {
  if (!crop) return null;
  return quarterTurns === 1
    ? { x: 1 - (crop.y + crop.h), y: crop.x, w: crop.h, h: crop.w }
    : { x: crop.y, y: 1 - (crop.x + crop.w), w: crop.h, h: crop.w };
}

// ---------------------------------------------------------------------------
// THE TONE IS REMEMBERED (Mark, 2026-09-18: "once I dial it in, I'd like it to
// be the default until I change the settings again"). A per-device display
// preference, so localStorage — `lib/receivingLayout`'s rule, read through
// `useSyncExternalStore` for the same reason given there. Every change saves,
// Reset included; there is no separate "save as default" to forget.

const TONE_KEY = "rf.scan.tone";
const toneListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedTone: ScanTone = NEUTRAL_TONE;

function subscribeTone(onChange: () => void) {
  toneListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    toneListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function clampSetting(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;
}

/** The stored tone. The same object while the stored text is unchanged —
 *  `useSyncExternalStore` compares snapshots by identity. */
function readTone(): ScanTone {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TONE_KEY);
  } catch {
    // Private browsing: every scan starts untouched.
  }
  if (raw === cachedRaw) return cachedTone;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    cachedTone = parsed
      ? {
          mode: parsed.mode === "grey" || parsed.mode === "bw" ? parsed.mode : "color",
          brightness: clampSetting(parsed.brightness),
          contrast: clampSetting(parsed.contrast),
        }
      : NEUTRAL_TONE;
  } catch {
    cachedTone = NEUTRAL_TONE;
  }
  return cachedTone;
}

export function useScanTone(): ScanTone {
  return useSyncExternalStore(subscribeTone, readTone, () => NEUTRAL_TONE);
}

export function saveScanTone(tone: ScanTone) {
  try {
    window.localStorage.setItem(TONE_KEY, JSON.stringify(tone));
  } catch {
    // Not being able to persist shouldn't stop the control working this scan.
  }
  for (const listener of toneListeners) listener();
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

export type ScanPageSettings = {
  img: HTMLImageElement;
  rotation: ScanRotation;
  crop: ScanCrop | null;
};

/**
 * One page — turned, cropped, shrunk to `maxEdge`, toned — onto `canvas`.
 * `maxEdge` applies to what is KEPT, so a cropped page keeps its detail
 * rather than being shrunk as a whole page and then cut down.
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  page: ScanPageSettings,
  tone: ScanTone,
  maxEdge: number
) {
  const { img, rotation } = page;
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const sideways = rotation === 90 || rotation === 270;
  // The turned page's size, which the crop's fractions are fractions of.
  const turnedW = sideways ? natH : natW;
  const turnedH = sideways ? natW : natH;
  const crop = page.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const keptW = crop.w * turnedW;
  const keptH = crop.h * turnedH;
  const scale = Math.min(1, maxEdge / Math.max(keptW, keptH));
  canvas.width = Math.max(1, Math.round(keptW * scale));
  canvas.height = Math.max(1, Math.round(keptH * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  context.imageSmoothingQuality = "high";
  context.save();
  context.scale(scale, scale);
  context.translate(-crop.x * turnedW, -crop.y * turnedH);
  context.translate(turnedW / 2, turnedH / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(img, -natW / 2, -natH / 2, natW, natH);
  context.restore();
  if (!isNeutralTone(tone)) {
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    applyTone(frame.data, tone);
    context.putImageData(frame, 0, 0);
  }
}

async function pageJpeg(page: ScanPageSettings, tone: ScanTone): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  renderPage(canvas, page, tone, MAX_EDGE);
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
  pages: readonly ScanPageSettings[],
  tone: ScanTone,
  fileName: string
): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();

  for (const page of pages) {
    const image = await out.embedJpg(await pageJpeg(page, tone));
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
