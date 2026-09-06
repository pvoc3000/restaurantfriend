"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { PHOTO_BUCKET, photoPath } from "@/lib/facilityPhotos";
import {
  INSPECTION_DOC_ACCEPT,
  INSPECTION_DOC_ACCEPT_ATTR,
  inspectionDocRejection,
} from "@/lib/inspections";

export type InspectionDocument = {
  id: string;
  url: string | null;
  storage_path: string;
  file_name: string | null;
  content_type: string | null;
};

/**
 * The inspector's report, on the record (093 — `facility_photos`' third
 * owner). Usually one PDF; sometimes a photograph of the paper. `TaskPhotos`'
 * two write orders apply verbatim: STORAGE then ROW on the way up, ROW then
 * OBJECT on the way out, and every write `.select()`s its own result.
 */
export function InspectionDocuments({
  inspectionId,
  orgId,
  documents,
  editable,
}: {
  inspectionId: string;
  orgId: string;
  documents: InspectionDocument[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function add(file: File) {
    const refusal = inspectionDocRejection(file);
    if (refusal) return setFailed(refusal);
    setFailed(null);
    setBusy(true);
    try {
      const path = photoPath(orgId, inspectionId, file.name);
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file);
      if (up.error) return setFailed(up.error.message);
      const { data, error } = await supabase
        .from("facility_photos")
        .insert({
          org_id: orgId,
          inspection_id: inspectionId,
          storage_path: path,
          file_name: file.name,
          content_type: file.type,
          byte_size: file.size,
        })
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("The file uploaded but was not filed — you may not have permission.");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: InspectionDocument) {
    const ok = await confirmDialog({
      title: "Remove this report?",
      body: `${doc.file_name ?? "The file"} comes off this inspection. There is no way back.`,
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("facility_photos")
        .delete()
        .eq("id", doc.id)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was removed — you may not have permission.");
      await supabase.storage.from(PHOTO_BUCKET).remove([doc.storage_path]);
      router.refresh();
    });
  }

  const body = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SectionHeading count={documents.length}>Report</SectionHeading>
        {editable && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={INSPECTION_DOC_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void add(f);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className={`${BUTTON_CLASS} ml-auto`}
            >
              {busy ? "Uploading…" : "Attach"}
            </button>
          </>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted">
          {editable ? "Nothing attached — drop the report here." : "Nothing attached."}
        </p>
      ) : (
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
                <span className="min-w-0 flex-1 truncate text-sm text-body">{d.file_name ?? "report"}</span>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                  >
                    Open
                  </a>
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
      )}
      {failed && <p className="text-sm text-accent">{failed}</p>}
    </div>
  );

  if (!editable) return body;
  return (
    <FileDropZone
      accept={INSPECTION_DOC_ACCEPT}
      label="Drop the report here"
      disabled={busy}
      onFiles={(files) => {
        const first = files[0];
        if (first) void add(first);
      }}
      onReject={(rejected) => {
        const first = rejected[0];
        setFailed(first ? inspectionDocRejection(first) : "That file cannot be attached.");
      }}
    >
      {body}
    </FileDropZone>
  );
}
