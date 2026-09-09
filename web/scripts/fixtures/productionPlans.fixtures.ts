// Plans — production brief decision 9.
//
// The weekday arithmetic especially: ISO 1 = Monday everywhere in this schema,
// and off by one silently shifts a whole shop's menu by a day.

import {
  coversDate,
  isCurrentPlan,
  rangesOverlap,
  overlappingPlans,
  planRange,
  buildMatrix, traySortUpdates, renumberTrays,
  defaultParFor,
  slotParLabel,
  stepPar,
  nextTrayNumber,
  duplicateTitle,
  planKitchenFor,
  planKitchens,
  defaultKitchenStrip,
  sellingShopsForKitchen,
  NO_CATEGORY,
  NO_TYPE,
  NO_CUT,
  WEEKDAYS,
  type PlanSummary,
} from "../../src/lib/productionPlans";
import { test, eq, ok, no } from "./harness";

const DF01 = "loc-df01";
const DF02 = "loc-df02";

function plan(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "p1", title: "October", location_id: DF02, kitchen_by_weekday: null,
    starts_on: "2026-10-01", ends_on: "2026-10-31", is_active: true, ...over,
  };
}

/* -- dates ----------------------------------------------------------------- */

test("a plan covers its own first and last day", () => {
  const p = plan();
  ok(coversDate(p, "2026-10-01"), "the first day is inside");
  ok(coversDate(p, "2026-10-31"), "the last day is inside");
  no(coversDate(p, "2026-09-30"));
  no(coversDate(p, "2026-11-01"));
});

test("an open-ended plan runs until somebody says otherwise", () => {
  const p = plan({ ends_on: null });
  ok(coversDate(p, "2099-01-01"));
  no(coversDate(p, "2026-09-30"), "but still not before it starts");
});

test("dates compare as STRINGS, never through Date", () => {
  // `new Date("2026-08-07")` is UTC midnight, so west of Greenwich it is the
  // 6th locally — which would shift a plan's first day for everyone here.
  // Comparing the ISO text has no timezone to get wrong.
  const p = plan({ starts_on: "2026-08-07", ends_on: "2026-08-07" });
  ok(coversDate(p, "2026-08-07"), "a one-day plan covers its day");
  no(coversDate(p, "2026-08-06"));
  no(coversDate(p, "2026-08-08"));
});

/* -- overlap is the FEATURE ------------------------------------------------ */

test("ranges that touch at a single day overlap", () => {
  ok(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: "2026-01-10" },
    { starts_on: "2026-01-10", ends_on: "2026-01-20" }
  ));
  no(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: "2026-01-09" },
    { starts_on: "2026-01-10", ends_on: "2026-01-20" }
  ));
});

test("an open-ended plan overlaps everything after it starts", () => {
  ok(rangesOverlap(
    { starts_on: "2026-01-01", ends_on: null },
    { starts_on: "2030-01-01", ends_on: "2030-02-01" }
  ));
});

test("DF01 making DF02's raised while DF02 makes its own cake is TWO overlapping plans", () => {
  // Decision 9's own example, and the thing the schema deliberately permits.
  const plans = [
    // 101 does NOT retire this case: two kitchens on ONE day, split by ITEM,
    // is still two overlapping plans. What it retires is two kitchens on
    // DIFFERENT days, which is one plan now.
    plan({ id: "raised", title: "DF02 raised", kitchen_by_weekday: defaultKitchenStrip(DF01) }),
    plan({ id: "cake", title: "DF02 cake", kitchen_by_weekday: defaultKitchenStrip(DF02) }),
  ];
  const warn = overlappingPlans(plans);
  eq(warn.get("raised"), ["DF02 cake"]);
  eq(warn.get("cake"), ["DF02 raised"]);
});

test("plans at DIFFERENT shops never warn about each other", () => {
  const plans = [
    plan({ id: "a", location_id: DF01 }),
    plan({ id: "b", location_id: DF02 }),
  ];
  eq(overlappingPlans(plans).size, 0);
});

test("an INACTIVE plan neither warns nor is warned about", () => {
  const plans = [
    plan({ id: "a" }),
    plan({ id: "b", title: "old", is_active: false }),
  ];
  eq(overlappingPlans(plans).size, 0);
});

