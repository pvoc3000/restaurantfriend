"use client";

/**
 * SCANNED PAGES → ONE PDF (Mark, 2026-09-18: "scan invoices directly into a
 * purchase order or bill record").
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

export type ScanPoint = { x: number; y: number };

/**
 * The part of the TURNED page to keep: its four corners, as fractions of the
 * page's width and height — so it means the same thing at preview size and at
 * full size. Null keeps the whole page.
 *
 * FOUR CORNERS, NOT A RECTANGLE (Mark, 2026-09-18: "add the four-corner
 * perspective correction"). A page photographed at an angle is a trapezoid in
 * the photo; put a corner on each corner of the paper and the page comes out
 * square, as if shot from straight above. A rectangle is just the case where
 * the corners line up, and it takes a cheaper path (`isRectangle`).
 */
export type ScanCrop = { tl: ScanPoint; tr: ScanPoint; br: ScanPoint; bl: ScanPoint };

export const WHOLE_PAGE: ScanCrop = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

const EPSILON = 1e-6;

export function isRectangle(c: ScanCrop): boolean {
  return (
    Math.abs(c.tl.y - c.tr.y) < EPSILON &&
    Math.abs(c.bl.y - c.br.y) < EPSILON &&
    Math.abs(c.tl.x - c.bl.x) < EPSILON &&
    Math.abs(c.tr.x - c.br.x) < EPSILON
  );
}

export function isWholePage(c: ScanCrop): boolean {
  return (["tl", "tr", "br", "bl"] as const).every(
    (k) => Math.abs(c[k].x - WHOLE_PAGE[k].x) < EPSILON && Math.abs(c[k].y - WHOLE_PAGE[k].y) < EPSILON
  );
}

export type ScanMode = "color" | "grey" | "bw";

/**
 * How the pages are toned — ONE setting for the whole scan, because the pages
 * of one invoice are shot in one light, one after another. Brightness and
 * contrast run −100…100 with 0 meaning untouched.
 */
export type ScanTone = { mode: ScanMode; brightness: number; contrast: number };

/** The photo untouched — what `applyTone` skips. */
export const NEUTRAL_TONE: ScanTone = { mode: "color", brightness: 0, contrast: 0 };

/**
 * Where a scan starts until somebody dials in their own, and what Reset goes
 * back to: GREYSCALE (Mark, 2026-09-18, "make greyscale the default"). An
 * invoice is black print on white, and colour adds only the counter's tint and
 * a warm cast from the shop's lights.
 */
export const DEFAULT_TONE: ScanTone = { mode: "grey", brightness: 0, contrast: 0 };

export function isDefaultTone(tone: ScanTone): boolean {
  return (
    tone.mode === DEFAULT_TONE.mode &&
    tone.brightness === DEFAULT_TONE.brightness &&
    tone.contrast === DEFAULT_TONE.contrast
  );
}

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
  // Each point turns with the page, and the corners are RENAMED so top-left is
  // still the top-left: a right turn brings the old bottom-left to the top.
  const turn = (p: ScanPoint): ScanPoint =>
    quarterTurns === 1 ? { x: 1 - p.y, y: p.x } : { x: p.y, y: 1 - p.x };
  return quarterTurns === 1
    ? { tl: turn(crop.bl), tr: turn(crop.tl), br: turn(crop.tr), bl: turn(crop.br) }
    : { tl: turn(crop.tr), tr: turn(crop.br), br: turn(crop.bl), bl: turn(crop.tl) };
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
let cachedTone: ScanTone = DEFAULT_TONE;

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
          mode:
            parsed.mode === "color" || parsed.mode === "grey" || parsed.mode === "bw"
              ? parsed.mode
              : DEFAULT_TONE.mode,
          brightness: clampSetting(parsed.brightness),
          contrast: clampSetting(parsed.contrast),
        }
      : DEFAULT_TONE;
  } catch {
    cachedTone = DEFAULT_TONE;
  }
  return cachedTone;
}

