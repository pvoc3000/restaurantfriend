import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canRunPayroll } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { PAY_PERIODS_CRUMB } from "@/lib/payPeriodRoutes";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { StatusChip } from "@/components/payroll/PayPeriodsList";
import { PayPeriodActions } from "@/components/payroll/PayPeriodActions";
import {
  daysBetween,
  formatPeriodRange,
  isPayPeriodEditable,
  workweekStart,
  payrollSettings,
  type PayPeriodStatus,
} from "@/lib/payPeriods";

type PayPeriodRecord = {
  id: string;
  legacy_id: string | null;
  start_date: string;
  end_date: string;
  status: PayPeriodStatus;
  notes: string | null;
  exported_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
};

/** A timestamptz as a readable local moment, or an em dash. */
function stamp(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * One fortnight.
 *
 * Phase 1 of the payroll module, so this screen is the CALENDAR record and not
 * yet the payroll worksheet. The per-employee roll-up, the break-premium
 * decisions, the tip pools and the export all land here in later phases — the
 * placeholder at the bottom says so rather than leaving a page that looks
 * finished and does nothing.
 */
export async function PayPeriodDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();
  const supabase = await createClient();

  // 027 makes pay_periods readable by any member — a period is two dates and a
  // status. Writing one is owner/admin, so below that every cell renders as
  // plain text rather than offering an edit the database will refuse.
  const canWrite = canRunPayroll(session.membership.role);

  const { data: row, error } = await supabase
    .from("pay_periods")
    .select(
      "id, legacy_id, start_date, end_date, status, notes, exported_at, closed_at, reopened_at, reopen_reason"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return <p className="text-sm text-accent">Could not load the pay period: {error.message}</p>;
  }
  if (!row) {
    return <p className="text-sm text-accent">This pay period no longer exists.</p>;
  }

  const period = row as unknown as PayPeriodRecord;
  const trail = parseTrail(rawParams, PAY_PERIODS_CRUMB);
  const timeZone = session.orgSettings.timezone ?? "UTC";
  const settings = payrollSettings(session.orgSettings.payroll);

  // A fortnight holds TWO workweeks, and California weekly overtime and the
  // seventh-day rule are per workweek. Stating them here is how the screen
  // stops anyone reading the period as the unit overtime is computed over.
  const weeks: string[] = [];
  {
    let w = workweekStart(period.start_date, settings);
    const guard = 60; // a period can't sanely hold more weeks than this
    for (let i = 0; i < guard && w <= period.end_date; i++) {
      weeks.push(w);
      const next = new Date(`${w}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      w = next.toISOString().slice(0, 10);
    }
  }

  // The one cell that stays editable in a closed period is deliberately none of
  // them. Decision 8 is the module's single read-only rule, and a note is part
  // of the record it describes.
  const editable = canWrite && isPayPeriodEditable(period.status);

  return (
    <div className="space-y-16">
      <Breadcrumbs
        trail={trail}
        current={formatPeriodRange(period)}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* ---- what this period is --------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {formatPeriodRange(period)}
          </h1>
          <StatusChip status={period.status} />
        </div>

        <dl className="grid max-w-lg grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Starts</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="start_date"
                kind="date"
                value={period.start_date}
                nullable={false}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.start_date}</span>
            )}
          </dd>

          <dt className="py-0.5 text-subtle">Ends</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="end_date"
                kind="date"
                value={period.end_date}
                nullable={false}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.end_date}</span>
            )}
          </dd>

          <dt className="py-0.5 text-subtle">Length</dt>
          <dd className={READ_ONLY_VALUE}>
            {daysBetween(period.start_date, period.end_date)} days
          </dd>

          <dt className="py-0.5 text-subtle">Workweeks</dt>
          <dd className={READ_ONLY_VALUE}>
            {weeks.join(" · ")}
            <span className="block text-[13px] text-muted">
              Overtime over 40 hours and the seventh-day rule are per workweek,
              not per period.
            </span>
          </dd>

          <dt className="py-0.5 text-subtle">Note</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="pay_periods"
                id={period.id}
                column="notes"
                value={period.notes}
                placeholder="—"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{period.notes ?? "—"}</span>
            )}
          </dd>

          {period.legacy_id && (
            <>
              <dt className="py-0.5 text-subtle">FileMaker</dt>
              <dd className={READ_ONLY_VALUE}>#{period.legacy_id}</dd>
            </>
          )}
        </dl>
      </div>

      {/* ---- where it is on the ladder --------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>Status</SectionHeading>
        <PayPeriodActions id={period.id} status={period.status} canWrite={canWrite} />

        <dl className="grid max-w-lg grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Exported</dt>
          <dd className={READ_ONLY_VALUE}>{stamp(period.exported_at, timeZone)}</dd>
          <dt className="py-0.5 text-subtle">Closed</dt>
          <dd className={READ_ONLY_VALUE}>{stamp(period.closed_at, timeZone)}</dd>
          {period.reopened_at && (
            <>
              <dt className="py-0.5 text-subtle">Reopened</dt>
              <dd className={READ_ONLY_VALUE}>
                {stamp(period.reopened_at, timeZone)}
                {period.reopen_reason && (
                  <span className="block text-[13px] text-muted">{period.reopen_reason}</span>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* ---- what isn't built yet -------------------------------------- */}
      <section className="space-y-4">
        <SectionHeading>Payroll worksheet</SectionHeading>
        <p className="max-w-[72ch] border border-hairline px-4 py-3 text-sm text-muted">
          The per-employee hours roll-up, the break-premium decisions, the tip
          pools with their rate and residual, and the Gusto export all live here.
          None of it is built yet — timesheets arrive with migration 028, and the
          export is deliberately last, because it is irreversible and must not
          run until every input is trustworthy.
        </p>
      </section>
    </div>
  );
}
