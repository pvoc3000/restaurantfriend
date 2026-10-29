// `supabase/functions/_shared/salesAutomation.ts` — the morning run's rules:
// when it runs, which days it syncs, which day a year ago it compares with,
// the fix each problem carries, and the summary email (Mark, 2026-10-29).

import { eq, no, ok, test } from "./harness";
import {
  addDays,
  emailSubject,
  emptyTally,
  percentChange,
  problem,
  renderSummaryEmail,
  runWindow,
  sameDayLastYear,
  totals,
  type RunForEmail,
} from "../../../supabase/functions/_shared/salesAutomation";

const LA = "America/Los_Angeles";
const at = (iso: string) => Date.parse(iso);

test("runWindow: pg_cron's 14:00 UTC is 7 AM Pacific in summer, and the 15:00 firing is not", () => {
  const summer = runWindow(at("2026-10-29T14:00:00Z"), LA);
  eq(summer.localDate, "2026-10-29");
  eq(summer.localHour, 7);
  ok(summer.isRunHour, "14:00 UTC runs in PDT");
  no(runWindow(at("2026-10-29T15:00:00Z"), LA).isRunHour, "15:00 UTC is 8 AM in PDT");
});

test("runWindow: in winter it is the 15:00 UTC firing that runs", () => {
  no(runWindow(at("2026-12-01T14:00:00Z"), LA).isRunHour, "14:00 UTC is 6 AM in PST");
  ok(runWindow(at("2026-12-01T15:00:00Z"), LA).isRunHour, "15:00 UTC runs in PST");
});

test("runWindow: across the November change, exactly one firing runs each day", () => {
  // DST ends 2026-11-01 at 2 AM. The 31st is PDT, the 1st and 2nd are PST.
  for (const day of ["2026-10-31", "2026-11-01", "2026-11-02", "2027-03-14", "2027-03-15"]) {
    const runs = ["14", "15"].filter((h) => runWindow(at(`${day}T${h}:00:00Z`), LA).isRunHour);
    eq(runs.length, 1, `${day}: one of the two firings`);
  }
});

test("runWindow: the last seven business days, ending yesterday", () => {
  const w = runWindow(at("2026-10-29T14:00:00Z"), LA);
  eq([w.from, w.to], ["2026-10-22", "2026-10-28"]);
  const jan = runWindow(at("2027-01-01T15:00:00Z"), LA);
  eq([jan.from, jan.to], ["2026-12-25", "2026-12-31"], "across a year");
});

test("sameDayLastYear: 52 weeks back, so a Tuesday compares with a Tuesday", () => {
  eq(sameDayLastYear("2026-10-28"), "2025-10-29");
  eq(new Date("2025-10-29T00:00:00Z").getUTCDay(), new Date("2026-10-28T00:00:00Z").getUTCDay(), "same weekday");
  eq(sameDayLastYear("2028-03-01"), "2027-03-03", "across a leap day: still the same weekday");
  eq(addDays("2026-03-08", 1), "2026-03-09", "date arithmetic ignores the clock change");
});

test("problem: an unbalanced day says it will be tried again", () => {
  const p = problem(
    "day_refused",
    "The day does not balance: debits $1,514.76 against credits $1,973.61 ($-458.85 apart). Nothing is posted until Square's figures agree with themselves — sync again, and if it persists, this day needs a look.",
    { shop: "DF01", date: "2026-10-06" }
  );
  ok(/offline payments/.test(p.fix), p.fix);
  ok(/Tomorrow morning/.test(p.fix), p.fix);
  eq(p.href, "/sales");
});

test("problem: a missing role links to the mapping grid; a missing class to Locations", () => {
  const role = problem("day_refused", "No account is set for “Tips” — Settings → Integrations → Square Sales Mapping.");
  eq(role.href, "/settings?tab=accounting&integration=square");
  const shop = problem("day_refused", "DF02 has no QuickBooks class — set it on the location's record.");
  eq(shop.href, "/locations");
});

test("problem: every kind carries a fix and a link", () => {
  for (const kind of [
    "square_sync", "qbo_connection", "bot", "missing_day", "day_refused", "day_unmapped",
    "day_failed", "deposit_refused", "deposit_failed", "not_attempted", "crash",
  ] as const) {
    const p = problem(kind, "x");
    ok(p.fix.length > 10, `${kind} fix`);
    ok(p.href, `${kind} link`);
  }
  eq(problem("deposit_refused", "This payout is negative (-$12.00) — Square took money back, which is a withdrawal to record by hand.").fix, "Record it by hand in QuickBooks.");
});

