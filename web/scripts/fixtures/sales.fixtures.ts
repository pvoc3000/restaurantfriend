// lib/sales — the comparison arithmetic behind /sales.
//
// The cases that matter are the ones where an obvious implementation is wrong
// in a way nobody notices: previousRange being off by a day, lastYearRange
// landing on the wrong weekday, and every "percentage of nothing" path.

import { test, eq, ok } from "./harness";
import {
  sumSales,
  tipFraction,
  previousRange,
  lastYearRange,
  compareTotals,
  missingDays,
  rollUpByDate,
  rollUpByLocation,
  daysIn,
  formatFraction,
  parseSalesRange,
  resolveSalesRange,
  fetchWindow,
  elapsedRange,
  isPartial,
  openingSlice,
  expectsSalesOn,
  type SalesDay,
} from "../../src/lib/sales";
import { isoWeekday, daysBetween } from "../../src/lib/payPeriods";

function day(
  code: string,
  date: string,
  net: number,
  tips: number,
  id = code.toLowerCase()
): SalesDay {
  return {
    location_id: id,
    locationCode: code,
    business_date: date,
    netSalesCents: net,
    tipsCents: tips,
    syncedAt: null,
  };
}

// ---------------------------------------------------------------------------
// sumSales
// ---------------------------------------------------------------------------

test("sumSales adds cents and counts SHOP-days, not dates", () => {
  const t = sumSales([
    day("DF01", "2026-08-20", 373327, 28658),
    day("DF02", "2026-08-20", 157322, 9196),
  ]);
  eq(t.netSalesCents, 530649, "net");
  eq(t.tipsCents, 37854, "tips");
  // Two shops on ONE date is two shop-days. An average-per-day figure that
  // counted dates would double every per-shop average the moment DF02 closed.
  eq(t.days, 2, "days");
});

test("sumSales of nothing is zero, not NaN", () => {
  eq(sumSales([]), { netSalesCents: 0, tipsCents: 0, days: 0 });
});

test("sumSales carries a negative day through rather than clamping it", () => {
  const t = sumSales([day("DF01", "2026-08-20", -5000, 0), day("DF01", "2026-08-21", 10000, 0)]);
  eq(t.netSalesCents, 5000, "a refund day reduces the total");
});

// ---------------------------------------------------------------------------
// tipFraction — every "percentage of nothing" path
// ---------------------------------------------------------------------------

test("tipFraction is a FRACTION, not a percentage", () => {
  // 286.58 on 3733.27 — Mark's real 2026-01-01 at DF01.
  const f = tipFraction({ netSalesCents: 373327, tipsCents: 28658, days: 1 });
  ok(f !== null, "computed");
  ok(Math.abs((f as number) - 0.076764) < 1e-5, `expected ~0.0768, got ${f}`);
});

test("tipFraction refuses zero net sales rather than returning 0 or Infinity", () => {
  eq(tipFraction({ netSalesCents: 0, tipsCents: 500, days: 1 }), null, "zero sales");
});

test("tipFraction refuses NEGATIVE net sales — a refund day has no tip rate", () => {
  eq(tipFraction({ netSalesCents: -5000, tipsCents: 100, days: 1 }), null, "negative sales");
});

test("tipFraction of zero tips on real sales is 0, which is a real answer", () => {
  eq(tipFraction({ netSalesCents: 100000, tipsCents: 0, days: 1 }), 0, "no tips taken");
});

// ---------------------------------------------------------------------------
// previousRange — the off-by-one that would understate every rise
// ---------------------------------------------------------------------------

test("previousRange is the SAME LENGTH and touches without overlapping", () => {
  // A real fortnight from pay_periods.
  const range = { from: "2026-07-20", to: "2026-08-02" };
  const prev = previousRange(range);
  eq(prev, { from: "2026-07-06", to: "2026-07-19" }, "the fortnight before");
  eq(daysBetween(prev.from, prev.to), daysBetween(range.from, range.to), "same length");
  eq(prev.to < range.from, true, "does not overlap");
});

test("previousRange of a single day is the day before", () => {
  eq(previousRange({ from: "2026-08-20", to: "2026-08-20" }), {
    from: "2026-08-19",
    to: "2026-08-19",
  });
});

test("previousRange crosses a month and a year boundary", () => {
  // January is 31 days, so the window before it is all of December — 31 days
  // too, not 30. Getting this wrong by one is the whole reason the length is
  // asserted rather than the dates alone.
  const prev = previousRange({ from: "2026-01-01", to: "2026-01-31" });
  eq(prev, { from: "2025-12-01", to: "2025-12-31" });
  eq(daysBetween(prev.from, prev.to), 31, "same length as January");
});

