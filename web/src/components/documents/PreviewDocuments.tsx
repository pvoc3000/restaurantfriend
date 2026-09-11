"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { DocumentViewer } from "@/components/ui/DocumentViewer";
import { printDocument } from "@/lib/printDocument";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/facilityPhotos";
import { DOCUMENT_BUCKET } from "@/lib/orgDocuments";

type PreviewFile = {
  id: string;
  document_id: string;
  file_name: string | null;
  content_type: string | null;
  url: string | null;
};

/**
 * One or several documents' files, previewed from the list (Mark, 2026-09-11:
 * "Preview…" on a row, "Preview Selected…" in the Actions menu). The files are
 * read and signed when the panel opens — the list carries only counts, and
 * signing every file on every load of the list is a cost nobody asked for.
 *
 * With more than one file a column down the left picks which is shown; the
 * viewer is `ui/DocumentViewer`, keyed by file, as on the record.
 */
export function PreviewDocuments({
  documents,
  onClose,
}: {
  documents: readonly { id: string; title: string }[];
  onClose: () => void;
}) {
  const [files, setFiles] = useState<PreviewFile[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let live = true;
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase
        .from("org_document_files")
        .select("id, document_id, storage_path, file_name, content_type")
        .in(
          "document_id",
          documents.map((d) => d.id)
        )
        .order("created_at");
      if (!live) return;
      if (error) {
        setFailed(error.message);
        setFiles([]);
        return;
      }
      const paths = (data ?? []).map((f) => f.storage_path as string);
      const signed = new Map<string, string>();
      if (paths.length > 0) {
        const { data: urls } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
        for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
      }
      if (!live) return;
      setFiles(
        (data ?? []).map((f) => ({
          id: f.id as string,
          document_id: f.document_id as string,
          file_name: (f.file_name as string | null) ?? null,
          content_type: (f.content_type as string | null) ?? null,
          url: signed.get(f.storage_path as string) ?? null,
        }))
      );
    })();
    return () => {
      live = false;
    };
  }, [documents]);

  const byDocument = documents.map((doc) => ({
    doc,
    files: (files ?? []).filter((f) => f.document_id === doc.id),
  }));
  const ordered = byDocument.flatMap((d) => d.files);
  const shown = ordered.find((f) => f.id === picked) ?? ordered[0] ?? null;
  const withPicker = documents.length > 1 || ordered.length > 1;

  /**
   * Printing is the point of the screen (Mark, 2026-09-11: "I need to be able
   * to print the documents using preview"), and it needs a button of its own:
   * on a desk the embedded PDF viewer supplies one, and on an iPad it does not
   * — `<object>` there shows page one with no toolbar at all. `printDocument`
   * picks the route that works on this device. Called straight from the click
   * with nothing awaited first, because the iOS route opens a tab.
   */
  async function print() {
    if (!shown?.url) return;
    setFailed(null);
    setPrinting(true);
    try {
      await printDocument(shown.url, shown.content_type);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not print.");
    } finally {
      setPrinting(false);
    }
  }
  const pick = "block w-full truncate text-left text-sm";
  const pickClass = (id: string) =>
    shown?.id === id
      ? `${pick} font-semibold text-ink`
      : `${pick} text-body underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900`;

  return (
    <Dialog
      title={documents.length === 1 ? documents[0].title : `${documents.length} documents`}
      onClose={onClose}
      width="max-w-6xl"
      height="h-[88vh]"
      bodyClassName="p-0"
      footer={
        <>
          <div className="mr-auto flex flex-wrap items-center gap-3">
            {shown?.url && (
              <>
                <button type="button" className={BUTTON_CLASS} disabled={printing} onClick={() => void print()}>
                  {printing ? "Printing…" : "Print"}
                </button>
                <a
                  className={BUTTON_CLASS}
                  href={`${shown.url}&download=${encodeURIComponent(shown.file_name ?? "file")}`}
                >
                  Download
                </a>
              </>
            )}
            {failed && <span className="text-sm text-accent">{failed}</span>}
          </div>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        {withPicker && files !== null && (
          <nav aria-label="Files" className="w-64 shrink-0 space-y-3 overflow-y-auto border-r border-ink p-4">
            {byDocument.map(({ doc, files: own }) => (
              <div key={doc.id} className="space-y-1">
                {own.length === 1 ? (
                  <button
                    type="button"
                    onClick={() => setPicked(own[0].id)}
                    aria-pressed={shown?.id === own[0].id}
                    className={pickClass(own[0].id)}
                  >
                    {doc.title}
                  </button>
                ) : (
                  <>
                    <p className="truncate text-sm font-semibold text-ink">{doc.title}</p>
                    {own.length === 0 ? (
                      <p className="text-sm text-faint">No file</p>
                    ) : (
                      own.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setPicked(f.id)}
                          aria-pressed={shown?.id === f.id}
                          className={`${pickClass(f.id)} pl-3`}
                        >
                          {f.file_name ?? "File"}
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>
            ))}
          </nav>
        )}
        <div className="min-w-0 flex-1">
          {files === null ? (
            <p className="grid h-full place-items-center text-sm text-muted">Loading…</p>
          ) : shown ? (
            <DocumentViewer
              key={shown.id}
              url={shown.url}
              fileName={shown.file_name}
              image={(shown.content_type ?? "").startsWith("image/")}
            />
          ) : (
            <p className="grid h-full place-items-center text-sm text-muted">No file to preview.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
