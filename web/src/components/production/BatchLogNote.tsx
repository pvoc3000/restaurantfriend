"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { createClient } from "@/lib/supabase/client";

/**
 * THE BATCH LOG'S NOTE ON THE TABLET (Mark, 2026-11-14) — the log's, not a
 * batch's. The desk edits it in a boxed field beside Group by; the tablet's
 * filter row has no width for that, so it gets a button there instead — Add
 * note, or Edit note once there is one — which opens a box to write in. A note
 * that exists is SHOWN on its own line under the filter row, so nobody has to
 * open anything to find out there is one.
 *
 * Rendered straight into the filter row's `flex-wrap` (`filterTail`): the
 * button is one item, and the note claims the next line with `basis-full`.
 *
 * What it shows is the typed note the moment Save is pressed, not after the
 * refresh lands (`lib/latestWrite`'s rule: a tap never waits on the server);
 * the local copy is dropped once the server's agrees.
 */
export function BatchLogNote({
  logId,
  note: serverNote,
  editable,
}: {
  logId: string;
  note: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<string | null | undefined>(undefined);
  const [seen, setSeen] = useState(serverNote);
  if (seen !== serverNote) {
    setSeen(serverNote);
    if (mine === serverNote) setMine(undefined);
  }
  const note = mine === undefined ? serverNote : mine;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function start() {
    setDraft(note ?? "");
    setFailed(null);
    setOpen(true);
  }

  function save() {
    const next = draft.trim() === "" ? null : draft.trim();
    const before = note;
    setFailed(null);
    setMine(next);
    setOpen(false);
    startTransition(async () => {
      const { data, error } = await createClient()
        .from("production_batch_logs")
        .update({ note: next })
        .eq("id", logId)
        .select("id");
      if (error || !data || data.length === 0) {
        // Put the old note back and reopen the box with what was typed in it.
        setMine(before);
        setFailed(error?.message ?? "Nothing changed — you may not have permission.");
        setOpen(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {editable ? (
        <button type="button" className={SMALL_BUTTON_CLASS} onClick={start}>
          {note ? "Edit note" : "Add note"}
        </button>
      ) : null}

      {note ? (
        <p className="basis-full whitespace-pre-wrap text-sm">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Note
          </span>
          {note}
        </p>
      ) : null}

      {open ? (
        <Dialog
          title="Note on this batch log"
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} onClick={save} disabled={busy}>
                Save
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              aria-label="Note on this batch log"
              className={FORM_TEXTAREA}
            />
            {failed ? <p className="text-sm text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
