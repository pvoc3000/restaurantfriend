"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { deleteTags, duplicateTag } from "./tagWrites";

/** Duplicate and Delete — purchaser+ (095), through the same two writes the
 *  list's bar and row menu use (`tagWrites`). */
export function TagActions({
  orgId,
  tagId,
  title,
  imagePaths,
}: {
  orgId: string;
  tagId: string;
  title: string;
  imagePaths: string[];
}) {
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
      const result = await deleteTags(supabase, [{ id: tagId, paths: imagePaths }]);
      if (result.error) return setFailed(result.error);
      router.push("/tags");
    });
  }

  function duplicate() {
    setFailed(null);
    startTransition(async () => {
      const result = await duplicateTag(supabase, orgId, tagId);
      if (result.error || !result.id) return setFailed(result.error ?? "The copy was not created.");
      router.push(`/tags/${result.id}?from=%2Ftags&fromLabel=Tags${result.warning ? `&warning=${encodeURIComponent(result.warning)}` : ""}`);
    });
  }

  return (
    <span className="flex items-center gap-3">
      <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={duplicate}>
        Duplicate
      </button>
      <button type="button" className={DANGER_BUTTON_CLASS} disabled={busy} onClick={() => void remove()}>
        Delete
      </button>
      {failed && <span className="text-sm text-accent">{failed}</span>}
    </span>
  );
}
