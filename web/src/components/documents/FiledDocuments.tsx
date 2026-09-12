"use client";

import { useRef, useState, useTransition } from "react";
import { useFillToBottom } from "@/lib/fillHeight";
import { useViewportAtLeast } from "@/lib/tableHead";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Pane } from "@/components/ui/Pane";
import { DocumentViewer } from "@/components/ui/DocumentViewer";
import { confirmDialog } from "@/lib/confirm";
import { PHOTO_BUCKET } from "@/lib/facilityPhotos";
import { printDocument } from "@/lib/printDocument";
import { attachFile } from "./documentWrites";
import { AttachFile } from "./AttachFile";
import { INSPECTION_DOC_ACCEPT, inspectionDocRejection } from "@/lib/inspections";
import { DOCUMENT_ACCEPT, DOCUMENT_BUCKET, documentRejection } from "@/lib/orgDocuments";

export type FiledDocument = {
  id: string;
  url: string | null;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
};

/**
 * A record's files, previewed and kept: the inspector's report on an
 * inspection, the PDF on an org document. ONE component (2026-09-05, when the
 * Documents screen wanted exactly what the inspection record had) — the table,
 * the owner column and the bucket are props, so the two screens cannot drift
 * the way two hand-rolled frames did.
 *
 * `TaskPhotos`' two write orders apply verbatim: **upload is STORAGE then
 * ROW**, because a row pointing at nothing renders broken, and **delete is ROW
 * then OBJECT**, because an orphaned object is invisible and harmless. Every
 * write `.select()`s its own result.
 *
 * THE RIGHT SIDE OF THE SCREEN (Mark: "let the report viewer take up the right
 * side of the screen"). Beside the record at `xl` the column is sticky under
 * the masthead and THE VIEWER BOX ITSELF is measured to the foot of the window
 * (`useFillToBottom`, 480 floor — 560 overran a 900px window). Measuring the
 * box and not the column is deliberate: a height handed down through
 * `FileDropZone`'s wrapper and two flex columns arrived as 150px, the PDF
 * plugin's own minimum. Below `xl` it stacks at `h-[70vh]`.
 */
/**
 * WHICH RECORD'S FILES. A KEY, not the target object, crosses the server →
 * client boundary: a target carries a FUNCTION (`rejection`), and "Functions
 * cannot be passed directly to Client Components" took the whole record down
 * with a runtime error — `BatchLogDetail`'s lesson (CLAUDE.md), met again
 * the first time this component was used from a second page. The registry
 * lives here, on the client side of the line.
 */
export type FiledDocumentsKind = "inspection" | "document";

export type FiledDocumentsTarget = {
  /** The files table and the column naming the owning record. */
  table: string;
  ownerColumn: string;
  bucket: string;
  /** Types the picker offers AND the drop re-checks — `accept` governs the
   *  picker only. */
  accept: readonly string[];
  /** The refusal, worded for this screen (HEIC gets its own sentence). */
  rejection: (file: { name: string; type: string }) => string | null;
  /** What the card is called and what one file is ("Report" / "the report"). */
  heading: string;
  noun: string;
};

export const TARGETS: Record<FiledDocumentsKind, FiledDocumentsTarget> = {
  inspection: {
    table: "facility_photos",
    ownerColumn: "inspection_id",
    bucket: PHOTO_BUCKET,
    accept: INSPECTION_DOC_ACCEPT,
    rejection: inspectionDocRejection,
    heading: "Report",
    noun: "the report",
  },
  document: {
    table: "org_document_files",
    ownerColumn: "document_id",
    bucket: DOCUMENT_BUCKET,
    accept: DOCUMENT_ACCEPT,
    rejection: documentRejection,
    heading: "File",
    noun: "the file",
  },
};

