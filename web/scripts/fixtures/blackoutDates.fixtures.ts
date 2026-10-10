// `lib/blackoutDates` — which calendar entry switches what off, where and when.
//
// Checked by BREAKING each rule: making the range exclusive at either end turns
// the first-day and last-day cases red; treating an empty `location_ids` as "no
// shop" turns the every-shop cases red; dropping the null filter lets an order
// with no pickup shop match a one-shop entry; ignoring the switch column makes
// a note refuse an order; and walking `closedDates` unclamped fails the
// year-long entry's count.

import { test, eq, ok, no } from "./harness";
import {
  blackoutFor,
  blackoutLabels,
  blackoutSentence,
  closedDates,
  coveringEntry,
  entryAppliesTo,
  entryCoversDate,
  entryDates,
  entryShops,
  isBlackout,
  type CalendarEntry,
} from "../../src/lib/blackoutDates";

const DF01 = "loc-1";
const DF02 = "loc-2";
const LOCATIONS = [
  { id: DF01, code: "DF01" },
  { id: DF02, code: "DF02" },
  { id: "loc-3", code: "EVENT" },
];

function entry(patch: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: "e",
    title: "Christmas",
    starts_on: "2026-12-25",
    ends_on: "2026-12-25",
    location_ids: [],
    no_special_orders: false,
    no_standing_orders: false,
    no_production: false,
    shop_closed: false,
    note: null,
    ...patch,
  };
}

/* -- what an entry is ---------------------------------------------------- */

test("an entry with no switch on is a note, not a blackout", () => {
  no(isBlackout(entry({})));
  ok(isBlackout(entry({ no_production: true })));
  ok(isBlackout(entry({ shop_closed: true })));
});

test("blackoutLabels lists what is on, in the screens' order", () => {
  eq(blackoutLabels(entry({ shop_closed: true, no_special_orders: true })), [
    "No special orders",
    "Shop closed",
  ]);
  eq(blackoutLabels(entry({})), []);
});

/* -- dates --------------------------------------------------------------- */

test("a range is inclusive on both ends", () => {
  const e = entry({ starts_on: "2026-11-26", ends_on: "2026-11-27" });
  no(entryCoversDate(e, "2026-11-25"));
  ok(entryCoversDate(e, "2026-11-26"), "first day");
  ok(entryCoversDate(e, "2026-11-27"), "last day");
  no(entryCoversDate(e, "2026-11-28"));
});

/* -- shops --------------------------------------------------------------- */

test("an every-shop entry applies to any shop, and to no shop at all", () => {
  const e = entry({ location_ids: [] });
  ok(entryAppliesTo(e, [DF01]));
  ok(entryAppliesTo(e, []), "no shop in hand");
  ok(entryAppliesTo(e, [null, undefined]), "only nulls");
});

test("a one-shop entry applies only where that shop is named", () => {
  const e = entry({ location_ids: [DF01] });
  ok(entryAppliesTo(e, [DF01]));
  ok(entryAppliesTo(e, [DF02, DF01]), "the kitchen counts as well as the pickup shop");
  no(entryAppliesTo(e, [DF02]));
  no(entryAppliesTo(e, []), "no shop in hand");
  no(entryAppliesTo(e, [null]), "a null pickup shop matches nothing");
});

/* -- blackoutFor --------------------------------------------------------- */

test("blackoutFor asks about ONE switch", () => {
  const entries = [entry({ no_production: true })];
  const ask = { date: "2026-12-25", locationIds: [DF01] };
  ok(blackoutFor(entries, { ...ask, effect: "production" }));
  no(blackoutFor(entries, { ...ask, effect: "special_orders" }));
  no(blackoutFor(entries, { ...ask, effect: "standing_orders" }));
  no(blackoutFor(entries, { ...ask, effect: "closed" }));
});

test("a note never blacks anything out", () => {
  const entries = [entry({})];
  for (const effect of ["special_orders", "standing_orders", "production", "closed"] as const) {
    no(blackoutFor(entries, { date: "2026-12-25", locationIds: [DF01], effect }), effect);
  }
});

