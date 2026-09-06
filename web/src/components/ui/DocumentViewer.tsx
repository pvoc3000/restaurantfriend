"use client";

import { useState } from "react";

/**
 * A filed document, shown: a PDF through the browser's own plugin, an image
 * with zoom and rotate. Extracted 2026-09-05 from the receiving screen's
 * `DocumentPane` when the inspection record wanted the same preview (Mark:
 * "I'd like to see the inspection document previewed on the detail page") —
 * one viewer, or the two drift the way the two hand-rolled frames did.
 *
 * KEY IT BY THE DOCUMENT'S ID. The URL is held in state from the first render
 * and never updated, because `createSignedUrls` mints a fresh token per call:
 * without that, every `router.refresh()` handed `<object data=…>` a new string
 * and the PDF plugin re-fetched two megabytes and jumped back to page 1 on
 * every edit. So a caller shows a DIFFERENT document by remounting.
 *
 * Zoom and rotate exist for PHOTOGRAPHS — half the invoices this was built for
 * are phone photos of paper, arriving sideways. A PDF gets the plugin's own.
 *
 * Nothing here carries a `min-height` (the receiving screen paid for that:
 * `min-h-64` was 2px more than a short pane had, and the plugin painted over
 * the frame). The CALLER gives the box a height; this fills it.
 */
export function DocumentViewer({
  url: initialUrl,
  fileName,
  image,
}: {
  /** The signed URL, or null when signing failed. */
  url: string | null;
  fileName: string | null;
  /** Whether to treat it as a picture (zoom/rotate) rather than a PDF. */
  image: boolean;
}) {
  const [url] = useState(() => initialUrl);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);

  if (!url) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-sm text-muted">
          This file couldn’t be signed for viewing. Reload the page to try again.
        </p>
      </div>
    );
  }

  if (image) {
    return (
      <div className="relative h-full overflow-auto bg-neutral-100">
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 border border-ink bg-white">
          <ToolButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            −
          </ToolButton>
          <ToolButton label="Zoom in" onClick={() => setZoom((z) => Math.min(6, z + 0.25))}>
            +
          </ToolButton>
          <ToolButton label="Rotate left" onClick={() => setTurns((t) => t - 1)}>
            ⟲
          </ToolButton>
          <ToolButton label="Rotate right" onClick={() => setTurns((t) => t + 1)}>
            ⟳
          </ToolButton>
        </div>
        {/* A plain <img>, not next/image: a signed, short-lived URL into a
            PRIVATE bucket. next/image would need the Supabase host whitelisted
            as a remote pattern and would then cache a URL built to expire. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={fileName ?? "Document"}
          style={{
            transform: `rotate(${turns * 90}deg) scale(${zoom})`,
            transformOrigin: "center top",
          }}
          className="mx-auto block w-full max-w-none"
        />
      </div>
    );
  }

  return (
    <object data={url} type="application/pdf" className="h-full w-full">
      {/* Shown by any client without an inline PDF viewer — the Claude browser
          pane is one, and so is iOS Safari past page 1. */}
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-sm text-muted">
          This browser won’t show the PDF inline.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="text-ink">
            Open {fileName ?? "the document"}
          </a>{" "}
          in a new tab.
          <br />
          <span className="text-xs">
            The link is signed and expires after an hour — reload the page for a fresh one.
          </span>
        </p>
      </div>
    </object>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center text-ink hover:bg-neutral-100"
    >
      {children}
    </button>
  );
}
