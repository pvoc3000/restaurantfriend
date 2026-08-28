import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEnterCounts, canReadHr } from "@/lib/roles";
import { daysBefore } from "@/lib/today";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { parseTrail } from "@/lib/breadcrumbs";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SHIFT_SLOT_LABEL, type ShiftSlot } from "@/lib/shiftReports";

function money(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A sent shift report, kept.
 *
 * This screen is why declining the FileMaker migration is safe. Without it the
 * only way to read last Tuesday would be to find the email — which would make
 * this app worse than FileMaker at the one thing the report exists for, and
 * would put nine years of accumulating institutional memory in an inbox.
 *
 * Read-only throughout: a sent report is a document. Everything on it is
 * already fetched by the runner, so this is cheap.
 */
export default async function ShiftReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const role = session.membership.role;

  if (!canEnterCounts(role)) {
    return <p className="text-sm text-muted">Shift reports are for supervisors and managers.</p>;
  }

  const { data: report, error } = await supabase
    .from("shift_reports")
    .select(
      "id, org_id, location_id, report_date, shift, status, narrative, supervisor_employee_id, next_production_date, created_by, sent_at, emailed_at, sent_receipt, email_receipt"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return <p className="text-sm text-accent">Could not open the report: {error.message}</p>;
  }
  if (!report) notFound();

  const shift = report.shift as ShiftSlot;
  const reportDate = report.report_date as string;
  const isDraft = report.status === "draft";

  const [{ data: takers }, { data: ratings }, { data: sales }] = await Promise.all([
    supabase.rpc("special_order_takers", { p_org_id: report.org_id }),
    // 070's own policy decides whether these come back at all: owner/admin, or
    // the person who wrote the report. A supervisor reading a colleague's
    // report gets an EMPTY list rather than an error, which is why the heading
    // below is conditional on the rows rather than on the role.
    supabase
      .from("shift_report_ratings")
      .select("id, employee_id, position, score, note, got_break, break_reason")
      .eq("report_id", id),
    supabase
      .from("daily_sales")
      .select("business_date, net_sales_cents, tips_cents")
      .eq("location_id", report.location_id)
      .in("business_date", [reportDate, daysBefore(reportDate, 7)]),
  ]);

  const nameById = new Map<string, string>(
    ((takers as { id: string; name: string }[] | null) ?? []).map((t) => [t.id, t.name])
  );
  const salesByDate = new Map(
    ((sales as Record<string, unknown>[] | null) ?? []).map((s) => [
      s.business_date as string,
      { net: Number(s.net_sales_cents), tips: Number(s.tips_cents) },
    ])
  );
  const settled = salesByDate.get(reportDate) ?? null;

  // What the EMAIL quoted, kept in `email_receipt` as a record of what was
  // claimed rather than as a fact about the day. If the settled figure has
  // since arrived and differs, the reader should be told which they are looking
  // at — `printedPoDisagreement`'s shape.
  const quoted = (report.email_receipt as { net_sales_cents?: number } | null) ?? null;
  const quotedNet = typeof quoted?.net_sales_cents === "number" ? quoted.net_sales_cents : null;
  const salesDisagree =
    settled !== null && quotedNet !== null && Math.abs(settled.net - quotedNet) > 1;

  const locationCode =
    session.locations.find((l) => l.id === report.location_id)?.code ?? "—";
  const supervisorName = report.supervisor_employee_id
    ? nameById.get(report.supervisor_employee_id as string) ?? null
    : null;

  const ratingRows = (ratings as Record<string, unknown>[] | null) ?? [];

  return (
    <div className="space-y-16">
      {/* The trail follows the route TAKEN, not a fixed hierarchy — reached
          from a filtered list, it goes back to that view. */}
      <Breadcrumbs
        trail={parseTrail(query, { href: "/shift-reports", label: "Shift Reports" })}
        current={`${locationCode} ${SHIFT_SLOT_LABEL[shift].toLowerCase()} — ${reportDate}`}
      />

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-[0.06em]">
              {locationCode} · {SHIFT_SLOT_LABEL[shift]} · {reportDate}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {supervisorName ?? "Supervisor not named"}
              {report.sent_at
                ? ` · sent ${String(report.sent_at).slice(0, 10)}`
                : " · not sent yet"}
            </p>
          </div>
          {isDraft ? (
            <Link href={`/shift-reports/${id}/run`} className="text-sm underline">
              Resume this report
            </Link>
          ) : null}
        </div>

        {report.sent_at && !report.emailed_at ? (
          <p className="text-sm">
            <span className="bg-mark-fill px-1">Sent, but not emailed</span>{" "}
            <span className="text-muted">
              — the counts and ratings were recorded; the team was not told.
            </span>
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <SectionHeading>How the shift went</SectionHeading>
        {report.narrative ? (
          <p className="max-w-3xl whitespace-pre-wrap text-[15px] leading-relaxed">
            {report.narrative as string}
          </p>
        ) : (
          <p className="text-sm text-faint">Nothing was written.</p>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeading>Sales</SectionHeading>
        <dl className="max-w-sm space-y-2">
          <div className="flex justify-between gap-8">
            <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Net sales</dt>
            <dd>{money(settled?.net ?? null)}</dd>
          </div>
          <div className="flex justify-between gap-8">
            <dt className="text-xs font-semibold uppercase tracking-[0.08em]">Tips</dt>
            <dd>{money(settled?.tips ?? null)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          {settled === null
            ? "Square has not reported this day."
            : "The settled figure, from Square's own reporting day."}
        </p>
        {salesDisagree ? (
          <p className="text-sm">
            <span className="bg-mark-fill px-1">
              The email quoted {money(quotedNet)}
            </span>{" "}
            <span className="text-muted">
              — that was provisional; the figure above is the settled one.
            </span>
          </p>
        ) : null}
      </section>

      {/* Conditional on the ROWS, not the role: a supervisor reading somebody
          else's report gets an empty list from the policy, and a heading over
          nothing would tell them there was something to be kept from. */}
      {ratingRows.length > 0 ? (
        <section className="space-y-4">
          <SectionHeading count={ratingRows.length}>Staff ratings</SectionHeading>
          <table className="w-full max-w-4xl">
            <thead>
              <tr className="border-b-2 border-ink text-xs font-semibold uppercase tracking-[0.08em]">
                <th className="py-2 text-left">Who</th>
                <th className="py-2 text-left">Position</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {ratingRows.map((r) => (
                <tr key={r.id as string} className="border-b border-hairline/60">
                  <td className="py-2 pr-3 text-[15px]">
                    {nameById.get(r.employee_id as string) ?? "Somebody"}
                  </td>
                  <td className="py-2 pr-3 text-[15px]">{(r.position as string) ?? "—"}</td>
                  <td className="py-2 pr-3 text-right text-[15px]">
                    {r.score === null ? "—" : Number(r.score).toFixed(2)}
                  </td>
                  <td className="py-2 text-[15px]">
                    {(r.note as string) ?? ""}
                    {r.got_break === false ? (
                      <span className="ml-2 bg-mark-fill px-1 text-xs">
                        missed break
                        {r.break_reason ? `: ${r.break_reason as string}` : ""}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : canReadHr(role) ? (
        <section className="space-y-4">
          <SectionHeading>Staff ratings</SectionHeading>
          <p className="text-sm text-faint">Nobody was rated on this shift.</p>
        </section>
      ) : null}
    </div>
  );
}
