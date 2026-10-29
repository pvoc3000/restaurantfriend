/**
 * THE MORNING RUN'S RULES — pure: when it runs, which days it reads, which day
 * a year ago it compares with, what each problem says and how to fix it, and
 * the email.
 *
 * Mark, 2026-10-29: weeks of syncing from Square and posting to QuickBooks by
 * hand every morning went cleanly, so `sales-nightly` now does it at 7 AM,
 * and sends "a nice summary email when the job runs that includes sales and
 * deposits for the previous day [and] compares sales to the same day 52 weeks
 * ago. This is what Shogo did and I miss it." A problem is in the same email,
 * named, with its fix, and on a banner on the Sales screen.
 *
 * No imports, so the fixture build can compile it (`salesAutomation.fixtures.ts`).
 */

/** The hour, in the org's own timezone, the run happens. pg_cron runs in UTC
 *  and fires at BOTH 14:00 and 15:00, because 7 AM Pacific is one in summer
 *  and the other in winter; the function goes ahead only in this hour. */
export const RUN_HOUR = 7;

/** How many business days, ending yesterday, each run syncs and posts. A day
 *  synced before an offline register uploaded its payments does not balance
 *  (DF01 2026-10-06); syncing a week each morning lets it heal itself, and an
 *  unchanged day costs nothing — `qbo-sync` skips it. */
export const WINDOW_DAYS = 7;

/** Same weekday a year earlier: 52 weeks, not the calendar date — a Tuesday
 *  compares with a Tuesday. */
export const LAST_YEAR_DAYS = 364;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `2026-10-29` plus n days, by UTC-midnight arithmetic on the date alone, so
 *  no timezone can shift it. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The wall date and hour at an instant in a zone. */
