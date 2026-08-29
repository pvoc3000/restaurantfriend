import { test, eq, ok, no } from "./harness";
import {
  pagesForShift,
  pageBanner,
  submitReadiness,
  attentionReason,
  missingNights,
  supervisorBody,
  managementBody,
  wrapEmail,
  ratingsSection,
  salesLine,
  emailSubject,
  type ReadinessInput,
  type EmailReport,
} from "../../src/lib/shiftReports";

// ---------------------------------------------------------------------------
// pagesForShift — the mirror rule
// ---------------------------------------------------------------------------

test("closing gets seven pages, opening five, mid and off-site four", () => {
  eq(pagesForShift("closing").length, 7, "closing");
  eq(pagesForShift("opening").length, 5, "opening");
  eq(pagesForShift("mid").length, 4, "mid");
  eq(pagesForShift("off_site").length, 4, "off_site");
});

test("PREMADES AND ELEMENTS ARE MIRRORS — never both, never neither by accident", () => {
  for (const shift of ["closing", "opening", "mid", "off_site"] as const) {
    const pages = pagesForShift(shift);
    const both = pages.includes("premades") && pages.includes("elements");
    no(both, `${shift} must not carry both production pages`);
  }
  ok(pagesForShift("closing").includes("premades"), "the closer counts leftovers");
  no(pagesForShift("closing").includes("elements"), "the closer did not do the bake");
  ok(pagesForShift("opening").includes("elements"), "the opener reports the bake");
  no(pagesForShift("opening").includes("premades"), "nothing is left over at 6am");
});

test("every shift gets the four that are always there", () => {
  for (const shift of ["closing", "opening", "mid", "off_site"] as const) {
    const pages = pagesForShift(shift);
    for (const must of ["info", "ratings", "report", "submit"] as const) {
      ok(pages.includes(must), `${shift} is missing ${must}`);
    }
  }
});

test("only closing carries sales and tomorrow's paper", () => {
  for (const shift of ["opening", "mid", "off_site"] as const) {
    no(pagesForShift(shift).includes("sales"), `${shift} sales`);
    no(pagesForShift(shift).includes("tomorrow"), `${shift} tomorrow`);
  }
});

test("pagesForShift returns a COPY — a caller sorting it cannot corrupt the next", () => {
  const first = pagesForShift("closing");
  first.length = 0;
  eq(pagesForShift("closing").length, 7, "second call");
});

test("the banner numbers what it was given", () => {
  const pages = pagesForShift("opening");
  eq(pageBanner(pages[2], 2, pages.length), "Shift report — page 3 of 5 — Elements made");
});

// ---------------------------------------------------------------------------
// submitReadiness — names what is unresolved, lets you through
// ---------------------------------------------------------------------------

const READY: ReadinessInput = {
  shift: "closing",
  narrative: "Busy but steady.",
  ratingCount: 3,
  taskRatingsDone: true,
  taskSpecialOrdersDone: true,
  taskSchedulesDone: true,
  netSalesCents: 133307,
  countedLines: 12,
  scheduledLines: 12,
  countedBatches: 0,
  scheduledBatches: 0,
};

test("a finished closing report has nothing outstanding", () => {
  eq(submitReadiness(READY), []);
});

test("an empty narrative is named", () => {
  const out = submitReadiness({ ...READY, narrative: "   " });
  eq(out.length, 1);
  ok(out[0].includes("empty"), out[0]);
});

test("uncounted premade lines are named, with the count", () => {
  const out = submitReadiness({ ...READY, countedLines: 9 });
  eq(out.length, 1);
  ok(out[0].includes("3 of 12"), out[0]);
});

test("one uncounted line reads singular", () => {
  const out = submitReadiness({ ...READY, countedLines: 11 });
  ok(out[0].includes("1 of 12 premade line has"), out[0]);
});

test("unprinted paper is two separate caveats, because they are two documents", () => {
  const out = submitReadiness({
    ...READY,
    taskSpecialOrdersDone: false,
    taskSchedulesDone: false,
  });
  eq(out.length, 2);
  ok(out.some((c) => c.includes("special orders")), "special orders named");
  ok(out.some((c) => c.includes("production logs")), "production logs named");
});

