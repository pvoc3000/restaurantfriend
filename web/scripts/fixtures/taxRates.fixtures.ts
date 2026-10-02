// `src/lib/taxRates.ts` — an order's tax rate, chosen from the shops' rates.

import { eq, no, ok, test } from "./harness";
import { optionValue, parseTaxRatePick, taxRateOptions } from "../../src/lib/taxRates";

const shops = [
  { code: "DF02", tax_rate: "0.1025" },
  { code: "DF01", tax_rate: 0.1025 },
  { code: "ONLINE", tax_rate: null },
  { code: "DF09", tax_rate: "0.0975" },
];

test("taxRateOptions: one row per shop rate, naming the shops, then 0%", () => {
  const o = taxRateOptions(shops, 0.1025);
  eq(o.map((x) => x.label), ["10.25%", "9.75%", "0%"], "highest first, 0% last");
  eq(o[0].hint, "DF01, DF02", "both shops on one row");
  eq(o[2].hint, "not taxed", "0% says what it means");
  eq(o[0].value, optionValue(0.1025), "the field's value matches its option");
  eq(optionValue(0.1025), optionValue(Number("0.10250")), "the database's numeric text is the same rate");
});

test("taxRateOptions: an order's own odd rate stays listed", () => {
  const o = taxRateOptions(shops, 0.105);
  eq(o[o.length - 1].label, "10.5%", "SO-10098's rate");
  eq(o[o.length - 1].hint, "this order", "and it says whose");
  eq(taxRateOptions(shops, null).length, 3, "no rate adds no row");
  eq(taxRateOptions(shops, 0).length, 3, "0% is already there");
});

test("parseTaxRatePick: a chosen option is exact; typed text is a percentage", () => {
  eq(parseTaxRatePick(optionValue(0.1025)), 0.1025, "picked");
  eq(parseTaxRatePick("10.5"), 0.105, "typed");
  eq(parseTaxRatePick(" 9.75% "), 0.0975, "typed with a sign");
  eq(parseTaxRatePick("0"), 0, "zero");
  eq(parseTaxRatePick(".5"), 0.005, "half a per cent is what it says");
  no(parseTaxRatePick("") !== null, "empty");
  no(parseTaxRatePick("-1") !== null, "negative");
  no(parseTaxRatePick("100") !== null, "100% is not a sales tax");
  no(parseTaxRatePick("ten") !== null, "words");
  ok(parseTaxRatePick("rate:0.0975") === 0.0975, "the prefix is the marker");
});
