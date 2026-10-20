import { closedDates } from "@/lib/blackoutDates";
import { fetchEntries } from "@/lib/calendarQueries";
import { missedClosingNights } from "@/lib/startPage";
import { daysBefore } from "@/lib/today";

import { CARD_ITEMS, StartCard, urgentCount, type CardItem, type CardSummary } from "../StartCard";
import { longDate, type Result, type StartContext, type Supabase } from "./shared";

export async function ShiftReportsWidget(ctx: StartContext) {
  const result = await loadShiftReports(ctx.supabase, ctx.today, ctx.shop.id, ctx.shop.code);
  return <StartCard {...shiftReportsSummary({ result })} />;
}

/** What Shift reports adds to the Home button's badge. */
export async function shiftReportsAttention(ctx: StartContext): Promise<number> {
  const result = await loadShiftReports(ctx.supabase, ctx.today, ctx.shop.id, ctx.shop.code);
  return urgentCount(shiftReportsSummary({ result }));
}

/** The Shift Reports list's own look-back for missing nights. */
const REPORT_LOOKBACK = 7;

type ReportsData = {
  missed: { code: string; date: string }[];
  staleDrafts: { id: string; code: string; date: string }[];
  notEmailed: number;
};

async function loadShiftReports(
  supabase: Supabase,
  today: string,
  loc: string,
  code: string
): Promise<Result<ReportsData>> {
  const since = daysBefore(today, REPORT_LOOKBACK);
  const [{ data: reports, error }, { data: shops, error: shopError }] = await Promise.all([
    supabase
      .from("shift_reports")
      .select("id, location_id, report_date, shift, status, sent_at, emailed_at")
      .eq("location_id", loc)
      .gte("report_date", since)
      .order("report_date"),
    supabase.from("locations").select("id, code, open_days").eq("id", loc),
  ]);
  if (error) return { data: null, error: error.message };
  if (shopError) return { data: null, error: shopError.message };
  const { entries } = await fetchEntries(supabase, { from: since, to: today });

  const rows = (reports ?? []) as {
    id: string;
    location_id: string;
    report_date: string;
    shift: string;
    status: string;
    emailed_at: string | null;
  }[];
  return {
    data: {
      missed: missedClosingNights(
        (shops ?? []).map((s) => ({
          id: s.id as string,
          code: s.code as string,
          openDays: (s.open_days as number[] | null) ?? [],
          closedDates: closedDates(entries, s.id as string, { from: since, to: today }),
        })),
        rows,
        today,
        REPORT_LOOKBACK
      ),
      // `attentionReason`'s two findings: a draft from an earlier day, and a
      // report that was sent but whose email never went out.
      staleDrafts: rows
        .filter((r) => r.status === "draft" && r.report_date < today)
        .map((r) => ({ id: r.id, code, date: r.report_date })),
      notEmailed: rows.filter((r) => r.status === "sent" && r.emailed_at === null).length,
    },
    error: null,
  };
}

function shiftReportsSummary({ result }: { result: Result<ReportsData> }): CardSummary {
  if (result.data === null) {
    return { lines: [], error: result.error };
  }
  const { missed, staleDrafts, notEmailed } = result.data;
  const items: CardItem[] = [
    ...missed.map((m) => ({ primary: longDate(m.date), secondary: "No closing report" })),
    ...staleDrafts.map((d) => ({
      primary: longDate(d.date),
      secondary: "Still a draft",
      href: `/shift-reports/${d.id}/run`,
    })),
  ].slice(0, CARD_ITEMS);

  return {
    lines: [
      { count: missed.length, label: `closing nights with no report (last ${REPORT_LOOKBACK} days)` },
      { count: staleDrafts.length, label: "drafts from an earlier day", href: "/shift-reports" },
      { count: notEmailed, label: "sent but not emailed", href: "/shift-reports" },
    ],
    items,
  };
}
