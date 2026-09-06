import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { canDeleteInspection } from "@/lib/roles";
import { parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { INSPECTION_SELECT, type Inspection } from "@/lib/inspections";
import { TASK_STATUS_LABEL, isTaskOpen, type TaskStatus } from "@/lib/facilityTasks";
import { InspectionDocuments, type InspectionDocument } from "@/components/inspections/InspectionDocuments";
import { InspectionActions } from "@/components/inspections/InspectionActions";
import { ScoreChip } from "@/components/inspections/InspectionsList";
import { NewTask } from "@/components/tasks/NewTask";
import type { Assignee } from "@/components/tasks/TasksScreen";

const CRUMB = { href: "/inspection-logs", label: "Inspection logs" };

/**
 * One inspector's visit (093): what they found, the report they left, and the
 * work it produced. Tasks raised here carry `source_inspection_id`, so this
 * record lists its own follow-up — and because they are ordinary
 * `location_tasks`, they land on every closing checklist until done, which is
 * the "show up on the checklist until resolved like issues do" Mark asked for.
 */
export default async function InspectionPage({
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
  const orgId = session.membership.org_id;
  const editable = canEditPage(session.membership.role, "/inspection-logs");

  const [
    { data: inspection, error },
    { data: docs },
    { data: tasks },
    { data: types },
    { data: members },
  ] = await Promise.all([
    supabase.from("inspections").select(INSPECTION_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("facility_photos")
      .select("id, storage_path, file_name, content_type")
      .eq("inspection_id", id)
      .order("created_at"),
    supabase
      .from("location_tasks")
      .select("id, title, status, due_on, priority, created_at")
      .eq("source_inspection_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("inspections").select("inspection_type").eq("org_id", orgId),
    supabase.from("org_members").select("user_id, display_name, role"),
  ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load this inspection: {error.message}</p>;
  }
  if (!inspection) notFound();
  const row = inspection as unknown as Inspection;
  const location = session.locations.find((l) => l.id === row.location_id);

  // The task dialog's pickers, scoped to this shop (TasksPage's own queries).
  const [{ data: equipment }, { data: sections }] = await Promise.all([
    supabase
      .from("equipment")
      .select("id, name, shop_section_id")
      .eq("location_id", row.location_id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("shop_sections")
      .select("id, display_name")
      .eq("location_id", row.location_id)
      .order("sort_order"),
  ]);
  const assignees: Assignee[] = (members ?? [])
    .filter((m) => m.role !== "staff")
    .map((m) => ({
      user_id: m.user_id as string,
      name: ((m.display_name as string | null)?.trim() || "Invited member") as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Signed URLs, server-side, one batch (077's rule).
  const paths = (docs ?? []).map((d) => d.storage_path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const documents: InspectionDocument[] = (docs ?? []).map((d) => ({
    id: d.id as string,
    url: signed.get(d.storage_path as string) ?? null,
    storage_path: d.storage_path as string,
    file_name: (d.file_name as string | null) ?? null,
    content_type: (d.content_type as string | null) ?? null,
  }));

  const trail = parseTrail(rawParams, CRUMB);
  const title = `${row.inspection_type} inspection · ${row.inspected_on}`;
  const typeOptions = [...new Set(["Health", ...(types ?? []).map((t) => t.inspection_type as string)])]
    .filter(Boolean)
    .sort()
    .map((t) => ({ value: t, label: t }));
  const openCount = (tasks ?? []).filter((t) => isTaskOpen({ status: t.status as TaskStatus })).length;

  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

  return (
    <div className="space-y-12">
      <Breadcrumbs trail={trail} current={title} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">{title}</h1>
          <p className="flex items-center gap-3 text-sm text-muted">
            <span>{location?.code ?? "—"}</span>
            <ScoreChip score={row.score} />
            {openCount > 0 && <span>{openCount} open {openCount === 1 ? "task" : "tasks"}</span>}
          </p>
        </div>
        {canDeleteInspection(session.membership.role) && (
          <div className="ml-auto">
            <InspectionActions
              inspectionId={id}
              label={title}
              documentPaths={paths}
              taskCount={(tasks ?? []).length}
            />
          </div>
        )}
      </div>

      {/* THE RECORD ON THE LEFT, THE REPORT ON THE RIGHT (Mark, 2026-09-05) —
          the invoice record mirrored: here the document is what you check the
          typed record against, so it stands beside it rather than above. The
          right column measures its own height; see `InspectionDocuments`. */}
      <div className="grid gap-12 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-12">
      <section className="space-y-4">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className={label}>Date</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="inspections"
              id={id}
              column="inspected_on"
              kind="date"
              nullable={false}
              value={row.inspected_on}
              boxed={BOXED_FIELDS}
              ariaLabel="Inspection date"
            />
          </dd>
          <dt className={label}>Type</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="inspections"
              id={id}
              column="inspection_type"
              kind="pick"
              allowNew
              nullable={false}
              value={row.inspection_type}
              options={typeOptions}
              boxed={BOXED_FIELDS}
              ariaLabel="Inspection type"
            />
          </dd>
          <dt className={label}>Score</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="inspections"
              id={id}
              column="score"
              value={row.score}
              boxed={BOXED_FIELDS}
              ariaLabel="Score"
            />
          </dd>
          <dt className={label}>Inspector</dt>
          <dd>
            <InlineValue
              readOnly={!editable}
              table="inspections"
              id={id}
              column="inspector"
              value={row.inspector}
              boxed={BOXED_FIELDS}
              ariaLabel="Inspector"
            />
          </dd>
        </dl>
      </section>

      <section className="space-y-3">
          <SectionHeading>Violations</SectionHeading>
          <InlineValue
            readOnly={!editable}
            table="inspections"
            id={id}
            column="violations"
            value={row.violations}
            multiline
            boxed={BOXED_FIELDS}
            ariaLabel="Violations"
          />
        </section>
      <section className="space-y-3">
          <SectionHeading>Corrected</SectionHeading>
          <InlineValue
            readOnly={!editable}
            table="inspections"
            id={id}
            column="violations_corrected"
            value={row.violations_corrected}
            multiline
            boxed={BOXED_FIELDS}
            ariaLabel="What was corrected"
          />
        </section>


      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <SectionHeading count={(tasks ?? []).length}>Follow-up</SectionHeading>
          {editable && (
            <div className="ml-auto">
              <NewTask
                kind="task"
                orgId={orgId}
                locationId={row.location_id}
                equipment={(equipment ?? []) as { id: string; name: string; shop_section_id: string | null }[]}
                sections={(sections ?? []) as { id: string; display_name: string }[]}
                assignees={assignees}
                sourceInspectionId={id}
                buttonLabel="New task from this inspection"
              />
            </div>
          )}
        </div>
        {(tasks ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            Nothing raised from this inspection yet. A task raised here goes on every closing
            checklist until it is done.
          </p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {(tasks ?? []).map((t) => {
              const open = isTaskOpen({ status: t.status as TaskStatus });
              return (
                <li key={t.id as string} className="flex items-center gap-4 py-2 text-sm">
                  <Link
                    href={`/tasks?open=${t.id}`}
                    className={`min-w-0 flex-1 truncate underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 ${open ? "text-ink" : "text-muted"}`}
                  >
                    {t.title as string}
                  </Link>
                  {t.due_on && (
                    <span className="shrink-0 tabular-nums text-muted">due {t.due_on as string}</span>
                  )}
                  <span className={`shrink-0 ${open ? "bg-mark-fill px-1 text-ink" : READ_ONLY_VALUE + " text-muted"}`}>
                    {TASK_STATUS_LABEL[t.status as TaskStatus]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
        </div>
      <section>
        <InspectionDocuments inspectionId={id} orgId={orgId} documents={documents} editable={editable} />
      </section>
      </div>
    </div>
  );
}
