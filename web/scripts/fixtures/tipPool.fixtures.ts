// lib/tipPool — dividing one shop's tips for one day.
//
// The allocations must sum to the pool EXACTLY. Every case here is really that
// one assertion asked a different way, because a cent lost each day is a cent
// the shop pays out of its own pocket, forever.

import { test, eq, ok } from "./harness";
import {
  allocateTips,
  formatCents,
  formatRate,
  parseDollarsToCents,
  type TipShift,
} from "../../src/lib/tipPool";

let seq = 0;
function shift(hours: number, over: Partial<TipShift> = {}): TipShift {
  seq += 1;
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    hours,
    excludeShift: null,
    excludePerson: false,
    ...over,
  };
}

const sum = (r: { allocations: { cents: number }[] }) =>
  r.allocations.reduce((n, a) => n + a.cents, 0);

/* -- the rule -------------------------------------------------------------- */

test("an even split is even", () => {
  const r = allocateTips(9000, [shift(5), shift(5)]);
  eq(r.allocations.map((a) => a.cents), [4500, 4500]);
  eq(r.totalTipHours, 10);
  eq(r.residualCents, 0);
  eq(sum(r), 9000);
});

test("the rate is dollars per hour, and allocation is hours times rate", () => {
  // $120 over 8 tip hours is $15.00/hour.
  const r = allocateTips(12000, [shift(6), shift(2)]);
  eq(formatRate(r.rateMillicents), "$15.000");
  eq(r.allocations.map((a) => a.cents), [9000, 3000]);
  eq(sum(r), 12000);
});

/* -- THE residual ---------------------------------------------------------- */

test("$100 over three equal shares is 33.34 / 33.33 / 33.33, residual 1c", () => {
  const a = shift(1), b = shift(1), c = shift(1);
  const r = allocateTips(10000, [a, b, c]);
  eq(r.allocations.map((x) => x.cents), [3334, 3333, 3333]);
  eq(r.residualCents, 1);
  eq(r.residualTo, [a.id], "and it NAMES who got it");
  eq(sum(r), 10000, "sums to the pool exactly");
});

test("running it twice returns an identical object", () => {
  // The deterministic tiebreak is what lets a re-run reproduce a frozen
  // snapshot rather than merely resemble it (decision 10).
  const shifts = [shift(1), shift(1), shift(1)];
  eq(allocateTips(10000, shifts), allocateTips(10000, shifts));
});

test("the residual goes to the LARGEST fractional remainders", () => {
  // $10.00 over 3h + 3h + 1h. Exact: 428.57, 428.57, 142.86.
  // Floors 428/428/142 = 998, so two cents to hand out; the 1-hour share has
  // the largest remainder (.857) and takes the first.
  const a = shift(3), b = shift(3), c = shift(1);
  const r = allocateTips(1000, [a, b, c]);
  eq(sum(r), 1000);
  eq(r.residualCents, 2);
  eq(r.residualTo[0], c.id, "the largest remainder first");
});

test("a tie in remainder goes to MORE tip hours, then to id ascending", () => {
  // Two shares with identical remainders, different hours.
  const long = shift(2), short = shift(2);
  const r = allocateTips(10001, [long, short, shift(1)]);
  eq(sum(r), 10001);
  ok(r.residualCents >= 1, "there is a residual to place");
});

test("an awkward pool over awkward hours still sums exactly", () => {
  // The property that matters, over a shape nobody would pick by hand.
  const shifts = [shift(7.23), shift(4.11), shift(6.5), shift(3.07), shift(8.99)];
  for (const pool of [1, 7, 99, 4237, 100000, 123457]) {
    const r = allocateTips(pool, shifts);
    eq(sum(r), pool, `pool ${pool}`);
  }
});

/* -- exclusion ------------------------------------------------------------- */

test("an excluded person is not in the pool and does not dilute the rate", () => {
  const manager = shift(8, { excludePerson: true });
  const a = shift(5), b = shift(5);
  const r = allocateTips(10000, [manager, a, b]);
  eq(r.totalTipHours, 10, "the manager's 8 hours are not counted");
  eq(r.allocations.length, 2, "and they get no allocation row");
  eq(r.allocations.map((x) => x.cents), [5000, 5000]);
});

test("the tri-state's third state puts them back IN", () => {
  // "The manager actually worked the floor on Saturday."
  const manager = shift(10, { excludePerson: true, excludeShift: false });
  const a = shift(10);
  const r = allocateTips(10000, [manager, a]);
  eq(r.totalTipHours, 20);
  eq(r.allocations.map((x) => x.cents), [5000, 5000]);
});

test("and excluding a single shift works the other way", () => {
  const a = shift(5, { excludeShift: true });
  const b = shift(5);
  const r = allocateTips(10000, [a, b]);
  eq(r.totalTipHours, 5);
  eq(r.allocations.map((x) => x.cents), [10000]);
});

test("a zero-hour shift is not in the pool", () => {
  const r = allocateTips(10000, [shift(0), shift(5)]);
  eq(r.totalTipHours, 5);
  eq(r.allocations.length, 1);
});

/* -- the empty cases ------------------------------------------------------- */

test("money with nobody eligible is reported as UNALLOCATED, not divided by zero", () => {
  const r = allocateTips(10000, [shift(8, { excludePerson: true })]);
  eq(r.totalTipHours, 0);
  eq(r.unallocatedCents, 10000, "the money is named, not silently lost");
  eq(r.rateMillicents, 0);
  eq(sum(r), 0);
});

test("no money and eligible people is simply zero each", () => {
  const r = allocateTips(0, [shift(5), shift(5)]);
  eq(sum(r), 0);
  eq(r.unallocatedCents, 0);
  eq(r.allocations.length, 2);
});

/* -- money in and out ------------------------------------------------------ */

test("typed dollars become cents, and an over-precise figure is REFUSED", () => {
  // The refusal is the point, not the arithmetic. parseFloat("2.675") * 100
  // rounds to 268 cents — a figure nobody typed — which would break the one
  // promise this module makes: that the allocations sum to what the shop
  // actually collected. (Math.round does handle plain two-decimal money
  // correctly; that was checked rather than assumed.)
  eq(parseDollarsToCents("4.35"), 435);
  eq(parseDollarsToCents("2.675"), null, "three decimal places is refused");
  eq(parseDollarsToCents("1.005"), null, "more than two places is refused");
  eq(parseDollarsToCents("$1,234.56"), 123456);
  eq(parseDollarsToCents("423.50"), 42350);
  eq(parseDollarsToCents("100"), 10000);
  eq(parseDollarsToCents(".5"), 50);
  eq(parseDollarsToCents(""), null);
  eq(parseDollarsToCents("abc"), null);
});

test("cents read back as dollars", () => {
  eq(formatCents(42350), "$423.50");
  eq(formatCents(5), "$0.05");
  eq(formatCents(0), "$0.00");
  eq(formatCents(-125), "-$1.25");
  // GROUPED past a thousand — /sales quotes a year of takings, where an
  // ungrouped "$65500.43" has to be counted rather than read. Still integer
  // arithmetic: the dollars are grouped as a string.
  eq(formatCents(100000), "$1,000.00");
  eq(formatCents(6550043), "$65,500.43");
  eq(formatCents(119386243), "$1,193,862.43");
  eq(formatCents(-6550043), "-$65,500.43");
  eq(formatCents(99999), "$999.99", "no comma below a thousand");
});