test("planRange says 'from' when a plan has no end", () => {
  eq(planRange({ starts_on: "2018-09-03", ends_on: "2018-11-04" }), "3 Sep 2018 – 4 Nov 2018");
  eq(planRange({ starts_on: "2018-09-03", ends_on: null }), "from 3 Sep 2018");
});

/* -- the matrix ------------------------------------------------------------ */

test("weekday 1 is MONDAY and 7 is Sunday, matching every array in the schema", () => {
  eq(WEEKDAYS[0].iso, 1);
  eq(WEEKDAYS[0].short, "Mon");
  eq(WEEKDAYS[6].iso, 7);
  eq(WEEKDAYS[6].short, "Sun");
});

test("a slot lands in the column its weekday names", () => {
  const names = new Map([["it1", "Bananaversary"]]);
  const m = buildMatrix(
    [{ id: "t1", tray_number: "01", band: "RAISED", sort: 1 }],
    [{ id: "s1", tray_id: "t1", weekday: 6, item_id: "it1", par: 12 }],
    names
  );
  // Saturday is index 5, not 6 — the off-by-one that would shift a menu.
  eq(m[0].days[5].map((s) => s.name), ["Bananaversary"]);
  eq(m[0].days[6].length, 0, "Sunday is empty");
  eq(m[0].days.length, 7);
});

test("a slot may hold SEVERAL items — half a tray of two things", () => {
  const names = new Map([["a", "Angry Samoa"], ["b", "Bacon 182"]]);
  const m = buildMatrix(
    [{ id: "t1", tray_number: "01", band: null, sort: 1 }],
    [
      { id: "s2", tray_id: "t1", weekday: 1, item_id: "b", par: 12 },
      { id: "s1", tray_id: "t1", weekday: 1, item_id: "a", par: 12 },
    ],
    names
  );
  // In NAME order whatever order the slots arrived in — the fixture feeds
  // Bacon 182 first.
  eq(m[0].days[0].map((s) => s.name), ["Angry Samoa", "Bacon 182"]);
});

test("trays order by their NUMBER, numerically, whatever `sort` says", () => {
  // Tray 17 was created after 18 and 20, so its `sort` is highest — the case
  // Mark hit. The number is what a person reads; sort only breaks ties.
  const m = buildMatrix(
    [
      { id: "c", tray_number: "18", band: null, sort: 1 },
      { id: "a", tray_number: "20", band: null, sort: 2 },
      { id: "b", tray_number: "17", band: null, sort: 3 },
      { id: "d", tray_number: "7", band: null, sort: 4 },
    ],
    [],
    new Map()
  );
  eq(m.map((r) => r.tray.tray_number), ["7", "17", "18", "20"]);
});

test("renumberTrays reads top to bottom, pads to two digits, names only what changes", () => {
  eq(
    renumberTrays([
      { id: "a", tray_number: "01", sort: 1 },
      { id: "b", tray_number: "07", sort: 2 },
      { id: "c", tray_number: "7A", sort: 3 },
      { id: "d", tray_number: "18", sort: 4 },
    ]),
    [
      { id: "b", from: "07", to: "02" },
      { id: "c", from: "7A", to: "03" },
      { id: "d", from: "18", to: "04" },
    ]
  );
  eq(renumberTrays([{ id: "a", tray_number: "01", sort: 1 }, { id: "b", tray_number: "02", sort: 2 }]), []);
});

test("traySortUpdates renumbers by tray number and names only what moves", () => {
  eq(
    traySortUpdates([
      { id: "c", tray_number: "18", sort: 1 },
      { id: "a", tray_number: "20", sort: 2 },
      { id: "b", tray_number: "17", sort: 3 },
    ]),
    [
      { id: "b", sort: 1 },
      { id: "c", sort: 2 },
      { id: "a", sort: 3 },
    ]
  );
  // Already in order: nothing to write.
  eq(traySortUpdates([{ id: "a", tray_number: "01", sort: 1 }, { id: "b", tray_number: "02", sort: 2 }]), []);
});

test("a tray with nothing on it still renders seven empty days", () => {
  // The empty slot is information — decision 9's combined view is what shows
  // tray 07 empty on Tuesdays.
  const m = buildMatrix([{ id: "t", tray_number: "07", band: null, sort: 1 }], [], new Map());
  eq(m[0].days.length, 7);
  eq(m[0].days.flat().length, 0);
});

