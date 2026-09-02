/**
 * The supervisor shift report — the pure half.
 *
 * Everything in here is a rule with no database and no React in it, so it can
 * be exercised by `npm run fixtures` and reused by the edge function's own
 * copy of the email bodies. The screens hold the queries; this holds the
 * decisions.
 */

import type { ShiftSlot } from "./employeeEvents";
import { SHIFT_SLOT_LABEL } from "./employeeEvents";
import {
  CHECKLIST_KIND_LABEL,
  outstandingCount,
  readingLabel,
  type CheckStatus,
  type ChecklistKind,
} from "./checklists";

export type { ShiftSlot };
export { SHIFT_SLOT_LABEL };

/**
 * The pages, in FileMaker's own order.
 *
 * `premades` and `elements` are MIRRORS and never both appear: the opening
 * supervisor records what the overnight bake produced, the closer records what
 * was left of it (Mark, 2026-08-28). Mid and off-site get neither — an
 * off-site shift has no kitchen for a batch log to be about.
 */
export type ShiftReportPage =
  | "info"
  | "ratings"
  | "sales"
  | "premades"
  | "elements"
  | "checklist"
  | "report"
  | "tomorrow"
  | "submit";

/** FMP printed these in the black band: "SHIFT REPORT — PAGE 3 OF 7 — SALES". */
export const PAGE_TITLE: Record<ShiftReportPage, string> = {
  info: "Info",
  // "Employees" rather than "Ratings" (Mark, 2026-09-01). The page is a list
  // of the people who worked the shift; rating them is one of the things you do
  // to a row, alongside the break question, and naming the page after one
  // column made the others read as extras.
  ratings: "Employees",
  sales: "Sales",
  premades: "Premades",
  elements: "Elements made",
  checklist: "Checklist",
  report: "Report",
  tomorrow: "Tomorrow's production",
  submit: "Submit",
};

const CLOSING_PAGES: ShiftReportPage[] = [
  "info",
  "ratings",
  "sales",
  "premades",
  "checklist",
  "report",
  "tomorrow",
  "submit",
];

const OPENING_PAGES: ShiftReportPage[] = [
  "info",
  "ratings",
  "elements",
  "checklist",
  "report",
  "submit",
];

/** Mid and off-site: no kitchen, no till to close. */
const SHORT_PAGES: ShiftReportPage[] = [
  "info",
  "ratings",
  "checklist",
  "report",
  "submit",
];

/**
 * Which pages this shift gets. The runner numbers whatever it is given, so an
 * opening report reads "PAGE 3 OF 5" rather than skipping from 2 to 5.
 */
export function pagesForShift(shift: ShiftSlot): ShiftReportPage[] {
  if (shift === "closing") return [...CLOSING_PAGES];
  if (shift === "opening") return [...OPENING_PAGES];
  return [...SHORT_PAGES];
}

export function pageTitle(page: ShiftReportPage): string {
  return PAGE_TITLE[page];
}

