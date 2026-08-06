"use client";

import { useState } from "react";
import Link from "next/link";
import { withFrom } from "@/lib/breadcrumbs";
import {
  attachmentRejection,
  fileSize,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTR,
  ATTACHMENT_KIND_LABEL,
  ATTACHMENT_KIND_OPTIONS,
  type AttachmentKind,
  type SignedAttachment,
} from "@/lib/attachments";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { PickList } from "@/components/ui/PickList";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { DocumentChip } from "@/components/ui/DocumentChip";
import { useAttachmentActions } from "./useAttachmentActions";
import type { InvoiceCreationOrder } from "@/lib/invoiceFromExtraction";

/**
 * The paperwork for a delivery (spec §2 step 5). Until now receiving wrote
 * quantities with nothing to check them against — the invoice existed only on
 * paper or in somebody's photo roll, and the "invoice price differs" prompt
 * asked you to trust a number you couldn't see.
 *
 * Two ordering decisions here are deliberate and opposite, for the same reason:
 *
 * - **Upload writes Storage FIRST, then the row.** If the row went first and the
 *   upload failed, the card would show an attachment that opens onto nothing.
 * - **Delete removes the ROW first, then the object.** Inverted for the same
 *   reason: a failed object delete leaves an orphan nobody can see, which is
 *   harmless, while a failed row delete leaves a card pointing at a file that is
 *   already gone.
 *
 * The file input carries **no `capture` attribute** on purpose. `capture` forces
 * the camera and removes the choice; without it iOS offers Photo Library / Take
 * Photo / Choose File in one sheet — which is what you want, because the invoice
 * is sometimes a photo of a page and sometimes a PDF the vendor emailed.
 *
 * It also names formats explicitly rather than saying `image/*`, and that is
 * load-bearing now that invoices get READ: a photo picked from an iPhone's
 * library arrives as **HEIC** under `image/*`, which the model API doesn't
 * accept. Naming jpeg/png/webp makes iOS transcode to JPEG on the way out, so
 * the file that lands is one that can be read. `image/*` would still upload —
 * and then fail at extraction, hours later, with the invoice already filed.
 *
 * The writes themselves live in `useAttachmentActions`, shared with the
 * receiving screen's document pane — including AUTO-READ, which fires here too
 * because it's a decision about attaching an invoice rather than about a
 * screen.
 *
 * The whole CARD is a drop target (`ui/FileDropZone`), matching the receiving
 * screen's document pane. Note what that buys beyond convenience: the format
 * check the picker gets free from `accept` does not exist on a drop, so without
 * the zone doing it, dropping the HEIC that the paragraph above is entirely
 * about would work, and fail hours later at extraction.
 */
export function PoAttachments({
  poId,
  orgId,
  attachments,
  canEdit,
  order,
}: {
  poId: string;
  /** Not null on the table and the first segment of every object key. */
  orgId: string;
  /** Signed by the server at render — see PurchaseOrderDetailView. */
  attachments: SignedAttachment[];
  canEdit: boolean;
  /** The order these belong to, so a read invoice can be filed as a record
   *  against the right vendor and matched to the right lines. */
  order: InvoiceCreationOrder;
}) {
  const [kind, setKind] = useState<AttachmentKind>("invoice");
  const {
    phase,
    busy,
    error,
    fileRef,
    upload,
    read,
    fileAsInvoice,
    remove,
    reportError,
  } = useAttachmentActions({ poId, orgId, order });

  return (
    <FileDropZone
      disabled={!canEdit || busy}
      accept={ATTACHMENT_ACCEPT}
      label={`Drop to attach as ${ATTACHMENT_KIND_LABEL[kind].toLowerCase()}`}
      onFiles={(files) => void upload(files, kind)}
      onReject={(rejected) => reportError(attachmentRejection(rejected))}
      className="space-y-3 border border-ink bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Paperwork
        </h2>
        <span className="text-sm text-muted">
          {attachments.length > 0
            ? `${attachments.length} ${attachments.length === 1 ? "file" : "files"}`
            : canEdit
              ? "Nothing attached — drop one here"
              : "Nothing attached"}
        </span>

        {canEdit && (
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                Add as
              </span>
              <span className="w-36">
                <PickList
                  value={kind}
                  options={ATTACHMENT_KIND_OPTIONS}
                  onPick={(next) => setKind(next as AttachmentKind)}
                  ariaLabel="Kind of attachment"
                />
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              Attach&hellip;
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(Array.from(e.target.files), kind);
              }}
            />
          </span>
        )}
      </div>

      {/* The progress goes in a band rather than into the button's label: an
          invoice read is 30s of an Opus call, and a word where "Attach…" used
          to be is indistinguishable from nothing happening. */}
      {phase.kind !== "idle" && (
        <ProgressBand
          label={phase.label}
          note={
            phase.kind === "reading"
              ? "Reading an invoice takes about half a minute. You can keep working."
              : undefined
          }
        />
      )}

      {error && <p className="text-sm text-accent">{error}</p>}

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {attachments.map((a) => (
            <DocumentChip
              key={a.id}
              url={a.url}
              fileName={a.file_name}
              contentType={a.content_type}
            >
              <>
                <p className="truncate text-xs text-ink" title={a.file_name ?? ""}>
                  {a.file_name ?? "Untitled"}
                </p>
                <p className="truncate text-[11px] uppercase tracking-[0.12em] text-subtle">
                  {ATTACHMENT_KIND_LABEL[a.kind]}
                  {a.byte_size !== null && ` · ${fileSize(a.byte_size)}`}
                </p>
                {a.extraction && (
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--rf-green-600)]">
                    {a.extraction.lines.length}{" "}
                    {a.extraction.lines.length === 1 ? "line read" : "lines read"}
                  </p>
                )}
                {/* Where the reading ended up. A filed document links to its
                    record; one that's been read but not filed offers the
                    button, which is how the readings stored before this module
                    existed get cleared and how a failed auto-file recovers. */}
                {a.invoice_id && (
                  <p className="text-[11px] uppercase tracking-[0.12em]">
                    <Link
                      href={withFrom(`/invoices/${a.invoice_id}`, {
                        href: `/purchase-orders/${poId}`,
                        label: "PO",
                      })}
                      className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                    >
                      Invoice →
                    </Link>
                  </p>
                )}
                {canEdit && (
                  <p className="flex flex-wrap items-baseline gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void read(a)}
                      className="text-[11px] uppercase tracking-[0.06em] text-ink hover:underline disabled:opacity-35"
                    >
                      {a.extraction ? "Read again" : "Read invoice"}
                    </button>
                    {a.extraction && !a.invoice_id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void fileAsInvoice(a)}
                        className="text-[11px] uppercase tracking-[0.06em] text-ink hover:underline disabled:opacity-35"
                      >
                        File as invoice
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(a)}
                      className="text-[11px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                    >
                      Remove
                    </button>
                  </p>
                )}
              </>
            </DocumentChip>
          ))}
        </ul>
      )}
    </FileDropZone>
  );
}