test("an item with no name renders an em dash rather than a raw uuid", () => {
  const m = buildMatrix(
    [{ id: "t", tray_number: "01", band: null, sort: 1 }],
    [{ id: "s", tray_id: "t", weekday: 1, item_id: "gone", par: 12 }],
    new Map()
  );
  eq(m[0].days[0][0].name, "—");
});

/* -- the par on the slot (migration 043) ----------------------------------- */

test("the matrix carries each slot's OWN par, a deliberate zero included", () => {
  // `par: s.par || null` in buildMatrix turns the 0 into null and destroys
  // decision 3 on screen while the database still holds it.
  const names = new Map([["a", "Angry Samoa"], ["b", "Bacon 182"]]);
  const m = buildMatrix(
    [{ id: "t1", tray_number: "01", band: null, sort: 1 }],
    [
      { id: "s1", tray_id: "t1", weekday: 1, item_id: "a", par: 24 },
      { id: "s2", tray_id: "t1", weekday: 1, item_id: "b", par: 0 },
      { id: "s3", tray_id: "t1", weekday: 2, item_id: "a", par: null },
    ],
    names
  );
  eq(m[0].days[0].map((s) => s.par), [24, 0]);
  eq(m[0].days[1].map((s) => s.par), [null], "and null survives too");
});

test("a par of ZERO is not the absence of a par", () => {
  // The whole of decision 3, in the one place a reader meets it. The obvious
  // `par || "—"` renders a shop's deliberate "making none today" as a slot
  // nobody has got round to filling in.
  eq(slotParLabel(0), "0");
  eq(slotParLabel(null), "—");
  eq(slotParLabel(24), "24");
});

test("the seed reads ISO weekday n from slot n-1", () => {
  // The one place this off-by-one can still happen: migration 043 took the
  // array subscript out of SQL entirely, so this function inherited it. A
  // weekday off by one seeds every weekend slot with the wrong number.
  const defaults = { it: [18, 18, 18, 18, 24, 36, 99] };
  eq(defaultParFor(defaults, "it", 6), 36, "Saturday is slot 5");
  eq(defaultParFor(defaults, "it", 7), 99, "Sunday is slot 6");
  eq(defaultParFor(defaults, "it", 1), 18, "Monday is slot 0");
});

test("a DEFAULT of zero seeds NOTHING, because it was never a decision", () => {
  // A zero in the old array meant "we don't make it that day" — silence. A zero
  // on a slot is a person saying so. Seeding one as the other would manufacture
  // a decision nobody made, and paint the derived day suppressed for it.
  eq(defaultParFor({ it: [0, 0, 0, 0, 0, 0, 0] }, "it", 1), null);
  eq(defaultParFor({ it: [0, 18, 0, 0, 0, 0, 0] }, "it", 2), 18, "but a real number still seeds");
});

test("every kind of absence seeds null, and NEVER undefined", () => {
  // `insert({ par: undefined })` is serialised with the key OMITTED, so the
  // write succeeds carrying a different payload than the one you read — the
  // failure that is hardest to see in a network tab.
  eq(defaultParFor({}, "gone", 3), null, "no row at this shop");
  eq(defaultParFor({ it: [] }, "it", 3), null, "a row with no strip");
  eq(defaultParFor({ it: [12, 12, 12] }, "it", 7), null, "a short strip");
  eq(defaultParFor({ it: [null, null, null, null, null, null, null] }, "it", 4), null);
});

/* -- the par steppers ------------------------------------------------------ */

test("a stepper moves a par by one BOX, and zero is the floor", () => {
  eq(stepPar(18, 6, 1), 24);
  eq(stepPar(18, 6, -1), 12);
  eq(stepPar(6, 6, -1), 0);
  // The floor holds however far past it you press — a negative par is not a
  // thing a kitchen can make, and the column's own check would bounce it.
  eq(stepPar(0, 6, -1), 0);
  eq(stepPar(4, 6, -1), 0, "and it clamps rather than going to -2");
});

test("the step is the ITEM's box size, not a hardcoded 6", () => {
  // 037's `tally_box_size` is per item. An item that trays in twelves plans in
  // twelves, with no second place saying "6".
  eq(stepPar(24, 12, 1), 36);
  eq(stepPar(24, 12, -1), 12);
  eq(stepPar(1, 1, 1), 2, "and an item counted singly steps by one");
});

