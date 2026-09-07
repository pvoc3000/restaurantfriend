// Display tags — `lib/displayTags`, the one place the tag geometry lives.

import { test, eq, ok } from "./harness";
import {
  LABEL_POINTS,
  SHEET_LAYOUT,
  TAG_SIZES,
  formatTagPrice,
  imageBoxFor,
  isoWeekday,
  planDateParam,
  labelOrigin,
  onPlanItemIds,
  priceBoxFor,
  sheetPages,
  tagImageRejection,
} from "../../src/lib/displayTags";

test("every sheet's grid fits inside its page and never overlaps", () => {
  for (const size of TAG_SIZES) {
    const layout = SHEET_LAYOUT[size];
    const label = LABEL_POINTS[size];
    const boxes = Array.from({ length: layout.perSheet }, (_, i) => ({ ...labelOrigin(size, i), ...label }));
    for (const b of boxes) {
      ok(b.x >= 0 && b.y >= 0, `${size}: label inside the page`);
      ok(b.x + b.w <= layout.page.w + 1e-9 && b.y + b.h <= layout.page.h + 1e-9, `${size}: label past the page edge`);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        ok(apart, `${size}: labels ${i} and ${j} overlap`);
      }
    }
    // Centred: the same margin left and right, top and bottom.
    const last = boxes[boxes.length - 1];
    eq(layout.originX, layout.page.w - (last.x + last.w), `${size}: horizontal margins`);
    eq(layout.originY, layout.page.h - (last.y + last.h), `${size}: vertical margins`);
  }
});

test("the 3-up sheets are landscape, the 8-up portrait", () => {
  eq(SHEET_LAYOUT["2x10"].orientation, "landscape");
  eq(SHEET_LAYOUT["2x10"].page, { w: 792, h: 612 });
  eq(SHEET_LAYOUT["2x8"].orientation, "landscape");
  eq(SHEET_LAYOUT["2x8"].page, { w: 792, h: 612 });
  // Every margin clears a printer's unprintable edge (≥ 0.5" = 36 pt).
  for (const size of TAG_SIZES) {
    ok(SHEET_LAYOUT[size].originX >= 36 && SHEET_LAYOUT[size].originY >= 36, `${size}: margins`);
  }
  eq(SHEET_LAYOUT["2x3.5"].orientation, "portrait");
});

test("the eighth 2x3.5 label is the second column, fourth row", () => {
  eq(labelOrigin("2x3.5", 7), { x: 54 + 252, y: 108 + 3 * 144 });
  eq(labelOrigin("2x8", 2), { x: 108, y: 90 + 2 * 144 });
});

test("the 2x10 centres 8-inch art with an inch of black either side", () => {
  eq(imageBoxFor("2x10"), { x: 72, y: 0, w: 576, h: 144 });
  eq(imageBoxFor("2x8"), { x: 0, y: 0, w: 576, h: 144 });
});

test("the price box sits over the measured glyph run, with margin", () => {
  // 2x8: glyphs measured at x 0.462–0.537, y 0.773–0.887 of the art.
  const b = priceBoxFor("2x8");
  ok(b.x <= 0.462 * 576 && b.x + b.w >= 0.537 * 576, "2x8 covers the glyphs horizontally");
  ok(b.y <= 0.773 * 144 && b.y + b.h >= 0.887 * 144, "2x8 covers the glyphs vertically");
  // 2x10: the same zone, shifted by the inch of bleed.
  const c = priceBoxFor("2x10");
  eq(c.x, b.x + 72);
  eq(c.y, b.y);
  // 2x3.5: glyphs at x 0.442–0.557, y 0.808–0.880.
  const s = priceBoxFor("2x3.5");
  ok(s.x <= 0.442 * 252 && s.x + s.w >= 0.557 * 252, "2x3.5 covers the glyphs horizontally");
  ok(s.y <= 0.808 * 144 && s.y + s.h >= 0.88 * 144, "2x3.5 covers the glyphs vertically");
});

test("a run chunks into sheets", () => {
  const nine = Array.from({ length: 9 }, (_, i) => i);
  eq(sheetPages(nine, "2x3.5").map((p) => p.length), [8, 1]);
  eq(sheetPages(nine, "2x8").map((p) => p.length), [3, 3, 3]);
  eq(sheetPages([], "2x10"), []);
});

test("the price prints as dollars and cents, ASCII only", () => {
  eq(formatTagPrice(4.95), "$4.95");
  eq(formatTagPrice(4), "$4.00");
  eq(formatTagPrice(null), null);
  eq(formatTagPrice(Number.NaN), null);
});

test("on the plan means that weekday, a par above zero or unstated, de-duplicated", () => {
  const ids = onPlanItemIds(
    [
      { item_id: "a", weekday: 6, planned_par: 18 },
      { item_id: "a", weekday: 6, planned_par: 24 },
      { item_id: "b", weekday: 6, planned_par: 0 },
      { item_id: "c", weekday: 6, planned_par: null },
      { item_id: "d", weekday: 7, planned_par: 12 },
    ],
    6
  );
  eq([...ids].sort(), ["a", "c"]);
});

test("the list's day is the URL's when it is a real date, else today", () => {
  eq(isoWeekday("2026-09-06"), 7, "a Sunday");
  eq(isoWeekday("2026-09-07"), 1, "a Monday");
  eq(planDateParam("2026-09-12", "2026-09-06"), "2026-09-12");
  eq(planDateParam(["2026-09-12"], "2026-09-06"), "2026-09-12");
  eq(planDateParam(undefined, "2026-09-06"), "2026-09-06");
  eq(planDateParam("2026-02-31", "2026-09-06"), "2026-09-06", "a rolled-over date is refused");
  eq(planDateParam("tomorrow", "2026-09-06"), "2026-09-06");
});

test("a background is a JPEG or a PNG; a PDF is told to export", () => {
  eq(tagImageRejection({ name: "x.jpg", type: "image/jpeg" }), null);
  eq(tagImageRejection({ name: "x.png", type: "image/png" }), null);
  ok(/PDF/.test(tagImageRejection({ name: "x.pdf", type: "application/pdf" }) ?? ""));
  eq(typeof tagImageRejection({ name: "x.heic", type: "image/heic" }), "string");
});
