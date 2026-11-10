"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { alertDialog } from "@/lib/confirm";
import { batchSheetFileName, fetchBatchSheet } from "@/lib/batchLogSheet";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { RowMenu } from "@/components/ui/RowMenu";

/**
 * Preview Batch Log… — the log as a sheet staff write On hand and Made into
 * (Mark, 2026-11-09). Offered from the log's Actions menu and from the ⋯ at the
 * end of each row on `/batch-logs`.
 *
 * `ProcessPo`'s Preview PDF mechanics, both load-bearing: the tab is opened
 * SYNCHRONOUSLY before any await (a `window.open` after one is silently
 * blocked), and the renderer is imported at the click, not on page load.
 *
 * A READ, so it stamps nothing — `production_batch_logs.printed_at` stays as it
 * is. Opening a preview is not proof the sheet reached a printer.
 */
export function useBatchLogPreview(printedOn: string) {
  const [busy, setBusy] = useState(false);

  function preview(logId: string) {
    const win = openWindowNow();
    setBusy(true);
    void (async () => {
      try {
        const supabase = createClient();
        const [{ pdf }, { BatchLogSheetPdf }, data] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./pdf/BatchLogSheetPdf"),
          fetchBatchSheet(supabase, logId, printedOn),
        ]);
        const blob = await pdf(<BatchLogSheetPdf data={data} />).toBlob();
        showBlob(win, blob, batchSheetFileName(data));
      } catch (e) {
        win?.close();
        await alertDialog({
          title: "The batch log could not be previewed",
          body: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setBusy(false);
      }
    })();
  }

  return { preview, busy };
}

/** The menu row, for a caller that already has an Actions menu. */
export function previewBatchLogRow(
  { preview, busy }: ReturnType<typeof useBatchLogPreview>,
  logId: string
): ActionMenuItem & { onSelect: () => void } {
  return { label: "Preview Batch Log…", onSelect: () => preview(logId), disabled: busy };
}

/** The ⋯ at the end of a `/batch-logs` row. */
export function BatchLogRowMenu({
  logId,
  name,
  printedOn,
}: {
  logId: string;
  /** "DF01 Mon 11/9", for the screen reader's "Actions for …". */
  name: string;
  printedOn: string;
}) {
  const previewer = useBatchLogPreview(printedOn);
  return (
    <RowMenu
      label={`Actions for the ${name} batch log`}
      items={[previewBatchLogRow(previewer, logId)]}
    />
  );
}