test("stepping an EMPTY par treats it as zero", () => {
  // Silence up is one box; silence down is a deliberate none. Pressing the
  // stepper is itself the human act the null/zero distinction turns on.
  eq(stepPar(null, 6, 1), 6);
  eq(stepPar(null, 6, -1), 0);
});

/* -- duplicating a tray ---------------------------------------------------- */

test("a duplicated tray counts UP and keeps its width", () => {
  // Unique on (plan, tray_number), so reusing the number is refused outright.
  eq(nextTrayNumber(["01"], "01"), "02");
  eq(nextTrayNumber(["01", "02", "03"], "01"), "04", "and skips the ones in use");
  eq(nextTrayNumber(["7"], "7"), "8", "a one-digit tray stays one digit");
});

test("a tray number that ISN'T a number takes a suffix rather than arithmetic", () => {
  // FMP's cases grow a "7A", and incrementing that is guesswork.
  eq(nextTrayNumber(["7A"], "7A"), "7A copy");
  eq(nextTrayNumber(["7A", "7A copy"], "7A"), "7A copy 2");
  eq(nextTrayNumber(["Front"], "Front"), "Front copy");
});

test("the number it picks is never one already in the plan", () => {
  // The whole job: the insert that follows must not trip the unique key.
  const existing = ["01", "02", "03", "04", "05"];
  const picked = nextTrayNumber(existing, "01");
  no(existing.includes(picked));
  eq(picked, "06");
});

/* -- grouping the trays ---------------------------------------------------- */

const TRAYS = [
  { id: "c", tray_number: "03", band: "CLASSIC", sort: 3 },
  { id: "a", tray_number: "01", band: "RAISED", sort: 1 },
  { id: "d", tray_number: "04", band: null, sort: 4 },
  { id: "b", tray_number: "02", band: "CLASSIC", sort: 2 },
];

test("grouping by TRAY keeps the plan's own order and bands nothing", () => {
  const m = buildMatrix(TRAYS, [], new Map(), "tray");
  eq(m.map((r) => r.tray.tray_number), ["01", "02", "03", "04"]);
  eq(m.map((r) => r.groupLabel), [null, null, null, null]);
});

test("grouping by CATEGORY orders by it, and bands each run ONCE", () => {
  // DataTable's rule: a grouping can only band what the ORDER already groups,
  // which is why the label comes from the same function that sorts.
  const m = buildMatrix(TRAYS, [], new Map(), "category");
  eq(m.map((r) => r.tray.tray_number), ["02", "03", "01", "04"]);
  eq(m.map((r) => r.groupLabel), ["CLASSIC", null, "RAISED", NO_CATEGORY]);
});

test("an uncategorised tray SINKS, and says so rather than showing a blank band", () => {
  // `lib/tableSort`'s empty-last rule, so a missing value reads the same way
  // here as everywhere else in the app.
  const m = buildMatrix(TRAYS, [], new Map(), "category");
  eq(m[m.length - 1].tray.tray_number, "04");
  eq(m[m.length - 1].groupLabel, NO_CATEGORY);
});

test("within a category the trays keep their own sort order", () => {
  const m = buildMatrix(TRAYS, [], new Map(), "category");
  eq(m.slice(0, 2).map((r) => r.tray.tray_number), ["02", "03"], "sort 2 before sort 3");
});

test("grouping never rewrites the plan — the input trays are untouched", () => {
  // `production_plan_trays.sort` is what the printed packet and production_day
  // read; this is a VIEW, and sorting a caller's array in place would make it
  // a write.
  //
  // A FRESH array, not the shared TRAYS: an in-place sort by an earlier test
  // would have left that one already reordered, so the snapshot would be taken
  // after the damage and the assertion would pass while the bug was live.
  // Checked by breaking it — `trays.sort` in place turns this red and nothing
  // else does.
  const own = [
    { id: "c", tray_number: "03", band: "CLASSIC", sort: 3 },
    { id: "a", tray_number: "01", band: "RAISED", sort: 1 },
    { id: "d", tray_number: "04", band: null, sort: 4 },
    { id: "b", tray_number: "02", band: "CLASSIC", sort: 2 },
  ];
  buildMatrix(own, [], new Map(), "category");
  eq(own.map((t) => t.tray_number), ["03", "01", "04", "02"]);
});