export function zonedNow(zone: string, instant: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export type RunWindow = {
  /** Today in the org's zone — the run's own date, one run per date. */
  localDate: string;
  localHour: number;
  /** True in the run hour. The cron's other firing that day is a no-op. */
  isRunHour: boolean;
  /** The days synced and posted, oldest first; `to` is yesterday. */
  from: string;
  to: string;
};

export function runWindow(instant: number, zone: string): RunWindow {
  const { date, hour } = zonedNow(zone, instant);
  return {
    localDate: date,
    localHour: hour,
    isRunHour: hour === RUN_HOUR,
    from: addDays(date, -WINDOW_DAYS),
    to: addDays(date, -1),
  };
}

export function sameDayLastYear(iso: string): string {
  return addDays(iso, -LAST_YEAR_DAYS);
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export type ProblemKind =
  | "square_sync"
  | "qbo_connection"
  | "bot"
  | "missing_day"
  | "day_refused"
  | "day_unmapped"
  | "day_failed"
  | "deposit_refused"
  | "deposit_failed"
  | "not_attempted"
  | "crash";

export type RunProblem = {
  kind: ProblemKind;
  /** `DF01`, when it is one shop's. */
  shop?: string;
  /** The business date or arrival date it is about. */
  date?: string;
  /** What is wrong, in a sentence. */
  message: string;
  /** What to do about it, in a sentence. */
  fix: string;
  /** Where to go to do it — an app path. */
  href?: string;
  hrefLabel?: string;
};

const MAPPING = { href: "/settings?tab=accounting&integration=square", hrefLabel: "Square Sales Mapping" };
const QUICKBOOKS = { href: "/settings?tab=accounting", hrefLabel: "QuickBooks settings" };
const SALES = { href: "/sales", hrefLabel: "Sales" };

/** The fix and the link for each kind. The message is the caller's — a
 *  refusal from the builder already names its own cause. */
export function problem(
  kind: ProblemKind,
  message: string,
  where: { shop?: string; date?: string } = {}
): RunProblem {
  const base = { kind, message, ...where };
  switch (kind) {
    case "square_sync":
      return {
        ...base,
        fix: "On the Sales screen, run Sync from Square… for the last 7 days. If it says the token is invalid, see docs/square-setup.md.",
        ...SALES,
      };
    case "qbo_connection":
      return {
        ...base,
        fix: "Reconnect QuickBooks in Settings → Integrations → QuickBooks, then press Run Now on the Sales screen.",
        ...QUICKBOOKS,
      };
    case "bot":
      return {
        ...base,
        fix: "The run signs in as its own member. In Settings → Integrations → Square → Morning Sales Run, choose a member who is a purchaser or above.",
        href: "/settings?tab=accounting&integration=square",
        hrefLabel: "Morning Sales Run",
      };
    case "missing_day":
      return {
        ...base,
        fix: "If the shop was open, run Sync from Square… for that day on the Sales screen.",
        ...SALES,
      };
    case "day_refused":
      return {
        ...base,
        fix: /does not balance/.test(message)
          ? "Usually a register's offline payments have not reached Square yet. Tomorrow morning's run syncs this day again; if it is still refused then, it needs a look."
          : "Fix what it names; the next run posts this day.",
        ...(/Mapping/.test(message) ? MAPPING : /location's record/.test(message) ? { href: "/locations", hrefLabel: "Locations" } : SALES),
      };
    case "day_unmapped":
      return {
        ...base,
        fix: "Pick an account for it in Square Sales Mapping. The next run updates the entries in place.",
        ...MAPPING,
      };
    case "day_failed":
    case "deposit_failed":
      return {
        ...base,
        fix: "QuickBooks refused it, for the reason given. Fix that, then press Run Now on the Sales screen.",
        ...SALES,
      };
    case "deposit_refused":
      return {
        ...base,
        fix: /negative|withdrawal/.test(message)
          ? "Record it by hand in QuickBooks."
          : /Mapping/.test(message)
            ? "Fix what it names; the next run posts this deposit."
            : "Nothing to post. Check the payout in Square if it looks wrong.",
        ...(/Mapping/.test(message) ? MAPPING : SALES),
      };
    case "not_attempted":
      return {
        ...base,
        fix: "Posting stops at the first failure. Fix that one; the next run sends these.",
        ...SALES,
      };
    case "crash":
      return {
        ...base,
        fix: "The run stopped partway. Press Run Now on the Sales screen; if it stops again, the message is the thing to look into.",
        ...SALES,
      };
  }
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export type ShopDay = {
  shop: string;
  /** Net sales yesterday, or null when Square has no day for the shop. */
  netCents: number | null;
  /** The same weekday 52 weeks earlier, or null when there is no such day. */
  lastYearCents: number | null;
};

export type DepositLine = {
  shop: string;
  arrivalDate: string;
  amountCents: number;
  docNumber: string | null;
  /** `posted`, `skipped` (already there, unchanged), `refused`, `failed`, `not sent`. */
  state: string;
};

export type Tally = { created: number; updated: number; skipped: number; refused: number; failed: number };

export function emptyTally(): Tally {
  return { created: 0, updated: 0, skipped: 0, refused: 0, failed: 0 };
}

/** One day of the chart: every shop's net sales together, beside the same
 *  weekday 52 weeks earlier. Null where Square has no day. */
export type WeekDay = {
  date: string;
  netCents: number | null;
  lastYearCents: number | null;
};

export type RunSummary = {
  /** Yesterday — the day the sales block is about. */
  businessDate: string;
  lastYearDate: string;
  shops: ShopDay[];
  /** The window's days, oldest first, for the chart at the top. Absent on
   *  runs recorded before the chart existed. */
  week?: WeekDay[];
  deposits: DepositLine[];
  entries: Tally;
  depositTally: Tally;
  /** Square's own warnings from the sync, passed through. */
  notes: string[];
};

export type RunForEmail = {
  orgName: string;
  appUrl: string | null;
  dryRun: boolean;
  window: { from: string; to: string };
  summary: RunSummary | null;
  problems: RunProblem[];
};

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** `+8.1%`, `-3.0%`, or null when there is nothing to compare with. */
export function percentChange(now: number | null, before: number | null): string | null {
  if (now === null || before === null || before === 0) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** `Tue, Oct 28` — read as a calendar date, never shifted by a zone. */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** `Tue, Oct 28, 2025` — for last year's date, where the year is the point. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function totals(shops: readonly ShopDay[]): ShopDay {
  const sum = (pick: (s: ShopDay) => number | null) => {
    const vals = shops.map(pick);
    return vals.every((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  };
  return { shop: "Total", netCents: sum((s) => s.netCents), lastYearCents: sum((s) => s.lastYearCents) };
}

export function emailSubject(run: RunForEmail): string {
  const dry = run.dryRun ? "[DRY RUN] " : "";
  const n = run.problems.length;
  const tail = n === 0 ? "all posted" : `${n} ${n === 1 ? "issue needs" : "issues need"} you`;
  if (!run.summary) return `${dry}Morning sales run · ${tail}`;
  const t = totals(run.summary.shops);
  const pct = percentChange(t.netCents, t.lastYearCents);
  const figure = t.netCents === null ? "" : `: ${formatCents(t.netCents)}${pct ? ` (${pct})` : ""}`;
  return `${dry}Sales for ${shortDate(run.summary.businessDate)}${figure} · ${tail}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tallyLine(t: Tally, noun: [string, string]): string {
  const parts: string[] = [];
  if (t.created) parts.push(`${t.created} created`);
  if (t.updated) parts.push(`${t.updated} updated`);
  if (t.skipped) parts.push(`${t.skipped} already up to date`);
  if (t.refused) parts.push(`${t.refused} refused`);
  if (t.failed) parts.push(`${t.failed} failed`);
  const count = t.created + t.updated + t.skipped + t.refused + t.failed;
  return parts.length ? `${count} ${count === 1 ? noun[0] : noun[1]}: ${parts.join(", ")}` : `No ${noun[1]}`;
}

function link(appUrl: string | null, href: string | undefined): string | null {
  if (!appUrl || !href) return null;
  return `${appUrl.replace(/\/$/, "")}${href}`;
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------
//
// IN THE APP'S OWN LOOK (Mark, 2026-10-29: "give the morning email a little
// Restaurant Friend design flair … add a sales graph to the top"). The design
// system's rules, as an email can carry them:
//   · structure is black — the masthead, the window's 2px frame and hard
//     shadow, the black section bands with white caps, the Mac title bar's
//     ruled stripes;
//   · colour is state — yellow only as the FILL behind what needs you, red and
//     green only behind the change on last year, never as ink;
//   · Helvetica, no webfonts, caps always tracked (+0.06em names, +0.12em
//     labels); square corners; 48px for the one number worth staring at.
// Tables and inline styles only: Gmail strips <style>, SVG and gradients, so
// the stripes are 1px table rows and the chart is bars of table cells. A
// client that drops the shadow loses nothing that carries meaning.

const C = {
  ink: "#000000",
  body: "#333333",
  secondary: "#545454",
  caption: "#757575",
  faint: "#9b9b9b",
  page: "#f1f1f1",
  macGrey: "#c0c0c0",
  yellowFill: "#ffe98a",
  greenFill: "#cfe8cb",
  redFill: "#ffcfc9",
};
const FONT = `ui-sans-serif,system-ui,-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif`;
const LABEL = `font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${C.secondary};`;
const CAPS = `letter-spacing:0.06em;text-transform:uppercase;`;
const NUM = `font-variant-numeric:tabular-nums;`;

/** `THU 22` under a chart bar. */
function axisDay(iso: string): [string, string] {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(d).toUpperCase();
  return [wd, String(d.getUTCDate())];
}

/** `$3,616` — the chart's one label, whole dollars. */
function wholeDollars(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

/** The Mac title bar: six 1px rules either side of the title in a white
 *  break — `ui/MacTitleBar`, drawn with table rows. */
function macTitleBar(title: string): string {
  const stripes =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    Array.from({ length: 11 }, (_, i) =>
      `<tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:${i % 2 === 0 ? C.ink : "#ffffff"}">&nbsp;</td></tr>`
    ).join("") +
    `</table>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:2px solid ${C.ink}">` +
    `<tr><td style="padding:6px 8px 6px 8px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td valign="middle" width="50%" style="width:50%">${stripes}</td>` +
    `<td valign="middle" style="padding:0 12px;white-space:nowrap;font-family:${FONT};font-size:12px;font-weight:700;${CAPS}color:${C.ink}">${esc(title)}</td>` +
    `<td valign="middle" width="50%" style="width:50%">${stripes}</td>` +
    `</tr></table></td></tr></table>`
  );
}

/** A black band with white caps — the app's group band. */
function band(title: string): string {
  return (
    `<tr><td style="padding:28px 0 0 0">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="background:${C.ink};color:#ffffff;padding:7px 12px;font-family:${FONT};font-size:12px;font-weight:700;${CAPS}">${esc(title)}</td>` +
    `</tr></table></td></tr>`
  );
}

/**
 * THE WEEK, AT THE TOP. Seven days of every shop together, each beside the
 * same weekday a year earlier — the comparison the email exists for, seen
 * before it is read. Black bars are this week; last year is the Mac grey with
 * a black outline, because grey alone is under 3:1 on white. One value label,
 * on yesterday, the day the rest of the email is about; the exact figures
 * are the table below. No hover in an email, so nothing else is labelled.
 */
function weekChart(week: readonly WeekDay[], businessDate: string): string {
  const H = 132;
  const max = Math.max(1, ...week.flatMap((d) => [d.netCents ?? 0, d.lastYearCents ?? 0]));
  const h = (c: number | null) => (c === null || c <= 0 ? 0 : Math.max(2, Math.round((c / max) * H)));
  const bar = (cents: number | null, now: boolean) => {
    const px = h(cents);
    if (px === 0) return `<div style="width:16px;height:0;font-size:0;line-height:0">&nbsp;</div>`;
    return now
      ? `<div style="width:16px;height:${px}px;background:${C.ink};font-size:0;line-height:0">&nbsp;</div>`
      : `<div style="width:14px;height:${Math.max(0, px - 2)}px;background:${C.macGrey};border:1px solid ${C.ink};font-size:0;line-height:0">&nbsp;</div>`;
  };
  const cols = week
    .map((d) => {
      const [wd, dom] = axisDay(d.date);
      const isYesterday = d.date === businessDate;
      const label =
        isYesterday && d.netCents !== null
          ? `<div style="font-family:${FONT};font-size:11px;font-weight:700;color:${C.ink};${NUM}padding-bottom:4px;white-space:nowrap">${wholeDollars(d.netCents)}</div>`
          : "";
      return (
        `<td valign="bottom" align="center" style="padding:0 2px">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td valign="bottom" align="center" height="${H + 20}" style="height:${H + 20}px">${label}${bar(d.netCents, true)}</td>` +
        `<td width="2" style="width:2px;font-size:0">&nbsp;</td>` +
        `<td valign="bottom">${bar(d.lastYearCents, false)}</td>` +
        `</tr></table>` +
        `<div style="border-top:2px solid ${C.ink};margin-top:0;padding-top:6px;font-family:${FONT};font-size:11px;${isYesterday ? "font-weight:700;" : ""}letter-spacing:0.12em;color:${isYesterday ? C.ink : C.secondary}">${wd}<br><span style="${NUM}letter-spacing:0">${dom}</span></div>` +
        `</td>`
      );
    })
    .join("");
  const key = (now: boolean) =>
    now
      ? `<span style="display:inline-block;width:10px;height:10px;background:${C.ink};vertical-align:middle"></span>`
      : `<span style="display:inline-block;width:8px;height:8px;background:${C.macGrey};border:1px solid ${C.ink};vertical-align:middle"></span>`;
  return (
    `<tr><td style="padding:24px 0 0 0">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="${LABEL}">The last 7 days · all shops</td>` +
    `</tr><tr>` +
    `<td style="padding-top:6px;font-family:${FONT};font-size:11px;color:${C.secondary}">` +
    `<span style="white-space:nowrap">${key(true)}&nbsp; This week</span> &nbsp;&nbsp; ` +
    `<span style="white-space:nowrap">${key(false)}&nbsp; Same day last year</span></td>` +
    `</tr></table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px"><tr>${cols}</tr></table>` +
    `</td></tr>`
  );
}

/** The change on last year as a filled chip: green up, red down — state,
 *  never ink. */
function changeChip(now: number | null, before: number | null): string {
  const pct = percentChange(now, before);
  if (!pct || now === null || before === null) {
    return `<span style="font-family:${FONT};font-size:13px;color:${C.secondary}">No day to compare with last year</span>`;
  }
  const up = now >= before;
  return (
    `<span style="display:inline-block;background:${up ? C.greenFill : C.redFill};color:${C.ink};padding:4px 8px;font-family:${FONT};font-size:13px;font-weight:700;white-space:nowrap;${NUM}">` +
    `${up ? "+" : ""}${formatCents(now - before)} · ${pct}</span>`
  );
}

function renderHtml(run: RunForEmail): string {
  const s = run.summary;
  const rows: string[] = [];
  const cell = `padding:10px 12px 10px 0;font-family:${FONT};font-size:14px;color:${C.body};`;
  const numCell = `${cell}text-align:right;${NUM}`;
  const head = `padding:0 12px 8px 0;border-bottom:2px solid ${C.ink};${LABEL}`;

  if (run.dryRun) {
    rows.push(
      `<tr><td style="padding:0 0 16px 0"><div style="border:1px solid ${C.ink};padding:10px 12px;font-family:${FONT};font-size:13px;color:${C.ink}">` +
        `<b style="${CAPS}">Test</b> — nothing was synced or posted; this is what the morning email would say.</div></td></tr>`
    );
  }

  // The headline: yesterday's total, 48px, and its change on last year.
  if (s) {
    const t = totals(s.shops);
    rows.push(
      `<tr><td style="${LABEL}">Net sales · ${esc(shortDate(s.businessDate))}</td></tr>` +
        `<tr><td style="padding:6px 0 0 0;font-family:${FONT};font-size:48px;line-height:52px;font-weight:700;letter-spacing:-0.02em;color:${C.ink};${NUM}">${t.netCents === null ? "—" : formatCents(t.netCents)}</td></tr>` +
        `<tr><td style="padding:10px 0 0 0">${changeChip(t.netCents, t.lastYearCents)}` +
        `<span style="font-family:${FONT};font-size:13px;color:${C.secondary}">&nbsp; vs ${esc(longDate(s.lastYearDate))}${t.lastYearCents !== null ? ` · ${formatCents(t.lastYearCents)}` : ""}</span></td></tr>`
    );
    if (s.week && s.week.length) rows.push(weekChart(s.week, s.businessDate));
  }

  // What needs you: a yellow FILL, black type — the app's "look at this".
  if (run.problems.length) {
    const items = run.problems
      .map((p) => {
        const where = [p.shop, p.date ? shortDate(p.date) : null].filter(Boolean).join(" · ");
        const url = link(run.appUrl, p.href);
        return (
          `<tr><td style="padding:12px 0 0 0;font-family:${FONT};font-size:14px;color:${C.ink}">` +
          (where ? `<b>${esc(where)}</b> — ` : "") +
          `${esc(p.message)}<br><span style="color:${C.secondary}">${esc(p.fix)}</span>` +
          (url ? ` <a href="${esc(url)}" style="color:${C.ink};text-decoration:underline">${esc(p.hrefLabel ?? "Open")}</a>` : "") +
          `</td></tr>`
        );
      })
      .join("");
    rows.push(
      `<tr><td style="padding:28px 0 0 0">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${C.ink}">` +
        `<tr><td style="background:${C.yellowFill};border-bottom:2px solid ${C.ink};padding:8px 12px;font-family:${FONT};font-size:12px;font-weight:700;${CAPS}color:${C.ink}">` +
        `Needs you · ${run.problems.length}</td></tr>` +
        `<tr><td style="padding:0 12px 14px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr>` +
        `</table></td></tr>`
    );
  }

  if (s) {
    // By shop.
    rows.push(band(`By shop · ${shortDate(s.businessDate)}`));
    const shopRows = s.shops.length > 1 ? [...s.shops, totals(s.shops)] : s.shops;
    const body = shopRows
      .map((r) => {
        const total = r.shop === "Total";
        const top = total ? `border-top:2px solid ${C.ink};font-weight:700;color:${C.ink};` : "";
        const pct = percentChange(r.netCents, r.lastYearCents);
        const diff = r.netCents !== null && r.lastYearCents !== null ? r.netCents - r.lastYearCents : null;
        const change =
          diff === null || !pct
            ? `<span style="color:${C.faint}">—</span>`
            : // Dollars over percent, so the column stays narrow on a phone.
              `<span style="display:inline-block;background:${diff >= 0 ? C.greenFill : C.redFill};color:${C.ink};padding:3px 6px;line-height:18px;white-space:nowrap">${diff >= 0 ? "+" : ""}${formatCents(diff)}<br>${pct}</span>`;
        return (
          `<tr>` +
          `<td style="${cell}${top}font-weight:700;color:${C.ink};${CAPS}">${esc(r.shop)}</td>` +
          `<td style="${numCell}${top}">${r.netCents === null ? `<span style="color:${C.faint}">—</span>` : formatCents(r.netCents)}</td>` +
          `<td style="${numCell}${top}color:${C.secondary};">${r.lastYearCents === null ? `<span style="color:${C.faint}">—</span>` : formatCents(r.lastYearCents)}</td>` +
          `<td style="${numCell}${top}padding-right:0">${change}</td>` +
          `</tr>`
        );
      })
      .join("");
    rows.push(
      `<tr><td style="padding:14px 0 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
        `<tr><td style="${head}">Shop</td><td style="${head}text-align:right">Net sales</td>` +
        `<td style="${head}text-align:right">${esc(longDate(s.lastYearDate))}</td><td style="${head}text-align:right;padding-right:0">Change</td></tr>` +
        `${body}</table></td></tr>`
    );

    // Deposits.
    rows.push(band("Square deposits"));
    if (s.deposits.length === 0) {
      rows.push(`<tr><td style="padding:14px 0 0 0;font-family:${FONT};font-size:14px;color:${C.secondary}">None arriving yesterday, today or tomorrow.</td></tr>`);
    } else {
      // The QuickBooks document rides a small second line under its row, so
      // the table is three columns wide and fits a phone.
      const dep = s.deposits
        .map(
          (d) =>
            `<tr><td style="${cell}padding-bottom:2px;font-weight:700;color:${C.ink};${CAPS}">${esc(d.shop)}</td>` +
            `<td style="${cell}padding-bottom:2px">${esc(shortDate(d.arrivalDate))}</td>` +
            `<td style="${numCell}padding-bottom:2px;padding-right:0">${formatCents(d.amountCents)}</td></tr>` +
            `<tr><td colspan="3" style="padding:0 0 10px 0;font-family:${FONT};font-size:12px;color:${C.secondary}">` +
            `QuickBooks: ${d.docNumber ? `<span style="${NUM}">${esc(d.docNumber)}</span> · ` : ""}${esc(d.state)}</td></tr>`
        )
        .join("");
      rows.push(
        `<tr><td style="padding:14px 0 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
          `<tr><td style="${head}">Shop</td><td style="${head}">Arrives</td><td style="${head}text-align:right;padding-right:0">Amount</td></tr>` +
          `${dep}</table></td></tr>`
      );
    }

    // What was posted.
    rows.push(band(`${run.dryRun ? "Would post" : "Posted"} to QuickBooks`));
    rows.push(
      `<tr><td style="padding:14px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.body}">` +
        `${esc(tallyLine(s.entries, ["journal entry", "journal entries"]))}<br>` +
        `${esc(tallyLine(s.depositTally, ["deposit", "deposits"]))}<br>` +
        `<span style="color:${C.secondary}">Synced from Square: ${esc(shortDate(run.window.from))} – ${esc(shortDate(run.window.to))}.</span></td></tr>`
    );

    if (s.notes.length) {
      rows.push(
        `<tr><td style="padding:20px 0 0 0;${LABEL}">Notes from Square</td></tr>` +
          s.notes
            .map((n) => `<tr><td style="padding:6px 0 0 0;font-family:${FONT};font-size:13px;color:${C.secondary}">${esc(n)}</td></tr>`)
            .join("")
      );
    }
  }

  // The one command: a white Mac button with its hard shadow.
  const salesUrl = link(run.appUrl, "/sales");
  if (salesUrl) {
    rows.push(
      `<tr><td style="padding:32px 0 4px 0">` +
        `<a href="${esc(salesUrl)}" style="display:inline-block;background:#ffffff;border:1px solid ${C.ink};box-shadow:3px 3px 0 0 ${C.ink};` +
        `padding:10px 18px;font-family:${FONT};font-size:12px;font-weight:600;${CAPS}color:${C.ink};text-decoration:none">Open Daily Sales</a></td></tr>`
    );
  }

  const title = s ? `Morning sales · ${shortDate(s.businessDate)}` : "Morning sales run";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.page}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 8px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">` +
    // The masthead: the wordmark set in type, black, as the app's is.
    `<tr><td style="background:${C.ink};padding:12px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff">Restaurant Friend</td>` +
    `<td align="right" style="font-family:${FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${C.faint}">${esc(run.orgName)}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td height="16" style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>` +
    // The window: 2px frame, hard shadow, the title bar.
    `<tr><td style="background:#ffffff;border:2px solid ${C.ink};box-shadow:4px 4px 0 0 ${C.ink}">` +
    macTitleBar(title) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:24px 12px 24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>` +
    `</td></tr></table></td></tr>` +
    `<tr><td style="padding:16px 2px 0 2px;font-family:${FONT};font-size:11px;line-height:16px;color:${C.caption}">` +
    `Sent by the morning sales run at 7 AM. It syncs the last seven days from Square and posts what changed.</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/** The email, as HTML and as its plain-text fallback. */
export function renderSummaryEmail(run: RunForEmail): { subject: string; html: string; text: string } {
  const subject = emailSubject(run);
  const text: string[] = [];

  if (run.dryRun) text.push("DRY RUN — nothing was synced or posted.", "");

  // Issues first: they are the reason to open it.
  if (run.problems.length) {
    text.push("NEEDS YOU");
    for (const p of run.problems) {
      const where = [p.shop, p.date ? shortDate(p.date) : null].filter(Boolean).join(" · ");
      const url = link(run.appUrl, p.href);
      text.push(`- ${where ? `${where}: ` : ""}${p.message}`, `  Fix: ${p.fix}${url ? ` ${url}` : ""}`);
    }
    text.push("");
  }

  const s = run.summary;
  if (s) {
    text.push(`SALES FOR ${shortDate(s.businessDate).toUpperCase()} (vs ${longDate(s.lastYearDate)})`);
    const rows = s.shops.length > 1 ? [...s.shops, totals(s.shops)] : s.shops;
    for (const r of rows) {
      const pct = percentChange(r.netCents, r.lastYearCents);
      const diff = r.netCents !== null && r.lastYearCents !== null ? formatCents(r.netCents - r.lastYearCents) : null;
      const now = r.netCents === null ? "—" : formatCents(r.netCents);
      const before = r.lastYearCents === null ? "—" : formatCents(r.lastYearCents);
      const change = pct ? `${diff} (${pct})` : "—";
      text.push(`  ${r.shop.padEnd(6)} ${now.padStart(12)}   last year ${before.padStart(12)}   ${change}`);
    }
    text.push("");

    if (s.week && s.week.length) {
      text.push("THE LAST 7 DAYS, ALL SHOPS (vs the same day last year)");
      for (const d of s.week) {
        const now = d.netCents === null ? "—" : formatCents(d.netCents);
        const before = d.lastYearCents === null ? "—" : formatCents(d.lastYearCents);
        text.push(`  ${shortDate(d.date).padEnd(12)} ${now.padStart(12)}   last year ${before.padStart(12)}`);
      }
      text.push("");
    }

    text.push("SQUARE DEPOSITS");
    if (s.deposits.length === 0) text.push("  None arriving yesterday, today or tomorrow.");
    for (const d of s.deposits) {
      const qbo = d.docNumber ? `${d.docNumber} · ${d.state}` : d.state;
      text.push(`  ${d.shop.padEnd(6)} ${shortDate(d.arrivalDate).padEnd(12)} ${formatCents(d.amountCents).padStart(12)}   ${qbo}`);
    }
    text.push("");

    text.push(
      run.dryRun ? "WOULD POST TO QUICKBOOKS" : "POSTED TO QUICKBOOKS",
      `  ${tallyLine(s.entries, ["journal entry", "journal entries"])}`,
      `  ${tallyLine(s.depositTally, ["deposit", "deposits"])}`,
      `  Synced from Square: ${shortDate(run.window.from)} – ${shortDate(run.window.to)}.`,
      ""
    );

    if (s.notes.length) {
      text.push("NOTES FROM SQUARE");
      for (const n of s.notes) text.push(`  - ${n}`);
      text.push("");
    }
  }

  const salesUrl = link(run.appUrl, "/sales");
  if (salesUrl) text.push(`Sales screen: ${salesUrl}`);
  return { subject, html: renderHtml(run), text: text.join("\n") };
}
