"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog } from "@/lib/confirm";
import { PHOTO_BUCKET } from "@/lib/facilityPhotos";

/**
 * Delete the record of a visit — owner/admin (093, 023's rule: deletion is
 * for the typo). The confirm names what goes with it: the report cascades,
 * the tasks stay and lose their link. Row first, then the objects.
 */
export function InspectionActions({
  inspectionId,
  label,
  documentPaths,
  taskCount,
}: {
  inspectionId: string;
  label: string;
  documentPaths: string[];
  taskCount: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function remove() {
    const parts = [];
    if (documentPaths.length > 0)
      parts.push(`${documentPaths.length} ${documentPaths.length === 1 ? "report" : "reports"} on file`);
    if (taskCount > 0)
      parts.push(`${taskCount} ${taskCount === 1 ? "task" : "tasks"} raised from it (they stay, unlinked)`);
    const ok = await confirmDialog({
      title: `Delete ${label}?`,
      body: parts.length ? `It has ${parts.join(" and ")}. This cannot be undone.` : "This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("inspections")
        .delete()
        .eq("id", inspectionId)
        .select("id");
      if (error) return setFailed(error.message);
      if (!data || data.length === 0) return setFailed("Nothing was deleted — you may not have permission.");
      if (documentPaths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(documentPaths);
      router.push("/inspection-logs");
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
