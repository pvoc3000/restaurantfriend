"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  documentPath,
  expiryState,
  paperworkStatus,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KIND_OPTIONS,
  EMPLOYEE_DOCS_BUCKET,
  type DocumentKind,
  type SignedEmployeeDocument,
} from "@/lib/employeeDocuments";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTR,
  attachmentRejection,
  fileSize,
} from "@/lib/attachments";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { DocumentChip } from "@/components/ui/DocumentChip";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { RevealPanel } from "@/components/ui/RevealPanel";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * One document's expiry, on the chip.
 *
 * A label line over the control, because a 176px chip has room for one or the
 * other and not both — and the label is where the meaning of an EMPTY box
 * lives. Null is the default and means "this does not lapse", which is right
 * for a W-4 and a handbook receipt; a blank box with no label reads instead as
 * something nobody has got round to filling in.
 *
 * The state mark is the app's usual pair: red for wrong (this has lapsed),
 * yellow for worth your eye (it is about to). Never green — a card that is
 * simply in date needs no colour.
 */
function ExpiryLine({
  document: d,
  today,
  canEdit,
  busy,
}: {
  document: SignedEmployeeDocument;
  today: string;
  canEdit: boolean;
  busy: boolean;
}) {
  const state = expiryState(d.expires_on, today);

  return (
    /* ONE wrapping row, and the wrap is what does the layout. With no date the
       control collapses to its glyph, so "NEVER EXPIRES 📅" sits on one line;
       with a date the label and the date can't share 160px, so it breaks in two
       by itself. Two hand-placed lines would have left the empty case with a
       calendar floating in the middle of the chip. */
    <div className="flex flex-wrap items-center gap-x-1 pt-0.5">
      <span className="text-[11px] uppercase tracking-[0.12em]">
        {d.expires_on === null ? (
          <span className="text-subtle">Never expires</span>
        ) : (
          <>
            <span className="text-subtle">Expires</span>
            {state === "expired" && <span className="text-accent"> · expired</span>}
            {state === "soon" && (
              <>
                {" · "}
                <span className="bg-mark-fill px-1">soon</span>
              </>
            )}
          </>
        )}
      </span>
      {canEdit ? (
        /* -ml-1 cancels the resting cell's own px-1, so a wrapped date starts on
           the same left edge as the label above it. */
        <span className={`-ml-1 text-xs ${busy ? "pointer-events-none opacity-35" : ""}`}>
          <InlineValue
            table="employee_documents"
            id={d.id}
            column="expires_on"
            value={d.expires_on}
            kind="date"
          />
        </span>
      ) : (
        <span className={`text-xs tabular-nums text-muted ${READ_ONLY_VALUE}`}>
          {d.expires_on}
        </span>
      )}
    </div>
  );
}

/**
 * The personnel file.
 *
 * FMP tracked onboarding as eight checkboxes with the documents themselves
 * nowhere in the system (Mark, 2026-08-01: paperwork should be "flags that are
 * set when those documents are uploaded"). So the completeness line at the top
 * is DERIVED from what's filed — there is nothing to keep in sync, and
 * "complete" cannot be true without the file.
 *
 * The two write orders are opposite on purpose, and both are load-bearing —
 * the same rule `useAttachmentActions` follows for a PO's paperwork:
 *
 * - **Upload writes Storage FIRST, then the row.** A row written first, with a
 *   failed upload after it, leaves a card pointing at nothing.
 * - **Delete removes the ROW first, then the object.** A failed object delete
 *   leaves an orphan nobody can see, which is harmless; a failed row delete
 *   leaves a card pointing at a file that is already gone.
 *
 * Not shared with `useAttachmentActions` despite the shape: that hook exists to
 * keep AUTO-READ identical across two surfaces, and its whole invoice-reading
 * half is meaningless here. What's common is thirty lines of Supabase calls;
 * what would be coupled is two modules' write behaviour.
 *
 * No `capture` on the input, and formats named rather than `image/*` — the same
 * two reasons as the PO card: `capture` forces the camera and takes away the
 * choice, and iOS transcodes HEIC to JPEG when the accept list names formats.
 */