test("percentChange and totals", () => {
  eq(percentChange(110_00, 100_00), "+10.0%");
  eq(percentChange(90_00, 100_00), "-10.0%");
  eq(percentChange(100_00, null), null, "no day last year");
  eq(percentChange(100_00, 0), null, "closed last year");
  eq(
    totals([
      { shop: "DF01", netCents: 100, lastYearCents: null },
      { shop: "DF02", netCents: 50, lastYearCents: 40 },
    ]),
    { shop: "Total", netCents: 150, lastYearCents: 40 }
  );
});

function sampleRun(over: Partial<RunForEmail> = {}): RunForEmail {
  return {
    orgName: "Donut Friend",
    appUrl: "https://app.example.test/",
    dryRun: false,
    window: { from: "2026-10-22", to: "2026-10-28" },
    summary: {
      businessDate: "2026-10-28",
      lastYearDate: "2025-10-29",
      shops: [
        { shop: "DF01", netCents: 2_118_45, lastYearCents: 1_950_00 },
        { shop: "DF02", netCents: 1_294_05, lastYearCents: 1_301_10 },
      ],
      deposits: [{ shop: "DF01", arrivalDate: "2026-10-29", amountCents: 1_843_12, docNumber: "T316V42B337KEBX", state: "posted" }],
      entries: { ...emptyTally(), created: 2, skipped: 12 },
      depositTally: { ...emptyTally(), created: 1 },
      notes: [],
    },
    problems: [],
    ...over,
  };
}

test("email: a clean morning leads with the total and its change on last year", () => {
  eq(emailSubject(sampleRun()), "Sales for Wed, Oct 28: $3,412.50 (+5.0%) · all posted");
  const { html, text } = renderSummaryEmail(sampleRun());
  ok(text.includes("Total"), "a total row with two shops");
  ok(text.includes("$168.45 (+8.6%)"), "DF01's change in dollars and percent");
  ok(text.includes("-$7.05 (-0.5%)"), "DF02 down");
  ok(text.includes("T316V42B337KEBX · posted"), "the deposit and its document");
  ok(text.includes("14 journal entries: 2 created, 12 already up to date"), "what was posted");
  no(/NEEDS YOU/.test(text), "no issues block");
  ok(html.includes('href="https://app.example.test/sales"'), "one slash between host and path");
});

test("email: issues come first, each with its fix and link, and the subject counts them", () => {
  const run = sampleRun({
    problems: [
      problem("day_unmapped", "“Pumpkin Spice” (category, $84.00) posted to Uncategorized Income.", { shop: "DF01", date: "2026-10-28" }),
      problem("qbo_connection", "QuickBooks is not connected."),
    ],
  });
  eq(emailSubject(run), "Sales for Wed, Oct 28: $3,412.50 (+5.0%) · 2 issues need you");
  const { text, html } = renderSummaryEmail(run);
  ok(text.indexOf("NEEDS YOU") < text.indexOf("SALES FOR"), "issues lead");
  ok(text.includes("DF01 · Wed, Oct 28: “Pumpkin Spice”"), "names the shop and day");
  ok(html.includes("integration=square"), "links to the grid");
  ok(html.includes("&ldquo;") || html.includes("“Pumpkin"), "text is escaped, not dropped");
});

test("email: a run that stopped before the summary still sends, and a dry run says so", () => {
  const crashed = sampleRun({ summary: null, problems: [problem("crash", "boom")] });
  eq(emailSubject(crashed), "Morning sales run · 1 issue needs you");
  ok(renderSummaryEmail(crashed).text.includes("boom"));
  ok(emailSubject(sampleRun({ dryRun: true })).startsWith("[DRY RUN] "));
  ok(renderSummaryEmail(sampleRun({ dryRun: true })).text.startsWith("DRY RUN"));
  ok(renderSummaryEmail(sampleRun({ dryRun: true })).text.includes("WOULD POST TO QUICKBOOKS"), "a test counts what it would send");
  no(renderSummaryEmail(sampleRun()).text.includes("WOULD POST"), "a real run says Posted");
});

