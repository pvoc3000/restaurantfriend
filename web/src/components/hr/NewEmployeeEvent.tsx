"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import {
  AD_HOC_EVENT_KINDS,
  EVENT_KIND_LABEL,
  EVENT_KIND_OPTIONS,
  isDisciplinary,
  type EventKind,
} from "@/lib/employeeEvents";
import {
  documentPath,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KIND_OPTIONS,
  EMPLOYEE_DOCS_BUCKET,
  type DocumentKind,
} from "@/lib/employeeDocuments";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTR,
  attachmentRejection,
  fileSize,
} from "@/lib/attachments";

/** A document already in this person's paperwork, offered for linking. */
export type FiledDocument = {
  id: string;
  file_name: string | null;
  kind: DocumentKind;
  created_at: string;
};

/**
 * Everything the event dialog needs from the record it is opened on — the same
 * bundle for New event and for Edit, so the two cannot be handed different
 * vocabularies.
 */
export type EventDialogContext = {
  employeeId: string;
  orgId: string;
  userId: string;
  /** The signed-in person's own employee row, resolved on the server so this
   *  dialog never has to query for it. Null when they have no HR record. */
  authorEmployeeId: string | null;
  /** ACTIVE shops only — this enumerates somewhere an event happened, and a
   *  closed shop is not one (design rule 3). */
  locations: { id: string; code: string }[];
  today: string;
  /** `orgs.settings.hr.event_outcomes` (166). */
  outcomes: string[];
  /** This person's paperwork, for "link a document already on file". */
  documents: FiledDocument[];
};

/** The stored values of an event being edited. */
export type EditableEvent = {
  id: string;
  kind: EventKind;
  occurred_on: string;
  locationId: string | null;
  headline: string | null;
  detail: string | null;
  outcome: string | null;
  documentId: string | null;
};

/**
 * Record something that happened with this person.
 *
 * `AddEmployeeBenefit`'s template rather than `NewEmployee`'s: hiring somebody
 * is more than a row and lands you on their record, while an event is a child
 * row on the record you are already standing on, with nowhere to go. So it STAYS
 * OPEN and clears only the TEXT, keeping the kind, the date and the shop —
 * because the second thing you type is usually another note about the same
 * incident, not the same note about another day.
 *
 * The kinds it offers are `AD_HOC_EVENT_KINDS`, which is not every kind: `shift`
 * belongs to the batch shift log (deferred until the Production module brings
 * sales, tips and production counts to the same screen), and `document_note` is
 * a historical kind for FileMaker's 81 filing-cabinet rows — a new filing goes
 * to the Paperwork block, or is attached here, which files it there too.
 */
