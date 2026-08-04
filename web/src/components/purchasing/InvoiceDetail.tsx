"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { withFrom } from "@/lib/breadcrumbs";
import { money } from "@/lib/purchaseOrders";
import {
  agingBucket,
  amountReconciliation,
  approvalReadiness,
  findPossibleDuplicates,
  lineSumReconciliation,
  signedTotal,
  AGING_LABEL,
  INVOICE_STATUS_CLASS,
  INVOICE_STATUS_LABEL,
  type LinkedOrder,
  type VendorInvoice,
  type VendorInvoiceLine,
} from "@/lib/invoices";
import { matchesFromLinks } from "@/lib/invoiceMatch";
import type { LinkedPurchaseOrder } from "@/lib/invoiceQueries";
import type { SignedAttachment } from "@/lib/attachments";
import { DocumentPane } from "./DocumentPane";
import { useAttachmentActions } from "./useAttachmentActions";
import { InvoiceFooter } from "./InvoiceFooter";
import { attachmentRejection, type AttachmentKind } from "@/lib/attachments";

type InvoiceRecord = VendorInvoice & {
  vendors: { id: string; name: string; order_type: string } | null;
};

const INVOICE_LINE_WIDTHS_KEY = "rf.invoiceLines.columnWidths.v1";

/**
 * One invoice: what we were billed, what it belongs to, and whether it should
 * be paid.
 *
 * LAYOUT — a two-column grid, document left, that is deliberately NOT draggable
 * and NOT viewport-measured. The receiving screen earned its ResizeObserver,
 * `spaceBelow` measurement and drag divider by being a single-viewport STANDING
 * task whose lines pane scrolls inside itself; this is a desk screen that
 * scrolls the page like every other detail screen, so a sticky ceiling that is
 * twenty pixels off just leaves a little air rather than running columns off
 * the bottom of the window. Don't "fix" this by lifting that machinery in.
 */
