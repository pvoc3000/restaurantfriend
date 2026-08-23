import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canSyncSales } from "@/lib/roles";
import { todayInTimeZone, serverTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  parseSalesRange,
  resolveSalesRange,
  fetchWindow,
  previousRange,
  lastYearRange,
  elapsedRange,
  isPartial,
  openingSlice,
  type SalesDay,
} from "@/lib/sales";
import { daysBetween } from "@/lib/payPeriods";
import { SyncFromSquare } from "@/components/sales/SyncFromSquare";
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
    .select("location_id, business_date, net_sales_cents, tips_cents, synced_at, source")
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
    source: (r.source as string) ?? "square",
  }));

  // Which shops this screen is ABOUT: the ones mapped to Square. A shop with no
  // mapping has no rows and never will, so listing it would only add an empty
  // column to every comparison.
  //
  // NOT filtered on `is_active`: the online channel is a VIRTUAL, INACTIVE
  // location on purpose (Mark, 2026-08-23) — inactive keeps it out of
  // `session.activeLocations` and so out of every per-location enumeration in
  // the app, while `square_location_id` is what decides whether it has sales
  // to show. Being mapped is the whole qualification.
  //
  // `open_days` comes with it because `missingDays` needs to know when a place
  // TRADES: the online channel sells on about five days a year, and expecting a
  // row from it every day would report ~230 phantom gaps.
  const { data: mapped } = await supabase
    .from("locations")
    .select("id, code, open_days, is_active")
    .not("square_location_id", "is", null)
    .order("code");

  const shops = (mapped ?? []).map((l) => ({
    id: l.id as string,
    code: l.code as string,
    openDays: (l.open_days as number[] | null) ?? null,
    isActive: (l.is_active as boolean | null) ?? null,
  }));

  // A SET, comma-separated, and EMPTY MEANS ALL — `FILTER_ALL`'s convention in
  // a plural form. A code no shop answers to is dropped rather than obeyed
  // (`parseFilterValues`' rule), so a stale link narrows to nothing rather than
  // showing an empty screen with no way out.
  const known = new Set(shops.map((s) => s.code));
  const picked = (first(params.location) ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => known.has(c));

  // THE SHOP FILTER IS APPLIED ON THE CLIENT, and the whole window's rows go
  // down unfiltered.
  //
  // It used to be applied here, which made every tick of the shop picker a
  // `router.push`: measured at 886ms and one history entry EACH, so choosing
  // three shops cost 2.7 seconds and three back-presses to undo. That is the
  // deviation, not the fix — `lib/filterMenus` has always filtered in the
  // browser and written the URL with `history.replaceState`, for exactly this
  // reason.
  //
  // It costs nothing to send: the window is bounded at ~5 shops × 365 days
  // even on a year view, and the rows were already fetched in one query.
  const elapsed = elapsedRange(resolved.range, today);
  const elapsedDays = daysBetween(elapsed.from, elapsed.to);

  return (
    <div className="space-y-8">
      {/* COMMANDS LEVEL WITH THE TITLE (Mark, 2026-08-23) — the special-order
          record's arrangement, and for its reason: pulling from Square is a
          command about the SCREEN, where everything in the filter row below is
          about the VIEW. `items-start` so the button lines up with the top of
          the heading rather than centring against a block whose height changes
          with the description. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold uppercase tracking-[0.08em]">Sales</h1>
          <p className="mt-1 text-sm text-muted">
            Net sales and tips per shop per day, from Square.
          </p>
        </div>
        {canSyncSales(session.membership.role) ? <SyncFromSquare today={today} /> : null}
      </div>

      <SalesScreen
        canEdit={canSyncSales(session.membership.role)}
        days={days}
        range={resolved.range}
        rangeLabel={resolved.label}
        fellBack={resolved.fellBack}
        elapsed={elapsed}
        elapsedDays={elapsedDays}
        partial={isPartial(resolved.range, today)}
        prevRange={openingSlice(previousRange(resolved.range), elapsedDays)}
        yearRange={openingSlice(lastYearRange(resolved.range), elapsedDays)}
        rangeKey={rangeKey}
        shops={shops}
        initialPicked={picked}
        yesterday={previousDay(today)}
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