// ---------------------------------------------------------------------------
// lastYearRange — the weekday decision
// ---------------------------------------------------------------------------

test("lastYearRange lands on the SAME WEEKDAY, which is the whole point", () => {
  const range = { from: "2026-08-17", to: "2026-08-22" };
  const back = lastYearRange(range);
  eq(isoWeekday(back.from), isoWeekday(range.from), "from weekday");
  eq(isoWeekday(back.to), isoWeekday(range.to), "to weekday");
  eq(back, { from: "2025-08-18", to: "2025-08-23" }, "364 days back");
});

test("the CALENDAR answer would compare a Saturday against a Friday", () => {
  // This is the case the default exists to avoid — proved rather than asserted.
  const range = { from: "2026-08-22", to: "2026-08-22" }; // a Saturday
  eq(isoWeekday(range.from), 6, "2026-08-22 is a Saturday");
  const calendar = lastYearRange(range, "sameDates");
  eq(calendar.from, "2025-08-22");
  eq(isoWeekday(calendar.from), 5, "2025-08-22 is a Friday — a different business");
  const aligned = lastYearRange(range, "weekAligned");
  eq(isoWeekday(aligned.from), 6, "the week-aligned answer is still a Saturday");
});

test("lastYearRange keeps the window length in both modes", () => {
  const range = { from: "2026-03-01", to: "2026-03-14" };
  for (const mode of ["weekAligned", "sameDates"] as const) {
    const back = lastYearRange(range, mode);
    eq(daysBetween(back.from, back.to), 14, `${mode} length`);
  }
});

test("sameDates clamps 29 February rather than rolling into March", () => {
  // 2024 was a leap year; 2023 was not. new Date("2023-02-29") rolls to Mar 1.
  const back = lastYearRange({ from: "2024-02-29", to: "2024-02-29" }, "sameDates");
  eq(back.from, "2023-02-28", "clamped, not rolled over");
});

// ---------------------------------------------------------------------------
// compareTotals
// ---------------------------------------------------------------------------

test("compareTotals reports deltas in cents and as fractions", () => {
  const c = compareTotals(
    { netSalesCents: 110000, tipsCents: 11000, days: 7 },
    { netSalesCents: 100000, tipsCents: 10000, days: 7 },
    { from: "2026-08-10", to: "2026-08-16" }
  );
  eq(c.netDeltaCents, 10000, "net delta");
  ok(Math.abs((c.netDeltaFraction as number) - 0.1) < 1e-9, "net +10%");
  eq(c.tipsDeltaCents, 1000, "tips delta");
  // Tips grew exactly in step with sales, so the SHARE did not move.
  ok(Math.abs(c.tipFractionDelta as number) < 1e-9, "tip share unchanged");
});

test("compareTotals refuses a percentage when the basis took NOTHING", () => {
  const c = compareTotals(
    { netSalesCents: 50000, tipsCents: 5000, days: 1 },
    { netSalesCents: 0, tipsCents: 0, days: 0 },
    { from: "2026-08-10", to: "2026-08-10" }
  );
  eq(c.netDeltaCents, 50000, "the cents delta is still real");
  eq(c.netDeltaFraction, null, "growth from zero has no percentage");
  eq(c.tipFractionDelta, null, "and no share to compare");
});

test("compareTotals shows a FALL as a negative", () => {
  const c = compareTotals(
    { netSalesCents: 80000, tipsCents: 8000, days: 7 },
    { netSalesCents: 100000, tipsCents: 10000, days: 7 },
    { from: "2026-08-10", to: "2026-08-16" }
  );
  eq(c.netDeltaCents, -20000, "net delta");
  ok(Math.abs((c.netDeltaFraction as number) + 0.2) < 1e-9, "net -20%");
});

// ---------------------------------------------------------------------------
// missingDays — the caveat that makes a comparison trustworthy
// ---------------------------------------------------------------------------

const LOCS = [
  { id: "df01", code: "DF01" },
  { id: "df02", code: "DF02" },
];

test("missingDays names each SHOP-day with no row", () => {
  const days = [day("DF01", "2026-08-20", 1, 1), day("DF02", "2026-08-20", 1, 1)];
  const gaps = missingDays(days, LOCS, { from: "2026-08-20", to: "2026-08-21" });
  eq(gaps.length, 2, "both shops missing the 21st");
  eq(
    gaps.map((g) => `${g.locationCode}|${g.business_date}`),
    ["DF01|2026-08-21", "DF02|2026-08-21"]
  );
});