/** The black band's own words. `total` is `pagesForShift(...).length`. */
export function pageBanner(page: ShiftReportPage, index: number, total: number): string {
  return `Shift report — page ${index + 1} of ${total} — ${pageTitle(page)}`;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * What is still outstanding, in words.
 *
 * `closeReadiness`'s rule, and for its reason: it NAMES what is unresolved and
 * then lets you through anyway. Gate a shift report on a complete set and the
 * night the printer jams is a report that never gets sent, which is how a
 * status stops meaning anything.
 *
 * Note it asks different questions of different shifts — an opening report is
 * complete with no schedules printed. There is deliberately no single "a
 * complete report looks like this"; the shift decides.
 */
export type ReadinessInput = {
  shift: ShiftSlot;
  narrative: string | null;
  ratingCount: number;
  /**
   * The break answers that are not finished — see `submitBlockers`.
   *
   * COUNTS, never names. `outstanding` reaches the supervisor email, which
   * carries no employee's name; these do not reach it at all (you cannot send
   * while one is outstanding), but they are counted the same way so that a
   * later change cannot leak one by moving a field between the two lists.
   */
  breaks: {
    /** Got a break, but no time was recorded. */
    missingTime: number;
    /** Did not get one — or nobody said — and no reason was given. */
    missingReason: number;
  };
  taskSpecialOrdersDone: boolean;
  taskSchedulesDone: boolean;
  /** Null when Square has not reported the day yet, which is the normal case. */
  netSalesCents: number | null;
  countedLines: number;
  scheduledLines: number;
  countedBatches: number;
  scheduledBatches: number;
  /**
   * The walk linked to this report, if there is one.
   *
   * DELIBERATELY NOT A `task_checklist_done` FLAG. 070 created its three
   * `task_*` columns because each is "an act NOTHING ELSE CAN OBSERVE" — and
   * with checklists as rows, whether the checklist was done IS observable: a
   * linked run, submitted. A boolean beside it would be a second answer to a
   * question that has one, which is 016's `nextDeliveryDate` trap. So the
   * caller counts the rows and this says what they come to.
   *
   * `null` means no walk is linked, which is different from one that is empty.
   */
  checklist: { outstanding: number; total: number; finished: boolean } | null;
  /** A list this shift is asked for that nobody has started. */
  checklistNotStarted: boolean;
};

export function submitReadiness(input: ReadinessInput): string[] {
  const pages = pagesForShift(input.shift);
  const caveats: string[] = [];

  if (!input.narrative || input.narrative.trim() === "") {
    caveats.push("The shift report itself is empty.");
  }

  // DERIVED FROM THE ROWS, not from a flag (Mark, 2026-09-01: "I don't see the
  // value in the checkbox 'I've rated everybody who worked the shift'. We aren't
  // making sure the user is filling out the report completely").
  //
  // He is right, and it is the readiness rule applied to itself: this list
  // exists to say what is MISSING, not to collect an acknowledgement that
  // nothing is. "You have not ticked the box" was a caveat about the caveat.
  // An empty page is still worth saying, because that one is observable.
  //
  // `task_ratings_done` therefore has no writer and no reader left. The column
  // stays — 070 is applied and a boolean nobody sets costs nothing — but
  // nothing in `web/src` touches it.
  if (input.ratingCount === 0) {
    caveats.push("No employees have been added.");
  }

  // THE BREAK ANSWERS ARE NOT HERE ANY MORE — they BLOCK, so they cannot be
  // something you send past. See `submitBlockers`.

  if (pages.includes("premades") && input.countedLines < input.scheduledLines) {
    const left = input.scheduledLines - input.countedLines;
    caveats.push(
      `${left} of ${input.scheduledLines} premade ${left === 1 ? "line has" : "lines have"} no count.`
    );
  }

  if (pages.includes("elements") && input.countedBatches < input.scheduledBatches) {
    const left = input.scheduledBatches - input.countedBatches;
    caveats.push(
      `${left} of ${input.scheduledBatches} ${left === 1 ? "batch has" : "batches have"} no yield recorded.`
    );
  }

  if (pages.includes("checklist")) {
    if (input.checklistNotStarted) {
      caveats.push("The checklist for this shift has not been started.");
    } else if (input.checklist) {
      const { outstanding, total } = input.checklist;
      if (outstanding > 0) {
        caveats.push(
          `${outstanding} of ${total} checklist ${outstanding === 1 ? "item has" : "items have"} not been looked at.`
        );
      }
      // NO "answered but not finished" CAVEAT ANY MORE (Mark, 2026-09-01).
      // Sending the report finishes the run, so an open-but-answered checklist
      // is not something outstanding for the reader — it is something this very
      // button is about to do. Naming it would be the failure `closeReadiness`
      // warns about in reverse: a list that reports as unresolved a thing the
      // screen resolves for you teaches people to stop reading the list.
      //
      // `checklist.finished` stays on the type. It is still read by the EMAIL,
      // where "was this finished" is a fact about the document being described
      // rather than a prompt.
    }
  }

  if (pages.includes("tomorrow")) {
    if (!input.taskSpecialOrdersDone) {
      caveats.push("Tomorrow's special orders have not been printed.");
    }
    if (!input.taskSchedulesDone) {
      caveats.push("Tomorrow's production logs have not been printed.");
    }
  }

  return caveats;
}

/**
 * What must be settled BEFORE the report can be sent — the one gate in a module
 * built on not gating.
 *
 * Why this exists at all, given `submitReadiness` two functions up and its rule
 * that naming a thing and letting you through is what keeps reports getting
 * sent (Mark, 2026-09-02): "In FMP we wouldn't allow the report to be submitted
 * if any employees were missing break times or a reason for missing a break.
 * Why aren't we doing that here?"
 *
 * THE DISTINCTION IS WHO ELSE COULD EVER SUPPLY IT. Everything in
 * `submitReadiness` is either derivable later or recoverable by somebody else:
 * an uncounted premade line can be counted tomorrow, an unprinted packet can be
 * printed, an empty narrative is a report that says little. A break answer
 * cannot. The supervisor standing there is the ONLY person who knows whether
 * that meal was taken and when, the punches are in Homebase and say nothing
 * about why, and by the time payroll looks at it a fortnight later there is
 * nobody left to ask. It is also the record California asks for.
 *
 * That is the test for anything else that wants to join this list: not "is it
 * important" — everything on the other list is important — but "is this the
 * last moment anybody can answer it".
 *
 * SO THIS IS DELIBERATELY SHORT, and it should stay short. A gate that grows
 * becomes the thing `submitReadiness`' own note warns about: a night the
 * printer jammed and the report never got sent at all.
 *
 * The costs, accepted with eyes open: a supervisor who genuinely cannot recall
 * a break time cannot file until they put something in the box, and a report
 * left with an unanswered row cannot be sent by anybody else either. FMP had
 * both of those for thirteen years.
 */
export function submitBlockers(input: ReadinessInput): string[] {
  const out: string[] = [];
  const { missingTime, missingReason } = input.breaks;

  if (missingReason > 0) {
    out.push(
      `${missingReason} ${missingReason === 1 ? "employee has" : "employees have"} no break, and no reason why.`
    );
  }
  if (missingTime > 0) {
    out.push(
      `${missingTime} ${missingTime === 1 ? "employee has" : "employees have"} a break with no time recorded.`
    );
  }
  return out;
}

/**
 * The sales line on the submit page. INFORMATION, never a caveat: Square types
 * the figure now, so there is no act for a supervisor to complete — which is
 * why FMP's `Task_SalesData_isComplete_b` has no counterpart in this schema.
 */
export function salesNote(netSalesCents: number | null): string {
  return netSalesCents === null
    ? "Square has not reported this day yet — the figures will arrive on tomorrow's sync."
    : "Sales are in.";
}

// ---------------------------------------------------------------------------
// The attention tier
// ---------------------------------------------------------------------------

/**
 * What makes this a routine rather than a form.
 *
 * FileMaker had `isComplete` and a search for the gaps. Without an equivalent a
 * skipped night is invisible until somebody wonders — so the list leads with a
 * tier and every row names its own reason in words.
 */
export type AttentionInput = {
  status: "draft" | "sent";
  reportDate: string;
  emailedAt: string | null;
  updatedAt: string;
  /** The org's own calendar day (`lib/today`), never the browser's. */
  today: string;
};

export function attentionReason(input: AttentionInput): string | null {
  if (input.status === "sent") {
    // The hole this exists to close: the flush succeeded and the mail did not,
    // so the facts are committed and nobody has been told.
    return input.emailedAt === null ? "Sent, but not emailed" : null;
  }
  // A draft somebody walked away from. Dated rather than timed, because a
  // report legitimately stays open across a shift.
  return input.reportDate < input.today ? "Still a draft" : null;
}

/**
 * A night that produced no report at all.
 *
 * `locations.open_days` (017) is what makes this a FACT rather than a
 * suspicion: the shop either was or was not open that weekday. ISO weekdays,
 * 1 = Monday, and the dates are compared as STRINGS — `new Date("2026-08-28")`
 * is UTC midnight and would move the boundary for everyone west of Greenwich.
 */
export type MissingNightsInput = {
  /** ISO dates, most recent first or otherwise — order does not matter. */
  reportDates: readonly string[];
  /** ISO weekday numbers the shop trades on. */
  openDays: readonly number[];
  /** The window to look back over, ending YESTERDAY: today is not late yet. */
  days: readonly { date: string; isoWeekday: number }[];
};

export function missingNights(input: MissingNightsInput): string[] {
  const have = new Set(input.reportDates);
  return input.days
    .filter((d) => input.openDays.includes(d.isoWeekday))
    .filter((d) => !have.has(d.date))
    .map((d) => d.date);
}

// ---------------------------------------------------------------------------
// The two emails
// ---------------------------------------------------------------------------

export type EmailRating = {
  employeeName: string;
  position: string | null;
  score: number | null;
  note: string | null;
  gotBreak: boolean | null;
  breakReason: string | null;
};

/**
 * One answer from the checklist, as the EMAIL needs it.
 *
 * A separate pure type rather than reusing `WalkItemRow`: that one lives in a
 * client component and carries photos, choices, ids and `scored`, none of which
 * an email has any use for. `EmailRating` sets the precedent — the email's
 * shape is declared where the email is composed.
 *
 * `position` (078 — whose job the item is) IS DELIBERATELY ABSENT. It draws on
 * the same vocabulary as `shift_report_ratings.position` ("Sr. DF"), so
 * carrying it would put that string in the supervisor body for a reason that
 * has nothing to do with a person. It says who should do a thing, not what is
 * wrong. `checked_by` never reaches the client at all.
 */
export type EmailChecklistItem = {
  status: CheckStatus;
  prompt: string;
  sectionName: string | null;
  equipmentName: string | null;
  note: string | null;
  valueNumber: number | null;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
};

export type EmailReport = {
  orgName: string;
  locationCode: string;
  locationName: string;
  reportDate: string;
  shift: ShiftSlot;
  supervisorName: string | null;
  narrative: string | null;
  /** Provisional at report time — see `salesLine`. */
  netSalesCents: number | null;
  tipsCents: number | null;
  salesAreProvisional: boolean;
  lastWeekNetCents: number | null;
  lastYearNetCents: number | null;
  premades: {
    name: string;
    par: number | null;
    made: number | null;
    leftover: number | null;
    /** The supervisor's note about this count — migration 081. */
    note: string | null;
  }[];
  elements: { name: string; yield: string | null; status: string | null }[];
  ratings: EmailRating[];
  /**
   * The checklist linked to this report. `ReadinessInput.checklist`'s shape and
   * for its reason: `null` means no checklist is linked, which is different
   * from one that is empty, and different again from one nobody started.
   *
   * It carries the ITEMS rather than a pre-filtered list of issues. If the page
   * filtered, then "an issue goes in the email and an n/a does not" would live
   * in a server component `npm run fixtures` cannot reach — `gustoExport`'s
   * discipline, where the pure function decides and the caller only projects.
   *
   * `finished` stays a field because it is NOT derivable: a checklist can be
   * fully answered and never submitted. `outstanding` and `total` are derivable
   * and deliberately absent, or they would be a second answer to a question
   * that has one (016's `nextDeliveryDate` trap).
   */
  checklist: {
    kind: ChecklistKind;
    title: string;
    finished: boolean;
    items: EmailChecklistItem[];
  } | null;
  /** A list this shift is asked for that nobody has started. */
  checklistNotStarted: boolean;
  /**
   * What the submit page said was still outstanding, verbatim.
   *
   * WHY THE EMAIL CARRIES IT (Mark, 2026-09-01, asking "what's the logic of
   * allowing a supervisor to submit a report when it's clearly incomplete?").
   *
   * The permissiveness is deliberate and stays: `closeReadiness`'s rule, and
   * its reason is that gating INVERTS the failure. The nights a report is
   * incomplete are the nights the printer jammed or the shop got slammed —
   * exactly the nights management most needs to hear about — and blocking the
   * send does not produce a complete report, it produces no report at all,
   * closing the one channel that would have carried the bad news.
   *
   * But that only holds if the incompleteness TRAVELS, and it did not:
   * `submitReadiness` had one caller, the screen. A supervisor saw four
   * outstanding items, pressed Send, and management received something that
   * read as finished. Told, and nobody downstream told.
   *
   * COMPUTED ONCE, SERVER-SIDE, AND HANDED TO BOTH. The page renders this same
   * array rather than calling `submitReadiness` again, so the email cannot say
   * something different from what the person was looking at when they pressed
   * the button. That is the whole claim it makes.
   *
   * COUNTS ONLY, no names and no scores — so it belongs in `supervisorBody`
   * and management inherits it, without touching the privacy boundary that
   * separates the two versions.
   */
  outstanding: string[];
};

/**
 * EVERY STYLE IS INLINE, because email clients strip `<style>` blocks — Gmail
 * has done so in its mobile apps for years. A bare `<table>` arrives with its
 * columns jammed together and is genuinely hard to read, which for a document
 * whose entire purpose is being read is not a cosmetic problem.
 *
 * Kept to the properties that survive everywhere: no flexbox, no grid, no
 * shorthand borders on `table` itself.
 */
const S = {
  // SINGLE quotes around the multi-word family, not double. These strings go
  // into `style="..."` attributes, so a double quote here TERMINATES THE
  // ATTRIBUTE and the whole declaration is dropped — which renders the email in
  // the client's default serif and looks like the styles never applied at all.
  // Caught by rendering it; invisible in review and to the type checker.
  wrap: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111",
  h2: "font-size:18px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em",
  h3: "font-size:13px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#555",
  table: "border-collapse:collapse;width:100%;max-width:640px;font-size:14px",
  th: "text-align:left;padding:6px 10px 6px 0;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.08em",
  thr: "text-align:right;padding:6px 10px 6px 0;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.08em",
  td: "padding:6px 10px 6px 0;border-bottom:1px solid #e5e5e5",
  tdr: "padding:6px 10px 6px 0;border-bottom:1px solid #e5e5e5;text-align:right",
  muted: "color:#666;font-size:13px",
  // Yellow as a FILL, never as ink — the app's own rule, and `text-mark` on
  // white measures 1.43:1.
  mark: "background:#fef08a;padding:0 3px",
} as const;

function esc(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function changeLine(current: number | null, basis: number | null, label: string): string {
  if (current === null || basis === null || basis === 0) return "";
  const pct = Math.round(((current - basis) / basis) * 100);
  const sign = pct > 0 ? "+" : "";
  return `<li style="${S.muted}">${esc(label)}: ${money(basis)} (${sign}${pct}%)</li>`;
}

/** The sales paragraph, which must never state a provisional figure as settled. */
export function salesLine(report: EmailReport): string {
  if (report.netSalesCents === null) {
    return `<p style="${S.muted}">Square has not reported this day yet.</p>`;
  }
  const caveat = report.salesAreProvisional
    ? ` <span style="${S.mark}">provisional — the day closes at 1am</span>`
    : "";
  return [
    `<p><strong>Net sales ${money(report.netSalesCents)}</strong>`,
    ` · tips ${money(report.tipsCents)}${caveat}</p>`,
    "<ul>",
    changeLine(report.netSalesCents, report.lastWeekNetCents, "Last week"),
    changeLine(report.netSalesCents, report.lastYearNetCents, "Last year"),
    "</ul>",
  ].join("");
}

/**
 * What the checklist found — the reason this module exists.
 *
 * Mark's first sentence about facility checks (2026-08-29) was "anything
 * flagged as an issue on a checklist would be included in the report that gets
 * emailed", and for a day it was the one thing the module did not do.
 *
 * IT LIVES IN THE SUPERVISOR BODY, so management gets it for free through
 * `managementBody`'s identity. The alternative — a section beside
 * `ratingsSection` — would mean the supervisors who open at 6am are the only
 * people who never hear that the walk-in is broken, which inverts the feature.
 * Nothing here can carry an employee name structurally: a section is a room, a
 * prompt is template copy, `equipment_name` is a machine, and `checked_by` is
 * never selected. The one free-text field is `note`, and its readers can
 * already read it on /checklists.
 *
 * A CLEAN NIGHT SAYS SO RATHER THAN GOING QUIET. `printedPoDisagreement` stays
 * silent when a vendor printed no number because an absent answer is not a
 * disagreement; this is the opposite case. Somebody walked 27 items and found
 * nothing, and that is evidence — it is what gives the flagged nights their
 * meaning. If the section vanished on a clean night a reader could not tell
 * CLEAN from NOBODY WALKED from THE FEATURE BROKE, and once absence is routine
 * for benign reasons the loud not-started case stops being loud.
 *
 * The silence is reserved for exactly one case: no checklist linked and none
 * asked for. That is the shop nobody has written a master list for, and an
 * email is the wrong place to nag about a feature that is not in use.
 */
export function checklistSection(report: EmailReport): string {
  const list = report.checklist;

  if (!list) {
    if (!report.checklistNotStarted) return "";
    return [
      `<h3 style="${S.h3}">Checklist</h3>`,
      `<p><span style="${S.mark}">The checklist for this shift was not started.</span></p>`,
    ].join("\n");
  }

  const total = list.items.length;
  // `progressLabel`'s own definition of looked-at: anything but pending. One
  // rule across the runner, the submit page and the email.
  const looked = total - outstandingCount(list.items);
  const na = list.items.filter((i) => i.status === "na").length;
  const issues = list.items.filter((i) => i.status === "issue");

  const account = [`${looked} of ${total} checked`];
  if (na > 0) account.push(`${na} not applicable`);

  const parts = [
    `<h3 style="${S.h3}">${esc(CHECKLIST_KIND_LABEL[list.kind])}</h3>`,
    `<p style="${S.muted}">${esc(list.title)} · ${account.join(" · ")}</p>`,
  ];

  if (!list.finished) {
    // Its own sentence at full contrast rather than folded into the muted line:
    // `S.mark` is a FILL, and #666 on #fef08a does not measure.
    parts.push(
      `<p><span style="${S.mark}">This checklist was not finished.</span></p>`
    );
  }

  if (total === 0) {
    // Every item narrowed out by weekday. "Nothing was flagged" would be a true
    // sentence here that reads as an all-clear.
    parts.push("<p>This checklist had no items.</p>");
    return parts.join("\n");
  }

  if (issues.length === 0) {
    parts.push("<p>Nothing was flagged.</p>");
    return parts.join("\n");
  }

  parts.push(
    `<table style="${S.table}"><tr>` +
      `<th style="${S.th}">Where</th><th style="${S.th}">What</th>` +
      `<th style="${S.th}">Reading</th><th style="${S.th}">Note</th></tr>`
  );
  for (const i of issues) {
    // The BOUND, not "out of range" — `readingLabel`'s whole point, and calling
    // it here rather than pre-formatting in the page is what keeps the sentence
    // pinned by a fixture.
    const expected = readingLabel(
      { min_value: i.minValue, max_value: i.maxValue, unit: i.unit },
      i.valueNumber
    );
    const reading =
      i.valueNumber === null
        ? "—"
        : `${i.valueNumber}${i.unit ? ` ${esc(i.unit)}` : ""}` +
          (expected ? ` <span style="${S.mark}">${esc(expected)}</span>` : "");
    parts.push(
      `<tr><td style="${S.td}">${esc(i.sectionName ?? "—")}</td>` +
        `<td style="${S.td}">${esc(i.prompt)}` +
        (i.equipmentName
          ? ` <span style="${S.muted}">(${esc(i.equipmentName)})</span>`
          : "") +
        `</td><td style="${S.td}">${reading}</td>` +
        // No em-dash fallback, matching `ratingsSection`: 076's CHECK guarantees
        // words on an issue, so an empty cell here means it was bypassed and
        // should look wrong.
        `<td style="${S.td}">${esc(i.note ?? "")}</td></tr>`
    );
  }
  parts.push("</table>");
  return parts.join("\n");
}

/**
 * THE SUPERVISOR VERSION — everything except the ratings.
 *
 * This is the base, and `managementBody` is this PLUS a ratings section. The
 * order is the whole security property: ratings can reach the supervisor
 * version only if somebody deliberately moves that section into here, never by
 * forgetting to exclude it. Same discipline as `gustoExport` walking
 * `GUSTO_COLUMNS` rather than the data.
 */
export function supervisorBody(report: EmailReport): string {
  const parts: string[] = [];

  parts.push(
    `<h2 style="${S.h2}">${esc(report.locationCode)} — ${esc(SHIFT_SLOT_LABEL[report.shift])} — ${esc(report.reportDate)}</h2>`
  );
  if (report.supervisorName) {
    parts.push(`<p style="${S.muted}">Supervisor: ${esc(report.supervisorName)}</p>`);
  }

  if (report.narrative && report.narrative.trim() !== "") {
    parts.push(`<h3 style="${S.h3}">How the shift went</h3>`);
    parts.push(`<p style="white-space:normal">${esc(report.narrative).replace(/\n/g, "<br>")}</p>`);
  }

  // Before Sales, deliberately: the narrative is how the shift went in prose
  // and this is the same thing in facts, and a manager scanning a phone reads
  // the first screen. A broken walk-in is on no dashboard; net sales is.
  const checklist = checklistSection(report);
  if (checklist !== "") parts.push(checklist);

  parts.push(`<h3 style="${S.h3}">Sales</h3>`);
  parts.push(salesLine(report));

  if (report.premades.length > 0) {
    parts.push(
      `<h3 style="${S.h3}">Premades</h3><table style="${S.table}"><tr>` +
        `<th style="${S.th}">Item</th><th style="${S.thr}">Par</th>` +
        `<th style="${S.thr}">Made</th><th style="${S.thr}">Left</th>` +
        `<th style="${S.th}">Note</th></tr>`
    );
    for (const p of report.premades) {
      parts.push(
        `<tr><td style="${S.td}">${esc(p.name)}</td><td style="${S.tdr}">${p.par ?? "—"}</td>` +
          `<td style="${S.tdr}">${p.made ?? "—"}</td><td style="${S.tdr}">${p.leftover ?? "—"}</td>` +
          // The column that makes the three numbers mean something: "18 made, 0
          // left" and the same with "dropped a tray, re-fried" are different
          // nights. Empty is a thin space rather than an em dash — a dash in
          // every row of a mostly-empty column is louder than the notes.
          `<td style="${S.td}">${esc(p.note ?? "")}</td></tr>`
      );
    }
    parts.push("</table>");
  }

  if (report.outstanding.length > 0) {
    // LAST, and that placement is the argument. Everything above is what the
    // shift DID; this is what it did not get to, and reading it first would
    // colour a report that is mostly a night's work. A manager who scans one
    // screen has already seen the narrative and the checklist findings — the
    // two things that need acting on tonight — and this is the footnote that
    // stops the rest reading as complete.
    parts.push(`<h3 style="${S.h3}">Still outstanding</h3>`);
    parts.push(`<ul style="margin:0 0 12px 0;padding-left:20px">`);
    for (const o of report.outstanding) {
      parts.push(`<li style="${S.muted}">${esc(o)}</li>`);
    }
    parts.push(`</ul>`);
  }

  if (report.elements.length > 0) {
    parts.push(
      `<h3 style="${S.h3}">Elements made</h3><table style="${S.table}"><tr>` +
        `<th style="${S.th}">Element</th><th style="${S.thr}">Yield</th>` +
        `<th style="${S.th}">Status</th></tr>`
    );
    for (const e of report.elements) {
      parts.push(
        `<tr><td style="${S.td}">${esc(e.name)}</td><td style="${S.tdr}">${esc(e.yield ?? "—")}</td>` +
          `<td style="${S.td}">${esc(e.status ?? "—")}</td></tr>`
      );
    }
    parts.push("</table>");
  }

  return parts.join("\n");
}

/** The ratings section. The ONLY place employee names and scores are rendered. */
export function ratingsSection(report: EmailReport): string {
  if (report.ratings.length === 0) return "";
  const rows = report.ratings.map((r) => {
    const brk =
      r.gotBreak === false
        ? ` <span style="${S.mark}">missed break${r.breakReason ? `: ${esc(r.breakReason)}` : ""}</span>`
        : "";
    return (
      `<tr><td style="${S.td}">${esc(r.employeeName)}</td>` +
      `<td style="${S.td}">${esc(r.position ?? "—")}</td>` +
      `<td style="${S.tdr}">${r.score === null ? "—" : r.score.toFixed(2)}</td>` +
      `<td style="${S.td}">${esc(r.note ?? "")}${brk}</td></tr>`
    );
  });
  return [
    `<h3 style="${S.h3}">Staff ratings</h3>`,
    `<table style="${S.table}"><tr><th style="${S.th}">Who</th><th style="${S.th}">Position</th>` +
      `<th style="${S.thr}">Score</th><th style="${S.th}">Note</th></tr>`,
    ...rows,
    "</table>",
  ].join("\n");
}

/** THE MANAGEMENT VERSION — the supervisor one, plus ratings. Never re-derived. */
export function managementBody(report: EmailReport): string {
  return `${supervisorBody(report)}\n${ratingsSection(report)}`;
}

/**
 * The font wrapper, applied by the SENDER rather than inside either body.
 *
 * It cannot live in `supervisorBody`: that would need a closing tag, and
 * closing it would break the identity `managementBody === supervisorBody +
 * ratingsSection` — which is not a tidiness point but the whole security
 * property, since it is what makes a ratings leak require somebody to MOVE the
 * section rather than merely forget to exclude it. So the wrapper goes on the
 * outside of whichever body is being sent.
 */
export function wrapEmail(body: string): string {
  return `<div style="${S.wrap}">${body}</div>`;
}

export function emailSubject(report: EmailReport): string {
  return `${report.locationCode} ${SHIFT_SLOT_LABEL[report.shift].toLowerCase()} shift report — ${report.reportDate}`;
}
