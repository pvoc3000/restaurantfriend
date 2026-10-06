"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useScanCapture } from "@/components/purchasing/useScanCapture";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { TabPicker } from "@/components/ui/TabPicker";
import {
  fileSize,
  uploadAttachment,
  ATTACHMENT_KIND_OPTIONS,
  type AttachmentKind,
} from "@/lib/attachments";
import { confirmDialog } from "@/lib/confirm";
import { money } from "@/lib/purchaseOrders";
import { createClient } from "@/lib/supabase/client";

import { ScanField } from "./ScanField";
import { TILE_CLASS } from "./tileClass";

/** How far back "an existing bill" looks. A scan is attached to a bill filed
 *  this week, not last year; the bill's own screen is there for the rest. */
const RECENT_BILLS = 200;

type Target = "new" | "existing";

/**
 * The landing page's "Scan a Bill" (Mark, 2026-10-05) — a COMMAND tile like
 * `RequestTile`. The camera opens on the tap, the pages go through Receiving's
 * own scan dialog (`useScanCapture`), and then one panel asks where the PDF
 * goes: a NEW bill (which vendor, bill or credit memo) or one ALREADY ON FILE
 * at this shop, and what the document is.
 *
 * A NEW BILL IS `NewBill`'S WRITE, with the fields a scan can answer for
 * itself left off: the row first (the object key needs its id), then the
 * document through `uploadAttachment`. The number, the total and the dates
 * are on the paper, and the bill's own screen — where this lands — is where
 * Read fills them in. It is dated today so the list's date range shows it.
 *
 * NOTHING IS READ HERE, for `NewBill`'s reason: a 30-second model call behind
 * a commit button reads as a hang.
 *
 * A BILL CREATED AND A DOCUMENT THAT THEN FAILED TO UPLOAD IS REMEMBERED
 * (`createdId`), so pressing File again attaches to that bill instead of
 * filing a second one.
 */