test("missingDays finds a hole in the MIDDLE, which is what breaks a sum", () => {
  const days = [
    day("DF01", "2026-08-20", 1, 1),
    // 08-21 absent
    day("DF01", "2026-08-22", 1, 1),
  ];
  const gaps = missingDays(days, [LOCS[0]], { from: "2026-08-20", to: "2026-08-22" });
  eq(gaps.map((g) => g.business_date), ["2026-08-21"]);
});

test("missingDays stops at `through`, so today is never reported as a gap", () => {
  const days = [day("DF01", "2026-08-20", 1, 1)];
  // The window runs to the 23rd but the shop has not finished trading today.
  const gaps = missingDays(days, [LOCS[0]], { from: "2026-08-20", to: "2026-08-23" }, "2026-08-22");
  eq(gaps.map((g) => g.business_date), ["2026-08-21", "2026-08-22"], "the 23rd is not a gap");
});

test("missingDays over a complete window is empty", () => {
  const days = [day("DF01", "2026-08-20", 1, 1), day("DF01", "2026-08-21", 1, 1)];
  eq(missingDays(days, [LOCS[0]], { from: "2026-08-20", to: "2026-08-21" }), []);
});

// ---------------------------------------------------------------------------
// roll-ups and range filtering
// ---------------------------------------------------------------------------

test("rollUpByDate folds both shops into one row per date", () => {
  const m = rollUpByDate([
    day("DF01", "2026-08-20", 373327, 28658),
    day("DF02", "2026-08-20", 157322, 9196),
    day("DF01", "2026-08-21", 100000, 5000),
  ]);
  eq(m.get("2026-08-20")?.netSalesCents, 530649, "the pair summed");
  eq(m.get("2026-08-20")?.days, 2, "two shop-days");
  eq(m.get("2026-08-21")?.netSalesCents, 100000, "one shop that date");
});

test("rollUpByLocation folds every date into one row per shop", () => {
  const m = rollUpByLocation([
    day("DF01", "2026-08-20", 100, 10),
    day("DF01", "2026-08-21", 200, 20),
    day("DF02", "2026-08-20", 50, 5),
  ]);
  eq(m.get("DF01")?.netSalesCents, 300, "DF01");
  eq(m.get("DF01")?.days, 2, "DF01 days");
  eq(m.get("DF02")?.netSalesCents, 50, "DF02");
});

test("daysIn is inclusive at BOTH ends", () => {
  const days = [
    day("DF01", "2026-08-19", 1, 1),
    day("DF01", "2026-08-20", 1, 1),
    day("DF01", "2026-08-21", 1, 1),
    day("DF01", "2026-08-22", 1, 1),
  ];
  const got = daysIn(days, { from: "2026-08-20", to: "2026-08-21" });
  eq(got.map((d) => d.business_date), ["2026-08-20", "2026-08-21"]);
});

// ---------------------------------------------------------------------------
// formatFraction
// ---------------------------------------------------------------------------

test("formatFraction renders one decimal, and a null as an em dash", () => {
  eq(formatFraction(0.076764), "7.7%");
  eq(formatFraction(null), "—");
  eq(formatFraction(Infinity), "—", "never prints Infinity%");
  eq(formatFraction(NaN), "—", "never prints NaN%");
});

test("formatFraction signs a delta, including a zero", () => {
  eq(formatFraction(0.1, { sign: true }), "+10.0%");
  eq(formatFraction(-0.1, { sign: true }), "-10.0%");
  eq(formatFraction(0, { sign: true }), "0.0%", "no sign on no change");
});

// ---------------------------------------------------------------------------
// resolveSalesRange / fetchWindow
// ---------------------------------------------------------------------------

const PERIODS = [
  { start_date: "2026-08-17", end_date: "2026-08-30" },
  { start_date: "2026-08-03", end_date: "2026-08-16" },
  { start_date: "2026-07-20", end_date: "2026-08-02" },
];

test("parseSalesRange falls back to the default on anything unrecognised", () => {
  eq(parseSalesRange("ytd"), "ytd");
  eq(parseSalesRange(undefined), "period", "absent");
  eq(parseSalesRange("nonsense"), "period", "a stale bookmark still shows the screen");
});

test("`period` is the pay period CONTAINING today", () => {
  const r = resolveSalesRange("period", "2026-08-23", PERIODS);
  eq(r.range, { from: "2026-08-17", to: "2026-08-30" });
  eq(r.fellBack, false);
});

