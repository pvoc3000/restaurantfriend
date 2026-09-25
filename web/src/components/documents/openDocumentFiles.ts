import type { SupabaseClient } from "@supabase/supabase-js";
import { showBlob } from "@/lib/poProcessing";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { DOCUMENT_BUCKET } from "@/lib/orgDocuments";

/**
 * Open documents' files in a browser tab, where printing and downloading
 * already are (Mark, 2026-09-11: "skip the middleman and just open the pdf in
 * a new tab so it can be printed and downloaded"). This replaced a preview
 * panel whose whole job was to put a viewer, a Print and a Download in front
 * of the same file the browser shows for nothing.
 *
 * SEVERAL FILES ARE ROLLED INTO ONE PDF FIRST (Mark, same day) — so printing
 * five signs is one tab and one print rather than five of each, and on an
 * iPad, where Safari allows about one new tab per tap, a selection opens at
 * all. One file is passed straight through: there is nothing to merge, and
 * re-encoding somebody's PDF to show them their own PDF would be work that
 * can only lose something.
 *
 * THE CALLER OPENS `win` BEFORE ANYTHING IS AWAITED (`openWindowNow`) — a
 * window opened after an await is silently blocked — and this points it at the
 * file or the merged blob once it exists. Shared by the list's Open and the
 * record's Open Document (Mark, 2026-09-25), so the two cannot drift.
 *
 * Returns a message to show, or null: an error (and `win` is closed), or the
 * files a merge had to leave out — a merge quietly one document short is worse
 * than one that refused.
 */
export async function openDocumentFiles(
  supabase: SupabaseClient,
  win: Window,
  documentIds: string[],
  today: string
): Promise<string | null> {
  const fail = (message: string) => {
    win.close();
    return message;
  };

  const { data, error } = await supabase
    .from("org_document_files")
    .select("document_id, storage_path, file_name, content_type")
    .in("document_id", documentIds)
    .order("created_at");
  if (error) return fail(error.message);

  // In the order they were asked for: each document's files, oldest first.
  const byDocument = new Map<string, { path: string; name: string | null; type: string | null }[]>();
  for (const f of data ?? []) {
    const list = byDocument.get(f.document_id as string) ?? [];
    list.push({
      path: f.storage_path as string,
      name: (f.file_name as string | null) ?? null,
      type: (f.content_type as string | null) ?? null,
    });
    byDocument.set(f.document_id as string, list);
  }
  const files = documentIds.flatMap((id) => byDocument.get(id) ?? []);
  if (files.length === 0) return fail("There are no files to open.");

  const { data: urls } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrls(
    files.map((f) => f.path),
    PHOTO_URL_TTL_SECONDS
  );
  const signed = new Map<string, string>();
  for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  const sources = files
    .map((f) => ({ url: signed.get(f.path), fileName: f.name, contentType: f.type }))
    .filter((s): s is { url: string; fileName: string | null; contentType: string | null } => !!s.url);

  if (sources.length === 0) return fail("Those files could not be opened. Reload the page and try again.");
  if (sources.length === 1) {
    win.location.href = sources[0].url;
    return null;
  }

  try {
    const { mergeToSinglePdf, mergedFileName } = await import("@/lib/mergeDocuments");
    const result = await mergeToSinglePdf(sources);
    if (result.merged === 0) return fail("None of those files could be read, so there was nothing to open.");
    showBlob(win, result.blob, mergedFileName(today, result.merged));
    return result.skipped.length > 0 ? `Left out of the merged PDF: ${result.skipped.join(", ")}.` : null;
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The documents could not be merged.");
  }
}
