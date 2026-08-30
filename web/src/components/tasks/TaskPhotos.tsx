"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { confirmDialog } from "@/lib/confirm";
import {
  PHOTO_ACCEPT,
  PHOTO_ACCEPT_ATTR,
  PHOTO_BUCKET,
  photoPath,
  photoRejection,
} from "@/lib/facilityPhotos";

export type TaskPhoto = {
  id: string;
  url: string | null;
  storage_path: string;
  file_name: string | null;
};

/**
 * Photographs on a task — 077's other owner, which had no writer until now.
 *
 * `facility_photos.task_id` and its one-owner CHECK shipped with the module and
 * nothing ever wrote to them; the migration's own header names this case ("here
 * is what needs doing"). A maintenance request is where it matters most: the
 * plumber is not standing in the shop, and a picture of the broken thing is
 * worth more than any sentence somebody types about it.
 *
 * THE TWO WRITE ORDERS ARE OPPOSITE ON PURPOSE, and `lib/facilityPhotos`'
 * `WRITE_ORDER_NOTE` is the argument: **upload is STORAGE then ROW**, because a
 * row pointing at nothing renders as a broken image, and **delete is ROW then
 * OBJECT**, because an orphaned object is invisible and harmless. Copied from
 * `WalkItem.addPhoto` rather than re-derived.
 *
 * IT ALSO DELETES, which nothing in the app did before: `WRITE_ORDER_NOTE`
 * documented an order with no caller, so until now a mis-shot photo was
 * permanent everywhere.
 */
export function TaskPhotos({
  task,
  orgId,
  photos,
  onClose,
}: {
  task: { id: string; title: string };
  orgId: string;
  photos: TaskPhoto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function add(file: File) {
    // `accept` governs the PICKER only and says nothing about a drop, so the
    // type is re-checked here — which is where the HEIC guard actually bites.
    const refusal = photoRejection(file);
    if (refusal) return setFailed(refusal);
    setFailed(null);
    setBusy(true);
    try {
      const path = photoPath(orgId, task.id, file.name);
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file);
      if (up.error) return setFailed(up.error.message);
      const { data, error } = await supabase
        .from("facility_photos")
        .insert({
          org_id: orgId,
          task_id: task.id,
          storage_path: path,
          file_name: file.name,
          content_type: file.type,
          byte_size: file.size,
        })
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("The photo uploaded but was not filed — you may not have permission.");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: TaskPhoto) {
    const ok = await confirmDialog({
      title: "Remove this photo?",
      body: `${photo.file_name ?? "The photo"} comes off “${task.title}”. There is no way back.`,
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      // ROW FIRST. An object with no row is invisible and harmless; a row
      // pointing at a deleted object is a broken image on somebody's screen.
      const { data, error } = await supabase
        .from("facility_photos")
        .delete()
        .eq("id", photo.id)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("Nothing was removed — you may not have permission.");
      }
      await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
      router.refresh();
    });
  }

  return (
    <Dialog
      title={`Photos — ${task.title}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <div className="flex justify-end">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <FileDropZone
        accept={PHOTO_ACCEPT}
        label="Drop a photo here"
        disabled={busy}
        onFiles={(files) => {
          const first = files[0];
          if (first) void add(first);
        }}
        onReject={(rejected) => {
          const first = rejected[0];
          setFailed(first ? photoRejection(first) : "That file cannot be attached.");
        }}
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={fileInput}
              type="file"
              // NO `capture`, for `WalkItem`'s reason: without it iOS offers
              // Photo Library / Take Photo / Choose File in one sheet, and the
              // named formats ask it to transcode HEIC on the way out.
              accept={PHOTO_ACCEPT_ATTR}
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
              className="h-9 shrink-0 border border-ink bg-white px-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {busy ? "Uploading…" : "Add a photo"}
            </button>
            <p className="text-[13px] text-muted">
              Or drop one anywhere on this panel. JPEG, PNG or WebP.
            </p>
          </div>

          {photos.length === 0 ? (
            <p className="text-sm text-muted">Nothing attached yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-4">
              {photos.map((p) => (
                <li key={p.id} className="w-40 space-y-1">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.url}
                      alt={p.file_name ?? ""}
                      className="h-40 w-40 border border-hairline object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center border border-hairline text-[13px] text-muted">
                      unreadable
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[12px] text-muted">
                      {p.file_name ?? "photo"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(p)}
                      className="shrink-0 text-[12px] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {failed ? <p className="text-sm text-accent">{failed}</p> : null}
        </div>
      </FileDropZone>
    </Dialog>
  );
}
