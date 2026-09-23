// `lib/squareCatalog` — the Settings picker's rows for a Square item variation.
// Checked by breaking: dropping the `unshift` turns the "not in the catalog"
// case red.

import { test, eq } from "./harness";
import { variationOptions } from "../../src/lib/squareCatalog";

const special = { id: "Y5XR", item: "Special Order", variation: "Regular", variations: 1, category: "Special Orders" };
const dozen = { id: "D12", item: "Donut Box", variation: "Dozen", variations: 2, category: "Donuts" };
const half = { id: "D06", item: "Donut Box", variation: "Half Dozen", variations: 2, category: null };

test("variationOptions: item name, variation only where it tells rows apart, category as hint", () => {
  eq(variationOptions([special, dozen, half], "Y5XR"), [
    { value: "Y5XR", label: "Special Order", hint: "Special Orders" },
    { value: "D12", label: "Donut Box — Dozen", hint: "Donuts" },
    { value: "D06", label: "Donut Box — Half Dozen", hint: "no category" },
  ]);
});

test("variationOptions: a saved id Square no longer lists is kept, first, under its raw id", () => {
  const opts = variationOptions([special], "GONE123");
  eq(opts[0], { value: "GONE123", label: "GONE123", hint: "not in the Square catalog" });
  eq(opts.length, 2);
  eq(variationOptions([special], null).length, 1, "nothing saved adds nothing");
});