test("each band counts the trays in its OWN run, not the whole plan", () => {
  const m = buildMatrix(TRAYS, [], new Map(), "category");
  // CLASSIC 2, RAISED 1, No category 1 — and the count rides with the label, so
  // it is null on every row that doesn't start a run.
  eq(
    m.filter((r) => r.groupLabel).map((r) => [r.groupLabel, r.groupCount]),
    [["CLASSIC", 2], ["RAISED", 1], [NO_CATEGORY, 1]]
  );
  eq(m.map((r) => r.groupCount), [2, null, 1, 1]);
});

test("the band counts sum to the number of trays", () => {
  // The grand total in the sticky footer is `trays.length`; if these disagreed
  // with it, one of the two would be lying.
  const m = buildMatrix(TRAYS, [], new Map(), "category");
  const summed = m.reduce((n, r) => n + (r.groupCount ?? 0), 0);
  eq(summed, TRAYS.length);
});

test("grouping by TRAY counts nothing, because it bands nothing", () => {
  const m = buildMatrix(TRAYS, [], new Map(), "tray");
  eq(m.map((r) => r.groupCount), [null, null, null, null]);
});

/* -- grouping by ITEM TYPE ------------------------------------------------- */

// Four trays, each carrying one donut on Monday. FileMaker bands the TYPE and
// orders within it by cut then finish — its black CAKE / MOCHI rules.
const TYPE_TRAYS = [
  { id: "t1", tray_number: "01", band: null, sort: 1 },
  { id: "t2", tray_number: "02", band: null, sort: 2 },
  { id: "t3", tray_number: "03", band: null, sort: 3 },
  { id: "t4", tray_number: "04", band: null, sort: 4 },
];
const TYPE_SLOTS = [
  { id: "s1", tray_id: "t1", weekday: 1, item_id: "mochi", par: 6 },
  { id: "s2", tray_id: "t2", weekday: 1, item_id: "cakeVanPlain", par: 12 },
  { id: "s3", tray_id: "t3", weekday: 1, item_id: "cakeBanana", par: 15 },
  { id: "s4", tray_id: "t4", weekday: 1, item_id: "cakeVanGlaze", par: 9 },
];
const TAXONOMY = new Map([
  ["mochi", { item_type: "Mochi", subtype: "Krinkle", finish: "Plain" }],
  ["cakeVanPlain", { item_type: "Cake", subtype: "Vanilla", finish: "Plain" }],
  ["cakeBanana", { item_type: "Cake", subtype: "Banana", finish: "Plain" }],
  ["cakeVanGlaze", { item_type: "Cake", subtype: "Vanilla", finish: "Chocolate Glaze" }],
]);

test("item-type grouping sorts by TYPE, then cut, then finish", () => {
  const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS, new Map(), "type", TAXONOMY);
  // Cake before Mochi; within Cake, Banana before Vanilla; within Vanilla,
  // Chocolate Glaze before Plain.
  eq(m.map((r) => r.tray.tray_number), ["03", "04", "02", "01"]);
});

test("the band is the TYPE alone, not the whole taxonomy", () => {
  // Banding on type+cut+finish would put a rule above almost every tray, which
  // names nothing. FileMaker's black rules are the type.
  const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS, new Map(), "type", TAXONOMY);
  eq(m.filter((r) => r.groupLabel).map((r) => [r.groupLabel, r.groupCount]), [
    ["Cake", 3],
    ["Mochi", 1],
  ]);
});

test("only MONDAY'S FIRST item speaks for a tray", () => {
  // A tray usually carries one kind of donut all week; picking a day makes the
  // answer stable instead of depending on which cell you looked at.
  const slots = [
    { id: "a", tray_id: "t1", weekday: 1, item_id: "cakeBanana", par: 15 },
    { id: "b", tray_id: "t1", weekday: 1, item_id: "mochi", par: 6 },
    { id: "c", tray_id: "t2", weekday: 2, item_id: "cakeBanana", par: 15 },
  ];
  const m = buildMatrix(TYPE_TRAYS.slice(0, 2), slots, new Map(), "type", TAXONOMY);
  // t1 is Cake (its FIRST Monday slot), and t2 has no Monday item at all.
  eq(m.map((r) => [r.tray.tray_number, r.groupLabel]), [["01", "Cake"], ["02", NO_TYPE]]);
});

