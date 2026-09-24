import {
  INVOICE_STATUS_CLASS,
  INVOICE_STATUS_LABEL,
  type InvoiceStatus,
} from "@/lib/customerInvoices";

/**
 * A customer invoice's status as a chip (2026-09-24) — the PO and bill chips'
 * layout, `INVOICE_STATUS_CLASS`'s colours. One part, so the record, the list,
 * the customer and the order cannot drift into four versions of it.
 */
export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${INVOICE_STATUS_CLASS[status]}`}
    >
      {INVOICE_STATUS_LABEL[status]}
    </span>
  );
}
