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

export type RunSummary = {
  /** Yesterday — the day the sales block is about. */
  businessDate: string;
  lastYearDate: string;
  shops: ShopDay[];
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

/** The email, as HTML and as its plain-text fallback. */
export function renderSummaryEmail(run: RunForEmail): { subject: string; html: string; text: string } {
  const subject = emailSubject(run);
  const html: string[] = [];
  const text: string[] = [];
  const cell = "padding:4px 12px 4px 0;border-bottom:1px solid #ddd;";
  const num = `${cell}text-align:right;font-variant-numeric:tabular-nums;`;

  html.push(`<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:640px">`);
  if (run.dryRun) {
    html.push(`<p style="background:#eee;padding:8px"><b>Dry run.</b> Nothing was synced or posted; this is what the email would say.</p>`);
    text.push("DRY RUN — nothing was synced or posted.", "");
  }

  // Issues first: they are the reason to open it.
  if (run.problems.length) {
    html.push(`<h2 style="font-size:16px;margin:16px 0 8px">Needs you</h2><ol style="padding-left:20px;margin:0">`);
    text.push("NEEDS YOU");
    for (const p of run.problems) {
      const where = [p.shop, p.date ? shortDate(p.date) : null].filter(Boolean).join(" · ");
      const url = link(run.appUrl, p.href);
      html.push(
        `<li style="margin-bottom:10px">${where ? `<b>${esc(where)}</b> — ` : ""}${esc(p.message)}<br>` +
          `<span style="color:#555">${esc(p.fix)}</span>` +
          (url ? ` <a href="${esc(url)}">${esc(p.hrefLabel ?? "Open")}</a>` : "") +
          `</li>`
      );
      text.push(`- ${where ? `${where}: ` : ""}${p.message}`, `  Fix: ${p.fix}${url ? ` ${url}` : ""}`);
    }
    html.push(`</ol>`);
    text.push("");
  }

  const s = run.summary;
  if (s) {
    html.push(
      `<h2 style="font-size:16px;margin:16px 0 8px">Sales for ${esc(shortDate(s.businessDate))}</h2>` +
        `<table style="border-collapse:collapse"><tr>` +
        `<th style="${cell}text-align:left">Shop</th><th style="${num}">Net sales</th>` +
        `<th style="${num}">${esc(longDate(s.lastYearDate))}</th><th style="${num}">Change</th></tr>`
    );
    text.push(`SALES FOR ${shortDate(s.businessDate).toUpperCase()} (vs ${longDate(s.lastYearDate)})`);
    const rows = s.shops.length > 1 ? [...s.shops, totals(s.shops)] : s.shops;
    for (const r of rows) {
      const pct = percentChange(r.netCents, r.lastYearCents);
      const diff = r.netCents !== null && r.lastYearCents !== null ? formatCents(r.netCents - r.lastYearCents) : null;
      const now = r.netCents === null ? "—" : formatCents(r.netCents);
      const before = r.lastYearCents === null ? "—" : formatCents(r.lastYearCents);
      const change = pct ? `${diff} (${pct})` : "—";
      const bold = r.shop === "Total" ? "font-weight:600;" : "";
      html.push(
        `<tr><td style="${cell}${bold}">${esc(r.shop)}</td><td style="${num}${bold}">${now}</td>` +
          `<td style="${num}${bold}">${before}</td><td style="${num}${bold}">${esc(change)}</td></tr>`
      );
      text.push(`  ${r.shop.padEnd(6)} ${now.padStart(12)}   last year ${before.padStart(12)}   ${change}`);
    }
    html.push(`</table>`);
    text.push("");

    html.push(`<h2 style="font-size:16px;margin:16px 0 8px">Square deposits</h2>`);
    text.push("SQUARE DEPOSITS");
    if (s.deposits.length === 0) {
      html.push(`<p style="margin:0">None arriving yesterday, today or tomorrow.</p>`);
      text.push("  None arriving yesterday, today or tomorrow.");
    } else {
      html.push(
        `<table style="border-collapse:collapse"><tr><th style="${cell}text-align:left">Shop</th>` +
          `<th style="${cell}text-align:left">Arrives</th><th style="${num}">Amount</th>` +
          `<th style="${cell}text-align:left">QuickBooks</th></tr>`
      );
      for (const d of s.deposits) {
        const qbo = d.docNumber ? `${d.docNumber} · ${d.state}` : d.state;
        html.push(
          `<tr><td style="${cell}">${esc(d.shop)}</td><td style="${cell}">${esc(shortDate(d.arrivalDate))}</td>` +
            `<td style="${num}">${formatCents(d.amountCents)}</td><td style="${cell}">${esc(qbo)}</td></tr>`
        );
        text.push(`  ${d.shop.padEnd(6)} ${shortDate(d.arrivalDate).padEnd(12)} ${formatCents(d.amountCents).padStart(12)}   ${qbo}`);
      }
      html.push(`</table>`);
    }
    text.push("");

    const window = `${shortDate(run.window.from)} – ${shortDate(run.window.to)}`;
    html.push(
      `<h2 style="font-size:16px;margin:16px 0 8px">Posted to QuickBooks</h2>` +
        `<p style="margin:0">${esc(tallyLine(s.entries, ["journal entry", "journal entries"]))}<br>` +
        `${esc(tallyLine(s.depositTally, ["deposit", "deposits"]))}<br>` +
        `<span style="color:#555">Synced from Square: ${esc(window)}.</span></p>`
    );
    text.push(
      "POSTED TO QUICKBOOKS",
      `  ${tallyLine(s.entries, ["journal entry", "journal entries"])}`,
      `  ${tallyLine(s.depositTally, ["deposit", "deposits"])}`,
      `  Synced from Square: ${window}.`,
      ""
    );

    if (s.notes.length) {
      html.push(`<h2 style="font-size:14px;margin:16px 0 8px;color:#555">Notes from Square</h2><ul style="color:#555;padding-left:20px;margin:0">`);
      text.push("NOTES FROM SQUARE");
      for (const n of s.notes) {
        html.push(`<li>${esc(n)}</li>`);
        text.push(`  - ${n}`);
      }
      html.push(`</ul>`);
      text.push("");
    }
  }

  const salesUrl = link(run.appUrl, "/sales");
  if (salesUrl) {
    html.push(`<p style="margin-top:20px"><a href="${esc(salesUrl)}">Open the Sales screen</a></p>`);
    text.push(`Sales screen: ${salesUrl}`);
  }
  html.push(`</div>`);
  return { subject, html: html.join("\n"), text: text.join("\n") };
}
