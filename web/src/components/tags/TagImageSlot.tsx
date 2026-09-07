"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { confirmDialog } from "@/lib/confirm";
import {
  TAG_BUCKET,
  TAG_IMAGE_ACCEPT,
  TAG_IMAGE_ACCEPT_ATTR,
  tagImagePath,
  tagImageRejection,
  tagSizeLabel,
  type TagSize,
} from "@/lib/displayTags";
import { TagPreview } from "./TagPreview";

export type SlotImage = {
  id: string;
  storage_path: string;
  url: string | null;
  file_name: string | null;
};

/**
 * One SIZE of a tag's background — the preview with the price laid over it,
 * and Attach / Replace / Remove. A fixed slot rather than `FiledDocuments`'
 * list: a tag has exactly one 2x8, and the printer prints one size at a time.
 *
 * THE TWO WRITE ORDERS ARE OPPOSITE (018's rule): upload = STORAGE then ROW
 * (a row pointing at nothing renders broken); remove = ROW then OBJECT (an
 * orphaned object is invisible and harmless). A REPLACE is an upload that
 * upserts the row on `(tag_id, size)` and only then removes the old object.
 */
export function TagImageSlot({
  orgId,
  tagId,
  size,
  image,
  price,
  scale,
  editable,
}: {
  orgId: string;
  tagId: string;
  size: TagSize;
  image: SlotImage | null;
  price: string | null;
  scale: number;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, startRemove] = useTransition();

  async function attach(file: File) {
    const refusal = tagImageRejection(file);
    if (refusal) return setFailed(refusal);
    setFailed(null);
    setUploading(true);
    try {
      const path = tagImagePath(orgId, tagId, file.name);
      const up = await supabase.storage.from(TAG_BUCKET).upload(path, file);
      if (up.error) return setFailed(up.error.message);
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("display_tag_images")
        .upsert(
          {
            org_id: orgId,
            tag_id: tagId,
            size,
            storage_path: path,
            file_name: file.name,
            content_type: file.type,
            byte_size: file.size,
            uploaded_by: uid,
          },
          { onConflict: "tag_id,size" }
        )
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) {
        return setFailed("The file uploaded but was not filed — you may not have permission.");
      }
      // The old background is unreachable now that the row points elsewhere.
      if (image && image.storage_path !== path) {
        await supabase.storage.from(TAG_BUCKET).remove([image.storage_path]);
      }
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!image) return;
    const ok = await confirmDialog({
      title: `Remove the ${size} background?`,
      body: `${image.file_name ?? "The file"} comes off this tag, and ${size} sheets skip it until another is attached.`,
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startRemove(async () => {
      const { data, error } = await supabase.from("display_tag_images").delete().eq("id", image.id).select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was removed — you may not have permission.");
      await supabase.storage.from(TAG_BUCKET).remove([image.storage_path]);
      router.refresh();
    });
  }

  const busy = uploading || removing;
  const preview = <TagPreview key={image?.storage_path ?? "none"} size={size} url={image?.url ?? null} price={price} scale={scale} />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SectionHeading>{size}</SectionHeading>
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">{tagSizeLabel(size)}</span>
        {editable && (
          <span className="ml-auto flex items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept={TAG_IMAGE_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void attach(f);
              }}
            />
            {image && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="text-sm text-muted underline underline-offset-[3px] hover:text-ink disabled:opacity-35"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={BUTTON_CLASS}>
              {uploading ? "Uploading…" : image ? "Replace" : "Attach"}
            </button>
          </span>
        )}
      </div>
      {editable ? (
        <FileDropZone
          accept={TAG_IMAGE_ACCEPT}
          label={`Attach as the ${size} background`}
          disabled={busy}
          onFiles={(files) => void attach(files[0])}
          onReject={(rejected) => setFailed(tagImageRejection(rejected[0]) ?? "That file can't be used.")}
          className="w-fit"
        >
          {preview}
        </FileDropZone>
      ) : (
        preview
      )}
      {image?.file_name && <p className="text-[12px] text-faint">{image.file_name}</p>}
      {failed && <p className="text-sm text-accent">{failed}</p>}
    </section>
  );
}
