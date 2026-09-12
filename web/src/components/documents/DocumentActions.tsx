"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { deleteDocuments } from "./documentWrites";

/**
 * Delete a document — owner/admin (094). The list's Delete goes through the
 * same `deleteDocuments`.
 *
 * Pass `children` and it hands back its row for an `ActionMenu` instead of
 * drawing a button, keeping the confirm that names the files going with it and
 * the row-count check behind it — `OrderCommandMenu`'s arrangement.
 */
export function DocumentActions({
  documentId,
  title,
  fileCount,
  children,
}: {
  documentId: string;
  title: string;
  fileCount: number;
  children?: (items: ActionMenuItem[]) => ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${title}”?`,
      body:
        fileCount > 0
          ? `Its ${fileCount === 1 ? "file goes" : `${fileCount} files go`} with it. This cannot be undone.`
          : "This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const result = await deleteDocuments(supabase, [documentId]);
      if (result.error) return setFailed(result.deleted === 0 ? "Nothing was deleted — you may not have permission." : result.error);
      router.push("/documents");
    });
  }

  if (children) {
    return (
      <>
        {children([
          {
            label: busy ? "Deleting…" : "Delete Document…",
            danger: true,
            disabled: busy,
            onSelect: () => void remove(),
          },
        ])}
        {failed && <p className="max-w-sm text-right text-sm text-accent">{failed}</p>}
      </>
    );
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