test("blackoutFor: a DF01-only blackout leaves DF02 alone", () => {
  const entries = [entry({ no_special_orders: true, location_ids: [DF01] })];
  ok(blackoutFor(entries, { date: "2026-12-25", locationIds: [DF01], effect: "special_orders" }));
  no(blackoutFor(entries, { date: "2026-12-25", locationIds: [DF02], effect: "special_orders" }));
  ok(
    blackoutFor(entries, {
      date: "2026-12-25",
      locationIds: [DF02, DF01],
      effect: "special_orders",
    }),
    "picked up at DF02, made at DF01",
  );
});

test("blackoutFor: no date, no blackout", () => {
  const entries = [entry({ no_special_orders: true })];
  no(blackoutFor(entries, { date: null, locationIds: [DF01], effect: "special_orders" }));
  no(blackoutFor(entries, { date: "2026-12-24", locationIds: [DF01], effect: "special_orders" }));
});

test("two overlapping entries: the one that starts first is named", () => {
  const entries = [
    entry({ id: "late", title: "Christmas Day", starts_on: "2026-12-25", ends_on: "2026-12-25" }),
    entry({ id: "early", title: "Holiday week", starts_on: "2026-12-21", ends_on: "2026-12-27" }),
  ];
  eq(coveringEntry(entries, "2026-12-25", [DF01])?.id, "early");
});

/* -- closedDates --------------------------------------------------------- */

test("closedDates walks only the closed entries for that shop, inside the range", () => {
  const entries = [
    entry({ shop_closed: true, starts_on: "2026-12-24", ends_on: "2026-12-26" }),
    entry({ no_production: true, starts_on: "2026-12-28", ends_on: "2026-12-28" }),
    entry({ shop_closed: true, location_ids: [DF02], starts_on: "2026-12-30", ends_on: "2026-12-30" }),
  ];
  const closed = closedDates(entries, DF01, { from: "2026-12-25", to: "2026-12-31" });
  eq([...closed].sort(), ["2026-12-25", "2026-12-26"]);
  const other = closedDates(entries, DF02, { from: "2026-12-25", to: "2026-12-31" });
  eq([...other].sort(), ["2026-12-25", "2026-12-26", "2026-12-30"]);
});

test("closedDates clamps a year-long entry to the days asked about", () => {
  const entries = [entry({ shop_closed: true, starts_on: "2026-01-01", ends_on: "2026-12-31" })];
  eq(closedDates(entries, DF01, { from: "2026-06-01", to: "2026-06-07" }).size, 7);
});

/* -- wording ------------------------------------------------------------- */

test("entryDates: one day, a span in a month, a span across months", () => {
  eq(entryDates({ starts_on: "2026-12-25", ends_on: "2026-12-25" }), "Dec 25");
  eq(entryDates({ starts_on: "2026-11-26", ends_on: "2026-11-27" }), "Nov 26–27");
  eq(entryDates({ starts_on: "2026-12-31", ends_on: "2027-01-01" }), "Dec 31 – Jan 1");
});

test("entryShops reads as codes, and every shop when none is named", () => {
  eq(entryShops({ location_ids: [] }, LOCATIONS), "Every shop");
  eq(entryShops({ location_ids: [DF01] }, LOCATIONS), "DF01");
  eq(entryShops({ location_ids: [DF02, DF01] }, LOCATIONS), "DF01 and DF02");
  eq(entryShops({ location_ids: [DF01, DF02, "loc-3"] }, LOCATIONS), "DF01, DF02 and EVENT");
});

test("blackoutSentence names the shops only when the entry is not for all", () => {
  eq(
    blackoutSentence(entry({ title: "Closed for Christmas" }), "special_orders", "2026-12-25", LOCATIONS),
    "No special orders on Dec 25 — Closed for Christmas",
  );
  eq(
    blackoutSentence(
      entry({ title: "Floor refinishing", location_ids: [DF01] }),
      "production",
      "2026-03-02",
      LOCATIONS,
    ),
    "No production on Mar 2 — Floor refinishing (DF01)",
  );
});
