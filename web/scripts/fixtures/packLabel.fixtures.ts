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

import { packLabel } from "../../src/lib/catalog";
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