export function FiledDocuments({
  kind,
  ownerId,
  orgId,
  documents,
  editable,
  showAttach = true,
}: {
  kind: FiledDocumentsKind;
  ownerId: string;
  orgId: string;
  documents: FiledDocument[];
  editable: boolean;
  /** False where the screen has taken Attach into an Actions menu of its own
   *  — the documents record. The DROP ZONE stays either way: a file dragged
   *  onto the card is the same act, and it has nowhere else to land. */
  showAttach?: boolean;
}) {
  const target = TARGETS[kind];
  const router = useRouter();
  const supabase = createClient();
  const viewerRef = useRef<HTMLDivElement>(null);
  const beside = useViewportAtLeast(1280);
  useFillToBottom(viewerRef, beside, 480);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  // Which document is PREVIEWED (Mark, 2026-09-05: "I'd like to see the
  // inspection document previewed on the detail page"). The newest-filed by
  // default; a file name in the list below picks another. Held as an id so a
  // refresh after an attach or a remove keeps the same document up — or falls
  // back to the first when that one is gone.
  const [picked, setPicked] = useState<string | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);

  async function print(doc: FiledDocument) {
    if (!doc.url) return;
    setFailed(null);
    setPrinting(doc.id);
    try {
      await printDocument(doc.url, doc.content_type);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not print.");
    } finally {
      setPrinting(null);
    }
  }
  const shown = documents.find((d) => d.id === picked) ?? documents[0] ?? null;

  /** The DROP path. The button's is `AttachFile`; both go through the same
   *  write, which is the point of it living in `documentWrites`. */
  async function add(file: File) {
    setFailed(null);
    setBusy(true);
    const { error } = await attachFile(supabase, target, orgId, ownerId, file);
    setBusy(false);
    if (error) return setFailed(error);
    router.refresh();
  }

  async function remove(doc: FiledDocument) {
    const ok = await confirmDialog({
      title: `Remove ${target.noun}?`,
      body: `${doc.file_name ?? "The file"} comes off this record. There is no way back.`,
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from(target.table)
        .delete()
        .eq("id", doc.id)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was removed — you may not have permission.");
      await supabase.storage.from(target.bucket).remove([doc.storage_path]);
      router.refresh();
    });
  }

  const body = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SectionHeading count={documents.length}>{target.heading}</SectionHeading>
        {/* THE COMMAND IS `AttachFile` NOW (2026-09-12) — one upload, two
            dresses. `showAttach={false}` is how the documents record takes it
            into the title row's Actions menu while the inspection record keeps
            the button here. */}
        {editable && showAttach && (
          <AttachFile kind={kind} ownerId={ownerId} orgId={orgId} />
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted">
          {editable ? `Nothing attached — drop ${target.noun} here.` : "Nothing attached."}
        </p>
      ) : (
        <>
          {/* The preview fills whatever the column has beside the record, and
              70vh stacked. A WRAPPER carries the height rather than a class on
              `Pane` — that component is `h-full`, and two height utilities on
              one element resolve by stylesheet order (it came out 150px). The
              viewer is keyed by id, so picking another file remounts it. */}
          {shown && (
            <div ref={viewerRef} className={beside ? "" : "h-[70vh]"}>
              <Pane>
                <DocumentViewer
                  key={shown.id}
                  url={shown.url}
                  fileName={shown.file_name}
                  image={(shown.content_type ?? "").startsWith("image/")}
                />
              </Pane>
            </div>
          )}
        <ul className="divide-y divide-hairline border-y border-hairline">
          {documents.map((d) => {
            const isImage = (d.content_type ?? "").startsWith("image/");
            return (
              <li key={d.id} className="flex items-center gap-4 py-2">
                {isImage && d.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.url} alt="" className="h-14 w-14 shrink-0 border border-hairline object-cover" />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center border border-hairline text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    PDF
                  </span>
                )}
                {documents.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPicked(d.id)}
                    aria-pressed={shown?.id === d.id}
                    className={`min-w-0 flex-1 truncate text-left text-sm ${shown?.id === d.id ? "font-semibold text-ink" : "text-body underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"}`}
                  >
                    {d.file_name ?? target.noun}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-body">{d.file_name ?? target.noun}</span>
                )}
                {d.url ? (
                  <>
                    {/* Open shows the file in the browser's own viewer. Print
                        fetches the bytes and prints them from a hidden
                        same-origin frame — except on iOS, where that prints
                        page one only and `lib/printDocument` opens a tab for
                        the share sheet instead. Download appends Supabase's own
                        `download` parameter to the signed URL, which sets the
                        Content-Disposition. */}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={() => void print(d)}
                      disabled={printing !== null}
                      className="shrink-0 text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 disabled:opacity-35"
                    >
                      {printing === d.id ? "Printing…" : "Print"}
                    </button>
                    <a
                      href={`${d.url}&download=${encodeURIComponent(d.file_name ?? "file")}`}
                      className="shrink-0 text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                    >
                      Download
                    </a>
                  </>
                ) : (
                  <span className="shrink-0 text-sm text-faint">unreadable</span>
                )}
                {editable && (
                  <button
                    type="button"
                    onClick={() => void remove(d)}
                    className="shrink-0 text-[12px] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        </>
      )}
      {failed && <p className="text-sm text-accent">{failed}</p>}
    </div>
  );

  const column = editable ? (
    <FileDropZone
      accept={target.accept}
      label={`Drop ${target.noun} here`}
      disabled={busy}
      onFiles={(files) => {
        const first = files[0];
        if (first) void add(first);
      }}
      onReject={(rejected) => {
        const first = rejected[0];
        setFailed(first ? target.rejection(first) : "That file cannot be attached.");
      }}
    >
      {body}
    </FileDropZone>
  ) : (
    body
  );

  return (
    <div className="min-w-0 xl:sticky" style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}>
      {column}
    </div>
  );
}