export function InvoiceDetail({
  invoice,
  lines,
  linkedOrders,
  linkError,
  attachments,
  documentError,
  duplicateCandidates,
  locationCode,
  orgId,
  vendors,
  locations,
  canEdit,
  canApprove,
  selfHref,
  closeHref,
}: {
  invoice: InvoiceRecord;
  lines: VendorInvoiceLine[];
  linkedOrders: LinkedPurchaseOrder[];
  linkError: string | null;
  attachments: SignedAttachment[];
  documentError: string | null;
  duplicateCandidates: VendorInvoice[];
  locationCode: string;
  orgId: string;
  vendors: { id: string; name: string }[];
  locations: { id: string; code: string; name: string }[];
  canEdit: boolean;
  canApprove: boolean;
  selfHref: string;
  closeHref: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [shownId, setShownId] = useState<string | null>(null);
  const [kind, setKind] = useState<AttachmentKind>("invoice");

  const {
    phase,
    busy,
    error: attachError,
    fileRef,
    upload,
    read,
    remove,
    reportError,
  } = useAttachmentActions({ poId: null, orgId, invoiceId: invoice.id });

  const shown =
    attachments.find((a) => a.id === shownId) ?? attachments[0] ?? null;

  // The three-way match, per linked order. `matchesFromLinks` prefers the
  // stored pairing over a fresh one, so a manual match made at the delivery is
  // what approval is judged against.
  const matched: LinkedOrder[] = useMemo(
    () =>
      linkedOrders.map((order) => ({
        poNumber: order.po_number,
        matches: matchesFromLinks(
          order.lines,
          lines
            .filter((l) => l.purchase_order_id === order.id)
            .map((l) => ({
              product_id: l.product_id,
              alt_product_id: l.alt_product_id,
              description: l.description ?? "",
              qty: l.qty === null ? null : Number(l.qty),
              unit_price: l.unit_price === null ? null : Number(l.unit_price),
              extended: l.extended === null ? null : Number(l.extended),
              pack: l.pack,
              purchase_order_item_id: l.purchase_order_item_id,
            }))
        ).matches,
      })),
    [linkedOrders, lines]
  );

  const duplicates = useMemo(
    () => findPossibleDuplicates(invoice, duplicateCandidates),
    [invoice, duplicateCandidates]
  );

  const amounts = useMemo(() => amountReconciliation(invoice), [invoice]);
  const lineSums = useMemo(
    () => lineSumReconciliation(lines, invoice.subtotal),
    [lines, invoice.subtotal]
  );

  // What the reader took off the page, when it disagrees with the vendor on the
  // record — a cheap check that catches a wrong-vendor pick on a hand-created
  // invoice, and a mis-filed auto-created one.
  const readVendorName = shown?.extraction?.vendor_name ?? null;
  const vendorDisagreement =
    readVendorName &&
    invoice.vendors &&
    !normalizedEqual(readVendorName, invoice.vendors.name)
      ? readVendorName
      : null;

  const caveats = useMemo(
    () =>
      approvalReadiness(
        invoice,
        lines,
        matched,
        attachments.length,
        duplicates,
        vendorDisagreement
      ),
    [invoice, lines, matched, attachments.length, duplicates, vendorDisagreement]
  );

  const columns: DataColumn<VendorInvoiceLine>[] = [
    {
      key: "product_id",
      label: "Product ID",
      width: 150,
      sortValue: (l) => l.product_id,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="product_id"
            value={l.product_id}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>{l.product_id ?? "—"}</span>
        ),
    },
    {
      key: "description",
      label: "Description",
      width: 320,
      pinned: true,
      wrap: true,
      sortValue: (l) => l.description,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="description"
            value={l.description}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{l.description ?? "—"}</span>
        ),
    },
    {
      key: "pack",
      label: "Pack",
      width: 110,
      sortValue: (l) => l.pack,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="pack"
            value={l.pack}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-muted`}>{l.pack ?? "—"}</span>
        ),
    },
    {
      key: "qty",
      label: "Qty",
      width: 100,
      align: "right",
      sortValue: (l) => l.qty,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="qty"
            value={l.qty}
            kind="number"
            align="right"
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>{l.qty ?? "—"}</span>
        ),
    },
    {
      key: "unit_price",
      label: "Unit price",
      width: 120,
      align: "right",
      sortValue: (l) => l.unit_price,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="unit_price"
            value={l.unit_price}
            kind="number"
            align="right"
            format={(v) => money(Number(v))}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {money(l.unit_price)}
          </span>
        ),
    },
    {
      key: "extended",
      label: "Extended",
      width: 130,
      align: "right",
      sortValue: (l) => l.extended,
      render: (l) =>
        canEdit ? (
          <InlineValue
            table="vendor_invoice_lines"
            id={l.id}
            column="extended"
            value={l.extended}
            kind="number"
            align="right"
            format={(v) => money(Number(v))}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {money(l.extended)}
          </span>
        ),
    },
    {
      key: "po",
      label: "PO line",
      width: 200,
      sortValue: (l) => l.purchase_order_id,
      render: (l) => {
        const order = linkedOrders.find((o) => o.id === l.purchase_order_id);
        if (!order) {
          return (
            <span className="text-faint">
              {l.kind === "item" ? "—" : ATTACHMENT_LINE_KIND[l.kind]}
            </span>
          );
        }
        const poLine = order.lines.find((p) => p.id === l.purchase_order_item_id);
        return (
          <span className="text-muted">
            <Link
              href={withFrom(`/purchase-orders/${order.id}`, {
                href: selfHref,
                label: invoice.invoice_number ?? "Invoice",
              })}
              className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
            >
              {order.po_number}
            </Link>
            {poLine && (
              <span className="block truncate text-[12px]">
                {poLine.vendor_items?.inventory_items?.name ?? poLine.description ?? ""}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {/* The duplicate band, above the fields where you'll see it before you
          work. Yellow, not red: it is worth your eye, not necessarily wrong —
          a credit memo legitimately carries the number it credits. */}
      {duplicates.length > 0 && (
        <div className="border border-ink bg-mark-fill px-4 py-3 text-sm text-ink">
          <p className="font-semibold">This may be a duplicate.</p>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.invoice.id}>
                <Link
                  href={withFrom(`/invoices/${d.invoice.id}`, {
                    href: selfHref,
                    label: invoice.invoice_number ?? "Invoice",
                  })}
                  className="underline decoration-neutral-500 underline-offset-[3px] hover:decoration-neutral-900"
                >
                  {d.invoice.invoice_number ?? "No number"}
                </Link>{" "}
                <span className="text-muted">
                  — {d.reason}
                  {d.invoice.invoice_date ? ` · ${d.invoice.invoice_date}` : ""}
                  {d.invoice.total !== null ? ` · ${money(d.invoice.total)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
              {invoice.invoice_number ?? "No number"}
            </h1>
            <span
              className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${INVOICE_STATUS_CLASS[invoice.status]}`}
            >
              {INVOICE_STATUS_LABEL[invoice.status]}
            </span>
            {invoice.is_credit && (
              <span className="inline-flex h-6 items-center border border-ink bg-mark-fill px-2 text-[12px] font-semibold uppercase tracking-[0.12em]">
                Credit memo
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {invoice.vendors?.name ?? "No vendor"} · {locationCode}
            {invoice.due_date &&
              ` · ${AGING_LABEL[agingBucket(invoice.due_date, todayLocal())]}`}
          </p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Total
          </div>
          <div className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
            {money(signedTotal(invoice))}
          </div>
        </div>
      </div>

      {(attachError || documentError || linkError) && (
        <p className="border border-accent px-4 py-3 text-sm text-accent">
          {attachError ?? documentError ?? linkError}
        </p>
      )}
      {phase.kind !== "idle" && (
        <p className="text-sm text-muted">{phase.label}</p>
      )}

      {/* Document left, record right. Sticky rather than measured — see the
          note on this component. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 xl:sticky xl:top-[calc(var(--rf-header-h)+1rem)] xl:max-h-[calc(100vh-var(--rf-header-h)-6rem)]">
          <DocumentPane
            attachment={shown}
            attachments={attachments}
            canEdit={canEdit}
            busy={busy}
            onPick={setShownId}
            onFilesPicked={(files) => void upload(files, kind)}
            // Through the hook, so a refused drop reads the same here as on PO
            // detail and lands in the same line as an upload failure.
            onDropRejected={(rejected) => reportError(attachmentRejection(rejected))}
            onRead={(a) => void read(a)}
            onRemove={(a) => void remove(a)}
            fileRef={fileRef}
            kind={kind}
            onKindChange={setKind}
            stacked={false}
          />
        </div>

        <div className="min-w-0 space-y-16">
          {/* The bill itself. */}
          <section className="space-y-2">
            <SectionHeading>Bill</SectionHeading>
            <dl className="grid grid-cols-[9rem_1fr] items-baseline gap-y-1 text-sm">
              <Field label="Invoice number">
                <Cell canEdit={canEdit} value={invoice.invoice_number}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="invoice_number"
                    value={invoice.invoice_number}
                  />
                </Cell>
              </Field>
              <Field label="Invoice date">
                <Cell canEdit={canEdit} value={invoice.invoice_date}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="invoice_date"
                    value={invoice.invoice_date}
                    kind="date"
                  />
                </Cell>
              </Field>
              <Field label="Due date">
                <Cell canEdit={canEdit} value={invoice.due_date}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="due_date"
                    value={invoice.due_date}
                    kind="date"
                  />
                </Cell>
              </Field>
              {/* Free TEXT, not a PickList: the vocabulary is the vendor's, not
                  ours, and an allowNew-less list would make an unlisted value
                  unenterable — the GAL/QT lesson. */}
              <Field label="Terms">
                <Cell canEdit={canEdit} value={invoice.terms}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="terms"
                    value={invoice.terms}
                  />
                </Cell>
              </Field>
              <Field label="Vendor">
                <Cell canEdit={canEdit} value={invoice.vendors?.name ?? null}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="vendor_id"
                    value={invoice.vendor_id}
                    kind="pick"
                    nullable={false}
                    options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                  />
                </Cell>
              </Field>
              <Field label="Location">
                <Cell canEdit={canEdit} value={locationCode}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="location_id"
                    value={invoice.location_id}
                    kind="pick"
                    nullable={false}
                    options={locations.map((l) => ({
                      value: l.id,
                      label: l.code,
                      hint: l.name,
                    }))}
                  />
                </Cell>
              </Field>
              <Field label="Note">
                <Cell canEdit={canEdit} value={invoice.notes}>
                  <InlineValue
                    table="vendor_invoices"
                    id={invoice.id}
                    column="notes"
                    value={invoice.notes}
                  />
                </Cell>
              </Field>
            </dl>
          </section>

          {/* The money. */}
          <section className="space-y-2">
            <SectionHeading>Amounts</SectionHeading>
            <dl className="grid grid-cols-[9rem_1fr] items-baseline gap-y-1 text-sm">
              {(
                [
                  ["Subtotal", "subtotal", invoice.subtotal],
                  ["Tax", "tax", invoice.tax],
                  ["Freight", "freight", invoice.freight],
                  ["Other", "other_charges", invoice.other_charges],
                  ["Total", "total", invoice.total],
                ] as const
              ).map(([label, column, value]) => (
                <Field key={column} label={label}>
                  <Cell canEdit={canEdit} value={value === null ? null : money(value)}>
                    <InlineValue
                      table="vendor_invoices"
                      id={invoice.id}
                      column={column}
                      value={value}
                      kind="number"
                      format={(v) => money(Number(v))}
                    />
                  </Cell>
                </Field>
              ))}
            </dl>

            {/* Yellow, never red — "worth your eye", the ≈/? rule. A total that
                doesn't match its parts is usually a reading to correct, not a
                vendor who can't add up. */}
            {amounts.differs && (
              <p className="border border-ink bg-mark-fill px-4 py-2 text-sm">
                The parts add up to{" "}
                <strong className="tabular-nums">{money(amounts.computed)}</strong>,
                but the invoice says{" "}
                <strong className="tabular-nums">{money(amounts.stated)}</strong>.
                {amounts.missing.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    Nothing was read for {amounts.missing.join(", ")}.
                  </span>
                )}
              </p>
            )}
            {lineSums.differs && (
              <p className="border border-ink bg-mark-fill px-4 py-2 text-sm">
                The item lines come to{" "}
                <strong className="tabular-nums">{money(lineSums.computed)}</strong>{" "}
                against a subtotal of{" "}
                <strong className="tabular-nums">{money(lineSums.stated)}</strong>.
              </p>
            )}
          </section>

          {/* What it belongs to. */}
          <section className="space-y-2">
            <SectionHeading count={linkedOrders.length}>
              Purchase orders
            </SectionHeading>
            {linkedOrders.length === 0 ? (
              // A landlord bill should not be nagged about a purchase order.
              invoice.vendors?.order_type === "none" ? (
                <p className="text-sm text-muted">
                  This vendor isn&rsquo;t ordered from, so there&rsquo;s no
                  purchase order to link.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  No lines on this invoice point at a purchase order yet.
                </p>
              )
            ) : (
              <ul className="space-y-2 text-sm">
                {linkedOrders.map((order) => {
                  const count = lines.filter(
                    (l) => l.purchase_order_id === order.id
                  ).length;
                  return (
                    <li
                      key={order.id}
                      className="flex flex-wrap items-baseline gap-x-4 border border-hairline px-4 py-2"
                    >
                      <Link
                        href={withFrom(`/purchase-orders/${order.id}`, {
                          href: selfHref,
                          label: invoice.invoice_number ?? "Invoice",
                        })}
                        className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                      >
                        {order.po_number}
                      </Link>
                      <span className="text-muted">{order.order_date}</span>
                      <span className="text-muted">
                        {count} {count === 1 ? "line" : "lines"}
                      </span>
                      <Link
                        href={withFrom(`/purchase-orders/${order.id}/receive`, {
                          href: selfHref,
                          label: invoice.invoice_number ?? "Invoice",
                        })}
                        className="ml-auto text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
                      >
                        Reconcile
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* The lines. */}
          <DataTable
            rows={lines}
            columns={columns}
            rowKey={(l) => l.id}
            storageKey={INVOICE_LINE_WIDTHS_KEY}
            columnChooser
            leading={<SectionHeading count={lines.length}>Lines</SectionHeading>}
            empty={
              <p className="text-sm text-muted">
                No lines — a one-line bill doesn&rsquo;t need any.
              </p>
            }
          />
        </div>
      </div>

      <InvoiceFooter
        invoiceId={invoice.id}
        status={invoice.status}
        approvedAt={invoice.approved_at}
        caveats={caveats}
        canApprove={canApprove}
        canEdit={canEdit}
        closeHref={closeHref}
        supabase={supabase}
        onDone={() => router.refresh()}
      />
    </>
  );
}

const ATTACHMENT_LINE_KIND: Record<VendorInvoiceLine["kind"], string> = {
  item: "—",
  freight: "Freight",
  other: "Other",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * An editable cell, or the same value as plain text below purchaser+.
 *
 * The read-only branch wears InlineValue's own resting padding — without it a
 * plain string starts 4px to the left of the cells above it and the whole
 * column looks broken (Mark, 2026-08-02, on a PO's sent_via).
 */
function Cell({
  canEdit,
  value,
  children,
}: {
  canEdit: boolean;
  value: string | number | null;
  children: React.ReactNode;
}) {
  if (canEdit) return <>{children}</>;
  return (
    <span className={READ_ONLY_VALUE}>
      {value === null || value === "" ? "—" : value}
    </span>
  );
}

/** Vendor names differ by punctuation and case far more often than by identity. */
function normalizedEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

/** The browser's day, for the aging chip only — the LIST computes its buckets
 *  from the org's timezone on the server, which is what the filters use. */
function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
