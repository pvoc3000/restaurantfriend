"use client";

import { useState, useTransition } from "react";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { createClient } from "@/lib/supabase/client";
import { openWindowNow } from "@/lib/poProcessing";
import { AttachFile } from "./AttachFile";
import { DocumentActions } from "./DocumentActions";
import { openDocumentFiles } from "./openDocumentFiles";

/**
 * THE DOCUMENT RECORD'S COMMANDS, AS ONE "ACTIONS" MENU (Mark, 2026-09-12:
 * "combine the action buttons on the documents detail page into an actionmenu,
 * place it where the delete button currently sits"). Attach File… and Delete
 * Document… — the screen's only two BUTTONS, one at each end of the page.
 *
 * The per-FILE controls stay where they are. Open · Print · Download · Remove
 * are underlined text on each row of the list, they act on THAT file, and there
 * can be several — a screen-level menu has no way to say which one it means.
 *
 * `AttachFile` and `DocumentActions` keep owning their commands and hand their
 * rows through a render prop; the upload, the delete's confirm and its row
 * count do not move. `OrderCommandMenu`'s arrangement.
 *
 * OPEN DOCUMENT LEADS (Mark, 2026-09-25) — ALL the record's files in one tab,
 * merged when there are several, exactly the list's Open (`openDocumentFiles`).
 * Unlike the per-file rows it means one thing whatever the file count, which
 * is what lets it sit in a screen-level menu. Dimmed with no files.
 */
export function DocumentCommandMenu({
  documentId,
  title,
  fileCount,
  orgId,
  today,
  editable,
  canDelete,
}: {
  documentId: string;
  title: string;
  fileCount: number;
  orgId: string;
  /** The org's today, for a merged PDF's file name. */
  today: string;
  /** Can this reader write at all — whether Attach is offered. */
  editable: boolean;
  /** owner/admin (094) — whether Delete is. */
  canDelete: boolean;
}) {
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function open() {
    const win = openWindowNow();
    setFailed(null);
    startTransition(async () => {
      if (!win) {
        setFailed("The browser blocked the new tab. Allow pop-ups for this site, then try again.");
        return;
      }
      setFailed(await openDocumentFiles(createClient(), win, [documentId], today));
    });
  }

  const withDelete = (render: (items: Parameters<typeof ActionMenu>[0]["items"]) => React.ReactNode) =>
    canDelete ? (
      <DocumentActions documentId={documentId} title={title} fileCount={fileCount}>
        {render}
      </DocumentActions>
    ) : (
      render([])
    );

  const withAttach = (render: (items: Parameters<typeof ActionMenu>[0]["items"]) => React.ReactNode) =>
    editable ? (
      <AttachFile kind="document" ownerId={documentId} orgId={orgId}>
        {render}
      </AttachFile>
    ) : (
      render([])
    );

  return withAttach((attachRows) =>
    withDelete((deleteRows) => {
      const items = [
        { label: "Open Document", disabled: fileCount === 0 || busy, onSelect: open },
        ...attachRows.map((row, i) => (i === 0 ? { ...row, separatorBefore: true } : row)),
        ...deleteRows.map((row, i) => (i === 0 ? { ...row, separatorBefore: true } : row)),
      ];
      return (
        <div className="flex flex-col items-end gap-2">
          <ActionMenu ariaLabel={`Actions for ${title}`} minWidth={220} items={items} />
          {failed && <p className="max-w-sm text-right text-sm text-accent">{failed}</p>}
        </div>
      );
    })
  );
}
