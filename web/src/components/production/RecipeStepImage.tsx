"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  RECIPE_IMAGE_ACCEPT_ATTR,
  RECIPE_IMAGE_BUCKET,
  recipeImagePath,
  recipeImageRejection,
} from "@/lib/recipeImages";

/**
 * FileMaker's container field on a procedure step: one picture per step.
 *
 * ONE and not a gallery — the old layout has a single box per step, and a step
 * needing two pictures is two steps. That is also why 041 put four columns on
 * the step rather than giving this a table: the image is 1:1 with the step, it
 * replaces rather than accumulates, and it should go when the step goes, which
 * a column does for free.
 *
 * The two write orders are opposite, exactly as `useAttachmentActions` sets
 * them out and for the same reasons. **Attaching writes Storage first, then the
 * row** — a row pointing at nothing renders broken. **Clearing writes the row
 * first, then removes the object** — an orphan object is invisible and
 * harmless, where a cleared object with the row still pointing at it is not.
 * Replacing is both: the new object up, the row moved, then the old object
 * removed, so at no instant does the row name a file that isn't there.
 *
 * NO DROP ZONE, deliberately. `ui/FileDropZone` arms off WINDOW drag events and
 * suppresses the page's own drop handling while a drag is live; one per step
 * would mean fifteen overlays lighting up together on a long procedure. Dropping
 * onto a page is worth having where there is one target (receiving's document
 * pane, the Paperwork card) and is noise where there are fifteen.
 */
export function RecipeStepImage({
  stepId,
  orgId,
  versionId,
  url,
  path,
  name,
  editable,
}: {
  stepId: string;
  orgId: string;
  versionId: string;
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
    if (!RECIPE_IMAGE_ACCEPT_ATTR.split(",").includes(file.type)) {
      setError(recipeImageRejection([file]));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const previous = path;
    start(async () => {
      const next = recipeImagePath(orgId, versionId, file.name);
      const { error: uploadError } = await supabase.storage
        .from(RECIPE_IMAGE_BUCKET)
        .upload(next, file, { contentType: file.type || undefined });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const { data, error: rowError } = await supabase
        .from("production_recipe_steps")
        .update({
          image_path: next,
          image_name: file.name,
          image_type: file.type || null,
          image_size: file.size,
        })
        .eq("id", stepId)
        .select("id");
      if (rowError || !data?.length) {
        // Up but unrecorded. Take it back out rather than leaving a file
        // nothing points at.
        await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([next]);
        setError(rowError?.message ?? "could not record the picture");
        return;
      }
      if (previous) await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([previous]);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  function clear() {
    if (!path) return;
    if (!window.confirm("Remove this picture?")) return;
    const previous = path;
    setError(null);
    start(async () => {
      const { data, error: rowError } = await supabase
        .from("production_recipe_steps")
        .update({ image_path: null, image_name: null, image_type: null, image_size: null })
        .eq("id", stepId)
        .select("id");
      if (rowError || !data?.length) {
        setError(rowError?.message ?? "not allowed");
        return;
      }
      await supabase.storage.from(RECIPE_IMAGE_BUCKET).remove([previous]);
      router.refresh();
    });
  }

  if (!editable) {
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? "Step picture"}
        className="max-h-24 border border-hairline"
      />
    ) : null;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title={name ?? undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name ?? "Step picture"}
            className="max-h-24 border border-hairline"
          />
        </a>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="border border-hairline px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-muted hover:border-ink hover:text-ink disabled:opacity-35"
        >
          {pending ? "Working…" : url ? "Replace" : "Picture"}
        </button>
        {url ? (
          <button
            type="button"
            disabled={pending}
            onClick={clear}
            aria-label="Remove this picture"
            title="Remove this picture"
            className="text-[14px] leading-none text-subtle hover:text-accent disabled:opacity-35"
          >
            ×
          </button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={RECIPE_IMAGE_ACCEPT_ATTR}
        onChange={(e) => attach(Array.from(e.target.files ?? []))}
      />
      {error && <span className="text-[11px] text-accent">{error}</span>}
    </div>
  );
}
