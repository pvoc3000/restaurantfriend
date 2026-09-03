import { test, eq, ok, no } from "./harness";
import {
  pagesForShift,
  pageBanner,
  submitReadiness,
  submitBlockers,
  attentionReason,
  missingNights,
  supervisorBody,
  managementBody,
  wrapEmail,
  ratingsSection,
  salesLine,
  emailSubject,
  checklistSection,
  type ReadinessInput,
  type EmailReport,
} from "../../src/lib/shiftReports";

// ---------------------------------------------------------------------------
// pagesForShift — the mirror rule
// ---------------------------------------------------------------------------

test("closing gets eight pages, opening six, mid and off-site five", () => {
  // Each gained ONE when the checklist page landed (2026-08-29): every shift
  // can be asked for a walk, including a mid.
  eq(pagesForShift("closing").length, 8, "closing");
  eq(pagesForShift("opening").length, 6, "opening");
  eq(pagesForShift("mid").length, 5, "mid");
  eq(pagesForShift("off_site").length, 5, "off_site");
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

test("every shift gets the five that are always there", () => {
  for (const shift of ["closing", "opening", "mid", "off_site"] as const) {
    const pages = pagesForShift(shift);
    // FIVE now: every shift can be asked for a checklist, including a mid.
    for (const must of ["info", "ratings", "checklist", "report", "submit"] as const) {
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
  eq(pagesForShift("closing").length, 8, "second call");
});

test("the banner numbers what it was given", () => {
  const pages = pagesForShift("opening");
  eq(pageBanner(pages[2], 2, pages.length), "Shift report — page 3 of 6 — Elements made");
});

// ---------------------------------------------------------------------------
// submitBlockers — what tomorrow cannot answer, so the send waits
// submitReadiness — what tomorrow CAN, so it only gets named
// ---------------------------------------------------------------------------

const READY: ReadinessInput = {
  shift: "closing",
  narrative: "Busy but steady.",
  ratingCount: 3,
  breaks: { missingTime: 0, missingReason: 0 },
  taskSpecialOrdersDone: true,
  taskSchedulesDone: true,
  netSalesCents: 133307,
  countedLines: 12,
  scheduledLines: 12,
  countedBatches: 0,
  scheduledBatches: 0,
  checklist: { outstanding: 0, total: 14, finished: true },
  checklistNotStarted: false,
};

test("a finished closing report has nothing outstanding and nothing blocking", () => {
  eq(submitReadiness(READY), []);
  eq(submitBlockers(READY), []);
});

test("THE PERISHABLE THINGS BLOCK; only the recoverable ones are advisory", () => {
  // Mark, 2026-09-02, correcting the line this function shipped with: "an
  // uncounted premade line cannot be counted tomorrow. The checklist can't be
  // completed tomorrow either." Right — last night's leftovers are gone by
  // morning and nobody can say at 9am what the walk-in read at close.
  //
  // So each of these BLOCKS, and none of them is a caveat any more.
  const cases: [Partial<ReadinessInput>, string][] = [
    [{ narrative: "  " }, "The shift report itself is empty."],
    [{ ratingCount: 0 }, "No employees have been added."],
    [{ countedLines: 5, scheduledLines: 32 }, "27 of 32 premade lines have no count."],
    [{ checklistNotStarted: true, checklist: null }, "The checklist for this shift has not been started."],
    [
      { checklist: { outstanding: 64, total: 67, finished: false } },
      "64 of 67 checklist items have not been looked at.",
    ],
  ];
  for (const [patch, sentence] of cases) {
    const input = { ...READY, ...patch };
    ok(submitBlockers(input).includes(sentence), `blocked: ${sentence}`);
    no(submitReadiness(input).includes(sentence), `and NOT merely advisory: ${sentence}`);
  }
});

test("printing is the exception — paper can come out of a printer tomorrow", () => {
  // The two ACTIONS, as against observations. Late is a real problem; gone is a
  // different one, and only the second earns a gate.
  const unprinted = { ...READY, taskSpecialOrdersDone: false, taskSchedulesDone: false };
  eq(submitReadiness(unprinted), [
    "Tomorrow's special orders have not been printed.",
    "Tomorrow's production logs have not been printed.",
  ]);
  eq(submitBlockers(unprinted), []);
});

test("a shift that is not asked for a page is not blocked on it", () => {
  // An opening report has no premades page, so 32 uncounted lines it never sees
  // must not stop it — the same `pagesForShift` guard the advisory list uses.
  const opening = {
    ...READY,
    shift: "opening" as const,
    countedLines: 0,
    scheduledLines: 32,
  };
  no(submitBlockers(opening).some((b) => b.includes("premade")), "premades on an opening report");
});

test("an empty narrative is named", () => {
  const out = submitBlockers({ ...READY, narrative: "   " });
  eq(out.length, 1);
  ok(out[0].includes("empty"), out[0]);
});

test("uncounted premade lines are named, with the count", () => {
  const out = submitBlockers({ ...READY, countedLines: 9 });
  eq(out.length, 1);
  ok(out[0].includes("3 of 12"), out[0]);
});

test("one uncounted line reads singular", () => {
  const out = submitBlockers({ ...READY, countedLines: 11 });
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
  const out = submitBlockers({
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

test("an EMPTY employee list is named; a filled one is not nagged about", () => {
  // Mark, 2026-09-01, removing the "I've rated everybody" checkbox: "we aren't
  // making sure the user is filling out the report completely". So the caveat
  // is derived from the rows and fires only on the one state that IS
  // observable — nobody added at all. One rated person is not incomplete, it is
  // a shift with one person on it.
  eq(submitBlockers({ ...READY, ratingCount: 0 }), ["No employees have been added."]);
  eq(submitBlockers({ ...READY, ratingCount: 1 }), []);
});

test("THE BREAK ANSWERS BLOCK — they are not a caveat you can send past", () => {
  // Mark, 2026-09-02: "In FMP we wouldn't allow the report to be submitted if
  // any employees were missing break times or a reason for missing a break."
  // The distinction from everything in `submitReadiness` is who else could ever
  // supply it — see `submitBlockers`.
  const missing = { ...READY, breaks: { missingTime: 0, missingReason: 1 } };
  eq(submitBlockers(missing), ["1 employee has no break, and no reason why."]);
  // And it stays OUT of the advisory list, or it would read as optional in one
  // place and required in the other.
  eq(submitReadiness(missing), []);
});

test("a break with no time blocks too, and both count in the plural", () => {
  eq(submitBlockers({ ...READY, breaks: { missingTime: 1, missingReason: 0 } }), [
    "1 employee has a break with no time recorded.",
  ]);
  const both = submitBlockers({ ...READY, breaks: { missingTime: 3, missingReason: 2 } });
  eq(both, [
    "2 employees have no break, and no reason why.",
    "3 employees have a break with no time recorded.",
  ]);
});

test("a finished report blocks on nothing", () => {
  eq(submitBlockers(READY), []);
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
  premades: [
    { name: "Angry Samoa", par: 12, made: 12, leftover: 3, note: "Dropped a tray, re-fried" },
  ],
  elements: [],
  // A realistic outstanding list, ON THE SHARED REPORT for the same reason the
  // checklist is: the privacy sweep, the composition identity and the style
  // sweep below then cover this markup too, without any of the three being
  // edited. It is counts only — no names, no scores — which is exactly why it
  // is allowed to live in `supervisorBody`.
  outstanding: [
    "No staff have been rated.",
    "2 of 14 premade lines have no count.",
  ],
  // A realistic checklist ON THE SHARED REPORT, deliberately: it is what makes
  // the privacy sweep, the composition identity and the style sweep below
  // cover the new markup without any of those three being edited.
  checklist: {
    kind: "checklist",
    title: "DF02 Closing",
    finished: true,
    items: [
      {
        status: "done",
        prompt: "Lobby swept",
        sectionName: "FOH",
        equipmentName: null,
        note: null,
        valueNumber: null,
        unit: null,
        minValue: null,
        maxValue: null,
      },
      {
        status: "issue",
        prompt: "Fridge temperature",
        sectionName: "Kitchen",
        equipmentName: "Walk-in #2",
        note: "Compressor icing again",
        valueNumber: 46,
        unit: "°F",
        minValue: 34,
        maxValue: 40,
      },
      {
        status: "na",
        prompt: "Patio tables wiped",
        sectionName: "FOH",
        equipmentName: null,
        note: "Patio closed for the night",
        valueNumber: null,
        unit: null,
        minValue: null,
        maxValue: null,
      },
    ],
  },
  checklistNotStarted: false,
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
    // A SECOND, INDEPENDENT GUARD ON PLACEMENT: move the checklist section into
    // `managementBody` and the supervisor iteration of this loop fails.
    ok(body.includes("Compressor icing again"), "the flagged issue");
    ok(body.includes("expected 34–40 °F"), "the bound it missed");
  }
});

test("the supervisor's note on a count reaches the email", () => {
  // Migration 081. "18 made, 0 left" and the same with "dropped a tray,
  // re-fried" are different nights, and the second is the one worth an email.
  // NB this is the count's note, never `production_schedule_items.note` — that
  // one is an instruction the kitchen already worked from, and 081's header is
  // where the distinction is written down.
  for (const body of [supervisorBody(REPORT), managementBody(REPORT)]) {
    ok(body.includes("Dropped a tray, re-fried"), "the note reached the email");
  }
});

test("WHAT WAS OUTSTANDING TRAVELS — both emails carry it", () => {
  // Mark, 2026-09-01: "what's the logic of allowing a supervisor to submit a
  // report when it's clearly incomplete?" The permissiveness is deliberate —
  // gating the send does not produce a complete report, it produces no report —
  // and it is only safe if the incompleteness reaches somebody. It did not:
  // `submitReadiness` had one caller, the screen. This is that hole closed.
  for (const body of [supervisorBody(REPORT), managementBody(REPORT)]) {
    ok(body.includes("Still outstanding"), "the heading");
    ok(body.includes("No staff have been rated."), "the first item");
    ok(body.includes("2 of 14 premade lines have no count."), "the second");
  }
});

test("a clean night says NOTHING about outstanding", () => {
  // The section is absent, not an empty list — a heading over nothing reads as
  // a thing that failed to load, and on a night where everything was done the
  // report should simply not raise the subject.
  const clean = { ...REPORT, outstanding: [] };
  no(supervisorBody(clean).includes("Still outstanding"), "heading on a clean night");
});

test("the outstanding list is COUNTS, so it may live in the supervisor email", () => {
  // The privacy sweep above is what actually enforces this, and it passes only
  // because `submitReadiness` never has a name to leak — every caveat it builds
  // is a count or a fact about the report. Stated here so that a future caveat
  // written with somebody's name in it fails a test that says why.
  const body = supervisorBody(REPORT);
  for (const line of REPORT.outstanding) {
    ok(body.includes(line), `the caveat "${line}" reached the supervisor email`);
    no(/[A-Z][a-z]+ [A-Z][a-z]+/.test(line.replace(/^\d+ of \d+ /, "")), `"${line}" looks like it names a person`);
  }
});

test("a report with no ratings produces an EMPTY section, not an empty table", () => {
  const bare = { ...REPORT, ratings: [] };
  eq(ratingsSection(bare), "");
  eq(managementBody(bare), `${supervisorBody(bare)}\n`);
});

// ---------------------------------------------------------------------------
// THE CHECKLIST SECTION — the reason the facility-checks module exists
// ---------------------------------------------------------------------------
// Mark, 2026-08-29: "anything flagged as an issue on a checklist would be
// included in the report that gets emailed". Every test here is asserted
// against the PRODUCED STRING rather than an object shape — `gustoExport`'s
// sick-hours discipline, because a shape assertion lets a rename pass while the
// thing quietly comes back or quietly goes away.

test("A FLAGGED ISSUE REACHES BOTH EMAILS, WORD FOR WORD", () => {
  for (const body of [supervisorBody(REPORT), managementBody(REPORT)]) {
    ok(body.includes("Compressor icing again"), "the note the supervisor typed");
    ok(body.includes("Fridge temperature"), "the prompt");
    ok(body.includes("Walk-in #2"), "the equipment it is about");
    ok(body.includes("Kitchen"), "the section it is in");
  }
});

test("AN OUT-OF-RANGE READING PRINTS THE NUMBER AND THE BOUND", () => {
  // "out of range" tells you nothing; 46 against 34–40 tells you how far off.
  const body = supervisorBody(REPORT);
  ok(body.includes("46 °F"), body);
  ok(body.includes("expected 34–40 °F"), "the bound, from readingLabel itself");
});

test("N/A IS NOT AN ISSUE — and is not silently swallowed either", () => {
  const body = supervisorBody(REPORT);
  no(body.includes("Patio closed for the night"), "an n/a note was listed as a finding");
  no(body.includes("Patio tables wiped"), "an n/a item was listed as a finding");
  ok(body.includes("1 not applicable"), "an n/a must still be counted out loud");
  ok(body.includes("3 of 3 checked"), body);
});

test("A CLEAN CHECKLIST SAYS SO — SILENCE IS NOT AN ALL-CLEAR", () => {
  // If the section vanished on a clean night, a reader could not tell CLEAN
  // from NOBODY WALKED from THE FEATURE BROKE.
  const clean: EmailReport = {
    ...REPORT,
    checklist: {
      ...REPORT.checklist!,
      items: REPORT.checklist!.items.filter((i) => i.status === "done"),
    },
  };
  const section = checklistSection(clean);
  no(section === "", "a checklist that found nothing must still say it happened");
  ok(section.includes("Nothing was flagged."), section);
  ok(supervisorBody(clean).includes("Nothing was flagged."), "and it reaches the email");
});

test("A CHECKLIST NOBODY STARTED CAN NEVER READ AS A CLEAN ONE", () => {
  const none: EmailReport = { ...REPORT, checklist: null, checklistNotStarted: true };
  const section = checklistSection(none);
  ok(section.includes("was not started"), section);
  no(section.includes("Nothing was flagged"), "not started must never read as all-clear");
});

test("A SHOP WITH NO CHECKLIST AT ALL IS SILENT", () => {
  // The common case for a shop that has not written a master list. Its email
  // must be byte-identical to the one it got before this feature existed.
  const none: EmailReport = { ...REPORT, checklist: null, checklistNotStarted: false };
  eq(checklistSection(none), "");
  no(supervisorBody(none).toLowerCase().includes("checklist"), "it nags");
});

test("THE EMAIL AND THE SUBMIT PAGE AGREE ABOUT 'NOT STARTED'", () => {
  // One question, two surfaces. If either condition drifts this fails, rather
  // than the screen and the email quietly disagreeing about the same night.
  for (const notStarted of [true, false]) {
    const onScreen = submitBlockers({
      ...READY,
      checklist: null,
      checklistNotStarted: notStarted,
    }).some((c) => c.includes("has not been started"));
    const inEmail = checklistSection({
      ...REPORT,
      checklist: null,
      checklistNotStarted: notStarted,
    }).includes("was not started");
    eq(onScreen, inEmail, `checklistNotStarted=${notStarted}`);
  }
});

test("AN UNFINISHED CHECKLIST SAYS SO, AND STILL REPORTS WHAT IT FOUND", () => {
  const half: EmailReport = {
    ...REPORT,
    checklist: { ...REPORT.checklist!, finished: false },
  };
  const body = supervisorBody(half);
  ok(body.includes("was not finished"), body);
  ok(body.includes("Compressor icing again"), "a partial walk's findings are still findings");
});

test("AN EMPTY RUN DOES NOT CLAIM A CLEAN ONE", () => {
  // Every item narrowed out by weekday. 0 of 0 is not an all-clear.
  const empty: EmailReport = {
    ...REPORT,
    checklist: { ...REPORT.checklist!, items: [] },
  };
  const section = checklistSection(empty);
  no(section.includes("Nothing was flagged"), "0 of 0 is not an all-clear");
  ok(section.includes("no items"), section);
});

test("A CHECKLIST NOTE IS SOMEBODY'S FREE TEXT", () => {
  const nasty: EmailReport = {
    ...REPORT,
    checklist: {
      ...REPORT.checklist!,
      items: REPORT.checklist!.items.map((i) =>
        i.status === "issue" ? { ...i, note: 'Broken <script>alert("x")</script>' } : i
      ),
    },
  };
  const body = supervisorBody(nasty);
  no(body.includes("<script>"), "a script tag survived into the email");
  ok(body.includes("&lt;script&gt;"), "escaped, not stripped");
});

test("the supervisor body carries the section VERBATIM", () => {
  ok(supervisorBody(REPORT).includes(checklistSection(REPORT)));
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

// ---------------------------------------------------------------------------
// What the premade sheet is called
// ---------------------------------------------------------------------------

import { premadeSheetTitle } from "../../src/lib/productionPacket";
import { scheduleTitle, splitScheduleTitle } from "../../src/lib/specialOrderSchedule";

test("a special order's sheet is headed SPECIAL ORDER #n, subtitled by its name", () => {
  eq(
    premadeSheetTitle({
      source: "special_order",
      title: "#9761 · Wedding 8/29/2026",
      sellsCode: "DF01",
    }),
    { heading: "SPECIAL ORDER #9761", subtitle: "Wedding 8/29/2026" }
  );
});

test("THE SPLIT IS scheduleTitle's INVERSE — pinned against the composer itself", () => {
  // If either side is ever re-spelled, this fails rather than the paper and the
  // screen quietly disagreeing about one document's name.
  for (const [number, name] of [
    ["9761", "Wedding 8/29/2026"],
    ["10015", "Cafe Knotted"],
    ["7769", "Wedding · Reception"], // a name containing the separator
  ] as const) {
    eq(splitScheduleTitle(scheduleTitle(number, name)), { number, name }, `#${number}`);
  }
});

test("an order with no name at all still heads correctly", () => {
  eq(
    premadeSheetTitle({ source: "special_order", title: scheduleTitle("9761", null), sellsCode: "DF01" }),
    { heading: "SPECIAL ORDER #9761", subtitle: null }
  );
});

test("a plan's sheet keeps the shop heading", () => {
  eq(
    premadeSheetTitle({ source: "plan", title: null, sellsCode: "DF02" }),
    { heading: "DF02 PREMADE SCHEDULE", subtitle: null }
  );
});

test("a plan that somehow has a title shows it BELOW the shop heading", () => {
  eq(
    premadeSheetTitle({ source: "plan", title: "Summer menu", sellsCode: "DF02" }),
    { heading: "DF02 PREMADE SCHEDULE", subtitle: "Summer menu" }
  );
});

test("a special order whose title is not composed falls back to the whole title", () => {
  eq(
    premadeSheetTitle({ source: "special_order", title: "Hand typed", sellsCode: "DF01" }),
    { heading: "Hand typed", subtitle: null }
  );
});

test("a special order with an empty title falls back to the shop heading", () => {
  for (const title of [null, "", "   "]) {
    eq(
      premadeSheetTitle({ source: "special_order", title, sellsCode: "DF01" }),
      { heading: "DF01 PREMADE SCHEDULE", subtitle: null },
      `title ${JSON.stringify(title)}`
    );
  }
});


// ---------------------------------------------------------------------------
// The checklist page — derived, never a `task_checklist_done` flag
// ---------------------------------------------------------------------------

test("a checklist nobody started is NAMED", () => {
  const out = submitBlockers({
    ...READY,
    checklist: null,
    checklistNotStarted: true,
  });
  eq(out, ["The checklist for this shift has not been started."]);
});

test("an unwalked checklist names how much is left", () => {
  const out = submitBlockers({
    ...READY,
    checklist: { outstanding: 6, total: 27, finished: false },
  });
  eq(out, ["6 of 27 checklist items have not been looked at."]);
});

test("one outstanding item reads in the singular", () => {
  const out = submitBlockers({
    ...READY,
    checklist: { outstanding: 1, total: 27, finished: false },
  });
  eq(out, ["1 of 27 checklist item has not been looked at."]);
});

test("answered but not finished says NOTHING — sending finishes it", () => {
  // Mark, 2026-09-01: the checklist page's Finish button is gone and sending
  // the report submits the run. So "answered but not finished" is no longer
  // outstanding work; it is the next half-second. Naming it would report as
  // unresolved a thing this very button resolves.
  //
  // Checked by BREAKING it: put the `else if (!finished)` branch back and this
  // goes red.
  const out = submitBlockers({
    ...READY,
    checklist: { outstanding: 0, total: 27, finished: false },
  });
  eq(out, []);
});

test("an unfinished checklist with work left still names the work", () => {
  // The half that survives, and the distinction that matters: how much has not
  // been LOOKED AT is a fact about the shift, where "not finished" was a fact
  // about a button.
  const out = submitBlockers({
    ...READY,
    checklist: { outstanding: 3, total: 27, finished: false },
  });
  eq(out, ["3 of 27 checklist items have not been looked at."]);
});

test("a report with NO checklist linked and none asked for says nothing", () => {
  // The common case for a shop that has not written a master list yet — the
  // page must not nag about a feature nobody is using.
  eq(submitBlockers({ ...READY, checklist: null, checklistNotStarted: false }), []);
});
