"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  attachmentPath,
  ATTACHMENT_BUCKET,
  type AttachmentKind,
  type PoAttachment,
} from "@/lib/attachments";

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
  | { kind: "uploading" | "reading" | "removing"; label: string };

const IDLE: AttachPhase = { kind: "idle" };

export function useAttachmentActions({ poId, orgId }: { poId: string; orgId: string }) {
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
  async function read(attachment: Pick<PoAttachment, "id" | "file_name">) {
    setPhase({ kind: "reading", label: `Reading ${attachment.file_name ?? "the invoice"}…` });
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("extract-invoice", {
      body: { attachment_id: attachment.id },
    });
    setPhase(IDLE);

    if (fnError) {
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
      setError(data.error);
      return;
    }
    router.refresh();
  }

  // `File[]`, not `FileList`: files reach this by two routes now — the picker,
  // whose input hands back a FileList, and a drop, which hands back a plain
  // array after the drop zone has vetted the types.
  async function upload(files: readonly File[], kind: AttachmentKind) {
    setError(null);
    for (const file of files) {
      setPhase({ kind: "uploading", label: `Uploading ${file.name}…` });
      const path = attachmentPath(orgId, poId, file.name);

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
        await read({ id: row.id as string, file_name: file.name });
      }
    }
    setPhase(IDLE);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function remove(
    attachment: Pick<PoAttachment, "id" | "file_name" | "storage_path">
  ) {
    if (
      !window.confirm(
        `Remove ${attachment.file_name ?? "this attachment"} from this order?\n\nThis cannot be undone.`
      )
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
    remove,
  };
}