test("`last-period` is the one before that, not merely an earlier one", () => {
  const r = resolveSalesRange("last-period", "2026-08-23", PERIODS);
  eq(r.range, { from: "2026-08-03", to: "2026-08-16" });
});

test("the pay-period windows FALL BACK when no period covers today", () => {
  // After the FileMaker load there was no open period at all. A screen that
  // renders nothing because the calendar has a hole is worse than one that
  // shows a fortnight and says so.
  const r = resolveSalesRange("period", "2027-01-01", PERIODS);
  eq(r.fellBack, true, "it says it fell back");
  eq(r.range, { from: "2026-12-19", to: "2027-01-01" }, "14 days");
});

test("mtd, ytd and last-30 all end TODAY", () => {
  eq(resolveSalesRange("mtd", "2026-08-23", PERIODS).range, {
    from: "2026-08-01",
    to: "2026-08-23",
  });
  eq(resolveSalesRange("ytd", "2026-08-23", PERIODS).range, {
    from: "2026-01-01",
    to: "2026-08-23",
  });
  eq(resolveSalesRange("last-30", "2026-08-23", PERIODS).range, {
    from: "2026-07-25",
    to: "2026-08-23",
  });
  eq(daysBetween("2026-07-25", "2026-08-23"), 30, "last-30 really is 30 days");
});

test("a custom range takes both ends, and SWAPS them if reversed", () => {
  eq(
    resolveSalesRange("custom", "2026-08-23", PERIODS, { from: "2026-03-01", to: "2026-03-31" })
      .range,
    { from: "2026-03-01", to: "2026-03-31" }
  );
  eq(
    resolveSalesRange("custom", "2026-08-23", PERIODS, { from: "2026-03-31", to: "2026-03-01" })
      .range,
    { from: "2026-03-01", to: "2026-03-31" },
    "typed backwards"
  );
});

test("a custom range falls back per END, since half-typed is the normal state", () => {
  const r = resolveSalesRange("custom", "2026-08-23", PERIODS, { from: "2026-03-01", to: null });
  eq(r.range, { from: "2026-03-01", to: "2026-08-23" }, "the typed end survives");
});

test("a custom range refuses a date that is not real", () => {
  // new Date("2026-02-31") does not fail — it rolls over to March 2nd.
  const r = resolveSalesRange("custom", "2026-08-23", PERIODS, {
    from: "2026-02-31",
    to: "2026-08-23",
  });
  eq(r.range.from, "2026-07-25", "the impossible date was refused, not rolled over");
});

test("fetchWindow spans the range, the one before it, AND a year back", () => {
  const w = fetchWindow({ from: "2026-08-17", to: "2026-08-30" });
  // 364 days before 2026-08-17 is 2025-08-18; the previous fortnight ends
  // 2026-08-16, so the widest window runs from last year to this period's end.
  eq(w.from, "2025-08-18", "a year back");
  eq(w.to, "2026-08-30", "this period's end");
});

test("fetchWindow always CONTAINS all three windows", () => {
  const range = { from: "2026-03-01", to: "2026-03-14" };
  const w = fetchWindow(range);
  for (const r of [range, previousRange(range), lastYearRange(range)]) {
    ok(w.from <= r.from && r.to <= w.to, `window contains ${JSON.stringify(r)}`);
  }
});

// ---------------------------------------------------------------------------
// Like-for-like: a period that has not finished yet
// ---------------------------------------------------------------------------

test("elapsedRange clips a running period to today", () => {
  eq(elapsedRange({ from: "2026-08-17", to: "2026-08-30" }, "2026-08-23"), {
    from: "2026-08-17",
    to: "2026-08-23",
  });
});

test("elapsedRange leaves a FINISHED period alone", () => {
  const done = { from: "2026-08-03", to: "2026-08-16" };
  eq(elapsedRange(done, "2026-08-23"), done, "nothing to clip");
  eq(isPartial(done, "2026-08-23"), false);
  eq(isPartial({ from: "2026-08-17", to: "2026-08-30" }, "2026-08-23"), true);
});

test("openingSlice takes the FIRST n days, which is the honest basis", () => {
  // The real case: on 2026-08-23 the current period is 7 days in, so last
  // period contributes its first 7 days — 08-03..08-09 — and not all fourteen.
  eq(openingSlice({ from: "2026-08-03", to: "2026-08-16" }, 7), {
    from: "2026-08-03",
    to: "2026-08-09",
  });
  eq(daysBetween("2026-08-03", "2026-08-09"), 7, "really seven days");
});

