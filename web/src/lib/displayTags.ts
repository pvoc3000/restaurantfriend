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
 * LANDSCAPE — 10" against 8.5" of portrait width — and 2x8 goes landscape
 * too (Mark, the same day): portrait left a quarter-inch side margin, which
 * is inside the unprintable edge of some printers, so the cut marks were
 * lost; landscape gives an inch and a half each side.
 */
export const SHEET_LAYOUT: Record<TagSize, SheetLayout> = {
  "2x3.5": { perSheet: 8, columns: 2, rows: 4, orientation: "portrait", page: { w: 612, h: 792 }, originX: 54, originY: 108 },
  "2x8": { perSheet: 3, columns: 1, rows: 3, orientation: "landscape", page: { w: 792, h: 612 }, originX: 108, originY: 90 },
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

/**
 * THE DESCRIPTION, LIKE THE PRICE, IS BAKED INTO THE ART — and Replace
 * Description covers it with a black box and sets the record's Description in
 * it (Mark, 2026-11-20). Measured over the same 151 raster files (2026-11-20):
 *
 *   2x3.5   title ends ≤ 0.487, description 0.503–0.740, price from 0.807
 *   2x8     title ends ≤ 0.357, description 0.463–0.697, price from 0.775
 *
 * so the box runs from just under the lowest title to the top of the price
 * box, the art's full width — the backgrounds are black, so covering more
 * than the glyphs is invisible. TWO 2x3.5 FILES START HIGHER: Fudgegazi and
 * Paramoreo have a one-line title and their description from 0.443, so a
 * sliver of the old first line stays above the box on those two.
 */
export const DESCRIPTION_ZONE: Record<TagSize, Box> = {
  "2x3.5": { x: 0, y: 0.492, w: 1, h: 0.278 },
  "2x8": { x: 0, y: 0.4, w: 1, h: 0.34 },
  "2x10": { x: 0, y: 0.4, w: 1, h: 0.34 },
};

/** Side margin inside the box, as a fraction of the art's width. */
const DESCRIPTION_INSET = 0.03;

/**
 * The art's own style: the 2x3.5 sets its description in CAPITALS, regular
 * weight, ~11.6 pt on a 12 pt pitch; the 2x8 in sentence case, bold, 18 pt on
 * one line and smaller when it wraps (both read off the files by width). The
 * text starts at `max` and steps down by half a point until it fits.
 */
export const DESCRIPTION_STYLE: Record<
  TagSize,
  { font: "Helvetica" | "Helvetica-Bold"; max: number; min: number; lineHeight: number; capitals: boolean }
> = {
  "2x3.5": { font: "Helvetica", max: 12, min: 6, lineHeight: 1.05, capitals: true },
  "2x8": { font: "Helvetica-Bold", max: 18, min: 8, lineHeight: 1.1, capitals: false },
  "2x10": { font: "Helvetica-Bold", max: 18, min: 8, lineHeight: 1.1, capitals: false },
};

/** The description overlay's box on the label, in points. */
export function descriptionBoxFor(size: TagSize): Box {
  return scaleBox(DESCRIPTION_ZONE[size], imageBoxFor(size));
}

/**
 * Advance widths of ASCII 32–126 per 1000 em, read from @react-pdf/pdfkit's
 * own AFM data for the two bundled faces — so the wrap computed here is the
 * wrap the renderer would make. Anything outside ASCII counts as a digit.
 */
const AFM_WIDTHS: Record<"Helvetica" | "Helvetica-Bold", number[]> = {
  Helvetica: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  "Helvetica-Bold": [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
};

export function textWidth(text: string, font: "Helvetica" | "Helvetica-Bold", fontSize: number): number {
  const table = AFM_WIDTHS[font];
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code < 127 ? table[code - 32] : 556;
  }
  return (units * fontSize) / 1000;
}

/** Greedy word wrap. A word wider than the line gets a line of its own. */
export function wrapWords(text: string, font: "Helvetica" | "Helvetica-Bold", fontSize: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, font, fontSize) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export type FittedDescription = { lines: string[]; fontSize: number; lineHeight: number; font: "Helvetica" | "Helvetica-Bold" };

/**
 * The description, broken into lines at the largest size that fits the box —
 * the lines are returned rather than left to the renderer so the PDF and the
 * preview break in the same places. Measured against 97% of the width, so a
 * rounding difference in the renderer can never re-wrap a line. At `min` it
 * stops shrinking and returns what it has, overflow and all: a description
 * that long wants editing, not 4 pt type.
 */
export function fitDescription(raw: string, size: TagSize): FittedDescription | null {
  const style = DESCRIPTION_STYLE[size];
  const text = (style.capitals ? raw.toUpperCase() : raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const box = descriptionBoxFor(size);
  const width = (box.w - 2 * DESCRIPTION_INSET * imageBoxFor(size).w) * 0.97;
  let fontSize = style.max;
  for (;;) {
    const lines = wrapWords(text, style.font, fontSize, width);
    const fits = lines.length * fontSize * style.lineHeight <= box.h;
    if (fits || fontSize - 0.5 < style.min) return { lines, fontSize, lineHeight: style.lineHeight, font: style.font };
    fontSize -= 0.5;
  }
}

/** The inner side margin of the description box, in points. */
export function descriptionInset(size: TagSize): number {
  return DESCRIPTION_INSET * imageBoxFor(size).w;
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

/** ISO weekday of a yyyy-mm-dd, 1 = Monday … 7 = Sunday — UTC arithmetic on
 *  the string, so a host west of Greenwich cannot move the day. */
export function isoWeekday(iso: string): number {
  const jsDay = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return ((jsDay + 6) % 7) + 1;
}

/**
 * The day the list is asked about — `?date=` when it is a real calendar date,
 * else today. A round trip rather than a regex: `new Date("2026-02-31")` does
 * not fail, it rolls over to March 2nd.
 */
export function planDateParam(raw: string | string[] | undefined, today: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : today;
}

/**
 * Which items are ON THE PLAN FOR A DAY — the rows of `v_production_plan_days`
 * for the plans in force that day, narrowed to that day's WEEKDAY (Mark,
 * 2026-09-06: a calendar picker, "on the plan finds the donuts that are on
 * the plan for whatever day it's set to"). A par of ZERO is 043's "on the
 * menu, making none" — not in the case that day, so not on this list. A null
 * par is silence and is counted, since nothing said no.
 */
export function onPlanItemIds(
  rows: readonly { item_id: string; weekday: number; planned_par: number | null }[],
  weekday: number
): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.weekday !== weekday) continue;
    if (r.planned_par === null || r.planned_par > 0) ids.add(r.item_id);
  }
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
