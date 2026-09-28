// `supabase/functions/_shared/refundSplit.ts` — a part refund of a QuickBooks
// invoice, split so that every line gives back the same share and QuickBooks'
// own tax on the taxable lines lands the receipt on the refund to the cent.

import { eq, no, ok, test } from "./harness";
import { splitRefund, spread } from "../../../supabase/functions/_shared/refundSplit";

/** QuickBooks' tax: each component rounded on its own, half up. */
const qboTax = (rates: number[], cents: number) =>
  rates.reduce((a, r) => a + Math.floor(r * cents + 0.5 + 1e-9), 0);

function lands(lines: { cents: number; taxable: boolean }[], tax: number, refund: number, rates: number[]) {
  const r = splitRefund(lines, tax, refund, rates);
  if ("error" in r) return { ok: false as const, why: r.error };
  const taxable = lines.reduce((a, l, i) => a + (l.taxable ? r.lines[i] : 0), 0);
  const qbo = lines.some((l) => l.taxable) ? qboTax(rates, taxable) : 0;
  const total = r.lines.reduce((a, c) => a + c, 0) + r.rounding + qbo;
  return { ok: total === refund, r, qbo, total };
}

test("spread: whole cents, in proportion, summing exactly", () => {
  eq(spread(100, [1, 1, 1]).join(","), "34,33,33", "the extra cent to the earliest");
  eq(spread(0, [5, 5]).join(","), "0,0", "nothing");
  eq(spread(7, [0, 10]).join(","), "0,7", "a zero-weight line takes nothing");
  eq(spread(1001, [333, 667]).reduce((a, c) => a + c, 0), 1001, "sums");
});

test("splitRefund: SO-10088's shape — $1.00 taxed + $0.10 tax — a part refund", () => {
  const lines = [{ cents: 100, taxable: true }];
  const half = lands(lines, 10, 55, [0.1]);
  ok(half.ok, `$0.55 lands (${JSON.stringify(half)})`);
  if (half.ok) {
    eq(half.r.lines[0], 50, "$0.50 of goods");
    eq(half.r.tax, 5, "$0.05 of tax");
    eq(half.r.rounding, 0, "no rounding line");
  }
});

test("splitRefund: taxed and untaxed lines each give back their share", () => {
  // $100 taxed at 9.5% + $10 delivery untaxed = $119.50; refund 10% = $11.95.
  const r = splitRefund([{ cents: 10000, taxable: true }, { cents: 1000, taxable: false }], 950, 1195, [0.095]);
  ok(!("error" in r));
  if (!("error" in r)) {
    eq(r.lines.join(","), "1000,100", "10% of each line");
    eq(r.tax, 95, "10% of the tax");
    eq(r.rounding, 0, "exact");
  }
});

for (const [name, rates] of [
  ["9.5%, one component", [0.095]],
  ["Los Angeles' 9.5% as QuickBooks splits it: 7.25% + 2.25%", [0.0725, 0.0225]],
  ["three components", [0.06, 0.0125, 0.0225]],
] as [string, number[]][]) {
  test(`splitRefund: EVERY cent from 1 to the whole invoice lands exactly — ${name}`, () => {
    const lines = [
      { cents: 4800, taxable: true },
      { cents: 1250, taxable: true },
      { cents: 1500, taxable: false },
    ];
    const tax = qboTax(rates, 6050);
    const total = 6050 + 1500 + tax;
    let rounded = 0;
    for (let refund = 1; refund <= total; refund++) {
      const x = lands(lines, tax, refund, rates);
      if (!x.ok) {
        ok(false, `refund ${refund} did not land: ${JSON.stringify(x)}`);
        return;
      }
      if (x.r.rounding > 0) rounded++;
      if (x.r.lines.some((c, i) => c > lines[i].cents)) {
        ok(false, `refund ${refund}: a line gives back more than it charged`);
        return;
      }
    }
    ok(rounded < total / 5, `a rounding line is the exception (${rounded} of ${total})`);
  });
}

test("splitRefund: the implied rate is only a fallback — it misses where the real rate lands", () => {
  // The bug the sweep found: $5.75 on $60.50 implies 9.504%, and at $1.63
  // that rounds the tax up where QuickBooks' 9.5% rounds it down.
  const lines = [{ cents: 4800, taxable: true }, { cents: 1250, taxable: true }, { cents: 1500, taxable: false }];
  ok(lands(lines, 575, 163, [0.095]).ok, "with the invoice's own rate it lands");
});

test("splitRefund: the whole invoice is every line in full", () => {
  const r = splitRefund([{ cents: 100, taxable: true }], 10, 110, [0.1]);
  ok(!("error" in r) && r.lines[0] === 100 && r.tax === 10 && r.rounding === 0, JSON.stringify(r));
});

test("splitRefund: refusals", () => {
  ok("error" in splitRefund([{ cents: 100, taxable: true }], 10, 111), "more than the invoice");
  ok("error" in splitRefund([{ cents: 100, taxable: true }], 10, 0), "nothing");
  ok("error" in splitRefund([{ cents: 100, taxable: false }], 10, 50), "tax on nothing taxable");
});