test("a tray with no Monday item SINKS and says so", () => {
  const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS.slice(0, 2), new Map(), "type", TAXONOMY);
  eq(m[m.length - 1].tray.tray_number, "04");
  eq(m.filter((r) => r.groupLabel).map((r) => r.groupLabel).pop(), NO_TYPE);
});

test("with no taxonomy supplied, item-type grouping degrades to one band", () => {
  // The map is optional; without it nothing has a type, so everything lands
  // under one honest heading rather than throwing.
  const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS, new Map(), "type");
  eq(m.filter((r) => r.groupLabel).map((r) => [r.groupLabel, r.groupCount]), [[NO_TYPE, 4]]);
});

test("the CUT is a second band under the type, and its runs are keyed by the PAIR", () => {
  // Two types can both have a "Plain" cut. Keyed on the cut alone, the second
  // Plain run would read as a continuation of the first and lose its heading.
  const trays = [
    { id: "a", tray_number: "01", band: null, sort: 1 },
    { id: "b", tray_number: "02", band: null, sort: 2 },
  ];
  const slots = [
    { id: "s1", tray_id: "a", weekday: 1, item_id: "cakePlain", par: 12 },
    { id: "s2", tray_id: "b", weekday: 1, item_id: "mochiPlain", par: 6 },
  ];
  const tax = new Map([
    ["cakePlain", { item_type: "Cake", subtype: "Plain", finish: "Plain" }],
    ["mochiPlain", { item_type: "Mochi", subtype: "Plain", finish: "Plain" }],
  ]);
  const m = buildMatrix(trays, slots, new Map(), "type", tax);
  eq(m.map((r) => [r.groupLabel, r.subGroupLabel]), [
    ["Cake", "Plain"],
    ["Mochi", "Plain"],
  ]);
});

test("the cut band names each run ONCE and marks where it ends", () => {
  // `endsSubGroup` is what puts the gap after the last tray of a run, so it has
  // to be true on exactly the last row of each — never on the first of the next.
  const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS, new Map(), "type", TAXONOMY);
  eq(m.map((r) => [r.tray.tray_number, r.subGroupLabel, r.endsSubGroup]), [
    ["03", "Banana", true],
    ["04", "Vanilla", false],
    ["02", null, true],
    ["01", "Krinkle", true],
  ]);
});

test("the cut band belongs to the TYPE grouping alone", () => {
  // Grouping by tray or category bands one level; a stray sub-heading there
  // would name a run the order hasn't made.
  for (const g of ["tray", "category"] as const) {
    const m = buildMatrix(TYPE_TRAYS, TYPE_SLOTS, new Map(), g, TAXONOMY);
    eq(m.map((r) => r.subGroupLabel), [null, null, null, null], g);
    eq(m.map((r) => r.endsSubGroup), [false, false, false, false], g);
  }
});

test("an item with no cut still gets a heading rather than sliding under the last one", () => {
  const trays = [{ id: "a", tray_number: "01", band: null, sort: 1 }];
  const slots = [{ id: "s", tray_id: "a", weekday: 1, item_id: "x", par: 6 }];
  const tax = new Map([["x", { item_type: "Cake", subtype: null, finish: null }]]);
  const m = buildMatrix(trays, slots, new Map(), "type", tax);
  eq(m[0].subGroupLabel, NO_CUT);
});

/* -- duplicating a plan ---------------------------------------------------- */

test("a duplicated plan gets a name no other plan is using", () => {
  // `production_plans` has no unique constraint on the title, so this is for
  // the READER: two rows called "SUMMER 2026" in the list you pick from is the
  // problem being solved.
  eq(duplicateTitle(["SUMMER 2026"], "SUMMER 2026"), "SUMMER 2026 copy");
  eq(duplicateTitle(["SUMMER 2026", "SUMMER 2026 copy"], "SUMMER 2026"), "SUMMER 2026 copy 2");
  eq(
    duplicateTitle(["A", "A copy", "A copy 2", "A copy 3"], "A"),
    "A copy 4",
    "and it keeps counting past the ones taken"
  );
});

