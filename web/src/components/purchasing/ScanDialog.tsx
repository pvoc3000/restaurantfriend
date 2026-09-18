"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TabPicker } from "@/components/ui/TabPicker";
import {
  isNeutralTone,
  renderPage,
  rotateBy,
  rotateCrop,
  saveScanTone,
  useScanTone,
  MIN_CROP,
  NEUTRAL_TONE,
  type ScanCrop,
  type ScanMode,
  type ScanPageSettings,
  type ScanTone,
} from "@/lib/scanPages";

export type ScanPage = ScanPageSettings & { id: string };

/**
 * THE SCAN DIALOG — the pages taken so far, and what can be done to them
 * before they are attached as one PDF (see `AttachMenu` for how you get here,
 * `lib/scanPages` for how a page is drawn).
 *
 * TWO VIEWS IN ONE PANEL. The GRID shows every page as a tile; PREVIEW
 * (Mark, 2026-09-18: "see what the document will look like outside of a
 * thumbnail") shows one page as large as the window allows, with ‹ › through
 * the rest. The tone controls stay pinned above BOTH, so the preview is where
 * you dial the tone in — on a page big enough to read the print.
 *
 * Preview is also where CROP lives, because a crop is dragged, and a handle
 * on a 250px tile is too small to aim at on an iPad.
 *
 * THE TONE IS REMEMBERED (`useScanTone`) and every change to it saves; see
 * `lib/scanPages`. Rotation and crop are per page and die with the scan.
 *
 * In preview, closing the panel (✕, Escape, a tap outside) goes BACK TO THE
 * GRID rather than discarding the scan — a stray tap should not cost four
 * photographed pages. From the grid it discards, as it always has.
 */
