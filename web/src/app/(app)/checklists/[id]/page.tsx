import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWalkChecklists, canReopenChecklistRun } from "@/lib/roles";
import { loadChecklistRun } from "@/lib/checklistRunData";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ReopenChecklistRun } from "@/components/checklists/ReopenChecklistRun";
import { PrintChecklist } from "@/components/checklists/PrintChecklist";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { SHIFT_SLOT_LABEL } from "@/lib/employeeEvents";
import {
  CHECKLIST_KIND_LABEL,
  CHECK_STATUS_LABEL,
  progressLabel,
  readingLabel,
  sectionScores,
  type ChecklistKind,
} from "@/lib/checklists";

const CRUMB = { href: "/checklists", label: "Checklists" };

/**
 * One checklist, walkthrough or inspection, as a record.
 *
 * READ-ONLY, deliberately: there is ONE write path and the runner is it. A
 * second editor here would be two places to correct one answer, and the fastest
 * route to fixing a mistake is to reopen it — which is a link, not a form.
 */
export default async function ChecklistRunRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();

  const { data, error } = await loadChecklistRun(supabase, id, session.userId);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load this record: {error}
      </p>
    );
  }
  if (!data) notFound();

  const { run, items } = data;
  const trail = parseTrail(rawParams, CRUMB);
  const locationCode =
    session.locations.find((l) => l.id === run.location_id)?.code ?? "";
  const editable = canWalkChecklists(session.membership.role);
  const canReopen = canReopenChecklistRun(session.membership.role);

  // Who walked it, for the printed document. `org_members` is readable by every
  // member (001's `members_read`), so this needs no definer — unlike a name off
  // `employees`, which 020 gates to owner/admin.
  const walkerId = run.started_by ?? run.created_by;
  const { data: walker } = walkerId
    ? await supabase
        .from("org_members")
        .select("display_name")
        .eq("user_id", walkerId)
        .maybeSingle()
    : { data: null };
  const isWalkthrough = run.kind === "walkthrough";
  const scores = isWalkthrough ? sectionScores(items) : [];
  const issues = items.filter((i) => i.status === "issue");

  // The walk order the run was written in — one band per section, in the order
  // the rows arrive, which is the shop's own.
  const bands: { section: string; rows: typeof items }[] = [];
  for (const i of items) {
    const key = i.section_name ?? "No section";
    const last = bands[bands.length - 1];
    if (last && last.section === key) last.rows.push(i);
    else bands.push({ section: key, rows: [i] });
  }

  return (
    <div className="space-y-12">
      <Breadcrumbs trail={trail} current={run.title} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {run.title}
          </h1>
          <p className="text-sm text-muted">
            {CHECKLIST_KIND_LABEL[run.kind as ChecklistKind]}
            {locationCode && ` · ${locationCode}`} · {run.business_date}
            {run.shift && ` · ${SHIFT_SLOT_LABEL[run.shift as never] ?? run.shift}`} ·{" "}
            {progressLabel(items)}
            {run.status === "open" ? " · unfinished" : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-3">
          {editable && (
            <Link href={`/checklists/${id}/run`} className={BUTTON_CLASS}>
              {/* "View", not "Reopen" — the runner renders a finished record
                  READ-ONLY, so the old label promised something the screen it
                  led to could not do. Reopening is the command beside it. */}
              {run.status === "open" ? "Continue" : "View"}
            </Link>
          )}
          <PrintChecklist
            data={{
              orgName: session.orgName,
              kindLabel: CHECKLIST_KIND_LABEL[run.kind as ChecklistKind],
              title: run.title,
              locationCode,
              businessDate: run.business_date,
              shiftLabel: run.shift
                ? (SHIFT_SLOT_LABEL[run.shift as never] ?? run.shift)
                : null,
              status: run.status === "open" ? "open" : "submitted",
              walkedBy: (walker?.display_name as string | null) ?? null,
              submittedAt: run.submitted_at ? run.submitted_at.slice(0, 10) : null,
              printedOn: new Date().toISOString().slice(0, 10),
              items: items.map((i) => ({
                status: i.status,
                prompt: i.prompt,
                sectionName: i.section_name,
                guidance: i.guidance,
                position: i.position,
                equipmentName: i.equipment_name,
                note: i.note,
                valueText: i.value_text,
                valueNumber: i.value_number,
                unit: i.unit,
                expected: readingLabel(i, i.value_number),
                score: i.score,
              })),
            }}
          />
          {run.status !== "open" && canReopen && (
            <ReopenChecklistRun
              runId={id}
              title={run.title}
              submittedAt={run.submitted_at}
              issueCount={issues.length}
            />
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <section className="space-y-3">
          <SectionHeading count={issues.length}>Issues</SectionHeading>
          <ul className="space-y-2">
            {issues.map((i) => (
              <li key={i.id} className="border-l-2 border-accent pl-3">
                <p className="text-sm font-medium">{i.prompt}</p>
                {i.note && <p className="text-sm text-muted">{i.note}</p>}
                <p className="text-[12px] text-muted">
                  {i.section_name ?? "No section"}
                  {i.task_id ? " · a task was raised" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isWalkthrough && scores.some((s) => s.average != null) && (
        <section className="space-y-3">
          <SectionHeading>Scores</SectionHeading>
          {/* DERIVED from the item scores, never stored — so the trend exists
              without a second number anybody has to maintain. A section with
              nothing scored says so rather than reporting a nought, which in
              035's range is a real and much worse verdict. */}
          <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            {scores.map((s) => (
              <div key={s.section} className="contents">
                <dt>{s.section}</dt>
                <dd className="tabular-nums">
                  {s.average == null ? (
                    <span className="text-muted">not scored</span>
                  ) : (
                    `${s.average.toFixed(2)} · ${s.scored} scored`
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-6">
        <SectionHeading count={items.length}>What was checked</SectionHeading>
        {bands.map((band) => (
          <div key={band.section}>
            <h3 className="bg-ink px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white">
              {band.section}
            </h3>
            <ul className="divide-y divide-hairline border border-t-0 border-hairline">
              {band.rows.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-x-4 gap-y-1 p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    {i.prompt}
                    {i.note && (
                      <span className="block text-[13px] text-muted">{i.note}</span>
                    )}
                    {i.photos.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        {i.photos.map((p) =>
                          p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={p.id}
                              src={p.url}
                              alt=""
                              className="h-16 w-16 border border-hairline object-cover"
                            />
                          ) : null,
                        )}
                      </span>
                    )}
                  </span>
                  {i.value_number != null && (
                    <span className="tabular-nums">
                      {i.value_number}
                      {i.unit ? ` ${i.unit}` : ""}
                    </span>
                  )}
                  {i.value_text && <span>{i.value_text}</span>}
                  {i.score != null && (
                    <span className="tabular-nums text-muted">score {i.score}</span>
                  )}
                  <span
                    className={
                      i.status === "issue"
                        ? "bg-accent px-1 text-white"
                        : i.status === "pending"
                          ? "text-muted"
                          : ""
                    }
                  >
                    {CHECK_STATUS_LABEL[i.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted">This checklist has no items.</p>
        )}
      </section>

    </div>
  );
}
