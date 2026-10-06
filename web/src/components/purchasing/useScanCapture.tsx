"use client";

import { useId, useState, type ReactNode } from "react";
import { detectPage, loadImage, type ScanCrop, type ScanTone } from "@/lib/scanPages";
import { ScanDialog, type ScanPage } from "./ScanDialog";

/**
 * SCANNING, AS ONE PIECE — the camera input, the pages taken so far and the
 * `ScanDialog` that adjusts them, ending in ONE PDF handed to the caller.
 *
 * Lifted out of `AttachMenu` (2026-10-05) when the tablet home screen gained
 * two tiles that scan (`tablet/ScanEmployeeTile`, `tablet/ScanBillTile`): the
 * act is the same whether the PDF lands on an order, a bill or a personnel
 * file, and a second copy of it would be the drift this codebase keeps warning
 * about. What differs is what happens to the PDF, which is `onPdf`.
 *
 * `openCamera` MUST BE CALLED INSIDE A USER GESTURE — `input.click()` is
 * honoured nowhere else — and `element` must be rendered somewhere, because
 * the input it clicks lives in it.
 *
 * SCAN OPENS THE CAMERA STRAIGHT AWAY rather than opening a dialog first, so
 * the common case — a one-page delivery slip — is Scan…, shoot, Attach. The
 * dialog appears once there is a page in it, to add the next page or to send.
 * `capture="environment"` is what asks iOS for the rear camera instead of the
 * Photo Library / Take Photo / Choose File sheet. A browser with no camera
 * ignores `capture` and shows its ordinary picker, so on a Mac it still works
 * as "put these photos together into one PDF".
 *
 * The pages go through `lib/scanPages` — why one PDF, why downscaled, and why
 * the preview is drawn by the same code as the PDF, is there.
 */
export function useScanCapture({
  kindLabel,
  commitVerb,
  onPdf,
}: {
  /** What the scan will be filed as — "Invoice" — for the dialog's title. */
  kindLabel: string;
  /** See `ScanDialog`. */
  commitVerb?: string;
  onPdf: (pdf: File) => void;
}): { openCamera: () => void; element: ReactNode } {
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
        files.map(async (file) => {
          const img = await loadImage(file);
          // The page found and squared up on the way in (`detectPage`); left
          // whole when nothing page-like is found. A detector that throws is a
          // photo without a crop, never a photo lost.
          let crop: ScanCrop | null = null;
          try {
            crop = detectPage({ img, rotation: 0 });
          } catch {
            crop = null;
          }
          return { id: crypto.randomUUID(), img, rotation: 0 as const, crop };
        })
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
      onPdf(pdf);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "The pages could not be put together.");
    } finally {
      setBuilding(false);
    }
  }

  const element = (
    <>
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
          commitVerb={commitVerb}
          onAddPage={openCamera}
          onCancel={discard}
          onAttach={(tone) => void attach(tone)}
          building={building}
          failed={failed}
        />
      )}
    </>
  );

  return { openCamera, element };
}
