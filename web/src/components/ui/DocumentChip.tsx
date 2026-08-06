"use client";

import type { ReactNode } from "react";

import { isImage } from "@/lib/attachments";

/**
 * A filed document, shown as the document.
 *
 * WHAT THIS REPLACED, and why it looked broken: the chip used to be a 112px
 * preview strip above a block of text, and the strip only ever handled
 * `image/*`. Everything else got a grey box with the word "PDF" in it. Measured
 * 2026-08-06: all 42 employee documents on file are PDFs and NONE is an image,
 * so that code path had never once been reached — every chip anyone had ever
 * seen was the placeholder, which reads as a preview that failed to load rather
 * than as a preview nobody wrote (Mark: "they look like they're supposed to
 * preview the document in the upper half but don't").
 *
 * So the preview fills the whole chip and the text sits over it (Mark's
 * design; it started semi-opaque and didn't stay that way — see the overlay).
 * Three things that took care:
 *
 * A PDF IN AN `<object>` IS A PLUGIN AND SWALLOWS POINTER EVENTS — the same
 * fact `ui/FileDropZone` exists to work around. Aiming at the document you are
 * looking at is the obvious way to open it, so the plugin is
 * `pointer-events-none` and a transparent anchor sits over the whole chip to
 * take the click.
 *
 * THE OVERLAY HOLDS REAL CONTROLS — an expiry date picker, Remove, Read again —
 * so it must sit ABOVE that anchor, or the anchor would eat every click meant
 * for them and quietly open a new tab instead.
 *
 * AND THE VIEWER CHROME IS HIDDEN with `#toolbar=0&navpanes=0&scrollbar=0`. At
 * 176px wide Chrome's PDF toolbar is most of the box, so without this the
 * "preview" is a grey toolbar with a sliver of page under it. `view=FitH` fits
 * the page WIDTH, which is what makes the top of a document recognisable at
 * thumbnail size. The fragment goes after the signed URL's query string, which
 * is untouched by it.
 *
 * ---------------------------------------------------------------------------
 * CONFIRMED IN THE APP by Mark, 2026-08-06 — a real PDF previews at this size.
 *
 * Worth recording because it CANNOT be checked from the Claude browser pane,
 * which has no PDF renderer at all: it paints a dark box for `<object>`,
 * `<iframe>` and `<embed>` alike, with and without the fragment. All five
 * variants failed identically there, which is the signature of a missing viewer
 * rather than a wrong parameter — so a dark box in the pane says nothing about
 * the app, and is not a regression to go chasing.
 */
export function DocumentChip({
  url,
  fileName,
  contentType,
  children,
}: {
  /** A signed, short-lived URL, or null when one could not be minted. */
  url: string | null;
  fileName: string | null;
  contentType: string | null;
  /** The text and controls that float over the preview. */
  children: ReactNode;
}) {
  // `lib/attachments`' own helper, not a local `startsWith`: a file picked on
  // iOS sometimes arrives with an EMPTY content type, and it falls back to the
  // extension. The same fallback is why the PDF test below checks the name too.
  const image = isImage({ content_type: contentType, file_name: fileName });
  const pdf =
    contentType === "application/pdf" ||
    (!contentType && /\.pdf$/i.test(fileName ?? ""));
  const label = fileName ?? "this document";

  return (
    /* 176 × 224 — the same overall height the chip had BEFORE the preview
       filled it (a 112px strip over ~110px of text). Mark, 2026-08-06: the
       height "increased unnecessarily", and it had: 288px bought a bigger
       preview at the cost of a taller wall of chips, when the point was to use
       the space that was already there rather than ask for more.

       A FIXED height rather than an aspect ratio, because the overlay is
       absolutely positioned and contributes nothing to it, and because the two
       callers' overlays differ in height — the employee chip carries an expiry
       picker the PO chip doesn't. */
    <li className="relative h-56 w-44 overflow-hidden border border-hairline bg-neutral-100">
      {/* ---- the preview, edge to edge ---------------------------------- */}
      {url && image ? (
        /* A plain <img>, not next/image: a signed, short-lived URL into a
           PRIVATE bucket. next/image would need the Supabase host whitelisted
           as a remote pattern and would then cache a URL built to expire. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="absolute inset-0 h-full w-full object-cover" />
      ) : url && pdf ? (
        <object
          data={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          type="application/pdf"
          // The plugin would otherwise swallow the click meant for the anchor
          // below it. Nothing inside here needs to be interactive.
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {/* Any client with no inline PDF viewer — iOS Safari past page 1, and
              the Claude browser pane. */}
          <span className="flex h-full w-full items-center justify-center text-[12px] uppercase tracking-[0.12em] text-subtle">
            PDF
          </span>
        </object>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[12px] uppercase tracking-[0.12em] text-subtle">
          {url ? "No preview" : "Unavailable"}
        </span>
      )}

      {/* ---- the click target ------------------------------------------- */}
      {/* Over the whole chip so the document itself is what you press, and
          UNDER the overlay so the overlay's own controls still work. */}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          className="absolute inset-0 z-10 block no-underline transition-colors hover:bg-ink/5"
        />
      )}

      {/* ---- the text, over it ------------------------------------------ */}
      {/* OPAQUE, not the semi-opaque this started as (Mark, 2026-08-06: "the
          rendering on the text area varies when it shouldn't"). It did, and
          translucency is why: at 90% white the band reads as flat grey where a
          page has ENDED and the plugin's own background is behind it, and as
          legible document text where the page runs to the bottom. Same overlay,
          two appearances, decided by whichever document happens to be filed.

          Blur would keep the translucency and wash the variation out, but
          `backdrop-filter` over a PDF plugin composites in a separate layer and
          cannot be relied on. Opaque is the one option that cannot vary. */}
      <div className="absolute inset-x-0 bottom-0 z-20 space-y-0.5 border-t border-hairline bg-white px-2 py-2">
        {children}
      </div>
    </li>
  );
}
