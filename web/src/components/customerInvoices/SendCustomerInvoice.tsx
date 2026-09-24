"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { FORM_FIELD_DRESS } from "@/components/ui/fieldMetrics";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { customerLabel, money, readSettings } from "@/lib/specialOrders";
import {
  DEFAULT_TEMPLATES,
  fillTemplate,
  orgDocHeader,
  usDate,
  type DocOrg,
} from "@/lib/specialOrderDocs";
import {
  bindPaySnapshot,
  breakdownFromTotals,
  mintPayToken,
  resolveAppBase,
} from "@/lib/specialOrderSend";
import { payLine, payUrl, quickBooksPayLine } from "@/lib/payLink";
import { invokeQbo } from "@/lib/qboClient";
import {
  INVOICE_SHEET_KEY,
  QBO_LINK_PLACEHOLDER,
  attachableFromResponse,
  attachableMetadata,
  buildCustomerInvoicePayload,
  customerInvoiceRefusals,
  qboVendorId,
  recordedAttachments,
  taxDisagreement,
  withAttachments,
  type AccountingRef,
  type CustomerInvoicePushInputs,
} from "@/lib/quickbooks";
import { fetchInvoiceView, type InvoiceView } from "@/lib/customerInvoiceQueries";
import { QuickBooksCustomerStep } from "@/components/specialOrders/QuickBooksCustomerStep";
import {
  invoiceFileName,
  invoiceNumberText,
  readInvoiceTerms,
  sumBreakdowns,
  type CustomerInvoiceSnapshot,
} from "@/lib/customerInvoices";

/** The org row the documents need: its name, settings and the doc header. */
export async function loadOrg(supabase: SupabaseClient) {
  const { data: org } = await supabase.from("orgs").select("name, settings").maybeSingle();
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const so = (settings.special_orders ?? {}) as Record<string, unknown>;
  const doc: DocOrg = {
    ...orgDocHeader((org?.name as string) ?? "", settings),
    terms: typeof so.terms === "string" ? so.terms : "",
    invoiceFooter: typeof so.invoice_footer === "string" ? so.invoice_footer : "",
  };
  return { settings, doc };
}

/** The invoice as a PDF, from the same read the record screen draws. */
export async function renderInvoicePdf(supabase: SupabaseClient, id: string, today: string) {
  const [{ settings, doc }, { pdf }, docs] = await Promise.all([
    loadOrg(supabase),
    import("@react-pdf/renderer"),
    import("@/components/specialOrders/pdf/SpecialOrderPdfs"),
  ]);
  const view = await fetchInvoiceView(supabase, id, readSettings(settings).rush);
  if (!view) throw new Error("That invoice is gone.");
  const terms = readInvoiceTerms(settings);
  const blob = await pdf(
    <docs.CustomerInvoicePdf
      org={doc}
      invoice={{
        number: invoiceNumberText(view.invoice.number, terms),
        issued_on: view.invoice.issued_on ?? today,
        due_on: view.invoice.due_on,
        notes: view.invoice.notes,
        customer: {
          name: view.customerName,
          phone: view.customer?.phone ?? null,
          email: view.customer?.email ?? null,
        },
        lines: view.lines.map((l) => ({
          description: l.description,
          amount: l.amount,
          detail: view.lines.length === 1 ? itemDetail(l) : undefined,
        })),
        total: view.total,
        paid: view.paid,
        balance: view.balance,
      }}
    />
  ).toBlob();
  return { blob, view, settings, doc, terms };
}

/**
 * A one-order invoice's itemization (2026-09-23): each item, then the order's
 * own money in the order its record shows it, then anything paid before the
 * invoice — so the rows add up to the line's amount.
 */
function itemDetail(l: InvoiceView["lines"][number]): { rows: { label: string; amount: number }[] } | undefined {
  if (!l.totals) return undefined;
  const rows: { label: string; amount: number }[] = l.items.map((i) => ({
    label: `${i.qty % 1 === 0 ? i.qty : i.qty.toFixed(2)} × ${i.name} @ ${money(i.unit_price)}`,
    amount: Math.round(i.qty * i.unit_price * 100) / 100,
  }));
  const t = l.totals;
  if (t.discount) rows.push({ label: "Discount", amount: -t.discount });
  if (t.deliveryCharge) rows.push({ label: "Delivery", amount: t.deliveryCharge });
  if (t.rushFee) rows.push({ label: "Rush fee", amount: t.rushFee });
  if (t.tax) rows.push({ label: "Tax", amount: t.tax });
  const earlier = Math.round((t.total - l.amount) * 100) / 100;
  if (Math.abs(earlier) >= 0.01) {
    // A cancelled order bills nothing (128); anything else in the gap is money
    // taken before the invoice, a deposit.
    rows.push({
      label: l.order?.status === "cancelled" ? "Order cancelled" : "Paid before this invoice",
      amount: -earlier,
    });
  }
  return { rows };
}