test("READINESS IS SHIFT-DEPENDENT: an opening report is complete with no paper printed", () => {
  const opening = submitReadiness({
    ...READY,
    shift: "opening",
    taskSpecialOrdersDone: false,
    taskSchedulesDone: false,
    countedLines: 0,
    scheduledLines: 12, // a schedule exists, but this shift does not count it
    countedBatches: 4,
    scheduledBatches: 4,
  });
  eq(opening, [], "an opening report must not be asked about the closer's work");
});

test("an opening report IS asked about its batches", () => {
  const out = submitReadiness({
    ...READY,
    shift: "opening",
    taskSpecialOrdersDone: false,
    taskSchedulesDone: false,
    scheduledLines: 0,
    countedLines: 0,
    countedBatches: 1,
    scheduledBatches: 4,
  });
  eq(out.length, 1);
  ok(out[0].includes("3 of 4"), out[0]);
});

test("a mid shift is asked about neither", () => {
  eq(
    submitReadiness({
      ...READY,
      shift: "mid",
      taskSpecialOrdersDone: false,
      taskSchedulesDone: false,
      countedLines: 0,
      scheduledLines: 12,
      countedBatches: 0,
      scheduledBatches: 4,
    }),
    []
  );
});

test("no sales figure is NEVER a caveat — Square types it, there is no act to complete", () => {
  eq(submitReadiness({ ...READY, netSalesCents: null }), []);
});

test("unrated staff are named whether or not anybody was rated", () => {
  ok(
    submitReadiness({ ...READY, taskRatingsDone: false, ratingCount: 0 })[0].includes(
      "No staff have been rated"
    )
  );
  ok(
    submitReadiness({ ...READY, taskRatingsDone: false, ratingCount: 1 })[0].includes(
      "1 person has"
    )
  );
});

// ---------------------------------------------------------------------------
// attentionReason
// ---------------------------------------------------------------------------

test("a sent-and-emailed report is quiet", () => {
  eq(
    attentionReason({
      status: "sent",
      reportDate: "2026-08-27",
      emailedAt: "2026-08-27T21:00:00Z",
      updatedAt: "2026-08-27T21:00:00Z",
      today: "2026-08-28",
    }),
    null
  );
});

test("SENT BUT NOT EMAILED is the hole this tier exists to close", () => {
  eq(
    attentionReason({
      status: "sent",
      reportDate: "2026-08-27",
      emailedAt: null,
      updatedAt: "2026-08-27T21:00:00Z",
      today: "2026-08-28",
    }),
    "Sent, but not emailed"
  );
});

test("today's draft is quiet — a report legitimately stays open across a shift", () => {
  eq(
    attentionReason({
      status: "draft",
      reportDate: "2026-08-28",
      emailedAt: null,
      updatedAt: "2026-08-28T20:00:00Z",
      today: "2026-08-28",
    }),
    null
  );
});

test("yesterday's draft is somebody who walked away", () => {
  eq(
    attentionReason({
      status: "draft",
      reportDate: "2026-08-27",
      emailedAt: null,
      updatedAt: "2026-08-27T21:00:00Z",
      today: "2026-08-28",
    }),
    "Still a draft"
  );
});

// ---------------------------------------------------------------------------
// missingNights — a night nobody reported
// ---------------------------------------------------------------------------

const WEEK = [
  { date: "2026-08-24", isoWeekday: 1 },
  { date: "2026-08-25", isoWeekday: 2 },
  { date: "2026-08-26", isoWeekday: 3 },
  { date: "2026-08-27", isoWeekday: 4 },
];

test("a night the shop was open and nobody reported is named", () => {
  eq(
    missingNights({ reportDates: ["2026-08-24", "2026-08-26", "2026-08-27"], openDays: [1, 2, 3, 4], days: WEEK }),
    ["2026-08-25"]
  );
});