export function useScanTone(): ScanTone {
  return useSyncExternalStore(subscribeTone, readTone, () => DEFAULT_TONE);
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
 * One page — turned, cropped or straightened, shrunk to `maxEdge`, toned —
 * onto `canvas`. `maxEdge` applies to what is KEPT, so a cropped page keeps its
 * detail rather than being shrunk as a whole page and then cut down.
 *
 * The GEOMETRY is cached per photo (`shaped`), and only the tone is redone on
 * each call. Straightening a page is a pass over every pixel with a projective
 * transform — about a tenth of a second at preview size — and a brightness
 * slider asks for a new picture every frame; without the cache the slider
 * would re-straighten the page sixty times a second.
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  page: ScanPageSettings,
  tone: ScanTone,
  maxEdge: number
) {
  const shape = shaped(page, maxEdge);
  canvas.width = shape.width;
  canvas.height = shape.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  context.drawImage(shape, 0, 0);
  if (!isNeutralTone(tone)) {
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    applyTone(frame.data, tone);
    context.putImageData(frame, 0, 0);
  }
}

/** A few shapes per photo — the tile, the preview, and the one being dragged
 *  to — and dropped with the photo, being keyed weakly on it. */
const shapeCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();
const SHAPES_PER_PHOTO = 4;

function shaped(page: ScanPageSettings, maxEdge: number): HTMLCanvasElement {
  const key = `${page.rotation}|${maxEdge}|${page.crop ? JSON.stringify(page.crop) : "whole"}`;
  let shapes = shapeCache.get(page.img);
  if (!shapes) shapeCache.set(page.img, (shapes = new Map()));
  const hit = shapes.get(key);
  if (hit) return hit;

  const crop = page.crop ?? WHOLE_PAGE;
  const out = isRectangle(crop) ? cropRectangle(page, crop, maxEdge) : straighten(page, crop, maxEdge);
  shapes.set(key, out);
  // Oldest first — a Map iterates in insertion order.
  while (shapes.size > SHAPES_PER_PHOTO) shapes.delete(shapes.keys().next().value!);
  return out;
}

