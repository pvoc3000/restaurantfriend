"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { publishSales } from "@/lib/shiftReportSales";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ProgressBand } from "@/components/ui/ProgressBand";

export type SalesBasis = { netCents: number | null; tipsCents: number | null };

function money(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Change({ current, basis }: { current: number | null; basis: number | null }) {
  if (current === null || basis === null || basis === 0) {
    return <span className="text-faint">—</span>;
  }
  const pct = Math.round(((current - basis) / basis) * 100);
  // Red and green here are a real exception to "colour means record state", and
  // FMP's own page made it: on a comparison the sign IS the information, and
  // the figure is meaningless without knowing which way it points.
  return (
    <span className={pct < 0 ? "text-accent" : "text-go"}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/**
 * FMP's page 3, and the one page that types nothing.
 *
 * SALES ARE NOT INCOMPLETE AT 9PM — THEY ARE ABSENT. Square's reporting day
 * runs 1:00 AM to 12:59 AM PT and the sync deliberately stops at yesterday, so
 * there is no `daily_sales` row for today at all. That is better than a partial
 * one: nothing here can be mistaken for a settled figure.
 *
 * So today's number is read LIVE from Square through `sync-square-sales`'
 * preview mode and is never stored. `daily_sales` is the settled reporting day
 * and it feeds `tip_pools`; a partial day landing there would corrupt payroll.
 * The comparisons beside it are settled days and come from the table as usual.
 */
export function SalesPage({
  reportId,
  locationId,
  reportDate,
  lastWeek,
  lastWeekDate,
  lastYear,
  lastYearDate,
  settled,
}: {
  reportId: string;
  locationId: string;
  reportDate: string;
  lastWeek: SalesBasis;
  lastWeekDate: string;
  lastYear: SalesBasis;
  lastYearDate: string;
  /** Non-null once Square has closed the day and the sync has run. */
  settled: SalesBasis | null;
}) {
  const supabase = createClient();
  const [today, setToday] = useState<SalesBasis | null>(settled);
  const [provisional, setProvisional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * ASKED FOR, never automatic.
   *
   * It began as an effect on mount and is a button instead, for two reasons
   * that agree. The lint refuses a setState called synchronously from an
   * effect, and it is right to: paging back to this screen or any
   * `router.refresh()` would fire a fresh Square API call, so the automatic
   * version would hit an external, rate-limited, billed service several times
   * a shift to answer a question nobody asked twice. And a live read of
   * somebody else's system is a thing worth pressing a button for.
   */
  const load = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const { data, error } = await supabase.functions.invoke("sync-square-sales", {
      body: { from: reportDate, to: reportDate, preview: true },
    });
    setBusy(false);
    if (error) {
      setFailed(
        `Square could not be reached: ${error.message}. The figures will arrive on tomorrow's sync either way.`
      );
      return;
    }
    const row = (data?.rows ?? []).find(
      (r: { location_id: string }) => r.location_id === locationId
    );
    if (!row) {
      setFailed("Square has nothing for this shop and day yet.");
      return;
    }
    setToday({ netCents: row.net_sales_cents, tipsCents: row.tips_cents });
    setProvisional(true);
    // So the email can quote what the supervisor is looking at. See
    // `lib/shiftReportSales` for why this is a store and not a prop.
    publishSales({
      reportId,
      netCents: row.net_sales_cents,
      tipsCents: row.tips_cents,
      provisional: true,
    });
  }, [supabase, reportDate, locationId, reportId]);



  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {busy ? <ProgressBand label="Asking Square for today's figures…" /> : null}

      <div className="space-y-3">
        <p className="text-center text-sm font-bold uppercase tracking-[0.08em]">Today</p>
        {today === null ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted">
              {failed ??
                "Square has not closed this day yet — its reporting day ends at 1am, so the settled figure arrives on tomorrow's sync."}
            </p>
            <button type="button" className={BUTTON_CLASS} onClick={() => void load()}>
              {failed ? "Try again" : "Get today's figures from Square"}
            </button>
          </div>
        ) : (
          <>
            <dl className="mx-auto grid max-w-sm grid-cols-2 gap-x-6 gap-y-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Net sales</dt>
              <dd className="text-right text-[16px] font-semibold">{money(today.netCents)}</dd>
              <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Total tips</dt>
              <dd className="text-right text-[16px] font-semibold">{money(today.tipsCents)}</dd>
            </dl>
            {provisional ? (
              <p className="text-center text-xs">
                <span className="bg-mark-fill px-1">
                  Provisional — Square closes the day at 1am
                </span>
              </p>
            ) : null}
          </>
        )}
      </div>

      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
            <th className="py-2 text-left"> </th>
            <th className="py-2 text-right">Last week</th>
            <th className="py-2 text-right">Change</th>
            <th className="py-2 text-right">Last year</th>
            <th className="py-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-3 text-xs font-semibold uppercase tracking-[0.08em]">Net sales</td>
            <td className="py-3 text-right">{money(lastWeek.netCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.netCents ?? null} basis={lastWeek.netCents} />
            </td>
            <td className="py-3 text-right">{money(lastYear.netCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.netCents ?? null} basis={lastYear.netCents} />
            </td>
          </tr>
          <tr>
            <td className="py-3 text-xs font-semibold uppercase tracking-[0.08em]">Total tips</td>
            <td className="py-3 text-right">{money(lastWeek.tipsCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.tipsCents ?? null} basis={lastWeek.tipsCents} />
            </td>
            <td className="py-3 text-right">{money(lastYear.tipsCents)}</td>
            <td className="py-3 text-right">
              <Change current={today?.tipsCents ?? null} basis={lastYear.tipsCents} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* Which days are being compared, because "last year" is 364 days back so
          the WEEKDAY aligns — `lib/sales.lastYearRange`'s own default, and a
          Saturday against a Friday would be a worse comparison than none. */}
      <p className="text-center text-xs text-muted">
        Compared against {lastWeekDate} and {lastYearDate}.
      </p>
    </div>
  );
}
