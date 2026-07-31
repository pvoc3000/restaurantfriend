"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentPath,
  fileSize,
  isImage,
  ATTACHMENT_BUCKET,
  ATTACHMENT_KIND_LABEL,
  ATTACHMENT_KIND_OPTIONS,
  type AttachmentKind,
  type SignedAttachment,
} from "@/lib/attachments";
import { PickList } from "@/components/ui/PickList";

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
 */
export function PoAttachments({
  poId,
  orgId,
  attachments,
  canEdit,
}: {
  poId: string;
  /** Not null on the table and the first segment of every object key. */
  orgId: string;
  /** Signed by the server at render — see PurchaseOrderDetailView. */
  attachments: SignedAttachment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>("invoice");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy(`Uploading ${file.name}…`);
      const path = attachmentPath(orgId, poId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setBusy(null);
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }

      const { error: rowError } = await supabase
        .from("purchase_order_attachments")
        .insert({
          org_id: orgId,
          po_id: poId,
          storage_path: path,
          kind,
          file_name: file.name,
          content_type: file.type || null,
          byte_size: file.size,
        });
      if (rowError) {
        // The object is up but unrecorded. Take it back out rather than leaving
        // a file nothing points at.
        await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
        setBusy(null);
        setError(`${file.name}: ${rowError.message}`);
        return;
      }
    }
    setBusy(null);
    // So the same file can be picked again after a failure — a file input holds
    // its value and won't re-fire change for an identical selection.
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  /**
   * Have the invoice read (the `extract-invoice` edge function). It writes the
   * extraction onto this attachment; `router.refresh()` brings it back and the
   * line table's Reconcile toggle appears.
   *
   * Nothing about the ORDER changes here — extraction only ever produces a
   * proposal to compare against, which a human then accepts line by line.
   */
  async function read(attachment: SignedAttachment) {
    setBusy(`Reading ${attachment.file_name ?? "the invoice"}…`);
    setError(null);
    const { data, error } = await supabase.functions.invoke("extract-invoice", {
      body: { attachment_id: attachment.id },
    });
    setBusy(null);
    if (error) {
      // The function returns a readable message in the body; the SDK surfaces
      // only "non-2xx status code" unless we go and get it.
      let message = error.message;
      const res = (error as { context?: Response }).context;
      if (res) {
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // Keep the SDK's message.
        }
      }
      setError(message);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }
    router.refresh();
  }

  async function remove(attachment: SignedAttachment) {
    if (
      !window.confirm(
        `Remove ${attachment.file_name ?? "this attachment"} from this order?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setBusy("Removing…");
    setError(null);

    const { error: rowError } = await supabase
      .from("purchase_order_attachments")
      .delete()
      .eq("id", attachment.id);
    if (rowError) {
      setBusy(null);
      setError(rowError.message);
      return;
    }
    // Best effort: the row is already gone, so a failure here leaves an orphan
    // object rather than a broken card. Not worth stopping the user over.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-3 border border-ink px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Paperwork
        </h2>
        <span className="text-sm text-muted">
          {attachments.length === 0
            ? "Nothing attached"
            : `${attachments.length} ${attachments.length === 1 ? "file" : "files"}`}
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
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {busy ? busy : "Attach…"}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
              }}
            />
          </span>
        )}
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {attachments.map((a) => (
            <li key={a.id} className="w-44 border border-hairline">
              <a
                href={a.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block no-underline"
              >
                {isImage(a) && a.url ? (
                  /* A plain <img>, not next/image: this is a signed, short-lived
                     URL into a PRIVATE bucket. next/image would need the Supabase
                     host whitelisted as a remote pattern and would then cache a
                     URL that is built to expire. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.url}
                    alt={a.file_name ?? "Attachment"}
                    className="h-28 w-full bg-neutral-100 object-cover"
                  />
                ) : (
                  <span className="flex h-28 w-full items-center justify-center bg-neutral-100 text-[12px] uppercase tracking-[0.12em] text-subtle">
                    {a.url ? "PDF" : "Unavailable"}
                  </span>
                )}
              </a>
              <div className="space-y-0.5 px-2 py-2">
                <p className="truncate text-xs text-ink" title={a.file_name ?? ""}>
                  {a.file_name ?? "Untitled"}
                </p>
                <p className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                  {ATTACHMENT_KIND_LABEL[a.kind]}
                  {a.byte_size !== null && ` · ${fileSize(a.byte_size)}`}
                </p>
                {a.extraction && (
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--rf-green-600)]">
                    {a.extraction.lines.length}{" "}
                    {a.extraction.lines.length === 1 ? "line read" : "lines read"}
                  </p>
                )}
                {canEdit && (
                  <p className="flex flex-wrap items-baseline gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void read(a)}
                      className="text-[11px] uppercase tracking-[0.06em] text-ink hover:underline disabled:opacity-35"
                    >
                      {a.extraction ? "Read again" : "Read invoice"}
                    </button>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
