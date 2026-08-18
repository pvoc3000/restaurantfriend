"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTR,
  attachmentPath,
  attachmentRejection,
  fileSize,
} from "@/lib/attachments";
import {
  SO_ATTACHMENT_BUCKET,
  SO_ATTACHMENT_KIND_LABEL,
  SO_ATTACHMENT_KIND_OPTIONS,
  stampsQuoteReturned,
  type SignedSoAttachment,
  type SoAttachmentKind,
} from "@/lib/specialOrderAttachments";
import { DocumentChip } from "@/components/ui/DocumentChip";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { PickList } from "@/components/ui/PickList";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * Decision 14's one card — pics and documents merged, plus the two documents
 * the app itself files when it sends one.
 *
 * The two write orders are opposite on purpose, both `useAttachmentActions`'
 * lessons carried over rather than rediscovered:
 *
 * - **Upload writes Storage FIRST, then the row.** A row that went in first and
 *   an upload that then failed leaves a chip pointing at nothing.
 * - **Delete removes the ROW first, then the object.** Inverted for the same
 *   reason: an orphan object is invisible and harmless, where a row pointing at
 *   a deleted file is a chip that will never load.
 *
 * WHY THIS IS NOT `useAttachmentActions`. That hook is the PO's, and its whole
 * reason for existing is auto-read — a decision about the act of attaching an
 * INVOICE, which has a vendor, a set of order lines to match against and an
 * `extract-invoice` call behind it. None of that is true of a photograph of a
 * cake. What the two share is the storage arithmetic, and that is shared:
 * `attachmentPath`, `ATTACHMENT_ACCEPT` and `attachmentRejection` are the same
 * functions, so a format droppable on one screen is droppable on the other.
 *
 * FILING A SIGNED QUOTE OFFERS THE STAMP (decision 14: offered, not forced).
 * The customer who prints, signs and scans is the manual lane decision 17's
 * link is the fast lane for, and it must stay one gesture.
 */
