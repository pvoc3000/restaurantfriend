import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateTitle } from "@/lib/productionPlans";
import { photoPath } from "@/lib/facilityPhotos";
import { DOCUMENT_BUCKET, DOCUMENT_SELECT, type OrgDocument } from "@/lib/orgDocuments";

/**
 * The two document writes with more than one door — the list's Actions menu,
 * its row menu, and the record's own Delete — so the `.select()` discipline and
 * the write ORDER live in one place (`tagWrites`' rule).
 */

/**
 * Row first, then the objects. The file ROWS cascade with the record, so their
 * paths are read before the delete; an orphaned object is invisible where a row
 * pointing at nothing is not. A refused delete (below owner/admin, 094) removes
 * zero rows and returns NO error, hence the count.
 */
export async function deleteDocuments(
  supabase: SupabaseClient,
  ids: readonly string[]
): Promise<{ deleted: number; error: string | null }> {
  const { data: files, error: fileError } = await supabase
    .from("org_document_files")
    .select("document_id, storage_path")
    .in("document_id", [...ids]);
  if (fileError) return { deleted: 0, error: fileError.message };
  const { data, error } = await supabase.from("org_documents").delete().in("id", [...ids]).select("id");
  if (error) return { deleted: 0, error: error.message };
  const gone = new Set((data ?? []).map((r) => r.id as string));
  const paths = (files ?? []).filter((f) => gone.has(f.document_id as string)).map((f) => f.storage_path as string);
  if (paths.length > 0) await supabase.storage.from(DOCUMENT_BUCKET).remove(paths);
  return {
    deleted: gone.size,
    error:
      gone.size === ids.length
        ? null
        : `${ids.length - gone.size} of ${ids.length} were not deleted — you may not have permission.`,
  };
}

/**
 * A copy of a document: title "… copy", every other field the same, added
 * today, and every file COPIED in the bucket under the new record's own folder
 * (094's policies authorise off the folder's org, and a copy sharing the
 * original's objects would lose them when either record is deleted). Written
 * parent-first; a file that fails to copy is named rather than failing the
 * record, which is real and one Attach from whole.
 */
export async function duplicateDocument(
  supabase: SupabaseClient,
  orgId: string,
  documentId: string,
  today: string
): Promise<{ id: string | null; warning: string | null; error: string | null }> {
  const [{ data: doc, error }, { data: files }, { data: titles }] = await Promise.all([
    supabase.from("org_documents").select(DOCUMENT_SELECT).eq("id", documentId).maybeSingle(),
    supabase
      .from("org_document_files")
      .select("storage_path, file_name, content_type, byte_size")
      .eq("document_id", documentId)
      .order("created_at"),
    supabase.from("org_documents").select("title").eq("org_id", orgId),
  ]);
  if (error) return { id: null, warning: null, error: error.message };
  if (!doc) return { id: null, warning: null, error: "That document no longer exists." };
  const source = doc as unknown as OrgDocument;
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data: created, error: insertError } = await supabase
    .from("org_documents")
    .insert({
      org_id: orgId,
      location_id: source.location_id,
      title: duplicateTitle((titles ?? []).map((t) => t.title as string), source.title),
      version: source.version,
      category: source.category,
      description: source.description,
      notes: source.notes,
      submitted_by: source.submitted_by,
      added_on: today,
      created_by: uid,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    return { id: null, warning: null, error: insertError?.message ?? "The copy was not created." };
  }

  let failed = 0;
  for (const f of files ?? []) {
    const to = photoPath(orgId, created.id, (f.file_name as string | null) ?? (f.storage_path as string));
    const copy = await supabase.storage.from(DOCUMENT_BUCKET).copy(f.storage_path as string, to);
    if (copy.error) {
      failed++;
      continue;
    }
    const { data: row, error: rowError } = await supabase
      .from("org_document_files")
      .insert({
        org_id: orgId,
        document_id: created.id,
        storage_path: to,
        file_name: f.file_name,
        content_type: f.content_type,
        byte_size: f.byte_size,
        uploaded_by: uid,
      })
      .select("id");
    if (rowError || !row || row.length === 0) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([to]);
      failed++;
    }
  }
  return {
    id: created.id,
    warning: failed ? `${failed} file${failed === 1 ? " did" : "s did"} not copy — attach ${failed === 1 ? "it" : "them"} on the copy.` : null,
    error: null,
  };
}
