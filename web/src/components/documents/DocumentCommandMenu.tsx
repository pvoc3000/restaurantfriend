"use client";

import { ActionMenu } from "@/components/ui/ActionMenu";
import { AttachFile } from "./AttachFile";
import { DocumentActions } from "./DocumentActions";

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
 * `canDelete` false leaves ONE row, which is still worth a menu here: it is the
 * command the screen is for, and a lone Attach button in the title row would be
 * a second place for a control the card already has.
 */
export function DocumentCommandMenu({
  documentId,
  title,
  fileCount,
  orgId,
  editable,
  canDelete,
}: {
  documentId: string;
  title: string;
  fileCount: number;
  orgId: string;
  /** Can this reader write at all — whether Attach is offered. */
  editable: boolean;
  /** owner/admin (094) — whether Delete is. */
  canDelete: boolean;
}) {
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
        ...attachRows,
        ...deleteRows.map((row, i) =>
          i === 0 && attachRows.length > 0 ? { ...row, separatorBefore: true } : row
        ),
      ];
      // Nothing to offer, nothing to open — the inventory list's rule.
      if (items.length === 0) return null;
      return <ActionMenu ariaLabel={`Actions for ${title}`} minWidth={220} items={items} />;
    })
  );
}
