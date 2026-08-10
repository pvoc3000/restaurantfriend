"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentPath,
  invoiceOwner,
  ATTACHMENT_BUCKET,
  type AttachmentKind,
  type PoAttachment,
} from "@/lib/attachments";
import {
  createInvoiceFromReading,
  type InvoiceCreationOrder,
} from "@/lib/invoiceFromExtraction";
import type { InvoiceExtraction } from "@/lib/invoiceExtraction";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * Attaching, reading and removing a PO's paperwork — the writes, shared by the
 * Paperwork card on PO detail and the document pane on the receiving screen.
 *
 * It lives in a hook rather than in either component because AUTO-READ is a
 * decision about the ACT of attaching an invoice (Mark, 2026-07-31), not about
 * a screen. If the two surfaces owned their own copies, the same gesture would
 * eventually behave differently depending on where you did it.
 *
 * The two write orders are opposite on purpose, and both are load-bearing:
 *
 * - **Upload writes Storage FIRST, then the row.** A row that went in first and
 *   an upload that then failed leaves a card pointing at nothing.
 * - **Delete removes the ROW first, then the object.** Inverted for the same
 *   reason: a failed object delete leaves an orphan nobody can see, which is
 *   harmless, while a failed row delete leaves a card pointing at a file that is
 *   already gone.
 */

export type AttachPhase =
  | { kind: "idle" }
  | { kind: "uploading" | "reading" | "removing" | "filing"; label: string };

const IDLE: AttachPhase = { kind: "idle" };