test("a night the shop was CLOSED is not a gap", () => {
  eq(
    missingNights({ reportDates: ["2026-08-24", "2026-08-26", "2026-08-27"], openDays: [1, 3, 4], days: WEEK }),
    []
  );
});

test("a full week reports nothing", () => {
  eq(
    missingNights({
      reportDates: ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
      openDays: [1, 2, 3, 4],
      days: WEEK,
    }),
    []
  );
});

// ---------------------------------------------------------------------------
// THE PRIVACY BOUNDARY — the most important assertion in this file
// ---------------------------------------------------------------------------

const REPORT: EmailReport = {
  orgName: "Donut Friend",
  locationCode: "DF02",
  locationName: "Donut Friend 02 DTLA",
  reportDate: "2026-08-27",
  shift: "closing",
  supervisorName: "Karina Morales",
  narrative: "Footwork today was pretty steady.",
  netSalesCents: 133307,
  tipsCents: 7801,
  salesAreProvisional: true,
  lastWeekNetCents: 181519,
  lastYearNetCents: 171399,
  premades: [{ name: "Angry Samoa", par: 12, made: 12, leftover: 3 }],
  elements: [],
  ratings: [
    {
      employeeName: "Abigail Morales",
      position: "Sr. DF",
      score: 4,
      note: "Steady all night.",
      gotBreak: false,
      breakReason: "Too busy at close",
    },
  ],
};

test("THE SUPERVISOR EMAIL CONTAINS NO EMPLOYEE NAME, SCORE OR RATING NOTE", () => {
  const body = supervisorBody(REPORT);
  no(body.includes("Abigail"), "an employee name leaked into the supervisor email");
  no(body.includes("Sr. DF"), "a position leaked");
  no(body.includes("Steady all night"), "a rating note leaked");
  no(body.includes("Too busy at close"), "a break reason leaked");
  no(body.toLowerCase().includes("rating"), "the ratings heading leaked");
});

test("the management email is the supervisor one PLUS ratings, never re-derived", () => {
  const sup = supervisorBody(REPORT);
  const mgmt = managementBody(REPORT);
  ok(mgmt.startsWith(sup), "management must contain the supervisor body verbatim");
  eq(mgmt, `${sup}\n${ratingsSection(REPORT)}`);
});

test("the management email DOES carry the names, or it is the wrong email", () => {
  const body = managementBody(REPORT);
  ok(body.includes("Abigail Morales"), "the name");
  ok(body.includes("4.00"), "the score");
  ok(body.includes("Steady all night"), "the note");
  ok(body.includes("Too busy at close"), "the missed break");
});

test("both emails carry the shift facts a supervisor needs", () => {
  for (const body of [supervisorBody(REPORT), managementBody(REPORT)]) {
    ok(body.includes("DF02"), "the shop");
    ok(body.includes("Footwork today"), "the narrative");
    ok(body.includes("Angry Samoa"), "the premades");
    ok(body.includes("$1,333.07"), "net sales");
  }
});

test("a report with no ratings produces an EMPTY section, not an empty table", () => {
  const bare = { ...REPORT, ratings: [] };
  eq(ratingsSection(bare), "");
  eq(managementBody(bare), `${supervisorBody(bare)}\n`);
});

test("HTML is escaped — a narrative is somebody's free text", () => {
  const nasty = { ...REPORT, narrative: 'Ran out of <script>alert("x")</script> glaze' };
  const body = supervisorBody(nasty);
  no(body.includes("<script>"), "a script tag survived into the email");
  ok(body.includes("&lt;script&gt;"), "it should be escaped, not stripped");
});

// ---------------------------------------------------------------------------
// salesLine — a provisional figure must never read as settled
// ---------------------------------------------------------------------------

test("a provisional figure SAYS SO", () => {
  ok(salesLine(REPORT).includes("provisional"), salesLine(REPORT));
});

test("a settled figure does not", () => {
  const settled = salesLine({ ...REPORT, salesAreProvisional: false });
  no(settled.includes("provisional"), settled);
  ok(settled.includes("$1,333.07"), settled);
});

