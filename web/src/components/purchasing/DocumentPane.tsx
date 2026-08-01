"use client";

import { useState } from "react";
import { PickList } from "@/components/ui/PickList";
import { Pane, PaneHeader } from "@/components/ui/Pane";
import {
  fileSize,
  isImage,
  ATTACHMENT_KIND_LABEL,
  ATTACHMENT_KIND_OPTIONS,
  type AttachmentKind,
  type SignedAttachment,
} from "@/lib/attachments";

/**
 * The invoice, beside the lines you're receiving against it (Mark, 2026-07-31:
 * "you should be able to see the invoice while receiving").
 *
 * **The URL is held in state and this component is KEYED by attachment id.**
 * That is not an optimisation, it's the difference between working and not:
 * `createSignedUrls` mints a fresh JWT on every call, so every `router.refresh()`
 * hands down a DIFFERENT url string for the same file. React would then update
 * `<object data=…>`, the PDF plugin would re-fetch two megabytes and jump back
 * to page one — on every quantity you type. Seeding once per attachment pins
 * the document while you work on it; changing attachments changes the key and
 * gets a fresh one.
 *
 * Zoom and rotate exist for PHOTOGRAPHS. Half of these invoices are a phone
 * picture of a page, which arrives small and often sideways, and there is
 * nothing else on the screen that can fix that. PDFs get the browser plugin's
 * own viewer, so the buttons are hidden rather than faked for them.
 */
export function DocumentPane({
  attachment,
  attachments,
  canEdit,
  busy,
  onPick,
  onFilesPicked,
  onRemove,
  fileRef,
  kind,
  onKindChange,
  stacked,
}: {
  /** The document on screen. Null when the order has no paperwork at all. */
  attachment: SignedAttachment | null;
  /** All of the order's files, for the chooser. */
  attachments: SignedAttachment[];
  canEdit: boolean;
  busy: boolean;
  onPick: (id: string) => void;
  onFilesPicked: (files: FileList) => void;
  onRemove: (a: SignedAttachment) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  kind: AttachmentKind;
  onKindChange: (kind: AttachmentKind) => void;
  stacked: boolean;
}) {
  return (
    <Pane>
      {/* One row, fixed height, matching the lines column's band exactly — see
          `ui/Pane`. The name is the only variable-width thing here, so it's the
          one that gives way: `min-w-0` is what actually lets a flex child
          truncate instead of refusing to shrink below its text. */}
      <PaneHeader>
        {attachments.length > 1 ? (
          <span className="min-w-44 max-w-72 flex-1">
            <PickList
              value={attachment?.id ?? null}
              options={attachments.map((a) => ({
                value: a.id,
                label: a.file_name ?? "Untitled",
                hint: ATTACHMENT_KIND_LABEL[a.kind],
              }))}
              onPick={onPick}
              ariaLabel="Which document to show"
            />
          </span>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[12px] uppercase tracking-[0.12em] text-subtle"
            title={attachment?.file_name ?? ""}
          >
            {attachment?.file_name ?? "No document"}
            {attachment?.byte_size != null && ` · ${fileSize(attachment.byte_size)}`}
          </span>
        )}

        {/* Not optional, and not only in the fallback: iOS Safari renders page
            ONE of a PDF in <object> and will not scroll to the rest, and the
            Claude browser pane shows no inline PDF at all. On both, this link
            is the only way to read the second page. */}
        {attachment?.url && (
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink"
          >
            Open
          </a>
        )}

        {canEdit && (
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="w-32">
              <PickList
                value={kind}
                options={ATTACHMENT_KIND_OPTIONS}
                onPick={(next) => onKindChange(next as AttachmentKind)}
                ariaLabel="Kind of attachment"
              />
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="h-9 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              Attach&hellip;
            </button>
            {attachment && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(attachment)}
                className="text-[12px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
              >
                Remove
              </button>
            )}
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          // Named formats, not `image/*`: a photo picked from an iPhone's
          // library arrives as HEIC under `image/*`, which the model API won't
          // read. Naming these makes iOS transcode on the way out, so the
          // failure happens at pick time rather than at extraction time with
          // the invoice already filed.
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesPicked(e.target.files);
          }}
        />
      </PaneHeader>

      {/* An EMPTY pane doesn't get the tall box. Stacked on an iPad, a document
          area reserved for a document that isn't there is 700px of nothing to
          scroll past before the first line — on exactly the device this screen
          is for. It sizes to its own sentence until there's something to show. */}
      <div
        className={
          attachment === null
            ? "shrink-0"
            : `min-h-0 flex-1 ${stacked ? "h-[70vh]" : ""}`
        }
      >
        {attachment === null ? (
          <Empty canEdit={canEdit} />
        ) : (
          <Viewer key={attachment.id} attachment={attachment} />
        )}
      </div>
    </Pane>
  );
}

function Empty({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="px-6 py-8 text-center">
      <p className="text-sm text-muted">
        No invoice or packing slip on this order yet.
        {canEdit && " Attach one and it'll be read automatically."}
        <br />
        <span className="text-xs">
          You can still receive against the ordered quantities.
        </span>
      </p>
    </div>
  );
}

/**
 * The document itself. Split out purely so the `key` above remounts it —
 * everything below depends on `url` never changing under a working page.
 *
 * Nothing here carries a `min-height`. It used to (`min-h-64`, 256px), and on a
 * short pane — a tall invoice band above it, or a small window — that was 2px
 * MORE than the space the flex row had to give, so the PDF plugin painted over
 * the pane's own bottom border and the left column's frame stopped matching the
 * right's (Mark, 2026-07-31). The container always has a height to fill now:
 * governed by the measured split row when side by side, `h-[70vh]` when
 * stacked. `overflow-hidden` on `Pane` is the belt to this braces.
 */
function Viewer({ attachment }: { attachment: SignedAttachment }) {
  const [url] = useState(() => attachment.url);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);

  if (!url) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <p className="text-sm text-muted">
          This file couldn&rsquo;t be signed for viewing. Reload the page to try again.
        </p>
      </div>
    );
  }

  if (isImage(attachment)) {
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
          alt={attachment.file_name ?? "Invoice"}
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
          This browser won&rsquo;t show the PDF inline.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="text-ink">
            Open {attachment.file_name ?? "the document"}
          </a>{" "}
          in a new tab.
          <br />
          <span className="text-xs">
            The link is signed and expires after an hour — reload the page for a fresh
            one.
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
