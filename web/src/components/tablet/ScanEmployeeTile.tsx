"use client";

import { useState } from "react";

import { useScanCapture } from "@/components/purchasing/useScanCapture";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { fileSize } from "@/lib/attachments";
import { confirmDialog } from "@/lib/confirm";
import {
  uploadEmployeeDocument,
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KIND_OPTIONS,
  type DocumentKind,
} from "@/lib/employeeDocuments";
import { employeeName } from "@/lib/employees";
import { createClient } from "@/lib/supabase/client";

import { ScanField } from "./ScanField";
import { TILE_CLASS } from "./tileClass";

/**
 * The landing page's "Scan an Employee Document" (Mark, 2026-10-05) — a
 * COMMAND tile like `RequestTile`: the camera opens on the tap, the pages go
 * through Receiving's own scan dialog (`useScanCapture`), and only then is the
 * question asked — whose file, what kind, and when it lapses. That is the
 * employee record's own filing dialog with one field more, and the same write
 * (`uploadEmployeeDocument`).
 *
 * THE ROSTER IS FETCHED ON THE TAP, not by the landing page: it is wanted by
 * one tile in a dozen, and it has arrived long before the first page has been
 * photographed. Former employees are listed, sunk under their own heading —
 * a final write-up is filed after somebody has left.
 *
 * IT STAYS ON THE HOME SCREEN and says what it filed in the tile's own line,
 * because paperwork arrives in stacks: the next tap is the next document.
 */
export function ScanEmployeeTile({ label, orgId }: { label: string; orgId: string }) {
  const supabase = createClient();
  const [people, setPeople] = useState<PickOption[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<DocumentKind>("application");
  const [expires, setExpires] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  const scan = useScanCapture({
    kindLabel: "Employee Document",
    commitVerb: "Use",
    onPdf: (pdf) => {
      setFailed(null);
      setFile(pdf);
    },
  });

  async function loadPeople() {
    const { data, error } = await supabase
      .from("employees")
      .select("id, first_name, last_name, status")
      .order("last_name")
      .order("first_name");
    if (error) {
      setFailed(`Could not load the employees: ${error.message}`);
      setPeople([]);
      return;
    }
    setPeople(
      (data ?? []).map((e) => ({
        value: e.id as string,
        label: employeeName(e as { first_name: string; last_name: string }),
        inactive: e.status === "inactive",
      }))
    );
  }

  function start() {
    setFiled(null);
    // The camera FIRST: `input.click()` is honoured only inside the tap.
    scan.openCamera();
    if (people === null) void loadPeople();
  }

  function reset() {
    setFile(null);
    setEmployeeId("");
    setKind("application");
    setExpires(null);
    setFailed(null);
  }

  /** Closing throws away photographed pages, so it asks — a stray tap outside
   *  the panel should not cost them. */
  async function close() {
    if (busy) return;
    if (await confirmDialog({ title: "Discard this scan?", confirmLabel: "Discard", tone: "danger" })) {
      reset();
    }
  }

  async function commit() {
    if (!file || employeeId === "" || busy) return;
    setBusy(true);
    setFailed(null);
    const problem = await uploadEmployeeDocument(supabase, {
      orgId,
      employeeId,
      file,
      kind,
      expires,
    });
    setBusy(false);
    if (problem) {
      setFailed(problem);
      return;
    }
    const who = people?.find((p) => p.value === employeeId)?.label ?? "";
    setFiled(`Filed ${DOCUMENT_KIND_LABEL[kind]} · ${who}`);
    reset();
  }

  return (
    <>
      <button type="button" onClick={start} className={TILE_CLASS}>
        <span className="font-bold uppercase tracking-[0.04em] text-ink">{label}</span>
        {filed && <span className="text-[14px] text-muted">{filed}</span>}
      </button>

      {scan.element}

      {file && (
        <Dialog
          title="File this document"
          onClose={() => void close()}
          busy={busy}
          width="max-w-md"
          footer={
            <>
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                disabled={busy}
                onClick={() => void close()}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={employeeId === "" || busy}
                onClick={() => void commit()}
              >
                {busy ? "Filing…" : "File"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="truncate text-sm" title={file.name}>
              {file.name}
              <span className="text-muted"> · {fileSize(file.size)}</span>
            </p>

            <ScanField label="Employee" required>
              <PickList
                variant="field"
                boxed
                className="w-full"
                value={employeeId}
                onPick={setEmployeeId}
                options={people ?? []}
                disabled={people === null}
                placeholder={people === null ? "Loading…" : ""}
                inactiveLabel="Former"
                ariaLabel="Employee"
              />
            </ScanField>

            <ScanField label="Kind">
              <PickList
                variant="field"
                boxed
                className="w-full"
                value={kind}
                onPick={(next) => setKind(next as DocumentKind)}
                options={DOCUMENT_KIND_OPTIONS}
                ariaLabel="Kind of document"
              />
            </ScanField>

            {/* Empty means "does not lapse" (034), which is most paperwork. */}
            <ScanField label="Expires">
              <DateField
                value={expires}
                onChange={setExpires}
                variant="field"
                boxed
                ariaLabel="The date this document expires"
              />
            </ScanField>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
