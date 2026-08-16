"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { FileDropZone } from "@/components/ui/FileDropZone";
import {
  attachmentPath,
  attachmentRejection,
  invoiceOwner,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTR,
  ATTACHMENT_BUCKET,
} from "@/lib/attachments";
import { findPossibleDuplicates, type VendorInvoice } from "@/lib/invoices";
import { money } from "@/lib/purchaseOrders";

/** Exactly what the duplicate check reads, and no more. */
type DuplicateCandidate = Pick<
  VendorInvoice,
  "id" | "vendor_id" | "invoice_number" | "invoice_date" | "total" | "status"
>;

/**
 * File a bill that no purchase order produced.
 *
 * This is the path the whole "all vendor bills" decision rests on: the
 * landlord, the plumber, the utilities and a Restaurant Depot receipt are all
 * already vendors (`order_type: 'none'`), they never generate a purchase order,
 * and until now there was nowhere in the app to record what they charged.
 *
 * It follows NewEmployee exactly — a command right-aligned in the list's filter
 * row, a `ui/Dialog`, an insert, and land on the new record — and asks for the
 * fields the LIST organizes by, leaving the rest to the detail screen's
 * `InlineValue` cells rather than keeping a second editor in step.
 *
 * The vendor is ASKED, not inferred, and it is the only required field: you
 * need it before the read (to build the record and the object path), and you
 * always know who billed you.
 *
 * The file is optional. With one, it uploads and auto-reads and the reading
 * fills the record in; without one, you type a total and you're done — which is
 * the rent bill, and is why the detail screen tolerates an invoice with no
 * lines at all.
 */
export function NewInvoice({
  orgId,
  locationId,
  vendors,
  today,
  /** Every invoice in the window, for the duplicate warning — the same list the
   *  screen already has, so this costs no query. */
  existing,
}: {
  orgId: string;
  locationId: string;
  vendors: { id: string; name: string; inactive?: boolean }[];
  today: string;
  existing: DuplicateCandidate[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [vendorId, setVendorId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<string | null>(today);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const ready = vendorId !== "";

  // Costs no query, same move as the rehire check: warn before the record
  // exists, never block. A credit memo legitimately repeats the number it
  // credits, so this is a question, not a refusal.
  const duplicates = ready
    ? findPossibleDuplicates(
        {
          id: "",
          vendor_id: vendorId,
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate,
          total: total.trim() === "" ? null : Number(total),
        },
        existing
      )
    : [];

  function reset() {
    setVendorId("");
    setInvoiceNumber("");
    setInvoiceDate(today);
    setDueDate(null);
    setTotal("");
    setFile(null);
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("vendor_invoices")
        .insert({
          org_id: orgId,
          location_id: locationId,
          vendor_id: vendorId,
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: invoiceDate,
          due_date: dueDate,
          total: total.trim() === "" ? null : Number(total),
          status: "open",
          source: "manual",
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The invoice could not be created.");
        return;
      }
      const invoiceId = data.id as string;

      // This INVERTS 018's Storage-then-row rule, and it's forced: the object
      // key needs the invoice's id, which only exists once the row does. It is
      // safe here in a way it isn't on a purchase order, because an invoice
      // with no document renders perfectly well — that is exactly the state a
      // hand-typed rent bill lives in — so the intermediate state is legal
      // rather than broken.
      if (file) {
        const path = attachmentPath(orgId, invoiceOwner(invoiceId), file.name);
        const { error: uploadError } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, file, { contentType: file.type || undefined });
        if (uploadError) {
          setFailed(
            `Filed the invoice, but the file didn't upload: ${uploadError.message}`
          );
          router.refresh();
          router.push(`/invoices/${invoiceId}`);
          return;
        }
        const { error: rowError } = await supabase
          .from("purchase_order_attachments")
          .insert({
            org_id: orgId,
            po_id: null,
            invoice_id: invoiceId,
            storage_path: path,
            kind: "invoice",
            file_name: file.name,
            content_type: file.type || null,
            byte_size: file.size,
          });
        if (rowError) {
          await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
          setFailed(`Filed the invoice, but the file wasn't recorded: ${rowError.message}`);
        }
      }

      // The reading happens on the DETAIL screen, from the document pane's
      // Read — not here. A 30-second model call behind a dialog's commit
      // button would make filing a rent bill feel like it had hung.
      router.refresh();
      router.push(`/invoices/${invoiceId}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New invoice
      </button>

      {open && (
        <Dialog
          title="New invoice"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              {/* A panel commit — the endorsed DIALOG_COMMIT_CLASS exception:
                  this dialog exists to produce ONE outcome, so its footer is a
                  two-weight decision rather than a row of peers. */}
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Filing…" : "File invoice"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Vendor" required>
              <PickList
                variant="field"
                value={vendorId}
                onPick={setVendorId}
                ariaLabel="Vendor"
                placeholder="Who billed you?"
                options={vendors.map((v) => ({ value: v.id, label: v.name, inactive: v.inactive }))}
                activateTable="vendors"
              />
            </Field>

            {duplicates.length > 0 && (
              <div className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
                <p className="font-semibold">
                  This vendor already has a bill like that.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {duplicates.map((d) => (
                    <li key={d.invoice.id}>
                      <Link
                        href={`/invoices/${d.invoice.id}`}
                        className="underline decoration-neutral-500 underline-offset-[3px] hover:decoration-neutral-900"
                      >
                        {d.invoice.invoice_number ?? "No number"}
                      </Link>{" "}
                      <span className="text-muted">
                        — {d.reason}
                        {d.invoice.total !== null ? ` · ${money(d.invoice.total)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted">
                  File it anyway if it&rsquo;s a different bill.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Invoice number">
                <TextInput
                  value={invoiceNumber}
                  onValueChange={setInvoiceNumber}
                  aria-label="Invoice number"
                  placeholder="Rent has none"
                  className="w-full"
                />
              </Field>
              <Field label="Total">
                <TextInput
                  value={total}
                  onValueChange={setTotal}
                  aria-label="Total"
                  inputMode="decimal"
                  className="w-full"
                />
              </Field>
              <Field label="Invoice date">
                <DateField
                  value={invoiceDate}
                  onChange={setInvoiceDate}
                  ariaLabel="Invoice date"
                />
              </Field>
              <Field label="Due date">
                <DateField
                  value={dueDate}
                  onChange={setDueDate}
                  ariaLabel="Due date"
                />
              </Field>
            </div>

            <Field label="The bill itself">
              <FileDropZone
                disabled={pending}
                accept={ATTACHMENT_ACCEPT}
                label="Drop the invoice here"
                onFiles={(files) => setFile(files[0] ?? null)}
                onReject={(rejected) => setFailed(attachmentRejection(rejected))}
                className="border border-hairline px-4 py-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex h-9 cursor-pointer items-center border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white">
                    Choose a file
                    <input
                      type="file"
                      className="hidden"
                      accept={ATTACHMENT_ACCEPT_ATTR}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <span className="text-muted">
                    {file ? file.name : "Optional — a rent bill needs no paperwork."}
                  </span>
                </div>
              </FileDropZone>
            </Field>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </div>
  );
}
