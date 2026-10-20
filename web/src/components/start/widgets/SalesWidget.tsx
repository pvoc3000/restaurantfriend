import { SalesSummary, type SalesSummaryData } from "@/components/sales/SalesSummary";
import { closedDates } from "@/lib/blackoutDates";
import { fetchEntries } from "@/lib/calendarQueries";
import {
  compareTotals,
  daysIn,
  fetchWindow,
  incompleteDays,
  lastYearRange,
  missingDays,
  previousRange,
  SALES_PREVIOUS_LABEL,
  sumSales,
  type SalesDay,
} from "@/lib/sales";
import { yearOverYearTrend } from "@/lib/startPage";
import { daysBefore } from "@/lib/today";

import { SalesTrend } from "../SalesTrend";
import type { Result, StartContext, Supabase } from "./shared";

/** How far back the sales band looks. */
const SALES_DAYS = 30;

/**
 * SALES — the last 30 days against the period before and the same weekdays a
 * year back, and the year-over-year line (2026-09-17). Wider, it says more
 * (2026-10-20): Net sales alone at one column with no chart, Tips and the chart
 * from two, the tip share at three.
 */
export async function SalesWidget(ctx: StartContext) {
  const result = await loadSales(ctx.supabase, ctx.today, ctx.shop.id, ctx.shop.code);
  if (result.data === null) return <p className="text-sm text-accent">Could not load sales: {result.error}</p>;
  return <SalesBand days={result.data.days} shops={result.data.shops} today={ctx.today} timeZone={ctx.timeZone} />;
}

type ShopRow = {
  id: string;
  code: string;
  openDays: number[] | null;
  isActive: boolean | null;
  /** Days the calendar says the shop was closed (migration 181). */
  closedDates: ReadonlySet<string>;
};

async function loadSales(
  supabase: Supabase,
  today: string,
  loc: string,
  code: string
): Promise<Result<{ days: SalesDay[]; shops: ShopRow[] }>> {
  const range = { from: daysBefore(today, SALES_DAYS - 1), to: today };
  const window = fetchWindow(range);
  const days: SalesDay[] = [];
  // Paginated on a TOTAL order: PostgREST stops at 1,000 rows without a word.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("location_id, business_date, net_sales_cents, tips_cents, synced_at, source")
      .eq("location_id", loc)
      .gte("business_date", window.from)
      .lte("business_date", window.to)
      .order("business_date")
      .order("location_id")
      .range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const r of data ?? []) {
      days.push({
        location_id: r.location_id as string,
        locationCode: code,
        business_date: r.business_date as string,
        netSalesCents: Number(r.net_sales_cents),
        tipsCents: Number(r.tips_cents),
        syncedAt: (r.synced_at as string | null) ?? null,
        source: (r.source as string) ?? "square",
      });
    }
    if (!data || data.length < 1000) break;
  }

  // This shop, if Square reports for it — the Sales screen's own definition,
  // so the gap line here and there agree.
  const { data: mapped, error } = await supabase
    .from("locations")
    .select("id, code, open_days, is_active")
    .eq("id", loc)
    .not("square_location_id", "is", null);
  if (error) return { data: null, error: error.message };
  const { entries } = await fetchEntries(supabase, range);

  return {
    data: {
      days,
      shops: (mapped ?? []).map((l) => ({
        id: l.id as string,
        code: l.code as string,
        openDays: (l.open_days as number[] | null) ?? null,
        isActive: (l.is_active as boolean | null) ?? null,
        closedDates: closedDates(entries, l.id as string, range),
      })),
    },
    error: null,
  };
}

function SalesBand({
  days,
  shops,
  today,
  timeZone,
}: {
  days: SalesDay[];
  shops: ShopRow[];
  today: string;
  timeZone: string;
}) {
  const range = { from: daysBefore(today, SALES_DAYS - 1), to: today };
  const prev = previousRange(range);
  const year = lastYearRange(range);
  const current = daysIn(days, range);
  const totals = sumSales(current);

  const summary: SalesSummaryData = {
    rangeLabel: `Last ${SALES_DAYS} days`,
    fellBack: false,
    partial: null,
    previousLabel: SALES_PREVIOUS_LABEL["last-30"],
    current: totals,
    vsPrevious: compareTotals(totals, sumSales(daysIn(days, prev)), prev),
    vsLastYear: compareTotals(totals, sumSales(daysIn(days, year)), year),
    // Through YESTERDAY: today is not a gap, it is a day still being taken.
    gaps: missingDays(current, shops, range, daysBefore(today, 1)),
    unfinished: incompleteDays(current, timeZone).map((d) => ({
      locationCode: d.locationCode,
      business_date: d.business_date,
    })),
  };

  return (
    <div className="space-y-6">
      <SalesSummary summary={summary} fit="container" />
      {/* The chart from two columns: at one it is a squiggle under a 64px axis. */}
      <div className="hidden @xl:block">
        <SalesTrend points={yearOverYearTrend(days, range)} />
      </div>
    </div>
  );
}
