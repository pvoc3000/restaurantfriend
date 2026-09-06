import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditPage } from "@/lib/pageAccess";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { DOCUMENT_SELECT } from "@/lib/orgDocuments";
import { DocumentsList, type DocumentRow } from "@/components/documents/DocumentsList";
import { NewDocument } from "@/components/documents/NewDocument";

/**
 * Documents — "a place to store, retrieve, and print the documents the
 * organization uses" (Mark, 2026-09-05). Org-wide; migration 094.
 */
export default async function DocumentsPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const orgId = session.membership.org_id;
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  const { data: docs, error } = await supabase
    .from("org_documents")
    .select(DOCUMENT_SELECT)
    .eq("org_id", orgId)
    .order("category")
    .order("title");

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the documents: {error.message}
        {/org_documents/.test(error.message) && " — migration 094 has not been applied yet."}
      </p>
    );
  }

  const ids = (docs ?? []).map((d) => d.id);
  const fileCount = new Map<string, number>();
  if (ids.length > 0) {
    const { data: files } = await supabase.from("org_document_files").select("document_id").in("document_id", ids);
    for (const f of files ?? []) fileCount.set(f.document_id, (fileCount.get(f.document_id) ?? 0) + 1);
  }
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: DocumentRow[] = (docs ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    version: d.version,
    category: d.category,
    location_code: d.location_id ? (codeById.get(d.location_id) ?? null) : null,
    description: d.description,
    added_on: d.added_on,
    file_count: fileCount.get(d.id) ?? 0,
  }));
  const categories = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort();
  const editable = canEditPage(session.membership.role, "/documents");

  return (
    <DocumentsList
      rows={rows}
      action={
        editable && (
          <NewDocument
            orgId={orgId}
            today={today}
            categories={categories}
            locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
          />
        )
      }
    />
  );
}
