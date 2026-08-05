import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { PayPeriodsList, type PayPeriodRow } from "@/components/payroll/PayPeriodsList";
import type { PayPeriodStatus } from "@/lib/payPeriods";

/**
 * The payroll calendar — every fortnight, and which one is open.
 *
 * ORG-scoped, not location-scoped: payroll belongs to the company, not to a
 * shop, so this screen doesn't key on the working location and isn't behind the
 * inactive-location gate. Same reasoning as `/employees`.
 *
 * Note the READ gate here is deliberately weaker than the one on `/timesheets`
 * will be. Migration 027 makes `pay_periods` readable by any member, because a
 * period is two dates and a status — no personal data at all — and a supervisor
 * reporting Saturday's tips has to know which fortnight is open. What needs
 * `canRunPayroll` is WRITING one, which is what the New button is gated on.
 */
export default async function PayPeriodsPage() {
  const session = await getAppSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pay_periods")
    .select("id, legacy_id, start_date, end_date, status, notes, exported_at, closed_at, reopened_at")
    // Newest first — a pay period is a diary, and the fortnight you want is
    // almost always the one that just ended. The client sorts for display; this
    // order is what makes the first paint right.
    .order("start_date", { ascending: false });

  if (error) {
    // Before 027 is applied this is "Could not find the table" rather than an
    // empty list, which is the intended behaviour: an empty table would read as
    // "no pay periods yet" and send someone looking for the wrong bug.
    return <p className="text-sm text-accent">Could not load pay periods: {error.message}</p>;
  }

  const rows: PayPeriodRow[] = (data ?? []).map((p) => ({
    id: p.id as string,
    legacy_id: (p.legacy_id ?? null) as string | null,
    start_date: p.start_date as string,
    end_date: p.end_date as string,
    status: p.status as PayPeriodStatus,
    notes: (p.notes ?? null) as string | null,
    exported_at: (p.exported_at ?? null) as string | null,
    closed_at: (p.closed_at ?? null) as string | null,
    reopened_at: (p.reopened_at ?? null) as string | null,
  }));

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Pay Periods
          </h1>
          <p className="max-w-[72ch] text-sm text-muted">
            Every pay period payroll has run for. A timesheet can only be edited
            while its period is open or in review — once the file has been
            produced, the record stops moving.
          </p>
        </div>
        {/* Here as well as on /timesheets (Mark, 2026-08-05: "should be on pay
            periods as well shouldn't it?"). It should: opening the period and
            filling it are one errand, and this is the screen you are on when
            you have just opened one. */}
        {canRunPayroll(session.membership.role) && (
          <Link
            href="/timesheets/import"
            className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
          >
            Import timesheets
          </Link>
        )}
      </div>

      <PayPeriodsList
        rows={rows}
        canWrite={canRunPayroll(session.membership.role)}
        today={today}
        settings={session.orgSettings.payroll}
        orgId={session.membership.org_id}
      />
    </div>
  );
}
