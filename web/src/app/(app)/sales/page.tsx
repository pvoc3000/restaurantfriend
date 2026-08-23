import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canSyncSales } from "@/lib/roles";
import { todayInTimeZone, serverTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  parseSalesRange,
  resolveSalesRange,
  fetchWindow,
  daysIn,
  sumSales,
  previousRange,
  lastYearRange,
  compareTotals,
  missingDays,
  type SalesDay,
} from "@/lib/sales";
import { SalesSummary } from "@/components/sales/SalesSummary";
import { SalesScreen } from "@/components/sales/SalesScreen";

/**
 * DAILY NET SALES AND TIPS, per shop.
 *
 * The figures come from Square (migration 063, `sync-square-sales`), which is
 * why there is no entry form on this screen: supervisors used to type these off
 * the Square dashboard into a FileMaker shift report, and now the app reads
 * them itself.
 *
 * ORG-WIDE, deliberately — both shops side by side is the whole point, so the
 * location is a filter DIMENSION here rather than a scope around the screen.
 * That is also why `/sales` is exempt from `InactiveLocationGate`: this screen
 * has nothing to empty when the working location is closed.
 *
 * READ BY ANY MEMBER (Mark, 2026-08-23). What the shop took is a shop-floor
 * fact and 063's select policy is membership-wide; only the SYNC is owner/admin,
 * because a sync rewrites the org's history.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const params = await searchParams;

  const timeZone = (session.orgSettings.timezone as string | undefined) ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);

  const rangeKey = parseSalesRange(first(params.range));

  // The pay-period calendar, newest first. 30 is generous: the picker only
  // needs the one containing today and the one before it, and a year of
  // fortnights is 26.
  const { data: periodRows } = await supabase
    .from("pay_periods")
    .select("start_date, end_date")
    .order("start_date", { ascending: false })
    .limit(30);

  const periods = periodRows ?? [];
  const resolved = resolveSalesRange(rangeKey, today, periods, {
    from: first(params.from),
    to: first(params.to),
  });

  // ONE QUERY spanning everything on screen — the chosen range, the one before
  // it, and the same range a year back. At two shops a year is ~730 rows, so
  // slicing in TypeScript is cheaper than asking three times.
  const window = fetchWindow(resolved.range);

  const { data: salesRows, error } = await supabase
    .from("daily_sales")
    .select("location_id, business_date, net_sales_cents, tips_cents, synced_at")
    .gte("business_date", window.from)
    .lte("business_date", window.to)
    .order("business_date", { ascending: false });

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load sales: {error.message}
        {/daily_sales|square_location_id|record_daily_sales/.test(error.message) ? (
          <span className="mt-2 block text-muted">
            If this names a missing table or column, migration 063 has not been
            applied yet.
          </span>
        ) : null}
      </p>
    );
  }

  const codeFor = new Map(session.locations.map((l) => [l.id, l.code]));

  const days: SalesDay[] = (salesRows ?? []).map((r) => ({
    location_id: r.location_id as string,
    locationCode: codeFor.get(r.location_id as string) ?? "—",
    business_date: r.business_date as string,
    // PostgREST returns numeric as a string; these are `integer` columns so
    // they arrive as numbers, but Number() costs nothing and makes the
    // arithmetic below immune to a column type changing under it.
    netSalesCents: Number(r.net_sales_cents),
    tipsCents: Number(r.tips_cents),
    syncedAt: (r.synced_at as string | null) ?? null,
  }));

  // Which shops this screen is ABOUT: the ones mapped to Square. A shop with no
  // mapping has no rows and never will, so listing it would only add an empty
  // column to every comparison.
  const { data: mapped } = await supabase
    .from("locations")
    .select("id, code")
    .not("square_location_id", "is", null)
    .order("code");

  const shops = (mapped ?? []).map((l) => ({ id: l.id as string, code: l.code as string }));

  const locationFilter = first(params.location) ?? "";
  const visible = locationFilter
    ? days.filter((d) => d.locationCode === locationFilter)
    : days;
  const shopsInScope = locationFilter ? shops.filter((s) => s.code === locationFilter) : shops;

  const current = daysIn(visible, resolved.range);
  const prevRange = previousRange(resolved.range);
  const yearRange = lastYearRange(resolved.range);

  const summary = {
    rangeLabel: resolved.label,
    fellBack: resolved.fellBack,
    current: sumSales(current),
    vsPrevious: compareTotals(
      sumSales(current),
      sumSales(daysIn(visible, prevRange)),
      prevRange
    ),
    vsLastYear: compareTotals(
      sumSales(current),
      sumSales(daysIn(visible, yearRange)),
      yearRange
    ),
    // `today` is excluded: the shops have not finished trading, so reporting it
    // as a gap every single day is how a reader learns to ignore this line.
    gaps: missingDays(current, shopsInScope, resolved.range, previousDay(today)),
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-bold uppercase tracking-[0.08em]">Sales</h1>
        <p className="mt-1 text-sm text-muted">
          Net sales and tips per shop per day, from Square.
        </p>
      </div>

      <SalesSummary summary={summary} />

      <SalesScreen
        days={visible}
        allDays={days}
        range={resolved.range}
        rangeKey={rangeKey}
        shops={shops}
        locationFilter={locationFilter}
        canSync={canSyncSales(session.membership.role)}
        today={today}
        params={params}
      />
    </div>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Yesterday, in the org's own calendar. */
function previousDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
