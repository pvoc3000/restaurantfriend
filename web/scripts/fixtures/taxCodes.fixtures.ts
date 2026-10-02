// `supabase/functions/_shared/taxCodes.ts` — the QuickBooks tax code an
// invoice goes under, chosen by the order's rate at send time.

import { eq, no, ok, test } from "./harness";
import { chooseTaxCode, taxCodesWithRates } from "../../../supabase/functions/_shared/taxCodes";

// Donut Friend's file as read 2026-10-02 (active codes only).
const codes = taxCodesWithRates(
  [
    { Id: "11", Name: "CA-Los Angeles-Los Angeles", SalesTaxRateList: { TaxRateDetail: [
      { TaxRateRef: { value: "17" } }, { TaxRateRef: { value: "18" } }, { TaxRateRef: { value: "21" } }] } },
    { Id: "9", Name: "CA-Los Angeles-Los Angeles", SalesTaxRateList: { TaxRateDetail: [
      { TaxRateRef: { value: "17" } }, { TaxRateRef: { value: "18" } }, { TaxRateRef: { value: "19" } }] } },
    { Id: "10", Name: "CA-Los Angeles-Los Angeles-Culver City", SalesTaxRateList: { TaxRateDetail: [
      { TaxRateRef: { value: "17" } }, { TaxRateRef: { value: "18" } }, { TaxRateRef: { value: "19" } },
      { TaxRateRef: { value: "20" } }] } },
    { Id: "8", Name: "Out of scope", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "15" } }] } },
    { Id: "13", Name: "Sales Tax", SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "23" } }] } },
    { Id: "99", Name: "No list" },
  ],
  [
    { Id: "17", RateValue: 6.25 }, { Id: "18", RateValue: 1 }, { Id: "19", RateValue: 2.25 },
    { Id: "20", RateValue: 0.75 }, { Id: "21", RateValue: 2.5 }, { Id: "15", RateValue: 0 },
    { Id: "23", RateValue: 10.25 },
  ]
);

test("taxCodesWithRates: a code's rate is the sum of its components", () => {
  const rate = (id: string) => codes.find((c) => c.id === id)?.rate;
  eq(rate("11"), 9.75, "state + county + district");
  eq(rate("9"), 9.5, "the older district");
  eq(rate("10"), 10.25, "four components");
  eq(rate("8"), 0, "out of scope is 0, not unknown");
  eq(rate("13"), 10.25, "a single custom rate");
  eq(rate("99"), null, "no rate list → unknown, never 0");
});

test("chooseTaxCode: one active code at the rate is chosen", () => {
  const c = chooseTaxCode([0.0975], codes, null);
  ok(c.ok && c.id === "11", `9.75% → code 11 (${JSON.stringify(c)})`);
  const d = chooseTaxCode([0.095, 0.095], codes, null);
  ok(d.ok && d.id === "9", "the same rate twice is one rate");
});

test("chooseTaxCode: a tie goes to the preferred code, and refuses without one", () => {
  const p = chooseTaxCode([0.1025], codes, "13");
  ok(p.ok && p.id === "13", "Settings' code breaks the tie");
  const q = chooseTaxCode([0.1025], codes, "10");
  ok(q.ok && q.id === "10", "whichever of the tied codes is preferred");
  const none = chooseTaxCode([0.1025], codes, null);
  no(none.ok, "two codes at 10.25% and no preference");
  ok(!none.ok && none.error.includes("Sales Tax") && none.error.includes("Culver City"), "names both");
  const stale = chooseTaxCode([0.1025], codes, "6");
  no(stale.ok, "a preferred code that is not active cannot break a tie");
});

test("chooseTaxCode: a rate QuickBooks has no code for is refused, by rate", () => {
  // SO-10098, 2026-10-02: entered at 10.5%.
  const r = chooseTaxCode([0.105], codes, "13");
  no(r.ok, "10.5% has no code");
  ok(!r.ok && r.error.includes("10.5%"), "the refusal names the rate");
  no(chooseTaxCode([0.0976], codes, "13").ok, "close is not equal");
});

test("chooseTaxCode: mixed rates and no rate are refused", () => {
  const m = chooseTaxCode([0.1025, 0.0975], codes, "13");
  ok(!m.ok && m.error.includes("10.25%") && m.error.includes("9.75%"), "mixed rates named");
  no(chooseTaxCode([], codes, "13").ok, "taxed with no rate");
  no(chooseTaxCode([0], codes, "13").ok, "0% is not a taxed rate");
  const z = chooseTaxCode([0, 0.0975], codes, null);
  ok(z.ok && z.id === "11", "an untaxed order beside a taxed one does not mix rates");
});
