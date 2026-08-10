// packLabel — how a vendor item's pack is written on the guide and the PO.
//
// These exist because migration 024 drops `vendor_items_pack_shape`, the check
// that forbade a `pack_count` with no `pack_size`. Dropping it is only safe
// because no reader has ever looked at the count without the size, so the
// half-filled row this now permits has to stay INVISIBLE rather than print
// "6 ×" on a purchase order. That is the first case below, and it is the whole
// reason for the file.
//
// 013's generation function makes the same decision in SQL
// (`when vi.pack_size is not null then …`). If one changes, change both.

import { packLabel, vendorItemTitle } from "../../src/lib/catalog";
import { eq, test } from "./harness";

const noPack = { pack_count: null, pack_size: null, pack_unit: null, package_content: null };

test("packLabel: a count with no size is ignored, not half-printed", () => {
  // The state migration 024 makes reachable: you typed the count first.
  eq(packLabel({ ...noPack, pack_count: 6 }, "EA"), null, "count alone");
});

test("packLabel: a count with no size still falls back to the stored content", () => {
  eq(
    packLabel({ ...noPack, pack_count: 6, package_content: 5.25 }, "EA"),
    "5.25 EA",
    "count alone, content stored"
  );
});

test("packLabel: nothing at all is null", () => {
  eq(packLabel(noPack, "EA"), null, "empty pack");
});

test("packLabel: a full pack reads count × size unit", () => {
  eq(
    packLabel({ pack_count: 6, pack_size: 14, pack_unit: "oz", package_content: 5.25 }, "EA"),
    "6 × 14 oz",
    "full pack"
  );
});

test("packLabel: a size with no count implies one of them", () => {
  // The opposite half-filled row, which the constraint always allowed.
  eq(
    packLabel({ ...noPack, pack_size: 14, pack_unit: "oz" }, "EA"),
    "1 × 14 oz",
    "size alone"
  );
});

test("packLabel: a size with no unit falls back to the item's base unit", () => {
  eq(
    packLabel({ pack_count: 1, pack_size: 50, pack_unit: null, package_content: 50 }, "lbs"),
    "1 × 50 lbs",
    "size, no unit"
  );
});

test("packLabel: the pack beats a stored content that disagrees", () => {
  // The stale-total case migration 010 was written for: the guide prints the
  // structure, and the total in parentheses is what you fix separately.
  eq(
    packLabel({ pack_count: 12, pack_size: 16, pack_unit: "oz", package_content: 192 }, "ea"),
    "12 × 16 oz",
    "structure wins"
  );
});

// ---------------------------------------------------------------------------
// vendorItemTitle — what a vendor item is CALLED when the vendor never
// described it.
//
// It had no coverage while the vendor-item screen was its only caller. As of
// 2026-08-10 the order guide renders it on every line (Mark: use the same
// calculated title "anytime there isn't a description"), which on DF01's Monday
// is 875 rows, 100 of them undescribed — so it is now load-bearing on the
// busiest screen in the app rather than on one record at a time.

const anon = {
  description: null,
  brand: null,
  package_desc: null,
  pack_count: null,
  pack_size: null,
  pack_unit: null,
  package_content: null,
};

test("vendorItemTitle: the vendor's own description wins outright", () => {
  // Their wording is how THEY name the product, which is what you check an
  // order against — so it beats anything we could assemble.
  eq(
    vendorItemTitle(
      { ...anon, description: "ORG BLACKBERRY 6/6OZ", brand: "Packer", pack_size: 6, pack_unit: "oz" },
      "Blackberries, Fresh",
      "oz"
    ),
    "ORG BLACKBERRY 6/6OZ",
    "described"
  );
});

test("vendorItemTitle: a blank description is no description", () => {
  // The guide's real case — the column is text, and empty is commoner than null.
  eq(
    vendorItemTitle({ ...anon, description: "   ", brand: "Packer" }, "Blackberries, Fresh", "oz"),
    "Blackberries, Fresh // Packer",
    "whitespace only"
  );
});

test("vendorItemTitle: undescribed composes item // brand // pack", () => {
  eq(
    vendorItemTitle(
      { ...anon, brand: "Giustos", pack_count: 1, pack_size: 50, pack_unit: "lbs" },
      "Flour, Cake",
      "lbs"
    ),
    "Flour, Cake // Giustos // 1 × 50 lbs",
    "all three slots"
  );
});

test("vendorItemTitle: an empty slot COLLAPSES, never leaving a bare separator", () => {
  // "Flour //  // CS" reads as missing data; an absent field should read as an
  // absent field. This is the case the non-food catalog actually hits — 
  // "Batteries, AAA // EA", with no brand anyone ever typed.
  eq(
    vendorItemTitle({ ...anon, package_desc: "EA" }, "Batteries, AAA", "ea"),
    "Batteries, AAA // EA",
    "no brand"
  );
  eq(
    vendorItemTitle({ ...anon, brand: "Bakemark" }, "Puree, Passion Fruit", "oz"),
    "Puree, Passion Fruit // Bakemark",
    "no pack"
  );
});

test("vendorItemTitle: with no pack structure it takes the base-unit total, then the type", () => {
  eq(
    vendorItemTitle({ ...anon, package_content: 1, package_desc: "CS" }, "Masking Tape", "ea"),
    "Masking Tape // 1 ea",
    "content beats the bare type"
  );
  eq(
    vendorItemTitle({ ...anon, package_desc: "CS" }, "Masking Tape", "ea"),
    "Masking Tape // CS",
    "type is the last resort"
  );
});

test("vendorItemTitle: nothing to say is NULL, so a caller can still show its dash", () => {
  // A vendor item with nothing in it but a vendor. The guide falls back to an
  // em dash here, which is honest — measured, no DF01 line reaches it.
  eq(vendorItemTitle(anon, null, "ea"), null, "empty");
});
