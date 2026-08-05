import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import {
  ImportTimesheets,
  type ImportEmployee,
  type ImportPeriod,
} from "@/components/payroll/ImportTimesheets";
import type { PayPeriodStatus } from "@/lib/payPeriods";

/**
 * Read a Homebase timesheet export.
 *
 * The server's only job is to hand the client what it needs to MATCH — the
 * roster and its two external ids, the pay periods, the locations. The file is
 * parsed in the browser and nothing is written until Commit, which is what
 * makes the plan a plan rather than a progress bar.
 */
export default async function ImportTimesheetsPage() {
  const session = await getAppSession();

  if (!canRunPayroll(session.membership.role)) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Import time sheets
        </h1>
        <p className="text-sm text-muted">
          Importing timesheets is open to managers and the owner.
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: employeeRows }, { data: periodRows }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, legacy_id, homebase_id")
      .order("last_name"),
    supabase.from("pay_periods").select("id, start_date, end_date, status"),
  ]);

  const employees: ImportEmployee[] = (employeeRows ?? []).map((e) => ({
    id: e.id as string,
    name: `${e.last_name}, ${e.first_name}`,
    legacy_id: e.legacy_id === null || e.legacy_id === undefined ? null : String(e.legacy_id),
    homebase_id: (e.homebase_id ?? null) as string | null,
  }));

  const periods: ImportPeriod[] = (periodRows ?? []).map((p) => ({
    id: p.id as string,
    start_date: p.start_date as string,
    end_date: p.end_date as string,
    status: p.status as PayPeriodStatus,
  }));

  // The FULL list — a file could legitimately come from a shop that has since
  // closed, and refusing to place it would be worse than importing it.
  const locations = session.locations.map((l) => ({ id: l.id, code: l.code }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Import time sheets
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          Drop the CSV Homebase exports. You&rsquo;ll see exactly what it
          contains, where it lands and who it can&rsquo;t match, before anything
          is written.{" "}
          <Link
            href="/time-sheets"
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Back to the shifts
          </Link>
          .
        </p>
      </div>

      <ImportTimesheets
        employees={employees}
        periods={periods}
        locations={locations}
        orgId={session.membership.org_id}
        // So the screen can OFFER to open the period a file needs instead of
        // stating that none covers it and leaving you to go and find the other
        // screen (Mark, 2026-08-05). The cadence still comes from
        // `nextPeriodAfter` / `periodContaining`, which stay the one place that
        // arithmetic lives — 016's `nextDeliveryDate` trap.
        payrollSettings={session.orgSettings.payroll}
        // Punches are wall times in the file and instants in the database. The
        // ORG's zone converts them; the browser's would be wrong for anyone
        // travelling, and the server's would be wrong on a UTC host.
        timeZone={session.orgSettings.timezone ?? "UTC"}
      />
    </div>
  );
}