export function EmployeeDocuments({
  employeeId,
  orgId,
  documents,
  legacyFoodHandlerExpires,
  today,
  canEdit,
  variant = "panel",
}: {
  employeeId: string;
  orgId: string;
  /**
   * `panel` is the pinned footer that opens on hover — right when this shares a
   * screen with the whole record. `page` is the same card with its body open in
   * flow, for the Documents tab, where the crowding it was hiding from is gone.
   */
  variant?: "panel" | "page";
  /** Signed by the server at render — see EmployeeDetail. */
  documents: SignedEmployeeDocument[];
  /**
   * `employees.food_handler_expires` — the column migration 034 is retiring.
   * It counts toward the lapse line only while no food handler card is on
   * file; the moment one is, the card's own date is the record.
   */
  legacyFoodHandlerExpires: string | null;
  /** The org's today (orgs.settings.timezone), from the server. */
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * The files chosen but not yet filed, and what the dialog says about them.
   *
   * FILING IS A DIALOG NOW (Mark, 2026-09-01: "the app should popup a
   * confirmation dialogue box that allows you to set the document type and the
   * expiration date if appropriate"). Before this the kind was set by a picker
   * in the header BEFORE choosing a file — so the commonest way to file a
   * document wrongly was to attach one having forgotten to change it, and the
   * mistake was invisible until you read the chip afterwards. Asked at the
   * moment of filing, with the file's own name on screen, there is nothing to
   * remember.
   *
   * THE HEADER PICKER IS GONE WITH IT. Two places to answer one question is how
   * they drift, and the drop zone's "Drop to file as a W-4" label was a promise
   * made by whichever of them you had not looked at.
   *
   * ONE KIND AND ONE DATE FOR THE WHOLE BATCH. The input is `multiple` and a
   * drag can carry several, but dropping two documents of different kinds at
   * once is not a thing anybody does — and the alternative, a row per file, is
   * a form where a sentence will do. The dialog names the count.
   */
  const [pending, setPending] = useState<{
    files: File[];
    kind: DocumentKind;
    expires: string | null;
  } | null>(null);

  const status = paperworkStatus(documents, legacyFoodHandlerExpires, today);

  /**
   * Files chosen — ASK before filing anything.
   *
   * Nothing is uploaded here. `application` is the resting kind because it is
   * the first thing filed for a new hire, and it is offered rather than
   * assumed; the expiry starts empty, which means "does not lapse" (034).
   */
  function choose(files: FileList | File[]) {
    const chosen = Array.from(files);
    if (chosen.length === 0) return;
    setError(null);
    setPending({ files: chosen, kind: "application", expires: null });
    // Cleared NOW rather than after the upload: the input keeps its value after
    // a pick, so choosing the same file again after cancelling would fire no
    // change event at all and the dialog would never reopen.
    if (fileRef.current) fileRef.current.value = "";
  }

  async function upload(files: File[], kind: DocumentKind, expires: string | null) {
    setError(null);
    for (const file of files) {
      setBusyLabel(`Uploading ${file.name}…`);
      const path = documentPath(orgId, employeeId, file.name);

      const { error: uploadError } = await supabase.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        setBusyLabel(null);
        setError(`${file.name}: ${uploadError.message}`);
        return;
      }

      const { error: rowError } = await supabase.from("employee_documents").insert({
        org_id: orgId,
        employee_id: employeeId,
        storage_path: path,
        kind,
        // NULL, never "", and that is 034's rule rather than tidiness: null
        // means "this does not lapse", which is the honest reading for a W-4 or
        // a handbook receipt, and an empty string is not a date.
        expires_on: expires,
        file_name: file.name,
        content_type: file.type || null,
        byte_size: file.size,
      });
      if (rowError) {
        // The object is up but unrecorded. Take it back out rather than leaving
        // a file nothing points at.
        await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([path]);
        setBusyLabel(null);
        setError(`${file.name}: ${rowError.message}`);
        return;
      }
    }
    setBusyLabel(null);
    router.refresh();
  }

  async function remove(doc: SignedEmployeeDocument) {
    if (
      !(await confirmDialog({ ...splitConfirmMessage(`Remove ${doc.file_name ?? "this document"} from this employee's file?\n\nThis cannot be undone.`), confirmLabel: "Remove", tone: "danger" }))
    ) {
      return;
    }
    setBusyLabel("Removing…");
    setError(null);

    const { error: rowError } = await supabase
      .from("employee_documents")
      .delete()
      .eq("id", doc.id);
    if (rowError) {
      setBusyLabel(null);
      setError(rowError.message);
      return;
    }
    // Best effort: the row is already gone, so a failure here leaves an orphan
    // object rather than a broken card.
    await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([doc.storage_path]);
    setBusyLabel(null);
    router.refresh();
  }

  return (
    <>
      {/* The panel WRAPS the card — see PoAttachments for why — and opens UP,
          because this card is pinned to the foot of the window too (Mark,
          2026-08-06). The drop zone is the card, so it is the target open or
          closed. */}
      <RevealPanel
      direction="up"
      label="the filed documents"
      alwaysOpen={variant === "page"}
      header={(toggle) => (
        <FileDropZone
          disabled={!canEdit || busyLabel !== null}
          accept={ATTACHMENT_ACCEPT}
          // No kind in the label any more: the dialog asks, so promising one
          // here would be a promise made before the question.
          label="Drop to file"
          onFiles={choose}
          // The zone knows a type didn't match; only this screen knows what to
          // suggest instead, and `accept` governs the PICKER only — a drag never
          // consults it, which is why the HEIC guard has to be re-stated here.
          onReject={(rejected) => setError(attachmentRejection(rejected))}
          className="space-y-3 border border-ink bg-white px-4 py-3"
        >
      <div className="flex flex-wrap items-center gap-4">
        {documents.length > 0 && toggle}
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-subtle">
          Paperwork
        </h2>
        <span className="text-sm text-muted">
          {documents.length === 0
            ? "Nothing on file"
            : `${documents.length} ${documents.length === 1 ? "document" : "documents"}`}
        </span>

        {canEdit && (
          <span className="ml-auto flex items-center gap-3">
            {/* No "Add as" picker beside it any more — the dialog that opens
                when a file is chosen is where the kind is set. */}
            <button
              type="button"
              disabled={busyLabel !== null}
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
                if (e.target.files?.length) choose(e.target.files);
              }}
            />
          </span>
        )}
      </div>

      {/* The derived completeness line — what FMP's eight checkboxes were for,
          except this one cannot be true without the documents.

          MISSING AND EXPIRED ARE SAID SEPARATELY. A lapsed food handler card is
          not a missing one: it's on file, you can look at it, and what it needs
          is a renewal rather than a first upload. Rolling them into one count
          would tell you the wrong thing to do about it. */}
      <div className="space-y-0.5 text-sm">
        {status.complete ? (
          <p className="text-[var(--rf-green-600)]">
            Onboarding paperwork complete.
          </p>
        ) : (
          status.missing.length > 0 && (
            <p>
              <span className="text-subtle">Missing: </span>
              <span className="text-ink">
                {status.missing.map((k) => DOCUMENT_KIND_LABEL[k]).join(", ")}
              </span>
            </p>
          )
        )}
        {status.expired.length > 0 && (
          <p>
            <span className="text-subtle">Expired: </span>
            <span className="text-accent">
              {status.expired
                .map((e) => `${DOCUMENT_KIND_LABEL[e.kind]} (${e.on})`)
                .join(", ")}
            </span>
          </p>
        )}
        {status.expiring.length > 0 && (
          <p>
            <span className="text-subtle">Expiring soon: </span>
            <span className="bg-mark-fill px-1">
              {status.expiring
                .map((e) => `${DOCUMENT_KIND_LABEL[e.kind]} (${e.on})`)
                .join(", ")}
            </span>
          </p>
        )}
      </div>

      {/* Progress and errors stay in the HEADER, not the body: a failed upload
          you can only see by hovering is one nobody sees. */}
      {busyLabel && <ProgressBand label={busyLabel} />}
      {error && <p className="text-sm text-accent">{error}</p>}
        </FileDropZone>
      )}
    >
      {documents.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {documents.map((d) => (
            <DocumentChip
              key={d.id}
              url={d.url}
              fileName={d.file_name}
              contentType={d.content_type}
            >
              <>
                <p className="truncate text-xs text-ink" title={d.file_name ?? ""}>
                  {d.file_name ?? "Untitled"}
                </p>
                <p className="truncate text-[11px] uppercase tracking-[0.12em] text-subtle">
                  {DOCUMENT_KIND_LABEL[d.kind]}
                  {d.byte_size !== null && ` · ${fileSize(d.byte_size)}`}
                </p>

                {/* The lapse date, on the chip and editable there (Mark,
                    2026-08-05). Two lines rather than one: a 176px chip cannot
                    hold a label and a date box side by side, and the box is the
                    house `DateField` (through InlineValue) because a bare
                    `<input type="date">` is the one control this app never
                    writes — Safari paints today's date into an empty one.

                    The LABEL carries the meaning of an empty box. A blank date
                    means "never expires", which is true and silent; saying it
                    is what stops the blank reading as "nobody has filled this
                    in yet". */}
                {(canEdit || d.expires_on) && (
                  <ExpiryLine
                    document={d}
                    today={today}
                    canEdit={canEdit}
                    busy={busyLabel !== null}
                  />
                )}

                {canEdit && (
                  <button
                    type="button"
                    disabled={busyLabel !== null}
                    onClick={() => void remove(d)}
                    className="text-[11px] uppercase tracking-[0.06em] text-accent hover:underline disabled:opacity-35"
                  >
                    Remove
                  </button>
                )}
              </>
            </DocumentChip>
          ))}
        </ul>
      )}
      </RevealPanel>

      {/* FILING A DOCUMENT ASKS WHAT IT IS (Mark, 2026-09-01).
          
          Enter commits, which `ui/Dialog`'s `onSubmit` is opt-in about for good
          reason — this qualifies: one commit, nothing destructive, and the only
          two fields are a picker and a date, neither of which owns the key.

          THE EXPIRY IS ALWAYS OFFERED, never gated on the kind. 034's rule and
          its own words: "which documents expire is a fact about the piece of
          paper in your hand, not about the vocabulary" — a food handler card
          issued with no printed expiry says so by staying null, and the next
          kind that turns out to lapse needs no change here. The caption is what
          carries the meaning of leaving it empty. */}
      {pending ? (
        <Dialog
          title={
            pending.files.length === 1
              ? "File this document"
              : `File ${pending.files.length} documents`
          }
          onClose={() => setPending(null)}
          busy={busyLabel !== null}
          width="max-w-md"
          onSubmit={() => {
            const p = pending;
            setPending(null);
            void upload(p.files, p.kind, p.expires);
          }}
          footer={
            <>
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={() => {
                  const p = pending;
                  setPending(null);
                  void upload(p.files, p.kind, p.expires);
                }}
              >
                File{pending.files.length > 1 ? ` ${pending.files.length}` : ""}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            {/* WHAT YOU PICKED, NAMED. The whole reason the question moved here
                is that it can be answered with the file in front of you. */}
            <ul className="space-y-0.5 text-sm">
              {pending.files.map((f) => (
                <li key={f.name} className="truncate" title={f.name}>
                  {f.name}
                  <span className="text-muted"> · {fileSize(f.size)}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">
                Kind
              </span>
              <PickList
                value={pending.kind}
                options={DOCUMENT_KIND_OPTIONS}
                onPick={(next) =>
                  setPending((p) => (p ? { ...p, kind: next as DocumentKind } : p))
                }
                variant="field"
                boxed
                className="w-full"
                ariaLabel="Kind of document"
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-[0.08em]">
                Expires
              </span>
              <DateField
                value={pending.expires}
                onChange={(next) => setPending((p) => (p ? { ...p, expires: next } : p))}
                variant="field"
                boxed
                ariaLabel="The date this document expires"
              />
              <span className="block text-xs text-muted italic">
                Leave it empty if it doesn&rsquo;t expire — most paperwork
                doesn&rsquo;t.
              </span>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
