"use client";

import { MenuButton } from "@/components/ui/MenuButton";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ATTACHMENT_ACCEPT_ATTR } from "@/lib/attachments";
import { useScanCapture } from "./useScanCapture";

/**
 * THE ATTACH COMMAND on an order's or an invoice's paperwork — a menu of two
 * (Mark, 2026-09-18): **File…** picks what already exists, **Scan…** takes the
 * pages with the camera and attaches them as ONE PDF.
 *
 * Shared by the Paperwork card on PO detail and `DocumentPane` (receiving and
 * the bill record), because the two Attach buttons were already twins and a
 * menu on one of them only would be the drift this codebase keeps warning
 * about. Both hidden inputs live HERE, beside the menu that clicks them:
 * `input.click()` is honoured only inside a user gesture, and `MenuButton` runs
 * `onSelect` in the same click that chose the row.
 *
 * SCAN IS `useScanCapture` — the camera, the pages and `ScanDialog` (rotate,
 * crop, preview, a remembered tone; Mark, 2026-09-18) — shared since
 * 2026-10-05 with the tablet home screen's scan tiles. File… keeps iOS's
 * Photo Library / Take Photo / Choose File sheet, which is the reason its
 * input carries no `capture` (see `PoAttachments`).
 *
 * The scanned PDF goes into the caller's own `onFiles`, which is the same
 * upload and the same auto-read a picked file gets.
 */
export function AttachMenu({
  fileRef,
  onFiles,
  busy,
  kindLabel,
  triggerClassName = BUTTON_CLASS,
}: {
  /** The File… input. The caller holds it because `useAttachmentActions`
   *  clears its value after a run. */
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
  busy: boolean;
  /** What the scan will be filed as — "Invoice" — for the dialog's title. */
  kindLabel: string;
  triggerClassName?: string;
}) {
  const scan = useScanCapture({ kindLabel, onPdf: (pdf) => onFiles([pdf]) });

  return (
    <>
      <MenuButton
        label="Attach"
        trigger="Attach"
        triggerClassName={triggerClassName}
        caret
        disabled={busy}
        items={[
          { label: "File…", onSelect: () => fileRef.current?.click() },
          { label: "Scan…", onSelect: scan.openCamera },
        ]}
      />

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
        }}
      />
      {scan.element}
    </>
  );
}
