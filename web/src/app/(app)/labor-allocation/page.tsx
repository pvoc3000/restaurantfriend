import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr } from "@/lib/roles";
import { canEditPage } from "@/lib/pageAccess";
import { PageHeading } from "@/components/ui/PageHeading";
import { LaborAllocationList, type LaborMonthRow } from "@/components/payroll/LaborAllocationList";
import { lastDayOfMonth, monthOf, monthsBetween, type LaborPostingRef } from "@/lib/laborAllocation";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";

/**
 * LABOR BY SHOP — the month's labor split by hours worked (migration 205).
 *
 * One row per month: each shop's hours and share, read here from the
 * timesheets, and whether that month's split is in QuickBooks. The dollars
 * are NOT on the list: they live in QuickBooks and are read only when a month
 * is opened for review, because a year of journal entries is twelve calls.
 */
const MONTHS_SHOWN = 12;

export default async function LaborAllocationPage() {
  const session = await getAppSession();
  const supabase = await createClient();

  if (!canReadHr(session.membership.role)) {
    return <p className="max-w-[72ch] text-sm text-muted">Labor by shop is visible to managers and owners.</p>;
  }

  const orgId = session.membership.org_id;
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const months = monthsBetween(
    // Twelve months back, counted on the first of the month.
    (() => {
      const [y, m] = monthOf(today).split("-").map(Number);
      const back = new Date(Date.UTC(y, m - MONTHS_SHOWN, 1));
      return back.toISOString().slice(0, 10);
    })(),
    today
  );
  const from = months[months.length - 1];
  const to = lastDayOfMonth(months[0]);

  const [hours, allocations] = await Promise.all([
    supabase.rpc("labor_hours_by_month", { p_org: orgId, p_from: from, p_to: to }),
    supabase
      .from("labor_allocations")
      .select("month, shares, external_ref, posted_at, post_error")
      .eq("org_id", orgId)
      .gte("month", from),
  ]);

  const error = hours.error ?? allocations.error;
  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load the labor split: {error.message}
        {/labor_hours_by_month|labor_allocations/.test(error.message) ? " — migration 205 has not been applied yet." : ""}
      </p>
    );
  }

  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const byMonth = new Map<string, LaborMonthRow>();
  for (const m of months) {
    byMonth.set(m, {
      month: m,
      hours: {},
      unassignedHours: 0,
      totalHours: 0,
      external_ref: null,
      posted_at: null,
      post_error: null,
      current: m === monthOf(today),
    });
  }
  for (const r of (hours.data ?? []) as { month: string; location_id: string | null; hours: number }[]) {
    const row = byMonth.get(r.month);
    if (!row) continue;
    const h = Number(r.hours);
    const code = r.location_id ? codeById.get(r.location_id) : undefined;
    if (code) row.hours[code] = (row.hours[code] ?? 0) + h;
    else row.unassignedHours += h;
    row.totalHours += code ? h : 0;
  }
  for (const a of (allocations.data ?? []) as {
    month: string;
    external_ref: LaborPostingRef | null;
    posted_at: string | null;
    post_error: string | null;
  }[]) {
    const row = byMonth.get(a.month);
    if (!row) continue;
    row.external_ref = a.external_ref;
    row.posted_at = a.posted_at;
    row.post_error = a.post_error;
  }

  const rows = [...byMonth.values()];
  const shopCodes = [...new Set(rows.flatMap((r) => Object.keys(r.hours)))].sort();

  return (
    <div className="space-y-6">
      <PageHeading title="Labor by Shop" total={rows.length} noun="months" />
      <LaborAllocationList
        orgId={orgId}
        rows={rows}
        shopCodes={shopCodes}
        editable={canEditPage(session.membership.role, "/labor-allocation")}
      />
    </div>
  );
}