export function OrderDocuments({
  orderId,
  orgId,
  attachments,
  canWrite,
  quoteReturnedAt,
  authorName,
}: {
  orderId: string;
  orgId: string;
  /** Signed by the SERVER at render — one `createSignedUrls` batch, and a URL
   *  built to expire should not outlive the page. */
  attachments: SignedSoAttachment[];
  canWrite: boolean;
  /** Whether `quote_returned_at` is already set, which decides whether filing a
   *  signed quote has anything to offer. */
  quoteReturnedAt: string | null;
  authorName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<SoAttachmentKind>("signed_quote");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerStamp, setOfferStamp] = useState(false);

  async function log(message: string) {
    await supabase.from("special_order_events").insert({
      org_id: orgId,
      order_id: orderId,
      message,
      author: authorName,
      source: "app",
    });
  }

  async function upload(files: readonly File[]) {
    setError(null);
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      const path = attachmentPath(orgId, orderId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(SO_ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setBusy(null);
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }

      const { data: row, error: rowError } = await supabase
        .from("special_order_attachments")
        .insert({
          org_id: orgId,
          order_id: orderId,
          storage_path: path,
          kind,
          file_name: file.name,
          content_type: file.type || null,
          byte_size: file.size,
        })
        .select("id")
        .single();
      if (rowError || !row) {
        // The object is up but unrecorded. Take it back out rather than leaving
        // a file nothing points at.
        await supabase.storage.from(SO_ATTACHMENT_BUCKET).remove([path]);
        setBusy(null);
        setError(`${file.name}: ${rowError?.message ?? "could not record the file"}`);
        return;
      }
      await log(`Filed ${SO_ATTACHMENT_KIND_LABEL[kind].toLowerCase()}: ${file.name}`);
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    if (stampsQuoteReturned(kind) && !quoteReturnedAt) setOfferStamp(true);
    router.refresh();
  }

  async function stampReturned() {
    setBusy("Recording the approval…");
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const { data, error: e } = await supabase
      .from("special_orders")
      .update({ quote_returned_at: today })
      .eq("id", orderId)
      .select("id");
    setBusy(null);
    if (e) {
      setError(e.message);
      return;
    }
    if (!data?.length) {
      setError("Nothing was saved — the database refused it and said nothing.");
      return;
    }
    await log("Signed quote received");
    setOfferStamp(false);
    router.refresh();
  }

  async function remove(a: SignedSoAttachment) {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Remove ${a.file_name ?? "this document"} from this order?\n\nThis cannot be undone.`
        ),
        confirmLabel: "Remove",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy("Removing…");
    setError(null);
    const { error: rowError } = await supabase
      .from("special_order_attachments")
      .delete()
      .eq("id", a.id);
    if (rowError) {
      setBusy(null);
      setError(rowError.message);
      return;
    }
    // Best effort: the row is already gone, so a failure here leaves an orphan
    // object rather than a chip pointing at nothing.
    await supabase.storage.from(SO_ATTACHMENT_BUCKET).remove([a.storage_path]);
    setBusy(null);
    router.refresh();
  }

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <SectionHeading count={attachments.length}>Documents</SectionHeading>
        <span className="text-sm text-muted">
          {attachments.length === 0
            ? canWrite
              ? "Nothing filed — drop one here"
              : "Nothing filed"
            : null}
        </span>

        {canWrite && (
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">Add as</span>
              <span className="w-40">
                <PickList
                  value={kind}
                  options={SO_ATTACHMENT_KIND_OPTIONS}
                  onPick={(next) => setKind(next as SoAttachmentKind)}
                  ariaLabel="Kind of document"
                />
              </span>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className={BUTTON_CLASS}
            >
              Attach&hellip;
            </button>
            {/* NO `capture` ATTRIBUTE, deliberately: `capture` forces the
                camera, and without it iOS offers Photo Library / Take Photo /
                Choose File in one sheet — which is what you want when the
                document is sometimes a photograph of a signed page and
                sometimes a PDF the customer emailed. */}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(Array.from(e.target.files));
              }}
            />
          </span>
        )}
      </div>

      {busy && <ProgressBand label={busy} />}
      {error && <p className="text-sm text-accent">{error}</p>}

      {/* The stamp is OFFERED (decision 14). The `→` idiom the receiving screen
          settled: the app has worked something out and you take it, rather than
          finding it already written. */}
      {offerStamp && canWrite && (
        <p className="text-[13px] text-mark">
          Filed a signed quote —{" "}
          <button
            type="button"
            onClick={() => void stampReturned()}
            className="underline underline-offset-2 hover:text-ink"
          >
            → record the quote as approved today
          </button>
          <button
            type="button"
            onClick={() => setOfferStamp(false)}
            aria-label="Dismiss"
            className="ml-3 text-subtle hover:text-ink"
          >
            ✕
          </button>
        </p>
      )}

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
                  {SO_ATTACHMENT_KIND_LABEL[a.kind]}
                  {a.byte_size !== null && ` · ${fileSize(a.byte_size)}`}
                </p>
                <p className="truncate text-[11px] text-subtle">{a.created_at.slice(0, 10)}</p>
                {canWrite && (
                  <p>
                    <button
                      type="button"
                      disabled={busy !== null}
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
    </div>
  );

  if (!canWrite) return body;

  return (
    /* The WHOLE block is the drop target, matching PO detail's Paperwork card.
       What that buys beyond convenience: `accept` governs the PICKER only, so
       a drop gets no format check at all unless the zone does it itself — which
       is how a HEIC would otherwise be filed as a document nothing can open. */
    <FileDropZone
      accept={ATTACHMENT_ACCEPT}
      disabled={busy !== null}
      label={`Drop to file as ${SO_ATTACHMENT_KIND_LABEL[kind].toLowerCase()}`}
      onFiles={(files) => void upload(files)}
      onReject={(rejected) => setError(attachmentRejection(rejected))}
    >
      {body}
    </FileDropZone>
  );
}