test("duplicateTitle ignores surrounding whitespace when checking what's taken", () => {
  // A title typed with a trailing space is the same name to a reader, so it
  // must not free up a name that looks identical in the list.
  eq(duplicateTitle(["A", "  A copy  "], "A"), "A copy 2");
});

/* -- which kitchen makes it, and who sells it ------------------------------ */
//
// Since migration 101 a plan's kitchen is PER WEEKDAY — Mark's case is one menu
// baked at DF01 on Mon–Wed and at DF02 on Thu–Sun, which used to need two plans
// and therefore two copies of every tray. Slot 0 is Monday.
//
// The subscript is the thing to get right: off by one, a whole shop's week of
// kitchens shifts by a day and nothing says so.

/** DF01 Mon–Wed, DF02 (as a null, i.e. the selling shop) Thu–Sun. */
const SPLIT_WEEK = [DF01, DF01, DF01, null, null, null, null];

test("planKitchenFor reads the slot for that ISO weekday", () => {
  const p = plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK });
  eq(planKitchenFor(p, 1), DF01, "Monday");
  eq(planKitchenFor(p, 3), DF01, "Wednesday");
  eq(planKitchenFor(p, 4), DF02, "Thursday");
  eq(planKitchenFor(p, 7), DF02, "Sunday");
});

test("planKitchenFor is ONE-BASED on the ISO weekday and zero-based in the array", () => {
  // The off-by-one, pinned on its own: a strip naming DF01 on Monday alone must
  // answer DF01 for weekday 1 and the selling shop for weekday 2.
  const p = plan({ location_id: DF02, kitchen_by_weekday: [DF01, null, null, null, null, null, null] });
  eq(planKitchenFor(p, 1), DF01);
  eq(planKitchenFor(p, 2), DF02);
});

test("planKitchenFor falls back to the selling shop on a null slot", () => {
  // Decision 9's reading of a null, moved from per-plan to per-day by 101.
  // Without it the day matches NO kitchen and vanishes from every list.
  eq(planKitchenFor(plan({ location_id: DF02, kitchen_by_weekday: null }), 4), DF02);
  eq(planKitchenFor(plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK }), 5), DF02);
});

test("planKitchens names every kitchen the week uses, first-used first", () => {
  eq(planKitchens(plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK })), [DF01, DF02]);
});

test("planKitchens is one entry on a week baked in one place", () => {
  // A list column that read "DF02 DF02 DF02 …" would say nothing; the point of
  // the column is which days leave the building.
  eq(planKitchens(plan({ location_id: DF02, kitchen_by_weekday: null })), [DF02]);
  eq(planKitchens(plan({ location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF02) })), [DF02]);
});

test("defaultKitchenStrip is seven copies of the selling shop", () => {
  // Written EXPLICITLY on create rather than left null, so `kitchen_assumed`
  // keeps meaning "nobody said" instead of firing on every ordinary day.
  eq(defaultKitchenStrip(DF02).length, 7);
  ok(defaultKitchenStrip(DF02).every((k) => k === DF02), "every slot is the shop");
});

test("sellingShopsForKitchen finds the shop a kitchen bakes for", () => {
  const plans = [
    plan({ id: "a", location_id: DF01, kitchen_by_weekday: defaultKitchenStrip(DF01) }),
    plan({ id: "b", location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF01) }),
    plan({ id: "c", location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF02) }),
  ];
  const range = { starts_on: "2026-10-05", ends_on: "2026-10-05" }; // a Monday
  // DF01's kitchen sells through BOTH shops — decision 9's whole case.
  eq(sellingShopsForKitchen(plans, DF01, range).sort(), [DF01, DF02]);
  eq(sellingShopsForKitchen(plans, DF02, range), [DF02]);
});

test("sellingShopsForKitchen asks the kitchen of each DATE in the window", () => {
  // The bug this function shipped with in 2026-08-28 and could not have fixed,
  // the answer not existing until 101: a plan baked at DF01 on Mon–Wed must not
  // offer its shop for a Thursday run.
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK })];
  const mon = { starts_on: "2026-10-05", ends_on: "2026-10-05" };
  const thu = { starts_on: "2026-10-08", ends_on: "2026-10-08" };
  eq(sellingShopsForKitchen(plans, DF01, mon), [DF02], "Monday is DF01's");
  eq(sellingShopsForKitchen(plans, DF01, thu), [], "Thursday is not");
  eq(sellingShopsForKitchen(plans, DF02, thu), [DF02], "Thursday is DF02's own");
  eq(sellingShopsForKitchen(plans, DF02, mon), [], "Monday is not");
});