export function ScanDialog({
  pages,
  onPagesChange,
  kindLabel,
  onAddPage,
  onCancel,
  onAttach,
  building,
  failed,
}: {
  pages: ScanPage[];
  onPagesChange: (update: (pages: ScanPage[]) => ScanPage[]) => void;
  kindLabel: string;
  onAddPage: () => void;
  onCancel: () => void;
  onAttach: (tone: ScanTone) => void;
  building: boolean;
  failed: string | null;
}) {
  const tone = useScanTone();
  /** The page shown large, or null for the grid. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** The crop being dragged in preview — committed on Done, dropped on Cancel. */
  const [draftCrop, setDraftCrop] = useState<ScanCrop | null>(null);
  const cropping = draftCrop !== null;

  const count = pages.length;
  const index = pages.findIndex((p) => p.id === viewing);
  const shown = index === -1 ? null : pages[index];

  function update(id: string, change: (p: ScanPage) => ScanPage) {
    onPagesChange((prev) => prev.map((p) => (p.id === id ? change(p) : p)));
  }

  function turn(id: string, quarterTurns: 1 | -1) {
    update(id, (p) => ({
      ...p,
      rotation: rotateBy(p.rotation, quarterTurns),
      crop: rotateCrop(p.crop, quarterTurns),
    }));
  }

  function remove(id: string) {
    // In preview, stay in preview on the neighbour rather than dropping back
    // to the grid; the last page removed leaves nothing to show either way.
    if (id === viewing) {
      const next = pages[index + 1] ?? pages[index - 1] ?? null;
      setViewing(next?.id ?? null);
    }
    onPagesChange((prev) => prev.filter((p) => p.id !== id));
  }

  function show(id: string | null) {
    setDraftCrop(null);
    setViewing(id);
  }

  return createPortal(
    <Dialog
      title={shown ? `Scan · ${kindLabel} · Page ${index + 1} of ${count}` : `Scan · ${kindLabel}`}
      onClose={shown ? () => show(null) : onCancel}
      busy={building}
      width={shown ? "max-w-6xl" : "max-w-4xl"}
      top={shown ? "pt-[3vh]" : "pt-[8vh]"}
      height={shown ? "h-[94vh]" : "max-h-[85vh]"}
      bodyClassName={shown ? "flex flex-col p-4" : "p-6"}
      toolbar={<ToneControls tone={tone} disabled={building || cropping} />}
      footer={
        <>
          {shown ? (
            <button
              type="button"
              onClick={() => show(null)}
              disabled={building || cropping}
              className={`${BUTTON_CLASS} mr-auto`}
            >
              All Pages
            </button>
          ) : (
            <button
              type="button"
              onClick={() => show(pages[0].id)}
              disabled={building || count === 0}
              className={`${BUTTON_CLASS} mr-auto`}
            >
              Preview
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={building} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAttach(tone)}
            disabled={building || cropping || count === 0}
            className={DIALOG_COMMIT_CLASS}
          >
            {building ? "Preparing…" : `Attach ${count} ${count === 1 ? "Page" : "Pages"}`}
          </button>
        </>
      }
    >
      {shown ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
            <button
              type="button"
              onClick={() => show(pages[index - 1].id)}
              disabled={index === 0 || cropping}
              aria-label="Previous page"
              className={SQUARE_CLASS}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => show(pages[index + 1].id)}
              disabled={index === count - 1 || cropping}
              aria-label="Next page"
              className={SQUARE_CLASS}
            >
              ›
            </button>
            <span className="mx-2 h-6 border-l border-neutral-300" aria-hidden />
            {cropping ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const full = draftCrop.x === 0 && draftCrop.y === 0 && draftCrop.w === 1 && draftCrop.h === 1;
                    update(shown.id, (p) => ({ ...p, crop: full ? null : draftCrop }));
                    setDraftCrop(null);
                  }}
                  className={BUTTON_CLASS}
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => setDraftCrop({ x: 0, y: 0, w: 1, h: 1 })}
                  className={BUTTON_CLASS}
                >
                  Whole Page
                </button>
                <button type="button" onClick={() => setDraftCrop(null)} className={DIALOG_CANCEL_CLASS}>
                  Cancel Crop
                </button>
              </>
            ) : (
              <>
                <RotateButtons disabled={building} pageLabel={`page ${index + 1}`} onTurn={(q) => turn(shown.id, q)} />
                <button
                  type="button"
                  disabled={building}
                  onClick={() => setDraftCrop(shown.crop ?? { x: 0, y: 0, w: 1, h: 1 })}
                  className={BUTTON_CLASS}
                >
                  Crop
                </button>
                <button
                  type="button"
                  disabled={building}
                  onClick={() => remove(shown.id)}
                  className="ml-2 text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                >
                  Remove
                </button>
              </>
            )}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100 p-3">
            {cropping ? (
              <CropEditor
                key={`${shown.id}-${shown.rotation}`}
                page={shown}
                tone={tone}
                crop={draftCrop}
                onChange={setDraftCrop}
              />
            ) : (
              <PageCanvas page={shown} tone={tone} maxEdge={LARGE_EDGE} label={`Page ${index + 1}`} />
            )}
          </div>
        </>
      ) : (
        <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {pages.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2">
              {/* The tile opens the preview too — the obvious thing to tap. */}
              <button
                type="button"
                onClick={() => show(p.id)}
                disabled={building}
                aria-label={`Preview page ${i + 1}`}
                className="flex aspect-[3/4] w-full items-center justify-center border border-ink bg-neutral-100 hover:bg-neutral-200"
              >
                <PageCanvas page={p} tone={tone} maxEdge={TILE_EDGE} label={`Page ${i + 1}`} />
              </button>
              <span className="flex items-center justify-between gap-2">
                <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                  Page {i + 1}
                  {p.crop && " · Cropped"}
                </span>
                <span className="flex items-center gap-2">
                  <RotateButtons disabled={building} pageLabel={`page ${i + 1}`} onTurn={(q) => turn(p.id, q)} />
                  <button
                    type="button"
                    disabled={building}
                    onClick={() => remove(p.id)}
                    className="ml-1 text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                  >
                    Remove
                  </button>
                </span>
              </span>
            </li>
          ))}
          <li className="flex aspect-[3/4] items-center justify-center border border-dashed border-neutral-400">
            <button type="button" disabled={building} onClick={onAddPage} className={BUTTON_CLASS}>
              Add Page
            </button>
          </li>
        </ol>
      )}
      {failed && <p className="mt-4 shrink-0 text-sm text-accent">{failed}</p>}
    </Dialog>,
    document.body
  );
}

/** A 36px square: the app's button, holding a glyph instead of a word. */
const SQUARE_CLASS =
  "mac-control inline-flex h-9 w-9 items-center justify-center border border-ink bg-white text-[17px] leading-none text-ink transition-colors hover:bg-neutral-100 disabled:opacity-35";

/** Long edge of a tile, in pixels — sharp at 3-across on a Retina iPad, and
 *  small enough to re-tone on every step of a slider. */
const TILE_EDGE = 640;
/** Long edge of the preview — enough to read an invoice's small print full
 *  screen on an iPad, still one frame to re-tone on a slider drag. */
const LARGE_EDGE = 1600;

function RotateButtons({
  disabled,
  pageLabel,
  onTurn,
}: {
  disabled: boolean;
  pageLabel: string;
  onTurn: (quarterTurns: 1 | -1) => void;
}) {
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTurn(-1)}
        aria-label={`Rotate ${pageLabel} left`}
        title="Rotate left"
        className={SQUARE_CLASS}
      >
        ↺
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTurn(1)}
        aria-label={`Rotate ${pageLabel} right`}
        title="Rotate right"
        className={SQUARE_CLASS}
      >
        ↻
      </button>
    </>
  );
}

/**
 * A page as it will be attached — drawn by `renderPage`, the PDF's own
 * function. Redrawn on the next frame after a change, so a slider dragged
 * across its range draws once per frame rather than once per input event.
 */
