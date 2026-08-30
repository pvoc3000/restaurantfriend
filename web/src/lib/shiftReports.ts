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
  ratings: "Ratings",
  sales: "Sales",
  premades: "Premades",
  elements: "Elements made",
  checklist: "Checklist",
  report: "Report",
  tomorrow: "Tomorrow's paper",
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
  taskRatingsDone: boolean;
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

  if (!input.taskRatingsDone) {
    caveats.push(
      input.ratingCount === 0
        ? "No staff have been rated."
        : `${input.ratingCount} ${input.ratingCount === 1 ? "person has" : "people have"} been rated, but the page is not marked done.`
    );
  }

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
      const { outstanding, total, finished } = input.checklist;
      if (outstanding > 0) {
        caveats.push(
          `${outstanding} of ${total} checklist ${outstanding === 1 ? "item has" : "items have"} not been looked at.`
        );
      } else if (!finished) {
        caveats.push("The checklist is answered but has not been finished.");
      }
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
  premades: { name: string; par: number | null; made: number | null; leftover: number | null }[];
  elements: { name: string; yield: string | null; status: string | null }[];
  ratings: EmailRating[];
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

  parts.push(`<h3 style="${S.h3}">Sales</h3>`);
  parts.push(salesLine(report));

  if (report.premades.length > 0) {
    parts.push(
      `<h3 style="${S.h3}">Premades</h3><table style="${S.table}"><tr>` +
        `<th style="${S.th}">Item</th><th style="${S.thr}">Par</th>` +
        `<th style="${S.thr}">Made</th><th style="${S.thr}">Left</th></tr>`
    );
    for (const p of report.premades) {
      parts.push(
        `<tr><td style="${S.td}">${esc(p.name)}</td><td style="${S.tdr}">${p.par ?? "—"}</td>` +
          `<td style="${S.tdr}">${p.made ?? "—"}</td><td style="${S.tdr}">${p.leftover ?? "—"}</td></tr>`
      );
    }
    parts.push("</table>");
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