type Compose = { to: string; cc: string; subject: string; body: string };

/**
 * SEND A CUSTOMER INVOICE (migration 124) — `SendDocument`'s compose card for
 * an invoice that covers several orders.
 *
 * THE SAME ORDER OF EVENTS, and for the same reasons: the app's address is
 * resolved BEFORE a pay token is minted (no orphan tokens), the token is
 * minted when the card OPENS so the link in the body is real and editable,
 * and the snapshot — what `/pay` shows and the TOTAL it charges against — is
 * written BEFORE the send, so a customer can never hold a link that says the
 * invoice does not exist. The edge function then stamps the invoice and every
 * order on it as sent, files the PDF, and retires older links.
 *
 * Re-sending is allowed and ordinary: a new link supersedes the old one, and
 * the sent date stays the first send's.
 */
export function SendCustomerInvoice({
  id,
  orgId,
  numberText,
  today,
  resend,
  disabled,
  children,
  autoOpen = null,
}: {
  id: string;
  orgId: string;
  numberText: string;
  today: string;
  resend: boolean;
  disabled: boolean;
  /** Hands its row UP to the record's one Actions menu and keeps drawing its
   *  own compose card — `SendDocument`'s render-prop shape. */
  children: (items: ActionMenuItem[]) => ReactNode;
  /**
   * Open the compose card on arrival — the page was reached with
   * `?send=<code>` from Create and Send, or from an order's Send ▸ Invoice
   * (2026-09-23). ONCE PER CODE: the code is remembered in sessionStorage, so
   * coming back to the page from Next's cache — which still carries the
   * original URL's props — does not open it again.
   */
  autoOpen?: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<"compose" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  /** An unlinked customer on a QuickBooks invoice: link or create them first,
   *  then compose. */
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    blob: Blob;
    url: string;
    filename: string;
    payToken: string | null;
    /** A QuickBooks invoice (131): pushed at Send, its link swapped in for
     *  the placeholder. `billEmail` is filled from To at that moment. */
    qbo: Omit<CustomerInvoicePushInputs, "billEmail"> | null;
    snapshot: CustomerInvoiceSnapshot;
    breakdown: (ReturnType<typeof breakdownFromTotals> & {
      lines: Record<string, ReturnType<typeof breakdownFromTotals>>;
    }) | null;
  } | null>(null);

  function close() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setCompose(null);
    setError(null);
  }

  const open = async () => {
    setBusy("compose");
    setError(null);
    setSentNote(null);
    try {
      const { blob, view, settings, doc, terms } = await renderInvoicePdf(supabase, id, today);
      const number = invoiceNumberText(view.invoice.number, terms);

      // The pay link, on SendDocument's terms: only when online payment is
      // configured and something is owed; the address resolved first.
      const sq = (settings.square_payments ?? {}) as Record<string, unknown>;
      const configured = typeof sq.application_id === "string" && sq.application_id.trim() !== "";
      const viaQbo = view.invoice.processor === "quickbooks";
      let payToken: string | null = null;
      let pay = "";
      let qbo: Omit<CustomerInvoicePushInputs, "billEmail"> | null = null;
      if (viaQbo) {
        // QuickBooks' link only exists once the invoice is pushed, which
        // happens at Send — so the body carries a placeholder until then.
        qbo = await quickBooksInputs(supabase, orgId, view, number);
        if (!qbo.customerRef && view.invoice.customer_id) {
          setLinkFor(view.invoice.customer_id);
          return;
        }
        const refusals = customerInvoiceRefusals({ ...qbo, billEmail: view.customer?.email ?? "-" });
        if (refusals.length > 0) throw new Error(refusals[0]);
        if (view.balance > 0.005) pay = QBO_LINK_PLACEHOLDER;
      } else if (configured && view.balance > 0.005) {
        const resolved = resolveAppBase(window.location.origin);
        if ("error" in resolved) throw new Error(resolved.error);
        payToken = await mintPayToken(supabase, { customerInvoiceId: id, orgId });
        pay = payUrl(payToken, resolved.base);
      }

      const snapshot = invoiceSnapshotOf(view, number, doc, today);
      // Each line's own split as well as the sum (126): the Square order is
      // cut per ITEM from these, since a line's item can change after send.
      const perLine = Object.fromEntries(
        view.lines
          .filter((l) => l.totals)
          .map((l) => [l.id, breakdownFromTotals(l.totals!, l.order?.tax_rate ?? null)])
      );
      const summed = sumBreakdowns(Object.values(perLine));
      const breakdown = summed ? { ...summed, lines: perLine } : null;

      setCompose(invoiceEmail(view, number, settings, pay, viaQbo));
      setPending({
        blob,
        url: URL.createObjectURL(blob),
        filename: invoiceFileName(number, view.invoice.issued_on ?? today),
        payToken,
        qbo,
        snapshot,
        breakdown,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    const key = `rf.invoice-send.${autoOpen}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable (private window): the ref still stops a repeat
      // within this mount, which is the best available.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("send");
    window.history.replaceState(null, "", url.toString());
    // A tick later, outside the effect body (React's set-state-in-effect
    // rule). Not cancelled on cleanup: development's double effect run would
    // cancel the only opening, since the ref already stops the second.
    queueMicrotask(() => void open());
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const send = async () => {
    if (!compose || !pending) return;
    setBusy("send");
    setError(null);
    try {
      if (pending.payToken) {
        await bindPaySnapshot(supabase, pending.payToken, pending.snapshot, pending.breakdown);
      }
      // QUICKBOOKS FIRST (131): the invoice goes in, its pay link comes back,
      // and only then does the email go — a failed push sends nothing.
      let body = compose.body;
      const qboNotes: string[] = [];
      if (pending.qbo) {
        const pushed = await pushToQuickBooks(supabase, pending.qbo, compose.to, pending.blob, pending.filename);
        body = body.split(QBO_LINK_PLACEHOLDER).join(pushed.link);
        qboNotes.push(...pushed.warnings);
        // It is in QuickBooks now. Should the email fail, Send again must
        // UPDATE that invoice, not try to create a second.
        const qbo = { ...pending.qbo, invoice: { ...pending.qbo.invoice, external_ref: pushed.ref } };
        setPending((p) => (p ? { ...p, qbo } : p));
      }
      const { data, error: e } = await supabase.functions.invoke("send-special-order-email", {
        body: {
          customer_invoice_id: id,
          to: compose.to,
          cc: compose.cc || undefined,
          subject: compose.subject,
          body,
          pdf_base64: await blobToBase64(pending.blob),
          filename: pending.filename,
          pay_token: pending.payToken ?? undefined,
        },
      });
      if (e) {
        let message = e.message;
        try {
          const parsed = await (e as { context?: Response }).context?.json();
          if (parsed?.error) message = parsed.error;
        } catch {
          // keep the generic message
        }
        throw new Error(message);
      }
      const warning = [(data as { warning?: string } | null)?.warning, ...qboNotes]
        .filter(Boolean)
        .join(" ");
      const to = compose.to;
      close();
      setSentNote(
        `Invoice ${numberText} ${pending.qbo ? "sent to QuickBooks and emailed" : "sent"} to ${to}` +
          `${warning ? ` — ${warning}` : ""}`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {children([
        {
          label: busy === "compose" ? "Loading…" : resend ? "Send Again…" : "Send…",
          onSelect: () => void open(),
          disabled: disabled || busy !== null,
        },
      ])}
      {sentNote && <p className="max-w-sm text-right text-[13px] text-[var(--rf-green-600)]">{sentNote}</p>}
      {error && !compose && <p className="max-w-sm text-right text-[13px] text-accent">{error}</p>}

      {linkFor && (
        <QuickBooksCustomerStep
          customerId={linkFor}
          onClose={() => setLinkFor(null)}
          onLinked={() => {
            setLinkFor(null);
            void open();
          }}
        />
      )}

      {compose && pending && (
        <Dialog
          title={`Email invoice #${numberText}`}
          onClose={close}
          busy={busy !== null}
          width="max-w-5xl"
          top="pt-[4vh]"
          height="h-[88vh]"
          bodyClassName="grid min-h-0 gap-4 p-6 md:grid-cols-2 md:grid-rows-1"
          footer={
            <>
              <span className="mr-auto text-xs text-subtle">
                Attached: {pending.filename} — the document shown here is what sends
              </span>
              <button type="button" disabled={busy !== null} onClick={close} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || !compose.to.trim()}
                onClick={send}
                className={DIALOG_COMMIT_CLASS}
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2 gap-y-1.5">
              {(
                [
                  ["To", "to"],
                  ["Cc", "cc"],
                  ["Subject", "subject"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="contents">
                  <span className="text-xs uppercase tracking-[0.12em] text-subtle">{label}</span>
                  <TextInput
                    value={compose[field]}
                    disabled={busy !== null}
                    onValueChange={(next) => setCompose({ ...compose, [field]: next })}
                    clearLabel={`Clear ${label}`}
                    className="w-full"
                  />
                </label>
              ))}
              <span className="self-start pt-1 text-xs uppercase tracking-[0.12em] text-subtle">Body</span>
              <textarea
                value={compose.body}
                rows={14}
                disabled={busy !== null}
                onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                className={FORM_FIELD_DRESS}
              />
            </div>
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>

          <object
            data={pending.url}
            type="application/pdf"
            aria-label={`Preview of ${pending.filename}`}
            className="h-[26rem] w-full border border-ink md:h-full md:min-h-[26rem]"
          >
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-subtle">
              This browser can&apos;t preview PDFs inline — use Preview to open it in its own tab.
            </div>
          </object>
        </Dialog>
      )}
    </>
  );
}

function invoiceSnapshotOf(
  view: InvoiceView,
  number: string,
  org: DocOrg,
  today: string
): CustomerInvoiceSnapshot {
  return {
    kind: "customer_invoice",
    number,
    title: view.customerName,
    customer_name: view.customerName,
    issued_on: view.invoice.issued_on,
    due_on: view.invoice.due_on,
    lines: view.lines.map((l) => ({ description: l.description, amount: l.amount })),
    // THE INVOICE'S WHOLE TOTAL, not what is owed at send: `pay_token_state`
    // subtracts every payment tagged with the invoice, so a link re-sent
    // after a part-payment still asks for the rest and no more.
    totals: { total: view.total },
    notes_quote: view.invoice.notes,
    org: { name: org.name, addressLine: org.addressLine, contactLine: org.contactLine, terms: org.terms },
    sent_on: today,
  };
}

/** The email, from `orgs.settings.special_orders.email.customer_invoice` or
 *  the default — blank means default, as `buildDocumentEmail` reads it. */
function invoiceEmail(
  view: InvoiceView,
  number: string,
  settings: Record<string, unknown>,
  pay: string,
  viaQbo = false
): Compose {
  const so = (settings.special_orders ?? {}) as Record<string, unknown>;
  const templates = (so.email ?? {}) as Record<string, { subject?: string; body?: string }>;
  const configured = templates.customer_invoice ?? {};
  const fallback = DEFAULT_TEMPLATES.customer_invoice;
  const orDefault = (v: string | undefined, f: string) => (typeof v === "string" && v.trim() !== "" ? v : f);
  const fullName = customerLabel(view.customer);
  const vars: Record<string, string> = {
    number,
    first_name: (view.customer?.first_name ?? "").trim() || fullName.split(/\s+/)[0] || "there",
    full_name: fullName,
    total: money(view.balance),
    due_on: view.invoice.due_on ? usDate(view.invoice.due_on) : "on receipt",
    orders: view.lines.map((l) => `${l.description} — ${money(l.amount)}`).join("\n"),
    pay_url: pay,
    pay_line: viaQbo ? quickBooksPayLine(pay) : payLine(pay),
  };
  return {
    to: (view.customer?.email ?? "").trim(),
    cc: typeof so.email_cc === "string" ? so.email_cc : "",
    subject: fillTemplate(orDefault(configured.subject, fallback.subject), vars),
    body: fillTemplate(orDefault(configured.body, fallback.body), vars),
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** What the QuickBooks push needs beyond the invoice view: the connection's
 *  items and tax code, and the customer's QuickBooks id. */
export async function quickBooksInputs(
  supabase: SupabaseClient,
  orgId: string,
  view: InvoiceView,
  number: string
): Promise<Omit<CustomerInvoicePushInputs, "billEmail">> {
  const [conn, customer, org] = await Promise.all([
    supabase.rpc("accounting_connection_status", { p_org: orgId }),
    view.invoice.customer_id
      ? supabase
          .from("customers")
          .select("external_ref")
          .eq("id", view.invoice.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
  ]);
  const row = Array.isArray(conn.data)
    ? (conn.data[0] as
        | {
            status?: string;
            invoice_item_ref?: string | null;
            wholesale_item_ref?: string | null;
            tax_code_ref?: string | null;
          }
        | undefined)
    : undefined;
  if (row?.status !== "connected") {
    throw new Error("QuickBooks is not connected. Connect it in Settings → Accounting.");
  }
  return {
    invoice: {
      id: view.invoice.id,
      number_text: number,
      issued_on: view.invoice.issued_on,
      due_on: view.invoice.due_on,
      voided_at: view.invoice.voided_at,
      external_ref: (view.invoice.external_ref ?? null) as AccountingRef | null,
    },
    customerName: view.customerName,
    orgName: (org.data?.name as string | undefined) ?? "",
    customerRef: qboVendorId((customer?.data?.external_ref ?? null) as AccountingRef | null),
    itemRef: row?.invoice_item_ref ?? null,
    wholesaleItemRef: row?.wholesale_item_ref ?? null,
    taxCodeRef: row?.tax_code_ref ?? null,
    lines: view.lines.map((l) => ({
      description: l.description,
      amount: l.amount,
      square_item: l.square_item,
      cancelled: l.order?.status === "cancelled",
      totals: l.totals,
    })),
  };
}

/**
 * Push (or update) the invoice in QuickBooks with the PDF being emailed
 * attached, record the attachment, and hand back the pay link. Throws on any
 * failure, so the caller sends nothing.
 */
export async function pushToQuickBooks(
  supabase: SupabaseClient,
  inputs: Omit<CustomerInvoicePushInputs, "billEmail">,
  to: string,
  pdf: Blob,
  fileName: string
): Promise<{ link: string; warnings: string[]; ref: AccountingRef }> {
  // The first address only: QuickBooks' BillEmail is one address.
  const billEmail = to.split(/[,;]/)[0]?.trim() ?? "";
  const { body } = buildCustomerInvoicePayload({ ...inputs, billEmail });
  const ref = inputs.invoice.external_ref;
  const previousSheet = recordedAttachments(ref)[INVOICE_SHEET_KEY] ?? null;
  const sheet = {
    key: INVOICE_SHEET_KEY,
    file_name: fileName,
    content_type: "application/pdf",
    metadata: attachableMetadata({
      entity: "Invoice",
      entityId: ref?.qbo?.id ?? "0",
      fileName,
      contentType: "application/pdf",
    }),
    pdf_base64: await blobToBase64(pdf),
  };

  const { data, message } = await invokeQbo(supabase, {
    mode: "push_customer_invoice",
    customer_invoice_id: inputs.invoice.id,
    payload: body,
    attachments: [sheet],
    ...(previousSheet ? { replace_attachable_id: previousSheet } : {}),
  });
  if (message) throw new Error(`QuickBooks: ${message} Nothing was emailed.`);
  const link = String(data?.invoice_link ?? "");
  if (!link) throw new Error("QuickBooks gave no pay link. Nothing was emailed.");

  const warnings: string[] = [...((data?.warnings as string[]) ?? [])];
  const added: Record<string, string> = {};
  for (const r of (data?.attachment_results as { key: string; response?: unknown; error?: string }[]) ?? []) {
    if (r.error) { warnings.push(r.error); continue; }
    const read = attachableFromResponse(r.response);
    if (read.ok) added[r.key] = read.id;
    else warnings.push(`The invoice PDF was not attached in QuickBooks: ${read.message}`);
  }
  let recorded = data!.ref as AccountingRef;
  if (Object.keys(added).length > 0) {
    recorded = withAttachments(recorded, added);
    const { error } = await supabase
      .from("customer_invoices")
      .update({ external_ref: recorded })
      .eq("id", inputs.invoice.id)
      .select("id");
    if (error) warnings.push("The PDF went up to QuickBooks but was not recorded, so the next send attaches a second copy.");
  }
  const ourTax = inputs.lines.reduce((a, l) => a + Number(l.totals?.tax ?? 0), 0);
  const theirs = taxDisagreement(Math.round(ourTax * 100) / 100, data?.tax as number | undefined);
  if (theirs) warnings.push(theirs);
  return { link, warnings, ref: recorded };
}