function PageCanvas({
  page,
  tone,
  maxEdge,
  label,
  whole = false,
}: {
  page: ScanPageSettings;
  tone: ScanTone;
  maxEdge: number;
  label: string;
  /** Ignore the crop — the crop editor shows the whole page to crop from. */
  whole?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { img, rotation, crop } = page;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (canvasRef.current) {
        renderPage(canvasRef.current, { img, rotation, crop: whole ? null : crop }, tone, maxEdge);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [img, rotation, crop, whole, tone, maxEdge]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block max-h-full max-w-full bg-white"
    />
  );
}

type Handle = "move" | "nw" | "ne" | "sw" | "se";

/**
 * The whole page with the kept rectangle over it: drag inside to move it,
 * drag a corner to size it. Everything is in FRACTIONS of the page, measured
 * against the canvas's own box on screen, so the crop means the same thing on
 * a phone and at full size.
 *
 * Pointer events with capture, so a finger that slides off the handle keeps
 * dragging it; `touch-action: none` stops iPad Safari scrolling the dialog
 * under the drag. The handles are 44px targets drawn as 14px squares — the
 * app's touch rule (see `ui/CalendarGrid`).
 */
function CropEditor({
  page,
  tone,
  crop,
  onChange,
}: {
  page: ScanPage;
  tone: ScanTone;
  crop: ScanCrop;
  onChange: (crop: ScanCrop) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);

  // The box is sized IN PIXELS to the largest page that fits the pane. A
  // percentage max-height on the canvas would not resolve inside a wrapper of
  // auto height, and the overlay's percentages need a box exactly the page's
  // shape.
  const sideways = page.rotation === 90 || page.rotation === 270;
  const aspect = sideways
    ? page.img.naturalHeight / page.img.naturalWidth
    : page.img.naturalWidth / page.img.naturalHeight;
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      const { width, height } = pane.getBoundingClientRect();
      const w = Math.min(width, height * aspect);
      setFit({ width: Math.floor(w), height: Math.floor(w / aspect) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [aspect]);

  const drag = useRef<{ handle: Handle; x: number; y: number; start: ScanCrop } | null>(null);

  // One handler, the handle read off the element — a handler MADE per handle
  // during render is what `react-hooks/refs` refuses.
  function begin(e: React.PointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = (e.currentTarget.dataset.handle ?? "move") as Handle;
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    const s = d.start;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    if (d.handle === "move") {
      onChange({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.handle === "nw" || d.handle === "sw") left = clamp(left + dx, 0, right - MIN_CROP);
    if (d.handle === "ne" || d.handle === "se") right = clamp(right + dx, left + MIN_CROP, 1);
    if (d.handle === "nw" || d.handle === "ne") top = clamp(top + dy, 0, bottom - MIN_CROP);
    if (d.handle === "sw" || d.handle === "se") bottom = clamp(bottom + dy, top + MIN_CROP, 1);
    onChange({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function end() {
    drag.current = null;
  }

  const pct = (v: number) => `${v * 100}%`;
  const corners: { handle: Handle; x: number; y: number; cursor: string }[] = [
    { handle: "nw", x: crop.x, y: crop.y, cursor: "nwse-resize" },
    { handle: "ne", x: crop.x + crop.w, y: crop.y, cursor: "nesw-resize" },
    { handle: "sw", x: crop.x, y: crop.y + crop.h, cursor: "nesw-resize" },
    { handle: "se", x: crop.x + crop.w, y: crop.y + crop.h, cursor: "nwse-resize" },
  ];

  return (
    <div ref={paneRef} className="flex h-full w-full items-center justify-center">
      {fit && (
        <div
          ref={boxRef}
          className="relative touch-none select-none"
          style={{ width: fit.width, height: fit.height }}
        >
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full [&>canvas]:max-h-none [&>canvas]:max-w-none">
            <PageCanvas page={page} tone={tone} maxEdge={LARGE_EDGE} label="Page to crop" whole />
          </div>
          {/* The part cut away, dimmed: one shadow spread from the kept box,
              clipped by this wrapper. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute outline outline-2 outline-ink"
              style={{
                left: pct(crop.x),
                top: pct(crop.y),
                width: pct(crop.w),
                height: pct(crop.h),
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
              }}
            />
          </div>
          <div
            className="absolute cursor-move"
            style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
            data-handle="move"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {corners.map((c) => (
            <div
              key={c.handle}
              className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: pct(c.x), top: pct(c.y), cursor: c.cursor }}
              data-handle={c.handle}
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <span className="h-3.5 w-3.5 border-2 border-ink bg-white" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MODE_OPTIONS = [
  { key: "color", label: "Color" },
  { key: "grey", label: "Greyscale" },
  { key: "bw", label: "Black & White" },
] as const satisfies readonly { key: ScanMode; label: string }[];

/** The scan's tone, pinned above the pages so it stays in reach as they
 *  scroll. Each control's label sits above it, the filter-row rule. Every
 *  change is saved as the default for the next scan. */
function ToneControls({ tone, disabled }: { tone: ScanTone; disabled: boolean }) {
  const onChange = saveScanTone;
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