test("sellingShopsForKitchen takes a window that spans both halves of the split", () => {
  // A week-long run reaches every weekday, so BOTH kitchens are offered the
  // shop — which is right: generating either writes the days that are theirs.
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK })];
  const week = { starts_on: "2026-10-05", ends_on: "2026-10-11" };
  eq(sellingShopsForKitchen(plans, DF01, week), [DF02]);
  eq(sellingShopsForKitchen(plans, DF02, week), [DF02]);
});

test("sellingShopsForKitchen counts a null-kitchen plan as its own shop", () => {
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: null })];
  const range = { starts_on: "2026-10-05", ends_on: "2026-10-05" };
  eq(sellingShopsForKitchen(plans, DF02, range), [DF02]);
  eq(sellingShopsForKitchen(plans, DF01, range), []);
});

test("sellingShopsForKitchen ignores inactive plans", () => {
  // Generation reads the ACTIVE plans, so a retired one would offer a shop
  // that then generates nothing and reports an empty run.
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF01), is_active: false })];
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-10-05", ends_on: "2026-10-05" }), []);
});

test("sellingShopsForKitchen ignores a plan whose dates miss the window", () => {
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF01) })]; // October
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-11-01", ends_on: "2026-11-03" }), []);
  // Touching at one end is enough — a run that reaches the plan's first day
  // legitimately generates it.
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-09-28", ends_on: "2026-10-01" }), [DF02]);
});

test("sellingShopsForKitchen ignores the days a plan does not cover", () => {
  // A window overlapping the plan's range is not enough: the DATE has to be
  // inside it too, or a run reaching a plan's last Monday would offer its shop
  // on the strength of a Thursday the plan has already ended before.
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: SPLIT_WEEK, ends_on: "2026-10-07" })];
  // 10-05..10-11 overlaps, but every DF02 day (Thu–Sun) is past ends_on.
  eq(sellingShopsForKitchen(plans, DF02, { starts_on: "2026-10-05", ends_on: "2026-10-11" }), []);
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-10-05", ends_on: "2026-10-11" }), [DF02]);
});

test("sellingShopsForKitchen returns each shop once however many plans it has", () => {
  const plans = [
    plan({ id: "a", location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF01) }),
    plan({ id: "b", location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF01), title: "October B" }),
  ];
  // Overlapping plans are the FEATURE (their pars sum), so two of them must
  // not offer the same shop twice or `p_location_ids` generates it twice.
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-10-05", ends_on: "2026-10-05" }), [DF02]);
});

test("sellingShopsForKitchen is empty when no plan reaches the kitchen", () => {
  const plans = [plan({ location_id: DF02, kitchen_by_weekday: defaultKitchenStrip(DF02) })];
  eq(sellingShopsForKitchen(plans, DF01, { starts_on: "2026-10-05", ends_on: "2026-10-05" }), []);
});

/* -- current --------------------------------------------------------------- */

test("a plan is current when it is active and covers today", () => {
  ok(isCurrentPlan(plan(), "2026-10-15"));
  ok(isCurrentPlan(plan(), "2026-10-01"));
  ok(isCurrentPlan(plan(), "2026-10-31"));
});

test("a plan out of season is not current", () => {
  // Next month's plan and last spring's both sit in the list looking active;
  // this is the half nothing on the screen used to answer.
  no(isCurrentPlan(plan(), "2026-09-30"));
  no(isCurrentPlan(plan(), "2026-11-01"));
});

test("an inactive plan is never current, even in season", () => {
  // Generation reads the ACTIVE plans, so a retired one makes nothing today
  // however its dates read.
  no(isCurrentPlan(plan({ is_active: false }), "2026-10-15"));
});

test("an open-ended plan is current from its first day on", () => {
  const p = plan({ ends_on: null });
  no(isCurrentPlan(p, "2026-09-30"));
  ok(isCurrentPlan(p, "2026-10-01"));
  ok(isCurrentPlan(p, "2099-01-01"));
});
