// lib/batchLogSheet — the printed batch log's order, name and par.
//
// The sheet is walked on paper and then typed into the screen, so the two must
// list the batches the same way: banded by element type with an untyped batch
// LAST (not first, under the empty string), then by element name, then by the
// schedule's own sort. And an unset par prints blank rather than an em dash,
// which on a sheet of figures somebody is copying reads as a value.

import { eq, test } from "./harness";
import {
  NO_TYPE,
  batchSheetFileName,
  batchSheetGroups,
  batchSheetName,
  batchSheetPar,
  type BatchSheetLine,
} from "../../src/lib/batchLogSheet";

const line = (
  id: string,
  element_name: string,
  element_type: string | null,
  extra: Partial<BatchSheetLine> = {}
): BatchSheetLine => ({
  id,
  element_name,
  element_type,
  batch_label: null,
  sort: null,
  par_count: null,
  par_size: null,
  par_unit: null,
  ...extra,
});

test("bands by type, untyped last, names ascending inside each band", () => {
  const groups = batchSheetGroups([
    line("a", "Vanilla Glaze", "Glaze"),
    line("b", "Sprinkles", null),
    line("c", "Raised Dough", "Donut"),
    line("d", "Chocolate Glaze", "Glaze"),
    line("e", "Cake Batter", "Donut"),
  ]);
  eq(
    groups.map((g) => g.type),
    ["Donut", "Glaze", NO_TYPE]
  );
  eq(
    groups.map((g) => g.lines.map((l) => l.id)),
    [["e", "c"], ["d", "a"], ["b"]]
  );
});

test("two batches of one element keep the schedule's sort, then their labels", () => {
  const groups = batchSheetGroups([
    line("hand", "Chocolate Glaze", "Glaze", { batch_label: "A" }),
    line("two", "Chocolate Glaze", "Glaze", { sort: 2, batch_label: "Milk" }),
    line("one", "Chocolate Glaze", "Glaze", { sort: 1, batch_label: "Dark" }),
    line("hand2", "Chocolate Glaze", "Glaze", { batch_label: "B" }),
  ]);
  eq(groups[0].lines.map((l) => l.id), ["one", "two", "hand", "hand2"]);
});

test("an empty log is no bands at all", () => {
  eq(batchSheetGroups([]), []);
});

test("the name carries the batch label; a blank label adds nothing", () => {
  eq(batchSheetName(line("x", "Chocolate Glaze", "Glaze", { batch_label: "Dark" })), "Chocolate Glaze — Dark");
  eq(batchSheetName(line("x", "Chocolate Glaze", "Glaze", { batch_label: "  " })), "Chocolate Glaze");
});

test("the par reads as the screen states it, and blank where unset", () => {
  eq(batchSheetPar(line("x", "Glaze", null, { par_count: 4, par_size: 3, par_unit: "gal" })), "4 × 3 gal");
  eq(batchSheetPar(line("x", "Dough", null, { par_size: 35, par_unit: "lb" })), "35 lb");
  eq(batchSheetPar(line("x", "Cream", null)), "");
});

test("the file is named by date and kitchen", () => {
  eq(batchSheetFileName({ logDate: "2026-11-09", kitchenCode: "DF01" }), "2026-11-09 DF01 batch log.pdf");
});
