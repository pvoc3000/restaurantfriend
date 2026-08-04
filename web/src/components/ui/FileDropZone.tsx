"use client";

import { useEffect, useRef, useState } from "react";
import { fileMatchesAccept } from "@/lib/fileTypes";

/**
 * Drop files onto a region of the page (Mark, 2026-08-03, of the receiving
 * screen's document pane: "can the user drag a pdf onto the pdf viewer").
 *
 * Three things about it are load-bearing.
 *
 * **The overlay is the drop target, not the region itself.** A PDF in an
 * `<object>` is a PLUGIN, and a plugin swallows drag events before React ever
 * sees them — aim at the middle of the document you're looking at, which is the
 * obvious place to aim, and nothing happens. So the moment a file drag enters
 * the WINDOW, an absolutely-positioned layer goes up over the region and takes
 * the drop. Listening at the window rather than on the region is what makes it
 * appear before the pointer arrives, instead of only once the pointer is
 * already over a plugin that won't report it.
 *
 * **A drop is not filtered by `accept`.** That attribute governs the file
 * PICKER and nothing else, so every reason the picker names its formats applies
 * here with no help from the browser: an iPhone photo dragged out of Photos or
 * Finder is HEIC, which the model API won't read, and an unchecked drop would
 * file it and then fail at extraction with the invoice already stored. The
 * check happens before anything is uploaded.
 *
 * **A file dropped OUTSIDE the region is swallowed, not navigated to.** A
 * browser's default for a file dropped on a page is to open it, which would
 * replace a half-counted delivery with a PDF viewer. While a drag is live and
 * this zone is enabled, that default is suppressed page-wide.
 */
export function FileDropZone({
  disabled = false,
  accept,
  label,
  onFiles,
  onReject,
  className = "",
  children,
}: {
  /** No overlay, no page-wide suppression — the zone is simply not there. */
  disabled?: boolean;
  /** MIME types a dropped file may have, e.g. ["application/pdf"]. */
  accept: readonly string[];
  /** What the overlay says. Name the outcome, not the gesture. */
  label: string;
  onFiles: (files: File[]) => void;
  /** The files this refused, for the CALLER to word — a general control knows
   *  a type didn't match, and only the domain knows what to suggest instead.
   *  Nothing is uploaded when this fires. */
  onReject: (rejected: File[]) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  /* dragenter/dragleave fire for every element the pointer crosses, so a bare
     boolean flickers off the instant the drag moves between two children.
     Counting the pairs is the standard answer and the only one that survives
     nested markup. */
  const depth = useRef(0);

  useEffect(() => {
    if (disabled) return;

    const carriesFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    function enter(e: DragEvent) {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setActive(true);
    }
    function leave(e: DragEvent) {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    }
    function over(e: DragEvent) {
      // Suppressing the page's default open-the-file behaviour requires
      // preventing dragover, not drop — by the time drop fires it's too late.
      if (carriesFiles(e)) e.preventDefault();
    }
    function done() {
      depth.current = 0;
      setActive(false);
    }

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", done);
    window.addEventListener("dragend", done);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", done);
      window.removeEventListener("dragend", done);
      // A drag in flight when this unmounts would otherwise leave the counter
      // armed for the next mount.
      depth.current = 0;
    };
  }, [disabled]);

  function drop(e: React.DragEvent) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const rejected = files.filter((f) => !fileMatchesAccept(f, accept));
    if (rejected.length > 0) {
      onReject(rejected);
      return;
    }
    onFiles(files);
  }

  return (
    <div className={`relative ${className}`} onDrop={drop}>
      {children}
      {active && (
        /* Square, hairline-descended, no shadow — and z-10 rather than a rung
           on the app's own ladder, because it only ever needs to beat the
           sibling it covers. */
        <div
          className="absolute inset-0 z-10 grid place-items-center border-2 border-ink bg-white/95 px-6 text-center"
          onDragOver={(e) => e.preventDefault()}
        >
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">
            {label}
          </p>
        </div>
      )}
    </div>
  );
}
