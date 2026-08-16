// lib/anchoredPanel — `sinkInactive`, the rule that lets a PickList list retired
// entries without letting one be mistaken for a live one.
//
// Six vocabularies feed this now (elements, production items, vendors, payroll
// benefits), so the cases that matter are the ones a per-caller version would
// get wrong: a heading only renders where the group CHANGES, so the sink has to
// be a real partition rather than a filter the caller appends; and `inactive`
// has to BEAT `group`, or a retired entry from a grouped vocabulary carries its
// old heading down below the rule and the panel shows that heading twice.

import { sinkInactive } from "../../src/lib/anchoredPanel";
import { eq, test } from "./harness";

type O = { value: string; inactive?: boolean; group?: string };
const o = (value: string, extra: Partial<O> = {}): O => ({ value, ...extra });
const values = (list: O[]) => list.map((x) => x.value);
const groups = (list: O[]) => list.map((x) => x.group ?? null);

test("nothing inactive → the caller's order, untouched", () => {
  const list = [o("a"), o("b"), o("c")];
  eq(values(sinkInactive(list, "Inactive")), ["a", "b", "c"]);
});

test("nothing inactive → the caller's own groups survive", () => {
  const list = [o("g", { group: "Weight" }), o("h", { group: "Volume" })];
  eq(groups(sinkInactive(list, "Inactive")), ["Weight", "Volume"]);
});

test("inactive entries sink below every live one", () => {
  const list = [o("a"), o("x", { inactive: true }), o("b"), o("y", { inactive: true })];
  eq(
    values(sinkInactive(list, "Inactive")),
    ["a", "b", "x", "y"],
    "a filter-and-append at the call site would leave x above b"
  );
});

test("the sunken entries all carry the heading, so it renders once", () => {
  const list = [o("a"), o("x", { inactive: true }), o("y", { inactive: true })];
  eq(groups(sinkInactive(list, "Inactive")), [null, "Inactive", "Inactive"]);
});

test("`inactive` overrides the caller's own group", () => {
  // Otherwise "Weight" heads a run at the top AND the run under the rule.
  const list = [
    o("g", { group: "Weight" }),
    o("old", { group: "Weight", inactive: true }),
  ];
  eq(groups(sinkInactive(list, "Inactive")), ["Weight", "Inactive"]);
});

test("live entries keep their relative order, and so do the sunken ones", () => {
  const list = [
    o("z", { inactive: true }),
    o("b"),
    o("a"),
    o("y", { inactive: true }),
  ];
  // Neither half is re-sorted: the caller already ordered its vocabulary (by
  // name, by sort_order), and this must not second-guess it.
  eq(values(sinkInactive(list, "Inactive")), ["b", "a", "z", "y"]);
});

test("everything inactive → one heading and every row under it", () => {
  const list = [o("x", { inactive: true }), o("y", { inactive: true })];
  const out = sinkInactive(list, "Inactive");
  eq(values(out), ["x", "y"]);
  eq(groups(out), ["Inactive", "Inactive"]);
});

test("the heading is the caller's word", () => {
  eq(groups(sinkInactive([o("x", { inactive: true })], "Retired")), ["Retired"]);
});

test("the input is never mutated", () => {
  const list = [o("a"), o("x", { inactive: true, group: "Weight" })];
  sinkInactive(list, "Inactive");
  eq(groups(list), [null, "Weight"], "the caller's own array must survive the call");
});

test("an empty list is an empty list", () => {
  eq(sinkInactive([], "Inactive"), []);
});
