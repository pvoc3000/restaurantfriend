// A sheet of display tags — rendered client-side with @react-pdf/renderer.
// Import this module DYNAMICALLY (await import(...)) from a click handler:
// the renderer is heavy and nothing on a normal page load needs it.
//
// Each label is the stored background with a black box over the price baked
// into it and the CURRENT price set in that box — the geometry is
// `lib/displayTags`', shared with the on-screen preview, so the two can only
// ever disagree by font metrics. Labels are packed edge to edge on a letter
// sheet (8-up for 2x3.5, 3-up for 2x8 and 2x10, the last in landscape) with
// hairline cut marks in the margins: plain paper, cut by hand (Mark,
// 2026-09-06).

import { Document, Font, Image, Page, Text, View } from "@react-pdf/renderer";
import {
  LABEL_POINTS,
  PRICE_FONT,
  PRICE_FONT_SIZE,
  SHEET_LAYOUT,
  imageBoxFor,
  labelOrigin,
  priceBoxFor,
  sheetPages,
  type TagSize,
} from "@/lib/displayTags";

/** No hyphenation — registered here because no other module can be relied
 *  on having loaded (`ChecklistPdf`'s note). Nothing here wraps anyway. */
Font.registerHyphenationCallback((word) => [word]);

/**
 * The bundled Helvetica is WinAnsi and emits NOTHING for a character it
 * cannot place. A price is ASCII by construction (`formatTagPrice`), but the
 * substitution is cheap insurance against the day one is typed by hand.
 */
const PDF_SAFE: [RegExp, string][] = [
  [/[–—]/g, "-"],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
];
function pdfText(raw: string): string {
  let out = raw;
  for (const [from, to] of PDF_SAFE) out = out.replace(from, to);
  return out;
}

export type TagPrint = {
  /** A signed URL the renderer fetches while building — valid because the page that minted it is the page you pressed Print on. */
  url: string;
  /** "$4.95" */
  price: string;
  title: string;
};

const CUT_MARK = 12;
const HAIRLINE = 0.5;

/** Crop marks in the margins along every grid line, never across the art. */
function CutMarks({ size }: { size: TagSize }) {
  const layout = SHEET_LAYOUT[size];
  const label = LABEL_POINTS[size];
  const xs = Array.from({ length: layout.columns + 1 }, (_, i) => layout.originX + i * label.w);
  const ys = Array.from({ length: layout.rows + 1 }, (_, i) => layout.originY + i * label.h);
  const top = layout.originY;
  const bottom = layout.originY + layout.rows * label.h;
  const left = layout.originX;
  const right = layout.originX + layout.columns * label.w;
  const mark = { position: "absolute" as const, backgroundColor: "#999" };
  return (
    <>
      {xs.map((x) => (
        <View key={`t${x}`}>
          <View style={{ ...mark, left: x - HAIRLINE / 2, top: top - CUT_MARK, width: HAIRLINE, height: CUT_MARK }} />
          <View style={{ ...mark, left: x - HAIRLINE / 2, top: bottom, width: HAIRLINE, height: CUT_MARK }} />
        </View>
      ))}
      {ys.map((y) => (
        <View key={`l${y}`}>
          <View style={{ ...mark, left: left - CUT_MARK, top: y - HAIRLINE / 2, width: CUT_MARK, height: HAIRLINE }} />
          <View style={{ ...mark, left: right, top: y - HAIRLINE / 2, width: CUT_MARK, height: HAIRLINE }} />
        </View>
      ))}
    </>
  );
}

function Label({ size, tag, index }: { size: TagSize; tag: TagPrint; index: number }) {
  const origin = labelOrigin(size, index);
  const label = LABEL_POINTS[size];
  const art = imageBoxFor(size);
  const box = priceBoxFor(size);
  return (
    <View
      style={{
        position: "absolute",
        left: origin.x,
        top: origin.y,
        width: label.w,
        height: label.h,
        // The 2x10 is the 2x8 art with an inch of black either side; the
        // label's own background is that black. The others are the art
        // edge to edge, so a missing fetch shows as white rather than a brick.
        backgroundColor: size === "2x10" ? "#000" : "#fff",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf's Image is a PDF primitive, not an <img>; it takes no alt. */}
      <Image src={tag.url} style={{ position: "absolute", left: art.x, top: art.y, width: art.w, height: art.h }} />
      <View
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          backgroundColor: "#000",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: PRICE_FONT, fontSize: PRICE_FONT_SIZE[size], color: "#fff" }}>
          {pdfText(tag.price)}
        </Text>
      </View>
    </View>
  );
}

export function TagSheetPdf({ size, tags }: { size: TagSize; tags: TagPrint[] }) {
  const layout = SHEET_LAYOUT[size];
  return (
    <Document title={`Tags ${size}`}>
      {sheetPages(tags, size).map((page, p) => (
        <Page key={p} size="LETTER" orientation={layout.orientation} style={{ padding: 0 }}>
          <CutMarks size={size} />
          {page.map((tag, i) => (
            <Label key={`${p}-${i}`} size={size} tag={tag} index={i} />
          ))}
        </Page>
      ))}
    </Document>
  );
}
