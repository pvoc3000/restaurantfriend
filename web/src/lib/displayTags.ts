/**
 * Display tags — the case signs (migration 095).
 *
 * PURE: no React, no Supabase, no `@/` imports. It is compiled into the fixture
 * run, and it is the ONE place the tag's geometry lives — the printed sheet
 * (`components/tags/pdf/TagSheetPdf`) and the on-screen preview
 * (`components/tags/TagPreview`) both read these constants, so the two can
 * disagree only by font metrics, never by a number typed twice.
 *
 * THE ARTWORK CARRIES A PRICE ALREADY. Every background on disk has the
 * price of the day it was made baked in, bottom centre, white on black — so
 * the overlay is a black box over that spot with the CURRENT price set in it.
 * The spot was MEASURED, not guessed (2026-09-06, over 151 raster files):
 *
 *   2x3.5   glyphs at x 0.442–0.557, y 0.808–0.880 of the image  (~15 pt bold)
 *   2x8     glyphs at x 0.462–0.537, y 0.773–0.887 of the image  (~23 pt bold)
 *
 * and every file agreed to three decimals, which is what makes ONE box per
 * size safe. `PRICE_ZONE` is that spot with margin around it.
 *
 * THE 2x10 SLOT HOLDS 8-INCH ART. Every "2x10" file FileMaker exported is the
 * 2x8 artwork (2400×600 px = 8"×2" at 300 dpi). Mark's call (2026-09-06): a
 * 2x10 is that art CENTRED on a 10" black label, an inch of black each side —
 * seamless, since the backgrounds are black. `ART_BOX["2x10"]` is that inch.
 */

export const TAG_SIZES = ["2x3.5", "2x8", "2x10"] as const;
export type TagSize = (typeof TAG_SIZES)[number];

/** Points — PostScript, 72 to the inch — which is what @react-pdf lays out in. */
export const PT_PER_INCH = 72;

export const LABEL_INCHES: Record<TagSize, { w: number; h: number }> = {
  "2x3.5": { w: 3.5, h: 2 },
  "2x8": { w: 8, h: 2 },
  "2x10": { w: 10, h: 2 },
};

export const LABEL_POINTS: Record<TagSize, { w: number; h: number }> = {
  "2x3.5": { w: 252, h: 144 },
  "2x8": { w: 576, h: 144 },
  "2x10": { w: 720, h: 144 },
};

export const LETTER = { w: 612, h: 792 } as const;

export type Box = { x: number; y: number; w: number; h: number };

export type SheetLayout = {
  /** Labels on one sheet. */
  perSheet: number;
  columns: number;
  rows: number;
  orientation: "portrait" | "landscape";
  /** The page in points, already turned for the orientation. */
  page: { w: number; h: number };
  /** Where the packed grid starts, so it sits centred on the page. */
  originX: number;
  originY: number;
};

/**
 * PLAIN PAPER, CUT BY HAND (Mark, 2026-09-06): labels are packed edge to edge
 * and the grid is centred on a letter sheet. 2x10 3-up only fits letter in
 * LANDSCAPE — 10" against 8.5" of portrait width.
 */
export const SHEET_LAYOUT: Record<TagSize, SheetLayout> = {
  "2x3.5": { perSheet: 8, columns: 2, rows: 4, orientation: "portrait", page: { w: 612, h: 792 }, originX: 54, originY: 108 },
  "2x8": { perSheet: 3, columns: 1, rows: 3, orientation: "portrait", page: { w: 612, h: 792 }, originX: 18, originY: 180 },
  "2x10": { perSheet: 3, columns: 1, rows: 3, orientation: "landscape", page: { w: 792, h: 612 }, originX: 36, originY: 90 },
};

/** Where the ARTWORK sits on the label, as fractions of the label. */
export const ART_BOX: Record<TagSize, Box> = {
  "2x3.5": { x: 0, y: 0, w: 1, h: 1 },
  "2x8": { x: 0, y: 0, w: 1, h: 1 },
  "2x10": { x: 0.1, y: 0, w: 0.8, h: 1 },
};

/**
 * The black box that covers the baked-in price, as fractions of the ART (not
 * the label — the 2x10 uses the 2x8 art and so the 2x8 zone). Centred on the
 * measured glyphs with margin: for 2x8 the glyphs run y 0.773–0.887 and the
 * box 0.74–0.92; for 2x3.5, 0.808–0.880 inside 0.77–0.92. The width is a
 * multiple of the measured glyph run so a longer price ("$10.50") still fits.
 */
export const PRICE_ZONE: Record<TagSize, Box> = {
  "2x3.5": { x: 0.35, y: 0.77, w: 0.3, h: 0.15 },
  "2x8": { x: 0.4, y: 0.74, w: 0.2, h: 0.18 },
  "2x10": { x: 0.4, y: 0.74, w: 0.2, h: 0.18 },
};