export function useAttachmentActions({
  poId,
  orgId,
  order,
  invoiceId,
}: {
  /** The purchase order these documents hang off, or null on an invoice with
   *  no order behind it (migration 026 made `po_id` nullable). */
  poId: string | null;
  orgId: string;
  /** What an auto-filed invoice needs to know: whose vendor, whose location,
   *  and the lines to match against. Absent on the Invoices section's own
   *  upload, which supplies a vendor directly. */
  order?: InvoiceCreationOrder | null;
  /** Where an invoice-owned upload's objects go, and the vendor/location a
   *  reading is filed under when there is no order. */
  invoiceId?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [phase, setPhase] = useState<AttachPhase>(IDLE);
  const [error, setError] = useState<string | null>(null);
  // The file input's own value has to be cleared after a run, or picking the
  // identical file again won't re-fire `change`.
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Have an invoice read (the `extract-invoice` edge function). It writes the
   * extraction onto the attachment row; the refresh brings it back.
   *
   * Nothing about the ORDER changes here — an extraction is only ever a
   * proposal to compare against, which a person then accepts line by line.
   */
  async function read(
    attachment: Pick<PoAttachment, "id" | "file_name" | "invoice_id">
  ) {
    setPhase({ kind: "reading", label: `Reading ${attachment.file_name ?? "the invoice"}…` });
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("extract-invoice", {
      body: { attachment_id: attachment.id },
    });

    if (fnError) {
      setPhase(IDLE);
      // The function returns a readable message in the body; the SDK surfaces
      // only "non-2xx status code" unless we go and get it.
      let message = fnError.message;
      const res = (fnError as { context?: Response }).context;
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
      setPhase(IDLE);
      setError(data.error);
      return;
    }

    // File the reading as an invoice RECORD — but only if this document isn't
    // already filed as one. That check is the structural guard the design leans
    // on instead of a unique constraint: a document row carries at most one
    // invoice_id, so "Read again" on a filed invoice refreshes the raw reading
    // and can never mint a second record over someone's corrections.
    if (!attachment.invoice_id) {
      const extraction = (data?.extraction ?? null) as InvoiceExtraction | null;
      if (extraction) {
        setPhase({ kind: "filing", label: "Filing it as an invoice…" });
        const result = await createInvoiceFromReading(supabase, {
          orgId,
          attachmentId: attachment.id,
          extraction,
          order: order ?? null,
          fallback: null,
        });
        // The READ still stands if filing fails, exactly as the upload stands
        // if the read fails: the extraction is on the row, and "File as
        // invoice" is right there to try again.
        if ("error" in result) setError(result.error);
      }
    }

    setPhase(IDLE);
    router.refresh();
  }

  // `File[]`, not `FileList`: files reach this by two routes now — the picker,
  // whose input hands back a FileList, and a drop, which hands back a plain
  // array after the drop zone has vetted the types.
  async function upload(files: readonly File[], kind: AttachmentKind) {
    setError(null);
    for (const file of files) {
      setPhase({ kind: "uploading", label: `Uploading ${file.name}…` });
      // An order's own paperwork keeps 018's key; an invoice with no order
      // behind it files under `invoices/{id}`. Both are authorised by the same
      // policies, which read the first segment only.
      const owner = poId ?? (invoiceId ? invoiceOwner(invoiceId) : null);
      if (!owner) {
        setPhase(IDLE);
        setError("Nothing to attach this to.");
        return;
      }
      const path = attachmentPath(orgId, owner, file.name);

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setPhase(IDLE);
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }

      // `.select("id").single()` and not a bare insert: auto-read needs the id
      // of the row it is about to hand to the edge function.
      const { data: row, error: rowError } = await supabase
        .from("purchase_order_attachments")
        .insert({
          org_id: orgId,
          po_id: poId,
          invoice_id: invoiceId ?? null,
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
        await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
        setPhase(IDLE);
        setError(`${file.name}: ${rowError?.message ?? "could not record the file"}`);
        return;
      }

      // Invoices only (Mark, 2026-07-31). Each read is an Opus call, so
      // attaching four pages as four files costs four; and a packing slip has
      // no prices to join on, so reading one buys nothing.
      //
      // The UPLOAD stands if the read fails: the file is filed either way, and
      // "Read invoice" is still there to try again. Losing a successfully
      // stored invoice because a model call timed out would be the worse trade.
      if (kind === "invoice") {
        // `invoice_id` is whatever this upload was filed under: null on a PO's
        // Paperwork card (so the read goes on to create a record), and set when
        // the Invoices section uploaded into an invoice that already exists.
        await read({
          id: row.id as string,
          file_name: file.name,
          invoice_id: invoiceId ?? null,
        });
      }
    }
    setPhase(IDLE);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  /**
   * File an ALREADY-READ document as an invoice record.
   *
   * The manual counterpart to auto-filing, and it earns its place three ways:
   * it clears the readings stored before this module existed, it recovers a
   * read whose auto-file failed, and it handles a document filed as a `photo`
   * that turns out to be the invoice.
   */
  async function fileAsInvoice(
    attachment: Pick<PoAttachment, "id" | "file_name" | "invoice_id" | "extraction">
  ) {
    if (attachment.invoice_id) return;
    if (!attachment.extraction) {
      setError("Read the invoice first — there's nothing to file yet.");
      return;
    }
    setPhase({ kind: "filing", label: "Filing it as an invoice…" });
    setError(null);
    const result = await createInvoiceFromReading(supabase, {
      orgId,
      attachmentId: attachment.id,
      extraction: attachment.extraction,
      order: order ?? null,
      fallback: null,
    });
    setPhase(IDLE);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function remove(
    attachment: Pick<PoAttachment, "id" | "file_name" | "storage_path">
  ) {
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Remove ${attachment.file_name ?? "this attachment"} from this order?\n\nThis cannot be undone.`), confirmLabel: "Remove", tone: "danger" }))
    ) {
      return;
    }
    setPhase({ kind: "removing", label: "Removing…" });
    setError(null);

    const { error: rowError } = await supabase
      .from("purchase_order_attachments")
      .delete()
      .eq("id", attachment.id);
    if (rowError) {
      setPhase(IDLE);
      setError(rowError.message);
      return;
    }
    // Best effort: the row is already gone, so a failure here leaves an orphan
    // object rather than a broken card. Not worth stopping the user over.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);
    setPhase(IDLE);
    router.refresh();
  }

  return {
    phase,
    busy: phase.kind !== "idle",
    error,
    /**
     * Say something went wrong with attaching, without having attached
     * anything — a drop this surface refused before it reached Storage.
     *
     * It goes through the hook so a refused drop reads the same on both
     * surfaces, in the same line as an upload failure. That's the same argument
     * auto-read is here for: it's a fact about the ACT of attaching, and two
     * screens owning two copies is how they drift.
     */
    reportError: (message: string) => setError(message),
    clearError: () => setError(null),
    fileRef,
    upload,
    read,
    fileAsInvoice,
    remove,
  };
}