export function ScanBillTile({
  label,
  orgId,
  locationId,
  locationCode,
  today,
}: {
  label: string;
  orgId: string;
  locationId: string;
  locationCode: string;
  /** The org's today, from the server (lib/today). */
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [vendors, setVendors] = useState<PickOption[] | null>(null);
  const [bills, setBills] = useState<PickOption[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<Target>("new");
  const [vendorId, setVendorId] = useState("");
  const [isCredit, setIsCredit] = useState(false);
  const [billId, setBillId] = useState("");
  const [kind, setKind] = useState<AttachmentKind>("invoice");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const scan = useScanCapture({
    kindLabel: "Bill",
    commitVerb: "Use",
    onPdf: (pdf) => {
      setFailed(null);
      setFile(pdf);
    },
  });

  async function loadChoices() {
    const [v, b] = await Promise.all([
      supabase.from("vendors").select("id, name, is_active").eq("org_id", orgId).order("name"),
      supabase
        .from("vendor_bills")
        .select("id, invoice_number, invoice_date, total, is_credit, vendors ( name )")
        .eq("location_id", locationId)
        .order("invoice_date", { ascending: false })
        .limit(RECENT_BILLS),
    ]);
    if (v.error || b.error) {
      setFailed(`Could not load the bills: ${(v.error ?? b.error)?.message}`);
    }
    setVendors(
      (v.data ?? []).map((row) => ({
        value: row.id as string,
        label: row.name as string,
        inactive: !row.is_active,
      }))
    );
    type BillRow = {
      id: string;
      invoice_number: string | null;
      invoice_date: string | null;
      total: number | null;
      is_credit: boolean;
      vendors: { name: string } | null;
    };
    setBills(
      ((b.data ?? []) as unknown as BillRow[]).map((row) => ({
        value: row.id,
        label: `${row.vendors?.name ?? "No vendor"} · ${row.invoice_number ?? "No number"}`,
        hint: [
          row.invoice_date,
          row.total !== null ? money(row.total) : null,
          row.is_credit ? "credit" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }))
    );
  }

  function start() {
    // The camera FIRST: `input.click()` is honoured only inside the tap.
    scan.openCamera();
    if (vendors === null) void loadChoices();
  }

  function reset() {
    setFile(null);
    setTarget("new");
    setVendorId("");
    setIsCredit(false);
    setBillId("");
    setKind("invoice");
    setCreatedId(null);
    setFailed(null);
  }

  /** Closing throws away photographed pages, so it asks. */
  async function close() {
    if (busy) return;
    if (await confirmDialog({ title: "Discard this scan?", confirmLabel: "Discard", tone: "danger" })) {
      reset();
    }
  }

  const ready = createdId !== null || (target === "new" ? vendorId !== "" : billId !== "");

  async function commit() {
    if (!file || !ready || busy) return;
    setBusy(true);
    setFailed(null);

    let id = createdId ?? (target === "existing" ? billId : null);
    if (id === null) {
      const { data, error } = await supabase
        .from("vendor_bills")
        .insert({
          org_id: orgId,
          location_id: locationId,
          vendor_id: vendorId,
          invoice_date: today,
          is_credit: isCredit,
          status: "open",
          source: "manual",
        })
        .select("id")
        .single();
      if (error || !data) {
        setBusy(false);
        setFailed(error?.message ?? "The bill could not be created.");
        return;
      }
      id = data.id as string;
      setCreatedId(id);
    }

    const result = await uploadAttachment(supabase, {
      orgId,
      poId: null,
      billId: id,
      file,
      kind,
    });
    if ("error" in result) {
      setBusy(false);
      setFailed(
        target === "new"
          ? `Filed the bill, but the scan didn't attach — ${result.error}. Press File to try again.`
          : result.error
      );
      return;
    }

    // Stays busy through the navigation, so the panel cannot be pressed twice.
    router.push(`/bills/${id}`);
  }

  return (
    <>
      <button type="button" onClick={start} className={TILE_CLASS}>
        <span className="font-bold uppercase tracking-[0.04em] text-ink">{label}</span>
      </button>

      {scan.element}

      {file && (
        <Dialog
          title={`File this scan · ${locationCode}`}
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
                disabled={!ready || busy}
                onClick={() => void commit()}
              >
                {busy ? "Filing…" : target === "new" ? "File Bill" : "Attach"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <p className="truncate text-sm" title={file.name}>
              {file.name}
              <span className="text-muted"> · {fileSize(file.size)}</span>
            </p>

            <ScanField label="File under">
              <TabPicker
                ariaLabel="File under"
                value={target}
                onChange={(next) => setTarget(next as Target)}
                options={[
                  { key: "new", label: "New bill" },
                  { key: "existing", label: "Existing bill" },
                ]}
              />
            </ScanField>

            {target === "new" ? (
              <>
                <ScanField label="Vendor" required>
                  <PickList
                    variant="field"
                    boxed
                    className="w-full"
                    value={vendorId}
                    onPick={setVendorId}
                    options={vendors ?? []}
                    disabled={vendors === null || createdId !== null}
                    placeholder={vendors === null ? "Loading…" : ""}
                    activateTable="vendors"
                    ariaLabel="Vendor"
                  />
                </ScanField>
                <ScanField label="Kind">
                  <TabPicker
                    ariaLabel="Kind"
                    value={isCredit ? "credit" : "bill"}
                    onChange={(k) => setIsCredit(k === "credit")}
                    options={[
                      { key: "bill", label: "Bill" },
                      { key: "credit", label: "Credit memo" },
                    ]}
                  />
                </ScanField>
              </>
            ) : (
              <ScanField label="Bill" required>
                <PickList
                  variant="field"
                  boxed
                  className="w-full"
                  value={billId}
                  onPick={setBillId}
                  options={bills ?? []}
                  disabled={bills === null}
                  placeholder={bills === null ? "Loading…" : ""}
                  ariaLabel="Bill"
                />
              </ScanField>
            )}

            <ScanField label="Document type">
              <PickList
                variant="field"
                boxed
                className="w-full"
                value={kind}
                onPick={(next) => setKind(next as AttachmentKind)}
                options={ATTACHMENT_KIND_OPTIONS}
                ariaLabel="Document type"
              />
            </ScanField>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
