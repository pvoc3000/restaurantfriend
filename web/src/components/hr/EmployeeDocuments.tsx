"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  documentPath,
  missingPaperwork,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KIND_OPTIONS,
  EMPLOYEE_DOCS_BUCKET,
  type DocumentKind,
  type SignedEmployeeDocument,
} from "@/lib/employeeDocuments";
import { fileSize, isImage } from "@/lib/attachments";
import { PickList } from "@/components/ui/PickList";
import { ProgressBand } from "@/components/ui/ProgressBand";

/**
 * The personnel file.
 *
 * FMP tracked onboarding as eight checkboxes with the documents themselves
 * nowhere in the system (Mark, 2026-08-01: paperwork should be "flags that are
 * set when those documents are uploaded"). So the completeness line at the top
 * is DERIVED from what's filed — there is nothing to keep in sync, and
 * "complete" cannot be true without the file.
 *
 * The two write orders are opposite on purpose, and both are load-bearing —
 * the same rule `useAttachmentActions` follows for a PO's paperwork:
 *
 * - **Upload writes Storage FIRST, then the row.** A row written first, with a
 *   failed upload after it, leaves a card pointing at nothing.
 * - **Delete removes the ROW first, then the object.** A failed object delete
 *   leaves an orphan nobody can see, which is harmless; a failed row delete
 *   leaves a card pointing at a file that is already gone.
 *
 * Not shared with `useAttachmentActions` despite the shape: that hook exists to
 * keep AUTO-READ identical across two surfaces, and its whole invoice-reading
 * half is meaningless here. What's common is thirty lines of Supabase calls;
 * what would be coupled is two modules' write behaviour.
 *
 * No `capture` on the input, and formats named rather than `image/*` — the same
 * two reasons as the PO card: `capture` forces the camera and takes away the
 * choice, and iOS transcodes HEIC to JPEG when the accept list names formats.
 */
export function EmployeeDocuments({
  employeeId,
  orgId,
  documents,
  canEdit,
}: {
  employeeId: string;
  orgId: string;
  /** Signed by the server at render — see EmployeeDetail. */
  documents: SignedEmployeeDocument[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [kind, setKind] = useState<DocumentKind>("application");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const missing = missingPaperwork(documents.map((d) => d.kind));

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      setBusyLabel(`Uploading ${file.name}…`);
      const path = documentPath(orgId, employeeId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setBusyLabel(null);
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }

      const { error: rowError } = await supabase.from("employee_documents").insert({
        org_id: orgId,
        employee_id: employeeId,
        storage_path: path,
        kind,
        file_name: file.name,
        content_type: file.type || null,
        byte_size: file.size,
      });
      if (rowError) {
        // The object is up but unrecorded. Take it back out rather than leaving
        // a file nothing points at.
        await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([path]);
        setBusyLabel(null);
        setError(`${file.name}: ${rowError.message}`);
        return;
      }
    }
    setBusyLabel(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function remove(doc: SignedEmployeeDocument) {
    if (
      !window.confirm(
        `Remove ${doc.file_name ?? "this document"} from this employee's file?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setBusyLabel("Removing…");
    setError(null);

    const { error: rowError } = await supabase
      .from("employee_documents")
      .delete()
      .eq("id", doc.id);
    if (rowError) {
      setBusyLabel(null);
      setError(rowError.message);
      return;
    }
    // Best effort: the row is already gone, so a failure here leaves an orphan
    // object rather than a broken card.
    await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([doc.storage_path]);
    setBusyLabel(null);
    router.refresh();
  }

  return (
    <div className="space-y-3 border border-ink px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Paperwork
        </h2>
        <span className="text-sm text-muted">
          {documents.length === 0
            ? "Nothing on file"
            : `${documents.length} ${documents.length === 1 ? "document" : "documents"}`}
        </span>

        {canEdit && (
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                Add as
              </span>
              <span className="w-48">
                <PickList
                  value={kind}
                  options={DOCUMENT_KIND_OPTIONS}
                  onPick={(next) => setKind(next as DocumentKind)}
                  ariaLabel="Kind of document"
                />
              </span>
            </span>
            <button
              type="button"
              disabled={busyLabel !== null}
              onClick={() => fileRef.current?.click()}
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              Attach&hellip;
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
              }}
            />
          </span>
        )}
      </div>

      {/* The derived completeness line — what FMP's eight checkboxes were for,
          except this one cannot be true without the documents. */}
      <p className="text-sm">
        {missing.length === 0 ? (
          <span className="text-[var(--rf-green-600)]">
            Onboarding paperwork complete.
          </span>
        ) : (
          <>
            <span className="text-subtle">Missing: </span>
            <span className="text-ink">
              {missing.map((k) => DOCUMENT_KIND_LABEL[k]).join(", ")}
            </span>
          </>
        )}
      </p>

      {busyLabel && <ProgressBand label={busyLabel} />}
      {error && <p className="text-sm text-accent">{error}</p>}

      {documents.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {documents.map((d) => (
            <li key={d.id} className="w-44 border border-hairline">
              <a
                href={d.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block no-underline"
              >
                {isImage(d) && d.url ? (
                  /* A plain <img>, not next/image: a signed, short-lived URL
                     into a PRIVATE bucket. next/image would cache a URL that is
                     built to expire. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.url}
                    alt={d.file_name ?? "Document"}
                    className="h-28 w-full bg-neutral-100 object-cover"
                  />
                ) : (
                  <span className="flex h-28 w-full items-center justify-center bg-neutral-100 text-[12px] uppercase tracking-[0.12em] text-subtle">
                    {d.url ? "PDF" : "Unavailable"}
                  </span>
                )}
              </a>
              <div className="space-y-0.5 px-2 py-2">
                <p className="truncate text-xs text-ink" title={d.file_name ?? ""}>
                  {d.file_name ?? "Untitled"}
                </p>
                <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                  {DOCUMENT_KIND_LABEL[d.kind]}
                  {d.byte_size !== null && ` · ${fileSize(d.byte_size)}`}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busyLabel !== null}
                    onClick={() => void remove(d)}
                    className="text-[11px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