test("email: a shop with no day reads as a dash, not $0.00", () => {
  const run = sampleRun();
  run.summary!.shops = [{ shop: "DF02", netCents: null, lastYearCents: 1_301_10 }];
  const { text } = renderSummaryEmail(run);
  ok(/DF02\s+—/.test(text), text);
  no(text.includes("Total"), "no total row for one shop");
});

// ---- web/src/lib/salesRun.ts — what the Sales screen says about the run ----

import { isOverdue, isStuck, runProblems, type SalesRun } from "../../src/lib/salesRun";

test("isOverdue: only when on, past 8 AM in the org's zone, and nothing finished today", () => {
  const nine = at("2026-10-29T16:00:00Z");
  ok(isOverdue({ enabled: true, now: nine, zone: LA, lastFinishedLocalDate: "2026-10-28" }), "yesterday's run only");
  ok(isOverdue({ enabled: true, now: nine, zone: LA, lastFinishedLocalDate: null }), "never run");
  no(isOverdue({ enabled: true, now: nine, zone: LA, lastFinishedLocalDate: "2026-10-29" }), "ran today");
  no(isOverdue({ enabled: false, now: nine, zone: LA, lastFinishedLocalDate: null }), "switched off");
  no(isOverdue({ enabled: true, now: at("2026-10-29T14:30:00Z"), zone: LA, lastFinishedLocalDate: "2026-10-28" }), "7:30 is not late");
  ok(isOverdue({ enabled: true, now: at("2026-12-01T16:30:00Z"), zone: LA, lastFinishedLocalDate: "2026-11-30" }), "8:30 PST is");
});

function run(over: Partial<SalesRun> = {}): SalesRun {
  return {
    id: "r", trigger: "cron", dry_run: false, local_date: "2026-10-29",
    started_at: "2026-10-29T14:00:05Z", finished_at: "2026-10-29T14:01:10Z",
    status: "ok", problems: [], emailed_to: "mark@example.test", email_error: null, ...over,
  };
}

test("isStuck and runProblems: a run cut off, and an email that did not go, are problems too", () => {
  const later = at("2026-10-29T14:30:00Z");
  ok(isStuck(run({ status: "running", finished_at: null }), later), "half an hour running");
  no(isStuck(run({ status: "running", finished_at: null }), at("2026-10-29T14:05:00Z")), "five minutes is still running");
  eq(runProblems(run({ status: "running", finished_at: null }), later).map((p) => p.kind), ["crash"]);
  eq(runProblems(run({ email_error: "no mailbox" }), later).map((p) => p.kind), ["email"]);
  eq(runProblems(run(), later), [], "a clean run has nothing");
});

test("email: the week's chart leads, labels yesterday only, and the text carries its figures", () => {
  const run = sampleRun();
  run.summary!.week = [
    { date: "2026-10-22", netCents: 3_100_00, lastYearCents: 3_400_00 },
    { date: "2026-10-23", netCents: 4_200_00, lastYearCents: null },
    { date: "2026-10-24", netCents: null, lastYearCents: 5_000_00 },
    { date: "2026-10-25", netCents: 4_000_00, lastYearCents: 4_100_00 },
    { date: "2026-10-26", netCents: 2_900_00, lastYearCents: 3_000_00 },
    { date: "2026-10-27", netCents: 3_000_00, lastYearCents: 3_200_00 },
    { date: "2026-10-28", netCents: 3_412_50, lastYearCents: 3_251_10 },
  ];
  const { html, text } = renderSummaryEmail(run);
  ok(html.indexOf("The last 7 days") < html.indexOf("By shop"), "the chart sits above the tables");
  ok(html.includes(">$3,413<"), "yesterday's bar carries its value");
  no(html.includes(">$3,100<"), "the other days do not");
  ok(html.includes("width:14px;height:130px;background:#c0c0c0"), "last year's $5,000 sets the scale: 132px, less its 1px outline top and bottom");
  ok(html.includes("width:16px;height:111px;background:#000000"), "this week's best day, $4,200, to the same scale");
  ok(text.includes("THE LAST 7 DAYS"), "the text fallback carries the week");
  ok(/Sat, Oct 24\s+—/.test(text), "a missing day is a dash");
  ok(html.includes("background:#ffe98a") === false, "no yellow without a problem");
  ok(html.includes("Restaurant Friend"), "the wordmark");
});