/** The bundled PDF font — Mark's call, no font file to embed. */
export const PRICE_FONT = "Helvetica-Bold";

/** In points; derived from the measured cap height (Helvetica's is 0.718 em). */
export const PRICE_FONT_SIZE: Record<TagSize, number> = {
  "2x3.5": 15,
  "2x8": 23,
  "2x10": 23,
};

const scaleBox = (frac: Box, within: Box): Box => ({
  x: within.x + frac.x * within.w,
  y: within.y + frac.y * within.h,
  w: frac.w * within.w,
  h: frac.h * within.h,
});

/** The artwork's box on the label, in points. */
export function imageBoxFor(size: TagSize): Box {
  const label = LABEL_POINTS[size];
  return scaleBox(ART_BOX[size], { x: 0, y: 0, w: label.w, h: label.h });
}

/** The price overlay's box on the label, in points. */
export function priceBoxFor(size: TagSize): Box {
  return scaleBox(PRICE_ZONE[size], imageBoxFor(size));
}

/** The top-left of the i-th label on a sheet (i within one sheet). */
export function labelOrigin(size: TagSize, index: number): { x: number; y: number } {
  const layout = SHEET_LAYOUT[size];
  const label = LABEL_POINTS[size];
  const col = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return { x: layout.originX + col * label.w, y: layout.originY + row * label.h };
}

/** Chunk a print run into sheets. */
export function sheetPages<T>(tags: readonly T[], size: TagSize): T[][] {
  const per = SHEET_LAYOUT[size].perSheet;
  const pages: T[][] = [];
  for (let i = 0; i < tags.length; i += per) pages.push(tags.slice(i, i + per));
  return pages;
}

/** "$4.95" — ASCII only, so the bundled WinAnsi Helvetica can place every character. */
export function formatTagPrice(price: number | null | undefined): string | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  return `$${price.toFixed(2)}`;
}

/** The size as the shop says it — `2x8` reads fine; this is for a heading. */
export function tagSizeLabel(size: TagSize): string {
  const { w, h } = LABEL_INCHES[size];
  return `${h}″ × ${w}″`;
}

/**
 * Which items are ON THE SHOP'S MENU — read off the plan rows in force today
 * (`v_production_plan_days`, any weekday). "On the current plan" is read as
 * on the menu rather than on today's trays: a sign stays in the case for as
 * long as the donut is on the plan, and a par of ZERO is 043's "on the menu,
 * making none" — that donut is not in the case, so it is not on this list.
 * A null par is silence and is counted, since nothing said no.
 */
export function onPlanItemIds(
  rows: readonly { item_id: string; planned_par: number | null }[]
): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) if (r.planned_par === null || r.planned_par > 0) ids.add(r.item_id);
  return ids;
}

/** `name · size · type · cut` — a production item's name is ambiguous by design
 *  ("Angry Samoa" is four donuts, 038), so a picker has to say which. */
export function itemLabel(i: {
  name: string;
  size: string | null;
  item_type: string | null;
  subtype: string | null;
}): string {
  return [i.name, i.size, i.item_type, i.subtype].filter(Boolean).join(" · ");
}

export const TAG_BUCKET = "display-tags";

/** Long enough to pick and print a run of tags; short enough not to outlive the page. */
export const TAG_URL_TTL_SECONDS = 60 * 60;

/**
 * RASTER ONLY. Six of FileMaker's sets were PDFs and the LOADER rasterises
 * those at 300 dpi on the way in; @react-pdf's `Image` cannot place a PDF, so
 * accepting one here would file a background the printer cannot print.
 */
export const TAG_IMAGE_ACCEPT = ["image/jpeg", "image/png"] as const;
export const TAG_IMAGE_ACCEPT_ATTR = TAG_IMAGE_ACCEPT.join(",");

export function tagImageRejection(file: { name: string; type: string }): string | null {
  if ((TAG_IMAGE_ACCEPT as readonly string[]).includes(file.type)) return null;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return `${file.name} is a PDF. Export the artwork as a JPEG or PNG at 300 dpi and attach that.`;
  }
  return `${file.name} isn't a background the app can print. JPEG or PNG at 300 dpi.`;
}

/**
 * `{org_id}/{tag_id}/{uuid}.{ext}` — ORG FIRST, because 095's storage policies
 * authorise off the first folder segment and nothing else (`photoPath`'s rule).
 */
export function tagImagePath(orgId: string, tagId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 6
      ? fileName.slice(dot).toLowerCase()
      : ".jpg";
  return `${orgId}/${tagId}/${crypto.randomUUID()}${ext}`;
}

export const TAG_SELECT = "id, production_item_id, title, description, is_active, created_at";

export type DisplayTag = {
  id: string;
  production_item_id: string | null;
  title: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type TagImage = {
  id: string;
  tag_id: string;
  size: TagSize;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
};
