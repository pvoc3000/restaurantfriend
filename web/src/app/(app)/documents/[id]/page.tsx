import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { canDeleteInspection } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { DOCUMENT_BUCKET, DOCUMENT_SELECT, ORG_DOCUMENT_FILES, type OrgDocument } from "@/lib/orgDocuments";
import { FiledDocuments, type FiledDocument } from "@/components/documents/FiledDocuments";
import { DocumentActions } from "@/components/documents/DocumentActions";

const CRUMB = { href: "/documents", label: "Documents" };

/** One document: its record on the left, the file previewed on the right —
 *  the inspection record's shape (Mark: "like the inspection report"). */
export default async function DocumentPage({
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
  const editable = canEditPage(session.membership.role, "/documents");

  const [{ data: doc, error }, { data: files }, { data: cats }] = await Promise.all([
    supabase.from("org_documents").select(DOCUMENT_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("org_document_files")
      .select("id, storage_path, file_name, content_type")
      .eq("document_id", id)
      .order("created_at"),
    supabase.from("org_documents").select("category").eq("org_id", orgId),
  ]);
  if (error) return <p className="text-sm text-accent">Could not load this document: {error.message}</p>;
  if (!doc) notFound();
  const row = doc as unknown as OrgDocument;

  const paths = (files ?? []).map((f) => f.storage_path as string);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const documents: FiledDocument[] = (files ?? []).map((f) => ({
    id: f.id as string,
    url: signed.get(f.storage_path as string) ?? null,
    storage_path: f.storage_path as string,
    file_name: (f.file_name as string | null) ?? null,
    content_type: (f.content_type as string | null) ?? null,
  }));

  const trail = parseTrail(rawParams, CRUMB);
  const categoryOptions = [
    { value: "", label: "No category" },
    ...[...new Set((cats ?? []).map((c) => c.category as string | null).filter((c): c is string => !!c))]
      .sort()
      .map((c) => ({ value: c, label: c })),
  ];
  const shopOptions = [
    { value: "", label: "All shops" },
    ...session.activeLocations.map((l) => ({ value: l.id, label: l.code })),
  ];
  const label = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";
  const cell = (column: string, value: string | null, aria: string, extra: Record<string, unknown> = {}) => (
    <InlineValue
      readOnly={!editable}
      table="org_documents"
      id={id}
      column={column}
      value={value}
      boxed={BOXED_FIELDS}
      ariaLabel={aria}
      {...extra}
    />
  );

  return (
    <div className="space-y-12">
      <Breadcrumbs
        trail={trail}
        current={row.title}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {/* The title keeps the underline — the one exception to the boxes. */}
            <InlineValue
              readOnly={!editable}
              table="org_documents"
              id={id}
              column="title"
              value={row.title}
              nullable={false}
              ariaLabel="Title"
              className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]"
            />
          </h1>
          <p className="text-sm text-muted">
            {[row.category, row.version ? `v${row.version}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {canDeleteInspection(session.membership.role) && (
          <div className="ml-auto">
            <DocumentActions documentId={id} title={row.title} filePaths={paths} />
          </div>
        )}
      </div>

      <div className="grid gap-12 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-12">
          <section className="space-y-4">
            <SectionHeading>Details</SectionHeading>
            <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
              <dt className={label}>Category</dt>
              <dd>{cell("category", row.category, "Category", { kind: "pick", allowNew: true, options: categoryOptions })}</dd>
              <dt className={label}>Version</dt>
              <dd>{cell("version", row.version, "Version")}</dd>
              <dt className={label}>Shop</dt>
              <dd>{cell("location_id", row.location_id ?? "", "Shop", { kind: "pick", options: shopOptions, placeholder: "All shops" })}</dd>
              <dt className={label}>Added</dt>
              <dd>{cell("added_on", row.added_on, "Added", { kind: "date" })}</dd>
              <dt className={label}>Submitted by</dt>
              <dd>{cell("submitted_by", row.submitted_by, "Submitted by")}</dd>
            </dl>
          </section>
          <section className="space-y-3">
            <SectionHeading>Description</SectionHeading>
            {cell("description", row.description, "Description", { multiline: true })}
          </section>
          <section className="space-y-3">
            <SectionHeading>Notes</SectionHeading>
            {cell("notes", row.notes, "Notes", { multiline: true })}
          </section>
        </div>
        <FiledDocuments target={ORG_DOCUMENT_FILES} ownerId={id} orgId={orgId} documents={documents} editable={editable} />
      </div>
    </div>
  );
}