test("openingSlice clamps rather than running past the range", () => {
  const r = { from: "2026-08-03", to: "2026-08-05" };
  eq(openingSlice(r, 99), r, "asking for more days than exist");
  eq(openingSlice(r, 1), { from: "2026-08-03", to: "2026-08-03" }, "one day");
});

test("THE WHOLE POINT: a part-finished period compares like for like", () => {
  // Fourteen days of trade in the previous period, seven so far in this one.
  // Compared naively that is a 50% collapse; compared honestly it is flat.
  const range = { from: "2026-08-17", to: "2026-08-30" };
  const today = "2026-08-23";

  const days: SalesDay[] = [];
  for (const [from, to] of [["2026-08-03", "2026-08-16"], ["2026-08-17", "2026-08-23"]]) {
    for (let d = from; d <= to; d = addDaysLocal(d, 1)) days.push(day("DF01", d, 10000, 1000));
  }

  const elapsed = elapsedRange(range, today);
  const n = daysBetween(elapsed.from, elapsed.to);
  const current = sumSales(daysIn(days, elapsed));

  const naive = compareTotals(
    current,
    sumSales(daysIn(days, previousRange(range))),
    previousRange(range)
  );
  ok((naive.netDeltaFraction as number) < -0.49, "the naive answer reads as a collapse");

  const honest = compareTotals(
    current,
    sumSales(daysIn(days, openingSlice(previousRange(range), n))),
    openingSlice(previousRange(range), n)
  );
  eq(honest.netDeltaFraction, 0, "like for like, trade is flat");
});

/** A tiny local date step, so this file needs no extra import. */
function addDaysLocal(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// missingDays respects open_days — a day the place doesn't trade is not a gap
// ---------------------------------------------------------------------------

test("a location with an EMPTY open_days never reports a gap", () => {
  // The online channel: sells on about five days a year. Expecting a row from
  // it every day would bury the real gaps under ~230 phantom ones.
  const online = { id: "online", code: "ONLINE", openDays: [] as number[] };
  const gaps = missingDays([], [online], { from: "2026-08-01", to: "2026-08-31" });
  eq(gaps.length, 0, "no fixed trading days, so nothing is missing");
});

test("a location with NO open_days still expects a row every day", () => {
  // Silence about a shop's hours must not silence a real gap.
  for (const openDays of [null, undefined]) {
    const loc = { id: "x", code: "DF01", openDays };
    const gaps = missingDays([], [loc], { from: "2026-08-01", to: "2026-08-03" });
    eq(gaps.length, 3, `openDays=${String(openDays)} expects every day`);
  }
});

test("a location open only some weekdays reports gaps on those days ALONE", () => {
  // 2026-08-01 is a Saturday. Open Mon–Fri (ISO 1..5) means Sat and Sun are
  // never gaps.
  eq(isoWeekday("2026-08-01"), 6, "2026-08-01 is a Saturday");
  const weekdaysOnly = { id: "w", code: "WK", openDays: [1, 2, 3, 4, 5] };
  const gaps = missingDays([], [weekdaysOnly], { from: "2026-08-01", to: "2026-08-07" });
  eq(
    gaps.map((g) => g.business_date),
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
    "Mon–Fri only; the weekend is not a gap"
  );
});

test("a shop open every day still reports a real hole", () => {
  // The case the whole line exists for — this must not be softened by the fix.
  const shop = { id: "df01", code: "DF01", openDays: [1, 2, 3, 4, 5, 6, 7] };
  const days = [day("DF01", "2026-08-01", 1, 1, "df01"), day("DF01", "2026-08-03", 1, 1, "df01")];
  const gaps = missingDays(days, [shop], { from: "2026-08-01", to: "2026-08-03" });
  eq(gaps.map((g) => g.business_date), ["2026-08-02"], "the middle day is still a gap");
});

test("expectsSalesOn states the three cases directly", () => {
  eq(expectsSalesOn({ id: "a", code: "A", openDays: null }, "2026-08-01"), true, "unknown");
  eq(expectsSalesOn({ id: "a", code: "A", openDays: [] }, "2026-08-01"), false, "no fixed days");
  eq(expectsSalesOn({ id: "a", code: "A", openDays: [6] }, "2026-08-01"), true, "a Saturday");
  eq(expectsSalesOn({ id: "a", code: "A", openDays: [1] }, "2026-08-01"), false, "Mondays only");
});
