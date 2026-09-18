"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuButton } from "@/components/ui/MenuButton";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TabPicker } from "@/components/ui/TabPicker";
import { ATTACHMENT_ACCEPT_ATTR } from "@/lib/attachments";
import {
  isNeutralTone,
  loadImage,
  renderPage,
  rotateBy,
  NEUTRAL_TONE,
  type ScanMode,
  type ScanRotation,
  type ScanTone,
} from "@/lib/scanPages";

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
 * THE DIALOG ADJUSTS AS WELL AS COLLECTS (Mark, 2026-09-18): each page turns
 * a quarter at a time, and the scan as a whole takes a Color · Greyscale ·
 * Black & White mode, brightness and contrast. The tone is one setting for all
 * the pages rather than per page — they are one invoice shot in one light — and
 * rotation is per page, because it is one page the camera gets wrong.
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
  const [tone, setTone] = useState<ScanTone>(NEUTRAL_TONE);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function openCamera() {
    const el = document.getElementById(scanInputId);
    if (el instanceof HTMLInputElement) el.click();
  }

  function discard() {
    setPages([]);
    setTone(NEUTRAL_TONE);
    setFailed(null);
  }

  async function addPhotos(files: File[]) {
    setFailed(null);
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          img: await loadImage(file),
          rotation: 0 as ScanRotation,
        }))
      );
      setPages((prev) => [...prev, ...loaded]);
    } catch {
      setFailed("That photo could not be opened. Try taking it again.");
    }
  }

  function turn(id: string, quarterTurns: 1 | -1) {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: rotateBy(p.rotation, quarterTurns) } : p))
    );
  }

  async function attach() {
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
          if (picked.length > 0) void addPhotos(picked);
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
            width="max-w-4xl"
            toolbar={<ToneControls tone={tone} onChange={setTone} disabled={building} />}
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
                <li key={p.id} className="flex flex-col gap-2">
                  <PagePreview page={p} tone={tone} label={`Page ${i + 1}`} />
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                      Page {i + 1}
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={building}
                        onClick={() => turn(p.id, -1)}
                        aria-label={`Rotate page ${i + 1} left`}
                        title="Rotate left"
                        className={ROTATE_CLASS}
                      >
                        ↺
                      </button>
                      <button
                        type="button"
                        disabled={building}
                        onClick={() => turn(p.id, 1)}
                        aria-label={`Rotate page ${i + 1} right`}
                        title="Rotate right"
                        className={ROTATE_CLASS}
                      >
                        ↻
                      </button>
                      <button
                        type="button"
                        disabled={building}
                        onClick={() => setPages((prev) => prev.filter((x) => x.id !== p.id))}
                        className="ml-1 text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                      >
                        Remove
                      </button>
                    </span>
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

type ScanPage = { id: string; img: HTMLImageElement; rotation: ScanRotation };

/** A 36px square: the app's button, holding a glyph instead of a word. */
const ROTATE_CLASS =
  "mac-control inline-flex h-9 w-9 items-center justify-center border border-ink bg-white text-[17px] leading-none text-ink transition-colors hover:bg-neutral-100 disabled:opacity-35";

/** Long edge of a preview, in pixels — sharp at a 3-across tile on a Retina
 *  iPad, and small enough to re-tone on every step of a slider. */
const PREVIEW_EDGE = 640;

/**
 * One page as it will be attached — drawn by `renderPage`, the PDF's own
 * function, at preview size. Redrawn on the next frame after a change, so a
 * slider dragged across its range draws once per frame rather than once per
 * input event.
 */
function PagePreview({ page, tone, label }: { page: ScanPage; tone: ScanTone; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (canvasRef.current) renderPage(canvasRef.current, page.img, page.rotation, tone, PREVIEW_EDGE);
    });
    return () => cancelAnimationFrame(frame);
  }, [page.img, page.rotation, tone]);

  return (
    <div className="flex aspect-[3/4] w-full items-center justify-center border border-ink bg-neutral-100">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="max-h-full max-w-full"
      />
    </div>
  );
}

const MODE_OPTIONS = [
  { key: "color", label: "Color" },
  { key: "grey", label: "Greyscale" },
  { key: "bw", label: "Black & White" },
] as const satisfies readonly { key: ScanMode; label: string }[];

/** The scan's tone, pinned above the pages so it stays in reach as they
 *  scroll. Each control's label sits above it, the filter-row rule. */
function ToneControls({
  tone,
  onChange,
  disabled,
}: {
  tone: ScanTone;
  onChange: (tone: ScanTone) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full flex-wrap items-end gap-x-6 gap-y-3">
      {/* A div, not a label: a label wrapping buttons hands a click on its
          caption to the first of them, which would set Color. */}
      <div className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">Mode</span>
        <TabPicker
          options={MODE_OPTIONS}
          value={tone.mode}
          onChange={(mode) => onChange({ ...tone, mode })}
          ariaLabel="Color mode"
        />
      </div>
      <ToneSlider
        label={tone.mode === "bw" ? "Threshold" : "Brightness"}
        value={tone.brightness}
        onChange={(brightness) => onChange({ ...tone, brightness })}
        disabled={disabled}
      />
      <ToneSlider
        label="Contrast"
        value={tone.contrast}
        onChange={(contrast) => onChange({ ...tone, contrast })}
        disabled={disabled}
      />
      <button
        type="button"
        disabled={disabled || isNeutralTone(tone)}
        onClick={() => onChange(NEUTRAL_TONE)}
        className={BUTTON_CLASS}
      >
        Reset
      </button>
    </div>
  );
}

function ToneSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-w-40 flex-1 flex-col gap-1">
      <span className="flex justify-between text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
        <span className="tabular-nums text-ink">{value > 0 ? `+${value}` : value}</span>
      </span>
      {/* A native range: the one control that is a thumb on a track, and on
          an iPad the one that drags properly. Black to match the app's ink. */}
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        // A double-click puts it back to untouched.
        onDoubleClick={() => onChange(0)}
        className="h-9 w-full accent-black disabled:opacity-35"
      />
    </label>
  );
}