/** The turned photo's size — what a crop's fractions are fractions of. */
function turnedSize(page: ScanPageSettings) {
  const sideways = page.rotation === 90 || page.rotation === 270;
  const w = page.img.naturalWidth;
  const h = page.img.naturalHeight;
  return sideways ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Draw the turned photo at `scale`, offset so that (`left`, `top`) in turned
 * pixels lands at the canvas origin. Both paths are this with different
 * windows.
 */
function drawTurned(
  context: CanvasRenderingContext2D,
  page: ScanPageSettings,
  scale: number,
  left: number,
  top: number
) {
  const { img, rotation } = page;
  const turned = turnedSize(page);
  context.imageSmoothingQuality = "high";
  context.save();
  context.scale(scale, scale);
  context.translate(-left, -top);
  context.translate(turned.width / 2, turned.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  context.restore();
}

function cropRectangle(page: ScanPageSettings, crop: ScanCrop, maxEdge: number): HTMLCanvasElement {
  const turned = turnedSize(page);
  const left = crop.tl.x * turned.width;
  const top = crop.tl.y * turned.height;
  const keptW = (crop.tr.x - crop.tl.x) * turned.width;
  const keptH = (crop.bl.y - crop.tl.y) * turned.height;
  const scale = Math.min(1, maxEdge / Math.max(keptW, keptH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(keptW * scale));
  canvas.height = Math.max(1, Math.round(keptH * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  drawTurned(context, page, scale, left, top);
  return canvas;
}

const distance = (a: ScanPoint, b: ScanPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The projective map from the unit square onto the four corners — Heckbert's
 * square-to-quad. (u, v) in the straightened page → (x, y) in the photo.
 * Forward only, which is all a resample needs: each OUTPUT pixel asks where in
 * the photo it comes from.
 */
function squareToQuad(q: ScanCrop) {
  const [p0, p1, p2, p3] = [q.tl, q.tr, q.br, q.bl];
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < EPSILON && Math.abs(sy) < EPSILON) {
    // A parallelogram: the map is affine.
    [a, b, c] = [p1.x - p0.x, p3.x - p0.x, p0.x];
    [d, e, f] = [p1.y - p0.y, p3.y - p0.y, p0.y];
    g = h = 0;
  } else {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dy1 * dx2;
    g = (sx * dy2 - sy * dx2) / den;
    h = (dx1 * sy - dy1 * sx) / den;
    [a, b, c] = [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x];
    [d, e, f] = [p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y];
  }
  return (u: number, v: number): ScanPoint => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/**
 * The four corners pulled out to a rectangle. The page's size is its longer
 * top-or-bottom edge by its longer left-or-right edge, so nothing is squeezed
 * below the resolution it was photographed at; then `maxEdge` as usual.
 *
 * The photo is first drawn at that same scale, and only the part under the
 * corners — a 12 MP camera page read in full would be 48 MB of pixels to pull
 * a preview out of. Then every output pixel is sampled bilinearly from it.
 */
function straighten(page: ScanPageSettings, crop: ScanCrop, maxEdge: number): HTMLCanvasElement {
  const turned = turnedSize(page);
  const px = (p: ScanPoint): ScanPoint => ({ x: p.x * turned.width, y: p.y * turned.height });
  const q = { tl: px(crop.tl), tr: px(crop.tr), br: px(crop.br), bl: px(crop.bl) };
  const outW = Math.max(distance(q.tl, q.tr), distance(q.bl, q.br));
  const outH = Math.max(distance(q.tl, q.bl), distance(q.tr, q.br));
  const scale = Math.min(1, maxEdge / Math.max(outW, outH));

  // The source: the corners' bounding box, drawn at `scale`.
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
  const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const source = document.createElement("canvas");
  source.width = Math.max(2, Math.ceil((Math.max(...xs) - left) * scale) + 1);
  source.height = Math.max(2, Math.ceil((Math.max(...ys) - top) * scale) + 1);
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("The browser could not read that photo.");
  drawTurned(sourceContext, page, scale, left, top);
  const src = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const sw = source.width;
  const sh = source.height;

  const local = (p: ScanPoint): ScanPoint => ({ x: (p.x - left) * scale, y: (p.y - top) * scale });
  const map = squareToQuad({ tl: local(q.tl), tr: local(q.tr), br: local(q.br), bl: local(q.bl) });

  const canvas = document.createElement("canvas");
  const W = (canvas.width = Math.max(1, Math.round(outW * scale)));
  const H = (canvas.height = Math.max(1, Math.round(outH * scale)));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that photo.");
  const frame = context.createImageData(W, H);
  const out = frame.data;

  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const at = map((i + 0.5) / W, v);
      // Pixel centres sit at +0.5; clamp so the 2×2 neighbourhood is in range.
      const x = Math.min(sw - 1.001, Math.max(0, at.x - 0.5));
      const y = Math.min(sh - 1.001, Math.max(0, at.y - 0.5));
      const x0 = x | 0;
      const y0 = y | 0;
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * fx;
        const bottom = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * fx;
        out[o + ch] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// FINDING THE PAGE (Mark, 2026-09-18: "add auto edge detection").
//
// A photographed invoice is a bright sheet on something darker — a counter, a
// box, a clipboard — so the page is found as the largest BRIGHT region, and its
// four corners as that region's four outermost points. Those corners are
// exactly what the crop editor straightens, so a detected page arrives square
// and the person only nudges a corner that landed wrong.
//
// Plain arithmetic on a ~400px copy, a few milliseconds, no library: OpenCV's
// contour finder would be more robust and is ~8 MB of WebAssembly to download
// on the iPad that is taking the photo. What this gives up is the page on a
// surface as bright as itself (a white counter): there is no bright region to
// find, the checks below refuse the result, and the page is left whole.

/** Long edge of the working copy. Plenty to place a corner within a fraction
 *  of a percent; small enough that every step is a few milliseconds. */
const DETECT_EDGE = 400;

/** Box blur, radius `r`, horizontal then vertical — takes the print off the
 *  page so the threshold sees a sheet rather than letters. */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, n++) sum += src[y * w + k];
      tmp[y * w + x] = sum / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, n++) sum += tmp[k * w + x];
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/** Otsu's threshold: the grey level that best splits the picture into two
 *  groups — here, paper and not-paper. */
function otsu(values: Float32Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const v of values) histogram[Math.min(255, Math.max(0, Math.round(v)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];
  let sumBelow = 0;
  let countBelow = 0;
  let best = 128;
  let bestSpread = -1;
  for (let t = 0; t < 256; t++) {
    countBelow += histogram[t];
    if (countBelow === 0) continue;
    const countAbove = total - countBelow;
    if (countAbove === 0) break;
    sumBelow += t * histogram[t];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (sumAll - sumBelow) / countAbove;
    const spread = countBelow * countAbove * (meanBelow - meanAbove) ** 2;
    if (spread > bestSpread) {
      bestSpread = spread;
      best = t;
    }
  }
  return best;
}

/** One pass of 3×3 erosion (`keep` = all neighbours set) or dilation (any). */
function morph(mask: Uint8Array, w: number, h: number, erode: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = true;
      let any = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? mask[yy * w + xx] : 0;
          if (v) any = true;
          else all = false;
        }
      }
      out[y * w + x] = (erode ? all : any) ? 1 : 0;
    }
  }
  return out;
}

/** The largest 4-connected run of set pixels, as a mask of its own. */
function largestRegion(mask: Uint8Array, w: number): { region: Uint8Array; size: number } {
  const label = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let bestLabel = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const n of neighbours) {
        if (n < 0 || n >= mask.length || !mask[n] || label[n]) continue;
        label[n] = next;
        stack[top++] = n;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  const region = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) region[i] = label[i] === bestLabel && bestLabel > 0 ? 1 : 0;
  return { region, size: bestSize };
}

function quadArea(q: ScanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function isConvex(q: ScanPoint[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const c = q[(i + 2) % q.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < EPSILON) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * The page's four corners in the TURNED photo, as a crop — or null when
 * nothing page-like was found, which the caller takes as "leave it whole".
 *
 * Refused as not-a-page: a region under 15% of the frame (a receipt in the
 * corner of a photo of the counter is more likely the lights), one over 97%
 * (the page already fills the photo, or the background is as bright as the
 * paper), and a shape that isn't a convex four-sided one.
 */
export function detectPage(page: Pick<ScanPageSettings, "img" | "rotation">): ScanCrop | null {
  const turned = turnedSize({ ...page, crop: null });
  const scale = Math.min(1, DETECT_EDGE / Math.max(turned.width, turned.height));
  const w = Math.max(8, Math.round(turned.width * scale));
  const h = Math.max(8, Math.round(turned.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  drawTurned(context, { ...page, crop: null }, scale, 0, 0);
  const rgba = context.getImageData(0, 0, w, h).data;

  const grey = new Float32Array(w * h);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  const smooth = blur(blur(grey, w, h, 2), w, h, 2);
  const threshold = otsu(smooth);
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = smooth[i] > threshold ? 1 : 0;
  // An OPENING — erode twice, dilate twice — cuts the thin bright bridges (a
  // glint on the counter's edge, a sleeve) that would join the page to
  // something else and drag a corner off to it.
  mask = morph(morph(mask, w, h, true), w, h, true);
  mask = morph(morph(mask, w, h, false), w, h, false);

  const { region, size } = largestRegion(mask, w);
  if (size < 0.1 * w * h) return null;

  // The outermost point in each diagonal direction is the corner there. A
  // page turned more than ~40° in the frame would confuse which is which —
  // a photo of an invoice is not taken that way.
  let tl = { x: 0, y: 0, v: Infinity };
  let br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity };
  let bl = { x: 0, y: 0, v: Infinity };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.v) tl = { x, y, v: sum };
      if (sum > br.v) br = { x, y, v: sum };
      if (diff > tr.v) tr = { x, y, v: diff };
      if (diff < bl.v) bl = { x, y, v: diff };
    }
  }
  // Pixel indices to fractions, reaching to the OUTER edge of the corner
  // pixel, so a page that fills the frame comes out as exactly the frame.
  const frac = (p: { x: number; y: number }, right: boolean, bottom: boolean): ScanPoint => ({
    x: Math.min(1, Math.max(0, (p.x + (right ? 1 : 0)) / w)),
    y: Math.min(1, Math.max(0, (p.y + (bottom ? 1 : 0)) / h)),
  });
  const crop: ScanCrop = {
    tl: frac(tl, false, false),
    tr: frac(tr, true, false),
    br: frac(br, true, true),
    bl: frac(bl, false, true),
  };
  const corners = [crop.tl, crop.tr, crop.br, crop.bl];
  const area = quadArea(corners);
  if (area < 0.15 || area > 0.97 || !isConvex(corners)) return null;
  return crop;
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
