"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuButton } from "@/components/ui/MenuButton";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ATTACHMENT_ACCEPT_ATTR } from "@/lib/attachments";

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
 * The pages go through `lib/scanPages` — why one PDF, and why downscaled, is
 * there — and then into the caller's own `onFiles`, which is the same upload
 * and the same auto-read a picked file gets.
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
  const [pages, setPages] = useState<{ file: File; url: string }[]>([]);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The thumbnails' object URLs, released when the dialog lets them go. A ref
  // so the unmount cleanup sees the last list rather than the first.
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function openCamera() {
    const el = document.getElementById(scanInputId);
    if (el instanceof HTMLInputElement) el.click();
  }

  function discard() {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setFailed(null);
  }

  function removePage(index: number) {
    URL.revokeObjectURL(pages[index].url);
    setPages(pages.filter((_, i) => i !== index));
  }

  async function attach() {
    setBuilding(true);
    setFailed(null);
    try {
      const { scanToPdf, scanFileName } = await import("@/lib/scanPages");
      const pdf = await scanToPdf(
        pages.map((p) => p.file),
        scanFileName()
      );
      discard();
      onFiles([pdf]);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "The pages could not be put together.");
    } finally {
      setBuilding(false);
    }
  }

  const count = pages.length;

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
          if (picked.length === 0) return;
          setPages((prev) => [
            ...prev,
            ...picked.map((file) => ({ file, url: URL.createObjectURL(file) })),
          ]);
        }}
      />

      {/* Portalled: the Attach button sits inside a pane header and a reveal
          panel, and a fixed overlay inherits from wherever it is mounted. */}
      {count > 0 &&
        createPortal(
          <Dialog
            title={`Scan · ${kindLabel}`}
            onClose={discard}
            busy={building}
            width="max-w-3xl"
            footer={
              <>
                <button
                  type="button"
                  onClick={discard}
                  disabled={building}
                  className={DIALOG_CANCEL_CLASS}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void attach()}
                  disabled={building}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {building
                    ? "Preparing…"
                    : `Attach ${count} ${count === 1 ? "Page" : "Pages"}`}
                </button>
              </>
            }
          >
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {pages.map((p, i) => (
                <li key={p.url} className="flex flex-col gap-2">
                  {/* A blob URL, which next/image can't optimise. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={`Page ${i + 1}`}
                    className="aspect-[3/4] w-full border border-ink bg-neutral-100 object-contain"
                  />
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                      Page {i + 1}
                    </span>
                    <button
                      type="button"
                      disabled={building}
                      onClick={() => removePage(i)}
                      className="text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
              <li className="flex aspect-[3/4] items-center justify-center border border-dashed border-neutral-400">
                <button
                  type="button"
                  disabled={building}
                  onClick={openCamera}
                  className={BUTTON_CLASS}
                >
                  Add Page
                </button>
              </li>
            </ol>
            {failed && <p className="mt-4 text-sm text-accent">{failed}</p>}
          </Dialog>,
          document.body
        )}
    </>
  );
}
