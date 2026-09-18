"use client";

import { useId, useState } from "react";
import { MenuButton } from "@/components/ui/MenuButton";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ATTACHMENT_ACCEPT_ATTR } from "@/lib/attachments";
import { loadImage, type ScanTone } from "@/lib/scanPages";
import { ScanDialog, type ScanPage } from "./ScanDialog";

/**
 * THE ATTACH COMMAND on an order's or an invoice's paperwork — a menu of two
 * (Mark, 2026-09-18): **File…** picks what already exists, **Scan…** takes the
 * pages with the camera and attaches them as ONE PDF.
 *
 * Shared by the Paperwork card on PO detail and `DocumentPane` (receiving and
 * the invoice record), because the two Attach buttons were already twins and a
 * menu on one of them only would be the drift this codebase keeps warning
 * about. Both hidden inputs live HERE, beside the menu that clicks them:
 * `input.click()` is honoured only inside a user gesture, and `MenuButton` runs
 * `onSelect` in the same click that chose the row.
 *
 * SCAN OPENS THE CAMERA STRAIGHT AWAY rather than opening a dialog first, so
 * the common case — a one-page delivery slip — is Scan…, shoot, Attach. The
 * dialog appears once there is a page in it, to add the next page or to send.
 * `capture="environment"` is what asks iOS for the rear camera instead of the
 * Photo Library / Take Photo / Choose File sheet; File… keeps that sheet, which
 * is the reason it carries no `capture` (see `PoAttachments`). A browser with
 * no camera ignores `capture` and shows its ordinary picker, so on a Mac Scan…
 * still works as "put these photos together into one PDF".
 *
 * THE DIALOG ADJUSTS AS WELL AS COLLECTS (Mark, 2026-09-18) — rotate, crop,
 * preview, and a remembered tone. That is `ScanDialog`; this component holds
 * the pages and the inputs.
 *
 * The pages go through `lib/scanPages` — why one PDF, why downscaled, and why
 * the preview is drawn by the same code as the PDF, is there — and then into
 * the caller's own `onFiles`, which is the same upload and the same auto-read
 * a picked file gets.
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
  const scanInputId = useId();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function openCamera() {
    const el = document.getElementById(scanInputId);
    if (el instanceof HTMLInputElement) el.click();
  }

  function discard() {
    setPages([]);
    setFailed(null);
  }

  async function addPhotos(files: File[]) {
    setFailed(null);
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          img: await loadImage(file),
          rotation: 0 as const,
          crop: null,
        }))
      );
      setPages((prev) => [...prev, ...loaded]);
    } catch {
      setFailed("That photo could not be opened. Try taking it again.");
    }
  }

  async function attach(tone: ScanTone) {
    setBuilding(true);
    setFailed(null);
    try {
      const { scanToPdf, scanFileName } = await import("@/lib/scanPages");
      const pdf = await scanToPdf(pages, tone, scanFileName());
      discard();
      onFiles([pdf]);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "The pages could not be put together.");
    } finally {
      setBuilding(false);
    }
  }

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
          { label: "Scan…", onSelect: openCamera },
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
      <input
        id={scanInputId}
        type="file"
        // Photos only — a scan is a camera's output. Named formats rather than
        // `image/*` for the HEIC reason in `lib/attachments`.
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Cleared at once, so the same photo can be taken twice.
          e.target.value = "";
          if (picked.length > 0) void addPhotos(picked);
        }}
      />

      {/* Open with a failure and no pages too: a first photo that will not
          open would otherwise set an error nothing is on screen to show. */}
      {(pages.length > 0 || failed) && (
        <ScanDialog
          pages={pages}
          onPagesChange={setPages}
          kindLabel={kindLabel}
          onAddPage={openCamera}
          onCancel={discard}
          onAttach={(tone) => void attach(tone)}
          building={building}
          failed={failed}
        />
      )}
    </>
  );
}
