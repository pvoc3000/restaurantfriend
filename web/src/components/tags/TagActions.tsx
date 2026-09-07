"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { TAG_BUCKET } from "@/lib/displayTags";

/** Delete a tag — purchaser+ (095). Row first (the image rows cascade), then
 *  its objects; every write `.select()`s its own result. */
export function TagActions({ tagId, title, imagePaths }: { tagId: string; title: string; imagePaths: string[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${title}”?`,
      body:
        imagePaths.length > 0
          ? `Its ${imagePaths.length === 1 ? "background goes" : `${imagePaths.length} backgrounds go`} with it. This cannot be undone.`
          : "This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase.from("display_tags").delete().eq("id", tagId).select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was deleted — you may not have permission.");
      if (imagePaths.length > 0) await supabase.storage.from(TAG_BUCKET).remove(imagePaths);
      router.push("/tags");
    });
  }

  return (
    <span className="flex items-center gap-3">
      <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy} onClick={() => void remove()}>
        Delete
      </button>
      {failed && <span className="text-sm text-accent">{failed}</span>}
    </span>
  );
}