test("no figure at all says what happened, and quotes nothing", () => {
  const none = salesLine({ ...REPORT, netSalesCents: null });
  ok(none.includes("has not reported"), none);
  no(none.includes("$"), "an absent day must not print a dollar sign");
});

test("the comparison is a percentage of the BASIS, and a zero basis is silent", () => {
  ok(salesLine(REPORT).includes("-27%"), "1333.07 against 1815.19 is -27%");
  no(salesLine({ ...REPORT, lastWeekNetCents: 0 }).includes("Last week"), "divide by zero");
  no(salesLine({ ...REPORT, lastYearNetCents: null }).includes("Last year"), "no basis");
});

test("NO STYLE VALUE CONTAINS A DOUBLE QUOTE — it would end the attribute", () => {
  // Found by rendering, not by review: `style="font-family:…,"Segoe UI",…"`
  // terminates at the quote before Segoe, so the whole declaration is dropped
  // and the email arrives in the client's default serif looking unstyled.
  // Every emitted `style="…"` is checked here rather than the one that bit.
  const html = wrapEmail(managementBody(REPORT));
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    no(m[1].includes('"'), `a style value contains a double quote: ${m[1]}`);
  }
  // And the attribute really did survive intact.
  ok(html.includes("sans-serif"), "the font stack was truncated");
  ok(/<div style="font-family:[^"]*sans-serif;/.test(html), "the wrapper style is malformed");
});

test("wrapEmail wraps and does not disturb the split", () => {
  const sup = wrapEmail(supervisorBody(REPORT));
  no(sup.includes("Abigail"), "the wrapper must not change what is in the body");
  ok(sup.startsWith("<div style="), "wrapped");
  ok(sup.endsWith("</div>"), "closed");
});

test("the subject names the shop, the shift and the day", () => {
  eq(emailSubject(REPORT), "DF02 closing shift report — 2026-08-27");
});

// ---------------------------------------------------------------------------
// The counting page reads down the printed sheet
// ---------------------------------------------------------------------------

import { compareForPremadeSheet } from "../../src/lib/productionSchedule";

const row = (item_type: string | null, size: string | null, subtype: string | null, item_name: string) =>
  ({ item_type, size, subtype, item_name });

test("premade order is type, then size, then subtype, then name", () => {
  const shuffled = [
    row("Raised", "Regular", "Bar", "Bar - Maple"),
    row("Cake", "Regular", "Vanilla", "Angry Samoa"),
    row("Raised", "Mini", "Promise Ring", "Promise Ring - Choc"),
    row("Cake", "Regular", "Banana", "Bananaversary"),
    row("Raised", "Regular", "Bar", "Band of Hostess"),
  ];
  eq(
    [...shuffled].sort(compareForPremadeSheet).map((r) => r.item_name),
    [
      "Bananaversary",          // Cake / Regular / Banana
      "Angry Samoa",            // Cake / Regular / Vanilla
      "Promise Ring - Choc",    // Raised / Mini
      "Band of Hostess",        // Raised / Regular / Bar — by name within
      "Bar - Maple",
    ]
  );
});

test("it is case- and number-aware, like every other sort in the app", () => {
  eq(compareForPremadeSheet(row("cake", null, null, "a"), row("Cake", null, null, "a")), 0);
  ok(
    compareForPremadeSheet(row("A", null, null, "Item 2"), row("A", null, null, "Item 10")) < 0,
    "Item 2 sorts before Item 10, not after"
  );
});

test("a null type, size or subtype does not throw and sorts consistently", () => {
  const rows = [row(null, null, null, "z"), row("Cake", null, null, "a"), row(null, null, null, "a")];
  const sorted = [...rows].sort(compareForPremadeSheet).map((r) => r.item_name);
  eq(sorted.length, 3);
  // Whatever the nulls do, they must do it deterministically — sorting twice
  // is the property that matters when two surfaces share the comparator.
  eq([...rows].sort(compareForPremadeSheet).map((r) => r.item_name), sorted);
});