export function NewEmployeeEvent({ context }: { context: EventDialogContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New event
      </button>
      {open && <EmployeeEventDialog context={context} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The event form, for a new event or an existing one (Mark, 2026-10-02: "I
 * would also like to be able to edit the event after posting"). ONE form, so
 * the editor can never offer less than the creator did — the table's inline
 * cells cover the date, kind and headline, but not the detail, the shop or the
 * document, and the dialog is where those were written.
 *
 * THE DOCUMENT IS AN ORDINARY PAPERWORK ROW (166). Attaching a file here files
 * it in `employee_documents` — it appears on the Documents tab like anything
 * else — and the event points at it. Or the event can point at something
 * already on file. The write order is `EmployeeDocuments`' upload order
 * (object, then row) followed by the event; if the event fails, the document
 * this dialog just filed is taken back out, so a failed save leaves nothing
 * behind.
 */
export function EmployeeEventDialog({
  context,
  editing,
  onClose,
}: {
  context: EventDialogContext;
  /** Absent for a new event. */
  editing?: EditableEvent;
  onClose: () => void;
}) {
  const { employeeId, orgId, userId, authorEmployeeId, locations, today, outcomes, documents } = context;
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<string>(editing?.kind ?? "note");
  const [occurredOn, setOccurredOn] = useState<string | null>(editing?.occurred_on ?? today);
  const [locationId, setLocationId] = useState(editing?.locationId ?? "");
  const [headline, setHeadline] = useState(editing?.headline ?? "");
  const [detail, setDetail] = useState(editing?.detail ?? "");
  const [outcome, setOutcome] = useState(editing?.outcome ?? "");
  const [linkedId, setLinkedId] = useState(editing?.documentId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [docKind, setDocKind] = useState<DocumentKind>("other");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const ready = kind !== "" && occurredOn !== null && headline.trim() !== "";
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
  // A kind outside AD_HOC_EVENT_KINDS (a shift rating, a FileMaker document
  // note) is shown and kept, never offered as a choice — see EmployeeEvents'
  // Kind cell for why a one-way door is worse than a fixed label.
  const kindChangeable = (AD_HOC_EVENT_KINDS as string[]).includes(kind);

  function close() {
    if (pending) return;
    onClose();
  }

  function pickFile(files: File[] | FileList) {
    const chosen = Array.from(files)[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!chosen) return;
    setFailed(null);
    setFile(chosen);
    // A warning's paper is a write-up; anything else says what it is itself.
    setDocKind(isDisciplinary(kind) ? "write_up" : "other");
  }

  function save() {
    setFailed(null);
    startTransition(async () => {
      // 1. File the document first, if there is one — object, then row.
      let filedId: string | null = null;
      let filedPath: string | null = null;
      if (file) {
        const path = documentPath(orgId, employeeId, file.name);
        const { error: uploadError } = await supabase.storage
          .from(EMPLOYEE_DOCS_BUCKET)
          .upload(path, file, { contentType: file.type || undefined });
        if (uploadError) {
          setFailed(`${file.name}: ${uploadError.message}`);
          return;
        }
        const { data: docRow, error: docError } = await supabase
          .from("employee_documents")
          .insert({
            org_id: orgId,
            employee_id: employeeId,
            storage_path: path,
            kind: docKind,
            file_name: file.name,
            content_type: file.type || null,
            byte_size: file.size,
          })
          .select("id")
          .maybeSingle();
        if (docError || !docRow) {
          await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([path]);
          setFailed(`${file.name}: ${docError?.message ?? "it was not filed."}`);
          return;
        }
        filedId = docRow.id as string;
        filedPath = path;
      }

      const fields = {
        occurred_on: occurredOn,
        kind,
        location_id: orNull(locationId),
        headline: orNull(headline),
        detail: orNull(detail),
        outcome: orNull(outcome),
        document_id: filedId ?? orNull(linkedId),
      };

      // 2. The event. Both paths .select() their row: with no matching policy
      // PostgREST reports success on zero rows.
      const { data, error } = editing
        ? await supabase.from("employee_events").update(fields).eq("id", editing.id).select("id")
        : await supabase
            .from("employee_events")
            .insert({
              ...fields,
              // EXPLICITLY, always. A WITH CHECK runs before the NOT NULL
              // constraint, so omitting this arrives as null and Postgres
              // reports an RLS violation instead of a missing column (rule 1).
              org_id: orgId,
              employee_id: employeeId,
              author_employee_id: authorEmployeeId,
              created_by: userId,
              source: "app",
            })
            .select("id");

      if (error || (data ?? []).length === 0) {
        if (filedId && filedPath) {
          await supabase.from("employee_documents").delete().eq("id", filedId);
          await supabase.storage.from(EMPLOYEE_DOCS_BUCKET).remove([filedPath]);
        }
        setFailed(error?.message ?? "Nothing was saved.");
        return;
      }

      // 3. A new answer joins the org's list. The event is already saved, so a
      // failure here costs only the suggestion next time — not worth an error.
      const typed = outcome.trim();
      if (typed && !outcomes.some((o) => o.toLowerCase() === typed.toLowerCase())) {
        await supabase.rpc("add_event_outcome", { p_org: orgId, p_outcome: typed });
      }

      router.refresh();
      if (editing) {
        onClose();
        return;
      }
      // Keep the kind, the date and the shop; clear what is specific to this one.
      setAdded(`${EVENT_KIND_LABEL[kind as EventKind] ?? kind} recorded.`);
      setHeadline("");
      setDetail("");
      setOutcome("");
      setLinkedId("");
      setFile(null);
    });
  }

  const outcomeOptions = [
    { value: "", label: "—" },
    ...outcomes.map((o) => ({ value: o, label: o })),
  ];

  return (
    <Dialog
      title={editing ? "Edit event" : "New event"}
      onClose={close}
      busy={pending}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            {editing ? "Cancel" : "Done"}
          </button>
          <button type="button" onClick={save} disabled={!ready || pending} className={DIALOG_COMMIT_CLASS}>
            {pending ? "Saving…" : editing ? "Save" : "Add event"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Kind" required>
            {kindChangeable ? (
              <PickList
                variant="field"
                value={kind}
                options={EVENT_KIND_OPTIONS.filter((o) => (AD_HOC_EVENT_KINDS as string[]).includes(o.value))}
                onPick={setKind}
                ariaLabel="Kind of event"
                className="w-56"
              />
            ) : (
              <span className="flex h-9 w-56 items-center text-sm">
                {EVENT_KIND_LABEL[kind as EventKind] ?? kind}
              </span>
            )}
          </Field>
          <Field label="When" required>
            <DateField value={occurredOn} onChange={setOccurredOn} ariaLabel="When it happened" />
          </Field>
          <Field label="Where">
            <PickList
              variant="field"
              value={locationId}
              options={[{ value: "", label: "—" }, ...locations.map((l) => ({ value: l.id, label: l.code }))]}
              onPick={setLocationId}
              ariaLabel="Which shop"
              className="w-32"
            />
          </Field>
        </div>

        <Field label="What happened" required>
          <TextInput value={headline} onValueChange={setHeadline} aria-label="What happened" fullWidth />
        </Field>

        <Field label="More detail">
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={5}
            aria-label="More detail"
            className={`${FORM_TEXTAREA} resize-y`}
          />
        </Field>

        <Field label="Action taken">
          <PickList
            variant="field"
            value={outcome}
            options={outcomeOptions}
            onPick={setOutcome}
            allowNew
            ariaLabel="What was done about it"
            className="w-72"
          />
        </Field>

        {/* A div, not a <label>: this block holds several controls. */}
        <FileDropZone
          disabled={pending}
          accept={ATTACHMENT_ACCEPT}
          label="Drop to attach"
          onFiles={pickFile}
          onReject={(rejected) => setFailed(attachmentRejection(rejected))}
          className="space-y-1"
        >
          <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">Document</span>
          {file ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 truncate text-sm" title={file.name}>
                {file.name}
                <span className="text-muted"> · {fileSize(file.size)}</span>
              </span>
              <PickList
                variant="field"
                value={docKind}
                options={DOCUMENT_KIND_OPTIONS}
                onPick={(v) => setDocKind(v as DocumentKind)}
                ariaLabel="File it as"
                className="w-56"
              />
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-[11px] uppercase tracking-[0.06em] text-accent hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <PickList
                variant="field"
                value={linkedId}
                options={[
                  { value: "", label: "—" },
                  ...documents.map((d) => ({
                    value: d.id,
                    label: d.file_name ?? "Untitled",
                    hint: `${DOCUMENT_KIND_LABEL[d.kind]} · ${d.created_at.slice(0, 10)}`,
                  })),
                ]}
                onPick={setLinkedId}
                ariaLabel="A document already on file"
                className="w-72"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-9 items-center mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-neutral-100"
              >
                Attach file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={ATTACHMENT_ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) pickFile(e.target.files);
                }}
              />
            </div>
          )}
        </FileDropZone>

        {added && !failed && <p className="text-sm text-muted">{added}</p>}
        {failed && <p className="text-sm text-accent">{failed}</p>}
      </div>
    </Dialog>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
