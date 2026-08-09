"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BATCH_PHOTO_ACCEPT_ATTR,
  BATCH_PHOTO_BUCKET,
  batchPhotoPath,
  batchPhotoRejection,
} from "@/lib/batchPhotos";

/**
 * The picture on a batch log — FileMaker's container field on Batch Logs.
 *
 * ONE, not a gallery, for `RecipeStepImage`'s reason: it is 1:1 with the batch,
 * it replaces rather than accumulates, and it should go when the batch goes,
 * which four columns give for free.
 *
 * The two write orders are OPPOSITE and both matter. **Attaching writes Storage
 * first, then the row** — a row pointing at nothing renders broken. **Clearing
 * writes the row first, then removes the object** — an orphan object is
 * invisible and harmless, where a removed object with the row still naming it
 * is not. Replacing is both, so at no instant does the row name a file that
 * isn't there.
 *
 * NO DROP ZONE, deliberately: `ui/FileDropZone` arms off WINDOW drag events and
 * suppresses the page's own drop handling while a drag is live, which is worth
 * it where there is one target and noise where there are several. This sits on
 * a record beside other controls.
 */
export function BatchPhoto({
  batchId,
  orgId,
  url,
  path,
  name,
  editable,
}: {
  batchId: string;
  orgId: string;
  /** A short-lived signed URL, minted server-side. Null when there is none. */
  url: string | null;
  /** The object's key, which is what a replace or a clear has to remove. */
  path: string | null;
  name: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function attach(files: readonly File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    if (!BATCH_PHOTO_ACCEPT_ATTR.split(",").includes(file.type)) {
      setError(batchPhotoRejection([file]));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const previous = path;
    start(async () => {
      const next = batchPhotoPath(orgId, batchId, file.name);
      const { error: uploadError } = await supabase.storage
        .from(BATCH_PHOTO_BUCKET)
        .upload(next, file, { contentType: file.type || undefined });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      const { data, error: rowError } = await supabase
        .from("production_batches")
        .update({
          photo_path: next,
          photo_name: file.name,
          photo_type: file.type || null,
          photo_size: file.size,
        })
        .eq("id", batchId)
        .select("id");
      if (rowError || !data?.length) {
        // Up but unrecorded. Take it back out rather than leaving a file
        // nothing points at. A zero-row update returns NO error, which is why
        // the length is checked as well.
        await supabase.storage.from(BATCH_PHOTO_BUCKET).remove([next]);
        setError(rowError?.message ?? "could not record the photo");
        return;
      }
      if (previous) await supabase.storage.from(BATCH_PHOTO_BUCKET).remove([previous]);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function clear() {
    if (!path) return;
    if (!window.confirm("Remove this photo?")) return;
    const previous = path;
    setError(null);
    start(async () => {
      const { data, error: rowError } = await supabase
        .from("production_batches")
        .update({ photo_path: null, photo_name: null, photo_type: null, photo_size: null })
        .eq("id", batchId)
        .select("id");
      if (rowError || !data?.length) {
        setError(rowError?.message ?? "not allowed");
        return;
      }
      await supabase.storage.from(BATCH_PHOTO_BUCKET).remove([previous]);
      router.refresh();
    });
  }

  if (!editable) {
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name ?? "Batch photo"} className="max-h-48 border border-hairline" />
    ) : (
      <p className="text-[13px] text-faint">No photo.</p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title={name ?? undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name ?? "Batch photo"} className="max-h-48 border border-hairline" />
        </a>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="border border-hairline px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-muted hover:border-ink hover:text-ink disabled:opacity-35"
        >
          {pending ? "Working…" : url ? "Replace" : "Photo"}
        </button>
        {url ? (
          <button
            type="button"
            disabled={pending}
            onClick={clear}
            aria-label="Remove this photo"
            title="Remove this photo"
            className="text-[14px] leading-none text-subtle hover:text-accent disabled:opacity-35"
          >
            ×
          </button>
        ) : null}
      </div>
      {/* No `capture`: without it iOS offers Photo Library / Take Photo /
          Choose File in one sheet, which is what you want when the photo is
          sometimes taken now and sometimes one from earlier in the shift. */}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={BATCH_PHOTO_ACCEPT_ATTR}
        onChange={(e) => attach(Array.from(e.target.files ?? []))}
      />
      {error && <span className="text-[11px] text-accent">{error}</span>}
    </div>
  );
}
