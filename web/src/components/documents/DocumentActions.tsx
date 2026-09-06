"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { DOCUMENT_BUCKET } from "@/lib/orgDocuments";

/** Delete a document — owner/admin (094). Row first, then its objects. */
export function DocumentActions({
  documentId,
  title,
  filePaths,
}: {
  documentId: string;
  title: string;
  filePaths: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${title}”?`,
      body:
        filePaths.length > 0
          ? `Its ${filePaths.length === 1 ? "file goes" : `${filePaths.length} files go`} with it. This cannot be undone.`
          : "This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase.from("org_documents").delete().eq("id", documentId).select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was deleted — you may not have permission.");
      if (filePaths.length > 0) await supabase.storage.from(DOCUMENT_BUCKET).remove(filePaths);
      router.push("/documents");
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
